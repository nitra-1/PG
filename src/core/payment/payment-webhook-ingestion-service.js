const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const config = require('../../config/config');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const { outboxService } = require('../outbox/outbox-service');
const paymentStateMachine = require('./payment-state-machine');
const verificationService = require('./gateway-webhook-verification-service');
const paymentSignalService = require('./payment-signal-service');
const { rawBodyString } = require('./gateway-webhook-verification-service');

function normalizedGatewayName(gatewayName) {
  return String(gatewayName || '').toLowerCase();
}

function parseBody(rawBody, parsedBody) {
  if (parsedBody && !Buffer.isBuffer(parsedBody)) return parsedBody;
  const raw = rawBodyString(rawBody, null);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function payloadHash(rawBody, parsedBody) {
  return crypto.createHash('sha256').update(rawBodyString(rawBody, parsedBody)).digest('hex');
}

function statusIsCaptured(status) {
  return paymentStateMachine.logicalStatusFromGateway(status) === 'CAPTURED';
}

function amountDiff(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Math.abs(a - b);
}

class PaymentWebhookIngestionService {
  constructor({
    verifier = verificationService,
    stateMachine = paymentStateMachine,
    signalService = paymentSignalService
  } = {}) {
    this.verifier = verifier;
    this.stateMachine = stateMachine;
    this.signalService = signalService;
  }

  async deriveTenantId(event, trustedTenantId = null) {
    if (trustedTenantId) return trustedTenantId;

    const transactionPredicates = [
      event.gatewayPaymentId ? ['gateway_transaction_id', event.gatewayPaymentId] : null,
      event.transactionRef ? ['transaction_ref', event.transactionRef] : null,
      event.orderId ? ['order_id', event.orderId] : null
    ].filter(Boolean);

    if (transactionPredicates.length > 0) {
      const transactionQuery = db.knex('transactions').where(function() {
        for (const [column, value] of transactionPredicates) {
          this.orWhere(column, value);
        }
      });
      const transaction = await transactionQuery.first();
      if (transaction?.tenant_id) return transaction.tenant_id;
    }

    const orderPredicates = [
      event.orderId ? ['order_id', event.orderId] : null,
      event.gatewayOrderId ? ['gateway_order_id', event.gatewayOrderId] : null
    ].filter(Boolean);

    if (orderPredicates.length > 0) {
      const orderQuery = db.knex('payment_orders').where(function() {
        for (const [column, value] of orderPredicates) {
          this.orWhere(column, value);
        }
      });
      const order = await orderQuery.first();
      if (order?.tenant_id) return order.tenant_id;
    }

    return config.webhooks?.defaultTenantId || config.defaultTenantId;
  }

  async findExistingWebhook({ tenantId, gatewayName, gatewayEventId, hash }) {
    let query = db.knex('gateway_webhook_events')
      .where({ tenant_id: tenantId, gateway_name: gatewayName });

    if (gatewayEventId) {
      query = query.where('gateway_event_id', gatewayEventId);
    } else {
      query = query.where('payload_hash', hash).whereNull('gateway_event_id');
    }

    return query.first();
  }

  async insertReceivedWebhook({ tenantId, gatewayName, event, rawPayload, rawHeaders, hash, signatureHeader, correlationId }) {
    const insertData = {
      id: uuidv4(),
      tenant_id: tenantId,
      gateway_name: gatewayName,
      gateway_event_id: event.gatewayEventId,
      gateway_event_type: event.gatewayEventType,
      gateway_payment_id: event.gatewayPaymentId,
      gateway_order_id: event.gatewayOrderId,
      transaction_ref: event.transactionRef,
      order_id: event.orderId,
      raw_payload: rawPayload,
      raw_headers: rawHeaders,
      payload_hash: hash,
      signature_header: signatureHeader || null,
      signature_verified: false,
      verification_status: 'PENDING',
      event_created_at: event.eventCreatedAt,
      received_at: new Date(),
      processing_status: 'RECEIVED',
      retry_count: 0,
      correlation_id: correlationId || null,
      metadata: {
        parsed_status: event.status,
        amount: event.amount,
        currency: event.currency
      }
    };

    try {
      const [webhookEvent] = await db.knex('gateway_webhook_events')
        .insert(insertData)
        .returning('*');
      return { webhookEvent, duplicate: false };
    } catch (error) {
      if (error.code === '23505') {
        const existing = await this.findExistingWebhook({
          tenantId,
          gatewayName,
          gatewayEventId: event.gatewayEventId,
          hash
        });
        if (existing) return { webhookEvent: existing, duplicate: true };
      }
      throw error;
    }
  }

  async markDuplicate(existingEvent, event, correlationId) {
    await this.signalService.createOrUpdateSignal({
      tenantId: existingEvent.tenant_id,
      signalType: 'DUPLICATE_GATEWAY_EVENT',
      sourceType: 'WEBHOOK',
      sourceId: existingEvent.id,
      transactionRef: existingEvent.transaction_ref,
      gatewayName: existingEvent.gateway_name,
      gatewayPaymentId: existingEvent.gateway_payment_id,
      gatewayEventId: existingEvent.gateway_event_id,
      description: `Duplicate webhook delivery received for gateway event ${existingEvent.gateway_event_id || existingEvent.payload_hash}`,
      correlationId,
      metadata: {
        duplicate_received_at: new Date().toISOString(),
        incoming_gateway_event_id: event.gatewayEventId
      }
    });

    logger.info('Duplicate gateway webhook ignored', {
      tenant_id: existingEvent.tenant_id,
      webhook_event_id: existingEvent.id,
      gateway_event_id: existingEvent.gateway_event_id,
      correlation_id: correlationId || null
    });

    return {
      webhookEvent: {
        ...existingEvent,
        processing_status: 'DUPLICATE'
      },
      duplicate: true,
      processed: false,
      status: 'DUPLICATE'
    };
  }

  async findTransactionForEvent(query, tenantId, event) {
    const predicates = [
      event.gatewayPaymentId ? ['gateway_transaction_id', event.gatewayPaymentId] : null,
      event.transactionRef ? ['transaction_ref', event.transactionRef] : null,
      event.orderId ? ['order_id', event.orderId] : null
    ].filter(Boolean);

    if (predicates.length === 0) return null;

    const txQuery = query('transactions')
      .where('tenant_id', tenantId)
      .where(function() {
        for (const [column, value] of predicates) {
          this.orWhere(column, value);
        }
      }
    );

    return txQuery.forUpdate().first();
  }

  async createWebhookSignal(signalType, { tenantId, webhookEvent, event, transaction = null, description, impactAmount = null, metadata = {} }, trx = null) {
    return this.signalService.createOrUpdateSignal({
      tenantId,
      signalType,
      sourceType: signalType === 'GATEWAY_STATUS_CONFLICT' ? 'GATEWAY_VERIFICATION' : 'WEBHOOK',
      sourceId: webhookEvent.id,
      transactionId: transaction?.id || null,
      transactionRef: transaction?.transaction_ref || event.transactionRef || webhookEvent.transaction_ref,
      gatewayName: webhookEvent.gateway_name,
      gatewayPaymentId: event.gatewayPaymentId || webhookEvent.gateway_payment_id,
      gatewayEventId: event.gatewayEventId || webhookEvent.gateway_event_id,
      impactAmount,
      currency: event.currency || transaction?.currency || null,
      description,
      correlationId: webhookEvent.correlation_id,
      metadata
    }, trx);
  }

  async updateWebhookStatus(webhookEventId, updateData, trx = null) {
    const query = trx || db.knex;
    const [updated] = await query('gateway_webhook_events')
      .where('id', webhookEventId)
      .update({
        ...updateData,
        updated_at: new Date()
      })
      .returning('*');
    return updated;
  }

  async rejectVerifiedWebhook({ webhookEvent, event, transaction = null, signalType, processingStatus, reason, impactAmount = null, metadata = {} }, trx = null) {
    await this.createWebhookSignal(signalType, {
      tenantId: webhookEvent.tenant_id,
      webhookEvent,
      event,
      transaction,
      description: reason,
      impactAmount,
      metadata
    }, trx);

    return this.updateWebhookStatus(webhookEvent.id, {
      verification_status: webhookEvent.verification_status === 'VERIFIED' ? 'VERIFIED' : webhookEvent.verification_status,
      processing_status: processingStatus,
      failure_reason: reason,
      processed_at: new Date()
    }, trx);
  }

  async ingestWebhook(params) {
    const {
      tenantId: trustedTenantId = null,
      gatewayName,
      rawBody,
      parsedBody,
      headers = {},
      correlationId = requestContext.getCorrelationId()
    } = params;

    const normalizedGateway = normalizedGatewayName(gatewayName);
    if (!normalizedGateway) throw new Error('gatewayName is required');

    const body = parseBody(rawBody, parsedBody);
    const event = this.verifier.parseGatewayEvent({
      gatewayName: normalizedGateway,
      rawPayload: body,
      headers
    });
    const hash = payloadHash(rawBody, body);
    const verification = this.verifier.verifyWebhookSignature({
      gatewayName: normalizedGateway,
      rawBody,
      parsedBody: body,
      headers,
      tenantId: trustedTenantId
    });
    const tenantId = await this.deriveTenantId(event, trustedTenantId);

    const existing = await this.findExistingWebhook({
      tenantId,
      gatewayName: normalizedGateway,
      gatewayEventId: event.gatewayEventId,
      hash
    });

    if (existing) {
      return this.markDuplicate(existing, event, correlationId);
    }

    const { webhookEvent } = await this.insertReceivedWebhook({
      tenantId,
      gatewayName: normalizedGateway,
      event,
      rawPayload: body,
      rawHeaders: headers,
      hash,
      signatureHeader: verification.signatureHeader,
      correlationId
    });

    try {
      if (!verification.verified) {
        const signalType = verification.replayRejected ? 'WEBHOOK_REPLAY_DETECTED' : 'WEBHOOK_SIGNATURE_FAILED';
        const processingStatus = verification.replayRejected ? 'REPLAY_REJECTED' : 'FAILED';

        const updated = await db.knex.transaction(async (trx) => {
          await this.createWebhookSignal(signalType, {
            tenantId,
            webhookEvent,
            event,
            description: verification.reason,
            metadata: {
              verification_reason: verification.reason,
              replay_rejected: Boolean(verification.replayRejected)
            }
          }, trx);

          return this.updateWebhookStatus(webhookEvent.id, {
            signature_verified: false,
            verification_status: 'FAILED',
            processing_status: processingStatus,
            failure_reason: verification.reason,
            processed_at: new Date()
          }, trx);
        });

        return {
          webhookEvent: updated,
          processed: false,
          status: updated.processing_status,
          reason: verification.reason
        };
      }

      const result = await db.knex.transaction(async (trx) => {
        let currentWebhook = await this.updateWebhookStatus(webhookEvent.id, {
          signature_verified: true,
          verification_status: 'VERIFIED',
          processing_status: 'VERIFIED'
        }, trx);

        const transaction = await this.findTransactionForEvent(trx, tenantId, event);
        if (!transaction) {
          const updated = await this.rejectVerifiedWebhook({
            webhookEvent: currentWebhook,
            event,
            signalType: 'PAYMENT_WITHOUT_ORDER',
            processingStatus: 'IGNORED',
            reason: `Webhook payment ${event.gatewayPaymentId || event.orderId || 'unknown'} does not map to an internal transaction`,
            impactAmount: event.amount,
            metadata: {
              gateway_order_id: event.gatewayOrderId,
              order_id: event.orderId,
              transaction_ref: event.transactionRef
            }
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status };
        }

        const gatewayVerification = await this.verifier.verifyGatewayPaymentStatus({
          gatewayName: normalizedGateway,
          gatewayPaymentId: event.gatewayPaymentId || transaction.gateway_transaction_id,
          expectedAmount: transaction.amount,
          expectedCurrency: transaction.currency,
          event
        });

        const incomingLogicalStatus = this.stateMachine.logicalStatusFromGateway(event.status);
        const verifiedLogicalStatus = this.stateMachine.logicalStatusFromGateway(gatewayVerification.status);
        if (!gatewayVerification.exists || (gatewayVerification.status && incomingLogicalStatus !== verifiedLogicalStatus)) {
          const updated = await this.rejectVerifiedWebhook({
            webhookEvent: currentWebhook,
            event,
            transaction,
            signalType: 'GATEWAY_STATUS_CONFLICT',
            processingStatus: 'FAILED',
            reason: `Gateway verification status conflict: webhook=${incomingLogicalStatus}, gateway=${verifiedLogicalStatus}`,
            impactAmount: event.amount,
            metadata: {
              gateway_verification: gatewayVerification
            }
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status };
        }

        const expectedAmount = Number(transaction.amount);
        const verifiedAmount = Number(gatewayVerification.amount ?? event.amount);
        if (!Number.isFinite(verifiedAmount) || amountDiff(expectedAmount, verifiedAmount) > 0.01) {
          const updated = await this.rejectVerifiedWebhook({
            webhookEvent: currentWebhook,
            event,
            transaction,
            signalType: 'PAYMENT_AMOUNT_MISMATCH',
            processingStatus: 'FAILED',
            reason: `Payment amount mismatch: transaction=${expectedAmount}, gateway=${verifiedAmount}`,
            impactAmount: Math.abs(expectedAmount - (Number.isFinite(verifiedAmount) ? verifiedAmount : 0)),
            metadata: {
              transaction_amount: expectedAmount,
              gateway_amount: verifiedAmount
            }
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status };
        }

        const transactionCurrency = String(transaction.currency || 'INR').toUpperCase();
        const gatewayCurrency = String(gatewayVerification.currency || event.currency || 'INR').toUpperCase();
        if (transactionCurrency !== gatewayCurrency) {
          const updated = await this.rejectVerifiedWebhook({
            webhookEvent: currentWebhook,
            event,
            transaction,
            signalType: 'PAYMENT_CURRENCY_MISMATCH',
            processingStatus: 'FAILED',
            reason: `Payment currency mismatch: transaction=${transactionCurrency}, gateway=${gatewayCurrency}`,
            impactAmount: expectedAmount,
            metadata: {
              transaction_currency: transactionCurrency,
              gateway_currency: gatewayCurrency
            }
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status };
        }

        const transition = await this.stateMachine.transitionPayment({
          tenantId,
          transaction,
          incomingStatus: incomingLogicalStatus,
          transitionReason: 'trusted_gateway_webhook',
          gatewayName: normalizedGateway,
          gatewayPaymentId: event.gatewayPaymentId || transaction.gateway_transaction_id,
          gatewayEventId: event.gatewayEventId,
          webhookEventId: currentWebhook.id,
          correlationId,
          gatewayVerified: Boolean(gatewayVerification.verified),
          metadata: {
            gateway_event_type: event.gatewayEventType,
            gateway_verification: gatewayVerification
          }
        }, trx);

        if (transition.outOfOrder) {
          await this.createWebhookSignal('OUT_OF_ORDER_PAYMENT_EVENT', {
            tenantId,
            webhookEvent: currentWebhook,
            event,
            transaction,
            description: `Out-of-order payment event ignored: current=${transition.previousStatus}, incoming=${transition.newStatus}`,
            impactAmount: expectedAmount,
            metadata: transition
          }, trx);
          const updated = await this.updateWebhookStatus(currentWebhook.id, {
            processing_status: 'OUT_OF_ORDER',
            failure_reason: `Current payment state ${transition.previousStatus} cannot be overwritten by ${transition.newStatus}`,
            processed_at: new Date()
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status, transition };
        }

        if (transition.stateConflict || transition.invalidTransition) {
          await this.createWebhookSignal('GATEWAY_STATUS_CONFLICT', {
            tenantId,
            webhookEvent: currentWebhook,
            event,
            transaction,
            description: `Payment state conflict: current=${transition.previousStatus}, incoming=${transition.newStatus}`,
            impactAmount: expectedAmount,
            metadata: transition
          }, trx);
          const updated = await this.updateWebhookStatus(currentWebhook.id, {
            processing_status: 'FAILED',
            failure_reason: `Invalid payment state transition ${transition.previousStatus} -> ${transition.newStatus}`,
            processed_at: new Date()
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status, transition };
        }

        if (transition.duplicateState) {
          await this.createWebhookSignal('DUPLICATE_GATEWAY_EVENT', {
            tenantId,
            webhookEvent: currentWebhook,
            event,
            transaction,
            description: `Duplicate gateway state event ignored for transaction ${transaction.transaction_ref}`,
            impactAmount: expectedAmount,
            metadata: transition
          }, trx);
          const updated = await this.updateWebhookStatus(currentWebhook.id, {
            processing_status: 'IGNORED',
            failure_reason: `Transaction already in ${transition.previousStatus}`,
            processed_at: new Date()
          }, trx);
          return { webhookEvent: updated, processed: false, status: updated.processing_status, transition };
        }

        if (transition.lateSuccess) {
          await this.createWebhookSignal('LATE_PAYMENT_SUCCESS', {
            tenantId,
            webhookEvent: currentWebhook,
            event,
            transaction: transition.transaction,
            description: `Late payment success accepted after prior failure for ${transaction.transaction_ref}`,
            impactAmount: expectedAmount,
            metadata: transition
          }, trx);
        }

        let outboxEvent = null;
        if (transition.transitioned && transition.newStatus === 'CAPTURED' && statusIsCaptured(event.status)) {
          const stableGatewayPaymentId = event.gatewayPaymentId || transition.transaction.gateway_transaction_id || transition.transaction.transaction_ref;
          outboxEvent = await outboxService.createEvent({
            tenantId,
            aggregateType: 'transaction',
            aggregateId: transition.transaction.id,
            eventType: 'payment.captured',
            idempotencyKey: `payment_captured:${tenantId}:${normalizedGateway}:${stableGatewayPaymentId}`,
            correlationId,
            payload: {
              transactionId: transition.transaction.id,
              transactionRef: transition.transaction.transaction_ref,
              orderId: transition.transaction.order_id,
              gateway: normalizedGateway,
              gatewayTransactionId: stableGatewayPaymentId,
              gatewayEventId: event.gatewayEventId,
              webhookEventId: currentWebhook.id,
              amount: String(transition.transaction.amount),
              currency: transition.transaction.currency || 'INR',
              merchantId: tenantId
            }
          }, trx);
        }

        const updated = await this.updateWebhookStatus(currentWebhook.id, {
          processing_status: 'PROCESSED',
          processed_at: new Date(),
          metadata: {
            ...(currentWebhook.metadata || {}),
            transaction_id: transition.transaction.id,
            transaction_ref: transition.transaction.transaction_ref,
            transition,
            outbox_event_id: outboxEvent?.id || null
          }
        }, trx);

        return {
          webhookEvent: updated,
          processed: true,
          status: updated.processing_status,
          transition,
          outboxEvent
        };
      });

      logger.info('Gateway webhook ingested', {
        tenant_id: tenantId,
        webhook_event_id: result.webhookEvent.id,
        gateway_name: normalizedGateway,
        gateway_event_id: event.gatewayEventId,
        gateway_payment_id: event.gatewayPaymentId,
        processing_status: result.status,
        correlation_id: correlationId || null
      });

      return result;
    } catch (error) {
      await this.updateWebhookStatus(webhookEvent.id, {
        processing_status: 'FAILED',
        failure_reason: error.message,
        processed_at: new Date()
      });
      logger.error('Gateway webhook ingestion failed', {
        tenant_id: tenantId,
        webhook_event_id: webhookEvent.id,
        gateway_name: normalizedGateway,
        gateway_event_id: event.gatewayEventId,
        error: error.message,
        correlation_id: correlationId || null
      });
      throw error;
    }
  }

  async listWebhookEvents(filters = {}) {
    const {
      tenantId,
      gatewayName,
      gatewayEventType,
      processingStatus,
      verificationStatus,
      transactionRef,
      gatewayPaymentId,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('gateway_webhook_events')
      .orderBy('received_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (gatewayName) query = query.where('gateway_name', normalizedGatewayName(gatewayName));
    if (gatewayEventType) query = query.where('gateway_event_type', gatewayEventType);
    if (processingStatus) query = query.where('processing_status', processingStatus);
    if (verificationStatus) query = query.where('verification_status', verificationStatus);
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (gatewayPaymentId) query = query.where('gateway_payment_id', gatewayPaymentId);
    if (from) query = query.where('received_at', '>=', from);
    if (to) query = query.where('received_at', '<=', to);

    return query;
  }
}

module.exports = new PaymentWebhookIngestionService();
module.exports.PaymentWebhookIngestionService = PaymentWebhookIngestionService;
module.exports.payloadHash = payloadHash;
