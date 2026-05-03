const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

const SEVERITY_BY_SIGNAL = {
  WEBHOOK_SIGNATURE_FAILED: 'CRITICAL',
  SUSPICIOUS_WEBHOOK_ATTEMPT: 'CRITICAL',
  PAYMENT_AMOUNT_MISMATCH: 'CRITICAL',
  PAYMENT_CURRENCY_MISMATCH: 'CRITICAL',
  WEBHOOK_REPLAY_DETECTED: 'HIGH',
  GATEWAY_STATUS_CONFLICT: 'HIGH',
  LATE_PAYMENT_SUCCESS: 'HIGH',
  OUT_OF_ORDER_PAYMENT_EVENT: 'MEDIUM',
  PAYMENT_WITHOUT_ORDER: 'MEDIUM',
  PAYMENT_WITHOUT_LEDGER: 'MEDIUM',
  DUPLICATE_GATEWAY_EVENT: 'LOW'
};

const ACTION_BY_SIGNAL = {
  WEBHOOK_SIGNATURE_FAILED: 'Check webhook secret, raw body handling, and source legitimacy.',
  WEBHOOK_REPLAY_DETECTED: 'Check gateway retry logs and possible replay attack.',
  OUT_OF_ORDER_PAYMENT_EVENT: 'Review event sequence and gateway status.',
  LATE_PAYMENT_SUCCESS: 'Verify previous failure reason and downstream ledger impact.',
  GATEWAY_STATUS_CONFLICT: 'Poll gateway transaction API and compare status.',
  PAYMENT_AMOUNT_MISMATCH: 'Verify order amount, gateway amount, and merchant mapping.',
  PAYMENT_CURRENCY_MISMATCH: 'Verify order currency, gateway currency, and merchant mapping.',
  PAYMENT_WITHOUT_ORDER: 'Map the gateway payment to an internal transaction before financial posting.',
  DUPLICATE_GATEWAY_EVENT: 'Confirm duplicate gateway delivery did not create duplicate outbox or ledger impact.',
  PAYMENT_WITHOUT_LEDGER: 'Run transaction-ledger reconciliation and inspect outbox/DLQ.'
};

function executor(trx) {
  return trx || db.knex;
}

class PaymentSignalService {
  severityFor(signalType) {
    return SEVERITY_BY_SIGNAL[signalType] || 'MEDIUM';
  }

  suggestedActionFor(signalType) {
    return ACTION_BY_SIGNAL[signalType] || null;
  }

  async createSignal(params, trx = null) {
    const {
      tenantId,
      signalType,
      severity = this.severityFor(signalType),
      sourceType,
      sourceId = null,
      transactionId = null,
      transactionRef = null,
      gatewayName = null,
      gatewayPaymentId = null,
      gatewayEventId = null,
      impactAmount = null,
      currency = null,
      description,
      suggestedAction = this.suggestedActionFor(signalType),
      correlationId = requestContext.getCorrelationId(),
      metadata = {}
    } = params;

    if (!tenantId || !signalType || !sourceType || !description) {
      throw new Error('tenantId, signalType, sourceType, and description are required for payment signal');
    }

    const [signal] = await executor(trx)('payment_signals')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        signal_type: signalType,
        severity,
        signal_status: 'OPEN',
        source_type: sourceType,
        source_id: sourceId,
        transaction_id: transactionId,
        transaction_ref: transactionRef,
        gateway_name: gatewayName,
        gateway_payment_id: gatewayPaymentId,
        gateway_event_id: gatewayEventId,
        impact_amount: impactAmount,
        currency,
        description,
        suggested_action: suggestedAction,
        correlation_id: correlationId || null,
        metadata
      })
      .returning('*');

    logger.info('Payment signal created', {
      tenant_id: tenantId,
      signal_id: signal.id,
      signal_type: signalType,
      severity,
      source_type: sourceType,
      source_id: sourceId,
      transaction_ref: transactionRef,
      gateway_payment_id: gatewayPaymentId,
      correlation_id: correlationId || null
    });

    return signal;
  }

  async createOrUpdateSignal(params, trx = null) {
    const query = executor(trx);
    const {
      tenantId,
      signalType,
      sourceType,
      sourceId = null,
      metadata = {}
    } = params;

    if (sourceId) {
      const existing = await query('payment_signals')
        .where({
          tenant_id: tenantId,
          signal_type: signalType,
          source_type: sourceType,
          source_id: sourceId
        })
        .first();

      if (existing) {
        const mergedMetadata = {
          ...(typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {}),
          ...metadata,
          last_seen_at: new Date().toISOString()
        };
        const [updated] = await query('payment_signals')
          .where('id', existing.id)
          .update({
            severity: params.severity || existing.severity,
            signal_status: existing.signal_status === 'RESOLVED' ? 'OPEN' : existing.signal_status,
            description: params.description || existing.description,
            suggested_action: params.suggestedAction || params.suggested_action || existing.suggested_action,
            impact_amount: params.impactAmount ?? existing.impact_amount,
            currency: params.currency || existing.currency,
            correlation_id: params.correlationId || existing.correlation_id,
            metadata: mergedMetadata,
            updated_at: new Date()
          })
          .returning('*');
        return updated;
      }
    }

    try {
      return await this.createSignal({ ...params, metadata }, trx);
    } catch (error) {
      if (error.code === '23505' && sourceId) {
        return query('payment_signals')
          .where({
            tenant_id: tenantId,
            signal_type: signalType,
            source_type: sourceType,
            source_id: sourceId
          })
          .first();
      }
      throw error;
    }
  }

  async listSignals(filters = {}) {
    const {
      tenantId,
      signalType,
      severity,
      signalStatus,
      transactionRef,
      gatewayPaymentId,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('payment_signals')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (signalType) query = query.where('signal_type', signalType);
    if (severity) query = query.where('severity', severity);
    if (signalStatus) query = query.where('signal_status', signalStatus);
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (gatewayPaymentId) query = query.where('gateway_payment_id', gatewayPaymentId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async updateSignalStatus({ signalId, tenantId, targetStatus, correlationId = requestContext.getCorrelationId() }) {
    const [signal] = await db.knex('payment_signals')
      .where('id', signalId)
      .where('tenant_id', tenantId)
      .update({
        signal_status: targetStatus,
        correlation_id: correlationId || null,
        updated_at: new Date()
      })
      .returning('*');

    if (!signal) throw new Error('Payment signal not found');
    return signal;
  }

  acknowledgeSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'ACKNOWLEDGED' });
  }

  resolveSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'RESOLVED' });
  }
}

module.exports = new PaymentSignalService();
module.exports.PaymentSignalService = PaymentSignalService;
