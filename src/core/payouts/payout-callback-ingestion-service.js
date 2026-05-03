const crypto = require('crypto');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const bankPayoutAdapter = require('./bank-payout-adapter');
const payoutExecutionService = require('./payout-execution-service');
const payoutSignalService = require('./payout-signal-service');

function rawString(rawBody, parsedBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  if (typeof rawBody === 'string') return rawBody;
  return JSON.stringify(parsedBody || {});
}

function hashPayload(rawBody, parsedBody) {
  return crypto.createHash('sha256').update(rawString(rawBody, parsedBody)).digest('hex');
}

class PayoutCallbackIngestionService {
  async findPayoutInstruction({ tenantId, providerPayoutId, bankIdempotencyKey }, trx = db.knex) {
    let query = trx('payout_instructions').where('tenant_id', tenantId);
    if (providerPayoutId) {
      query = query.where('provider_payout_id', providerPayoutId);
    } else if (bankIdempotencyKey) {
      query = query.where('bank_idempotency_key', bankIdempotencyKey);
    } else {
      return null;
    }
    return query.first();
  }

  async ingestPayoutCallback(params) {
    const {
      tenantId,
      providerName,
      rawBody,
      parsedBody,
      headers = {},
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!tenantId) throw new Error('tenantId is required for payout callback ingestion');
    const payload = parsedBody || JSON.parse(rawString(rawBody, parsedBody));
    const parsed = bankPayoutAdapter.parseProviderEvent({ providerName, rawPayload: payload, headers });
    const payloadHash = hashPayload(rawBody, payload);

    const duplicate = parsed.providerEventId
      ? await db.knex('payout_provider_events')
        .where({ tenant_id: tenantId, provider_name: providerName, provider_event_id: parsed.providerEventId })
        .first()
      : await db.knex('payout_provider_events')
        .where({ tenant_id: tenantId, provider_name: providerName, payload_hash: payloadHash })
        .first();

    if (duplicate) {
      await db.knex('payout_provider_events')
        .where('id', duplicate.id)
        .update({ processing_status: duplicate.processing_status === 'PROCESSED' ? 'PROCESSED' : 'DUPLICATE', updated_at: new Date() });
      return { providerEvent: duplicate, duplicate: true, status: 'DUPLICATE', processed: false };
    }

    const [providerEvent] = await db.knex('payout_provider_events')
      .insert({
        tenant_id: tenantId,
        provider_name: providerName,
        provider_event_id: parsed.providerEventId,
        provider_event_type: parsed.providerEventType,
        provider_payout_id: parsed.providerPayoutId,
        bank_idempotency_key: parsed.bankIdempotencyKey,
        raw_payload: payload,
        raw_headers: headers,
        payload_hash: payloadHash,
        signature_header: headers['x-mock-signature'] || headers['x-payout-signature'] || null,
        event_created_at: parsed.eventCreatedAt ? new Date(parsed.eventCreatedAt) : null,
        received_at: new Date(),
        processing_status: 'RECEIVED',
        verification_status: 'PENDING',
        correlation_id: correlationId || null,
        metadata: {
          provider_status: parsed.status
        }
      })
      .returning('*');

    const verification = await bankPayoutAdapter.verifyCallbackSignature({
      providerName,
      rawBody: rawBody || rawString(null, payload),
      headers,
      tenantId
    });

    if (!verification.verified) {
      const processingStatus = verification.status === 'REPLAY_REJECTED' ? 'REPLAY_REJECTED' : 'FAILED';
      const [updatedEvent] = await db.knex('payout_provider_events')
        .where('id', providerEvent.id)
        .update({
          verification_status: 'FAILED',
          processing_status: processingStatus,
          failure_reason: verification.reason,
          processed_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      await payoutSignalService.createOrUpdateSignal({
        tenantId,
        signalType: 'PAYOUT_STATUS_CONFLICT',
        sourceType: 'PROVIDER_EVENT',
        sourceId: providerEvent.id,
        providerEventId: providerEvent.id,
        impactAmount: payload.amount || null,
        currency: payload.currency || null,
        description: `Payout callback verification failed: ${verification.reason}`,
        correlationId,
        metadata: {
          provider_name: providerName,
          provider_event_id: parsed.providerEventId,
          verification_status: processingStatus
        }
      });

      return { providerEvent: updatedEvent, processed: false, status: processingStatus };
    }

    return db.knex.transaction(async (trx) => {
      const payoutInstruction = await this.findPayoutInstruction({
        tenantId,
        providerPayoutId: parsed.providerPayoutId,
        bankIdempotencyKey: parsed.bankIdempotencyKey
      }, trx);

      if (!payoutInstruction) {
        const [updatedEvent] = await trx('payout_provider_events')
          .where('id', providerEvent.id)
          .update({
            verification_status: 'VERIFIED',
            signature_verified: true,
            processing_status: 'FAILED',
            failure_reason: 'Payout instruction not found for provider callback',
            processed_at: new Date(),
            updated_at: new Date()
          })
          .returning('*');

        const signal = await payoutSignalService.createOrUpdateSignal({
          tenantId,
          signalType: 'PAYOUT_STATUS_CONFLICT',
          sourceType: 'PROVIDER_EVENT',
          sourceId: providerEvent.id,
          providerEventId: providerEvent.id,
          description: `Payout callback ${providerEvent.id} does not map to an instruction`,
          correlationId,
          metadata: {
            provider_payout_id: parsed.providerPayoutId,
            bank_idempotency_key: parsed.bankIdempotencyKey
          }
        }, trx);

        return { providerEvent: updatedEvent, signal, processed: false, status: 'FAILED' };
      }

      const lockedPayout = await trx('payout_instructions')
        .where('id', payoutInstruction.id)
        .forUpdate()
        .first();

      const [verifiedEvent] = await trx('payout_provider_events')
        .where('id', providerEvent.id)
        .update({
          payout_instruction_id: lockedPayout.id,
          verification_status: 'VERIFIED',
          signature_verified: true,
          processing_status: 'VERIFIED',
          updated_at: new Date()
        })
        .returning('*');

      const response = {
        providerName,
        providerPayoutId: parsed.providerPayoutId,
        providerStatus: parsed.providerStatus,
        status: parsed.status,
        utrNumber: parsed.utrNumber,
        bankReferenceNumber: parsed.bankReferenceNumber,
        bankTransactionId: parsed.bankTransactionId,
        failureReason: parsed.failureReason,
        returnReason: parsed.returnReason,
        rawResponse: parsed.rawPayload
      };

      const outcome = await payoutExecutionService.applyProviderOutcome({
        trx,
        payoutInstruction: lockedPayout,
        response,
        providerEvent: verifiedEvent,
        correlationId
      });

      const finalStatus = outcome.conflict ? 'OUT_OF_ORDER' : 'PROCESSED';
      const [processedEvent] = await trx('payout_provider_events')
        .where('id', verifiedEvent.id)
        .update({
          processing_status: finalStatus,
          processed_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      logger.info('Payout provider callback processed', {
        tenant_id: tenantId,
        provider_event_id: processedEvent.id,
        payout_instruction_id: lockedPayout.id,
        provider_status: parsed.status,
        processing_status: finalStatus,
        correlation_id: correlationId || null
      });

      return { providerEvent: processedEvent, ...outcome, processed: !outcome.conflict, status: finalStatus };
    });
  }

  async listProviderEvents(filters = {}) {
    const {
      tenantId,
      providerName,
      providerPayoutId,
      bankIdempotencyKey,
      processingStatus,
      verificationStatus,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('payout_provider_events')
      .orderBy('received_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (providerName) query = query.where('provider_name', providerName);
    if (providerPayoutId) query = query.where('provider_payout_id', providerPayoutId);
    if (bankIdempotencyKey) query = query.where('bank_idempotency_key', bankIdempotencyKey);
    if (processingStatus) query = query.where('processing_status', processingStatus);
    if (verificationStatus) query = query.where('verification_status', verificationStatus);
    if (from) query = query.where('received_at', '>=', from);
    if (to) query = query.where('received_at', '<=', to);

    return query;
  }
}

module.exports = new PayoutCallbackIngestionService();
module.exports.PayoutCallbackIngestionService = PayoutCallbackIngestionService;
