const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

const SEVERITY_BY_SIGNAL = {
  PAYOUT_DELAYED: 'MEDIUM',
  PAYOUT_TIMEOUT: 'HIGH',
  BANK_REJECTED_PAYOUT: 'HIGH',
  PAYOUT_FAILED: 'HIGH',
  PAYOUT_RETURNED: 'CRITICAL',
  PAYOUT_REVERSED: 'CRITICAL',
  DUPLICATE_PAYOUT_ATTEMPT: 'CRITICAL',
  UTR_DUPLICATE_DETECTED: 'CRITICAL',
  BANK_CONFIRMATION_MISSING: 'HIGH',
  PAYOUT_STATUS_CONFLICT: 'CRITICAL',
  PAYOUT_WITHOUT_RESERVATION: 'CRITICAL',
  PAYOUT_BLOCKED_BY_RECONCILIATION_EXCEPTION: 'HIGH',
  PAYOUT_PROVIDER_DOWNTIME: 'HIGH',
  PAYOUT_RETRY_REQUIRED: 'MEDIUM',
  PAYOUT_READY_FOR_BANK_SUBMISSION: 'LOW'
};

const ACTION_BY_SIGNAL = {
  PAYOUT_DELAYED: 'Check provider queue and wait for bank confirmation before retrying.',
  PAYOUT_TIMEOUT: 'Check provider payout status before retrying. Do not submit with a new idempotency key until prior status is final.',
  BANK_REJECTED_PAYOUT: 'Verify beneficiary bank account, IFSC, name match, and provider rejection reason.',
  PAYOUT_FAILED: 'Review provider failure reason and decide whether to retry or release settlement.',
  PAYOUT_RETURNED: 'Check bank return reason and decide whether to retry, correct beneficiary details, or release settlement.',
  PAYOUT_REVERSED: 'Review reversal evidence and decide whether merchant payable should be reopened through approved workflow.',
  DUPLICATE_PAYOUT_ATTEMPT: 'Review batch/reservation and payout idempotency key before retry.',
  UTR_DUPLICATE_DETECTED: 'Investigate duplicate bank reference before accepting payout confirmation.',
  BANK_CONFIRMATION_MISSING: 'Poll provider status or wait for callback before consuming reservation.',
  PAYOUT_STATUS_CONFLICT: 'Compare local payout state with provider evidence and escalate before changing financial state.',
  PAYOUT_WITHOUT_RESERVATION: 'Reserve funds for the settlement batch before payout creation.',
  PAYOUT_BLOCKED_BY_RECONCILIATION_EXCEPTION: 'Resolve open reconciliation exceptions before payout execution.',
  PAYOUT_PROVIDER_DOWNTIME: 'Check provider availability and retry only after outage is cleared.',
  PAYOUT_RETRY_REQUIRED: 'Retry only when prior bank outcome is final and idempotency risk is controlled.',
  PAYOUT_READY_FOR_BANK_SUBMISSION: 'Submit payout only after maker-checker and beneficiary controls are satisfied.'
};

function executor(trx) {
  return trx || db.knex;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

class PayoutSignalService {
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
      payoutInstructionId = null,
      payoutAttemptId = null,
      providerEventId = null,
      settlementBatchId = null,
      reservationId = null,
      merchantId = null,
      impactAmount = null,
      currency = null,
      description,
      suggestedAction = this.suggestedActionFor(signalType),
      correlationId = requestContext.getCorrelationId(),
      metadata = {}
    } = params;

    if (!tenantId || !signalType || !sourceType || !description) {
      throw new Error('tenantId, signalType, sourceType, and description are required');
    }

    const [signal] = await executor(trx)('payout_signals')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        signal_type: signalType,
        severity,
        signal_status: 'OPEN',
        source_type: sourceType,
        source_id: sourceId,
        payout_instruction_id: payoutInstructionId,
        payout_attempt_id: payoutAttemptId,
        provider_event_id: providerEventId,
        settlement_batch_id: settlementBatchId,
        reservation_id: reservationId,
        merchant_id: merchantId,
        impact_amount: impactAmount,
        currency,
        description,
        suggested_action: suggestedAction,
        correlation_id: correlationId || null,
        metadata
      })
      .returning('*');

    logger.info('Payout signal created', {
      tenant_id: tenantId,
      signal_id: signal.id,
      signal_type: signalType,
      severity,
      payout_instruction_id: payoutInstructionId,
      correlation_id: correlationId || null
    });

    return signal;
  }

  async createOrUpdateSignal(params, trx = null) {
    const query = executor(trx);
    const { tenantId, signalType, sourceType, sourceId = null, metadata = {} } = params;

    if (sourceId) {
      const existing = await query('payout_signals')
        .where({
          tenant_id: tenantId,
          signal_type: signalType,
          source_type: sourceType,
          source_id: sourceId
        })
        .first();

      if (existing) {
        const [updated] = await query('payout_signals')
          .where('id', existing.id)
          .update({
            severity: params.severity || existing.severity,
            signal_status: existing.signal_status === 'RESOLVED' ? 'OPEN' : existing.signal_status,
            payout_instruction_id: params.payoutInstructionId || existing.payout_instruction_id,
            payout_attempt_id: params.payoutAttemptId || existing.payout_attempt_id,
            provider_event_id: params.providerEventId || existing.provider_event_id,
            settlement_batch_id: params.settlementBatchId || existing.settlement_batch_id,
            reservation_id: params.reservationId || existing.reservation_id,
            merchant_id: params.merchantId || existing.merchant_id,
            impact_amount: params.impactAmount ?? existing.impact_amount,
            currency: params.currency || existing.currency,
            description: params.description || existing.description,
            suggested_action: params.suggestedAction || existing.suggested_action,
            correlation_id: params.correlationId || existing.correlation_id,
            metadata: {
              ...parseJson(existing.metadata),
              ...metadata,
              last_seen_at: new Date().toISOString()
            },
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
        return query('payout_signals')
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
      payoutInstructionId,
      settlementBatchId,
      merchantId,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('payout_signals')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (signalType) query = query.where('signal_type', signalType);
    if (severity) query = query.where('severity', severity);
    if (signalStatus) query = query.where('signal_status', signalStatus);
    if (payoutInstructionId) query = query.where('payout_instruction_id', payoutInstructionId);
    if (settlementBatchId) query = query.where('settlement_batch_id', settlementBatchId);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async updateSignalStatus({ signalId, tenantId, targetStatus, correlationId = requestContext.getCorrelationId() }) {
    const [signal] = await db.knex('payout_signals')
      .where('id', signalId)
      .where('tenant_id', tenantId)
      .update({
        signal_status: targetStatus,
        correlation_id: correlationId || null,
        updated_at: new Date()
      })
      .returning('*');

    if (!signal) throw new Error('Payout signal not found');
    return signal;
  }

  acknowledgeSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'ACKNOWLEDGED' });
  }

  resolveSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'RESOLVED' });
  }
}

module.exports = new PayoutSignalService();
module.exports.PayoutSignalService = PayoutSignalService;
