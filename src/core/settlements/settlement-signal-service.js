const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

const SEVERITY_BY_SIGNAL = {
  SETTLEMENT_DELAYED_BEYOND_SLA: 'HIGH',
  SETTLEMENT_ELIGIBILITY_FAILED: 'MEDIUM',
  INSUFFICIENT_ESCROW_FOR_SETTLEMENT: 'CRITICAL',
  INSUFFICIENT_MERCHANT_PAYABLE: 'CRITICAL',
  PAYABLE_RESERVED_TWICE_ATTEMPTED: 'CRITICAL',
  RESERVATION_EXPIRED: 'HIGH',
  RESERVATION_RELEASED: 'LOW',
  SETTLEMENT_BATCH_CANCELLED: 'MEDIUM',
  SETTLEMENT_AMOUNT_MISMATCH: 'CRITICAL',
  SETTLEMENT_BLOCKED_BY_RECONCILIATION_EXCEPTION: 'HIGH',
  SETTLEMENT_BLOCKED_BY_REFUND_OR_DISPUTE: 'HIGH',
  SETTLEMENT_READY_FOR_PAYOUT: 'LOW'
};

const ACTION_BY_SIGNAL = {
  SETTLEMENT_DELAYED_BEYOND_SLA: 'Check gateway settlement status, merchant hold policy, and unresolved exceptions.',
  SETTLEMENT_ELIGIBILITY_FAILED: 'Review eligibility details before including this item in a settlement batch.',
  INSUFFICIENT_ESCROW_FOR_SETTLEMENT: 'Check gateway settlement import, bank escrow ledger balance, and unresolved escrow reconciliation exceptions.',
  INSUFFICIENT_MERCHANT_PAYABLE: 'Review merchant payable ledger entries, fees, refunds, chargebacks, and existing reservations.',
  PAYABLE_RESERVED_TWICE_ATTEMPTED: 'Check duplicate batch generation or concurrent settlement run.',
  RESERVATION_EXPIRED: 'Regenerate eligibility and reserve funds again before payout preparation.',
  RESERVATION_RELEASED: 'Verify the release was intentional before creating any payout instruction.',
  SETTLEMENT_BATCH_CANCELLED: 'Confirm the cancellation reason and rerun settlement only after blockers are cleared.',
  SETTLEMENT_AMOUNT_MISMATCH: 'Recalculate batch totals from settlement items and compare with ledger-derived payable.',
  SETTLEMENT_BLOCKED_BY_RECONCILIATION_EXCEPTION: 'Review open reconciliation exception before settlement release.',
  SETTLEMENT_BLOCKED_BY_REFUND_OR_DISPUTE: 'Review refund, dispute, and chargeback state before settlement.',
  SETTLEMENT_READY_FOR_PAYOUT: 'Create payout instruction only after maker-checker and payout controls are satisfied.'
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

class SettlementSignalService {
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
      batchId = null,
      itemId = null,
      reservationId = null,
      merchantId = null,
      transactionRef = null,
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

    const [signal] = await executor(trx)('settlement_signals')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        signal_type: signalType,
        severity,
        signal_status: 'OPEN',
        source_type: sourceType,
        source_id: sourceId,
        batch_id: batchId,
        item_id: itemId,
        reservation_id: reservationId,
        merchant_id: merchantId,
        transaction_ref: transactionRef,
        impact_amount: impactAmount,
        currency,
        description,
        suggested_action: suggestedAction,
        correlation_id: correlationId || null,
        metadata
      })
      .returning('*');

    logger.info('Settlement signal created', {
      tenant_id: tenantId,
      signal_id: signal.id,
      signal_type: signalType,
      severity,
      source_type: sourceType,
      source_id: sourceId,
      batch_id: batchId,
      transaction_ref: transactionRef,
      correlation_id: correlationId || null
    });

    return signal;
  }

  async createOrUpdateSignal(params, trx = null) {
    const query = executor(trx);
    const { tenantId, signalType, sourceType, sourceId = null, metadata = {} } = params;

    if (sourceId) {
      const existing = await query('settlement_signals')
        .where({
          tenant_id: tenantId,
          signal_type: signalType,
          source_type: sourceType,
          source_id: sourceId
        })
        .first();

      if (existing) {
        const [updated] = await query('settlement_signals')
          .where('id', existing.id)
          .update({
            severity: params.severity || existing.severity,
            signal_status: existing.signal_status === 'RESOLVED' ? 'OPEN' : existing.signal_status,
            batch_id: params.batchId || existing.batch_id,
            item_id: params.itemId || existing.item_id,
            reservation_id: params.reservationId || existing.reservation_id,
            merchant_id: params.merchantId || existing.merchant_id,
            transaction_ref: params.transactionRef || existing.transaction_ref,
            description: params.description || existing.description,
            suggested_action: params.suggestedAction || existing.suggested_action,
            impact_amount: params.impactAmount ?? existing.impact_amount,
            currency: params.currency || existing.currency,
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
        return query('settlement_signals')
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
      merchantId,
      transactionRef,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('settlement_signals')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (signalType) query = query.where('signal_type', signalType);
    if (severity) query = query.where('severity', severity);
    if (signalStatus) query = query.where('signal_status', signalStatus);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async updateSignalStatus({ signalId, tenantId, targetStatus, correlationId = requestContext.getCorrelationId() }) {
    const [signal] = await db.knex('settlement_signals')
      .where('id', signalId)
      .where('tenant_id', tenantId)
      .update({
        signal_status: targetStatus,
        correlation_id: correlationId || null,
        updated_at: new Date()
      })
      .returning('*');

    if (!signal) throw new Error('Settlement signal not found');
    return signal;
  }

  acknowledgeSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'ACKNOWLEDGED' });
  }

  resolveSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'RESOLVED' });
  }
}

module.exports = new SettlementSignalService();
module.exports.SettlementSignalService = SettlementSignalService;
