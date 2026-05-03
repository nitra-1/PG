const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

const SEVERITY_BY_SIGNAL = {
  GATEWAY_SETTLEMENT_DELAYED: 'HIGH',
  GATEWAY_FEE_MISMATCH: 'HIGH',
  GST_MISMATCH: 'MEDIUM',
  NET_SETTLEMENT_MISMATCH: 'HIGH',
  MISSING_GATEWAY_SETTLEMENT_LINE: 'HIGH',
  UNEXPECTED_GATEWAY_DEDUCTION: 'HIGH',
  ESCROW_NOT_CREDITED: 'CRITICAL',
  DUPLICATE_GATEWAY_SETTLEMENT_LINE: 'LOW',
  GATEWAY_SETTLEMENT_AMOUNT_MISMATCH: 'CRITICAL',
  GATEWAY_SETTLEMENT_WITHOUT_PAYMENT: 'HIGH',
  PRICING_RULE_MISSING: 'MEDIUM',
  MDR_DEVIATION: 'HIGH',
  GST_CALCULATION_DEVIATION: 'MEDIUM'
};

const ACTION_BY_SIGNAL = {
  GATEWAY_SETTLEMENT_DELAYED: 'Check gateway settlement SLA, gateway dashboard, and whether the payment was excluded from the settlement cycle.',
  GATEWAY_FEE_MISMATCH: 'Check gateway MDR configuration, pricing rule, and settlement report fee column.',
  GST_MISMATCH: 'Verify GST rate and gateway tax invoice for this settlement cycle.',
  NET_SETTLEMENT_MISMATCH: 'Recalculate gross minus fee minus GST plus adjustments and compare against the gateway report.',
  MISSING_GATEWAY_SETTLEMENT_LINE: 'Check whether gateway settlement report is delayed or transaction was excluded from settlement.',
  UNEXPECTED_GATEWAY_DEDUCTION: 'Review adjustment, refund, and chargeback columns in the gateway settlement report.',
  ESCROW_NOT_CREDITED: 'Check gateway payout UTR and bank statement credit.',
  DUPLICATE_GATEWAY_SETTLEMENT_LINE: 'Confirm duplicate gateway settlement evidence did not create duplicate outbox or ledger impact.',
  GATEWAY_SETTLEMENT_AMOUNT_MISMATCH: 'Compare transaction amount, gateway gross amount, and merchant/order mapping.',
  GATEWAY_SETTLEMENT_WITHOUT_PAYMENT: 'Map this settlement line to an internal captured transaction before financial posting.',
  PRICING_RULE_MISSING: 'Configure the applicable gateway pricing rule before marking the settlement line matched.',
  MDR_DEVIATION: 'Review expected MDR pricing and gateway-applied fee for this transaction.',
  GST_CALCULATION_DEVIATION: 'Verify GST percentage and rounding used by gateway for the fee.'
};

function executor(trx) {
  return trx || db.knex;
}

class GatewaySettlementSignalService {
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
      lineId = null,
      transactionId = null,
      transactionRef = null,
      gatewayName,
      gatewaySettlementId = null,
      gatewayTransactionId = null,
      impactAmount = null,
      currency = null,
      description,
      suggestedAction = this.suggestedActionFor(signalType),
      correlationId = requestContext.getCorrelationId(),
      metadata = {}
    } = params;

    if (!tenantId || !signalType || !sourceType || !gatewayName || !description) {
      throw new Error('tenantId, signalType, sourceType, gatewayName, and description are required');
    }

    const [signal] = await executor(trx)('gateway_settlement_signals')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        signal_type: signalType,
        severity,
        signal_status: 'OPEN',
        source_type: sourceType,
        source_id: sourceId,
        batch_id: batchId,
        line_id: lineId,
        transaction_id: transactionId,
        transaction_ref: transactionRef,
        gateway_name: gatewayName,
        gateway_settlement_id: gatewaySettlementId,
        gateway_transaction_id: gatewayTransactionId,
        impact_amount: impactAmount,
        currency,
        description,
        suggested_action: suggestedAction,
        correlation_id: correlationId || null,
        metadata
      })
      .returning('*');

    logger.info('Gateway settlement signal created', {
      tenant_id: tenantId,
      signal_id: signal.id,
      signal_type: signalType,
      severity,
      source_type: sourceType,
      source_id: sourceId,
      gateway_name: gatewayName,
      transaction_ref: transactionRef,
      correlation_id: correlationId || null
    });

    return signal;
  }

  async createOrUpdateSignal(params, trx = null) {
    const query = executor(trx);
    const { tenantId, signalType, sourceType, sourceId = null, metadata = {} } = params;

    if (sourceId) {
      const existing = await query('gateway_settlement_signals')
        .where({
          tenant_id: tenantId,
          signal_type: signalType,
          source_type: sourceType,
          source_id: sourceId
        })
        .first();

      if (existing) {
        const [updated] = await query('gateway_settlement_signals')
          .where('id', existing.id)
          .update({
            severity: params.severity || existing.severity,
            signal_status: existing.signal_status === 'RESOLVED' ? 'OPEN' : existing.signal_status,
            description: params.description || existing.description,
            suggested_action: params.suggestedAction || existing.suggested_action,
            impact_amount: params.impactAmount ?? existing.impact_amount,
            currency: params.currency || existing.currency,
            correlation_id: params.correlationId || existing.correlation_id,
            metadata: {
              ...(typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {}),
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
        return query('gateway_settlement_signals')
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
      gatewayName,
      transactionRef,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('gateway_settlement_signals')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (signalType) query = query.where('signal_type', signalType);
    if (severity) query = query.where('severity', severity);
    if (signalStatus) query = query.where('signal_status', signalStatus);
    if (gatewayName) query = query.where('gateway_name', String(gatewayName).toLowerCase());
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async updateSignalStatus({ signalId, tenantId, targetStatus, correlationId = requestContext.getCorrelationId() }) {
    const [signal] = await db.knex('gateway_settlement_signals')
      .where('id', signalId)
      .where('tenant_id', tenantId)
      .update({
        signal_status: targetStatus,
        correlation_id: correlationId || null,
        updated_at: new Date()
      })
      .returning('*');

    if (!signal) throw new Error('Gateway settlement signal not found');
    return signal;
  }

  acknowledgeSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'ACKNOWLEDGED' });
  }

  resolveSignal(params) {
    return this.updateSignalStatus({ ...params, targetStatus: 'RESOLVED' });
  }
}

module.exports = new GatewaySettlementSignalService();
module.exports.GatewaySettlementSignalService = GatewaySettlementSignalService;
