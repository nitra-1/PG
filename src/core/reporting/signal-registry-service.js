const db = require('../../database');
const requestContext = require('../context/request-context');
const paymentSignalService = require('../payment/payment-signal-service');
const gatewaySettlementSignalService = require('../gateway-settlements/gateway-settlement-signal-service');
const settlementSignalService = require('../settlements/settlement-signal-service');
const payoutSignalService = require('../payouts/payout-signal-service');
const reconciliationExceptionService = require('../ledger/reconciliation-exception-service');

const SOURCE_CONFIG = {
  PAYMENT: {
    table: 'payment_signals',
    idColumn: 'id',
    sourceEntityColumn: 'source_id',
    extra: row => ({
      transaction_id: row.transaction_id,
      gateway_name: row.gateway_name,
      gateway_payment_id: row.gateway_payment_id,
      gateway_event_id: row.gateway_event_id
    })
  },
  GATEWAY_SETTLEMENT: {
    table: 'gateway_settlement_signals',
    idColumn: 'id',
    sourceEntityColumn: 'source_id',
    extra: row => ({
      gateway_name: row.gateway_name,
      gateway_settlement_id: row.gateway_settlement_id,
      gateway_transaction_id: row.gateway_transaction_id,
      batch_id: row.batch_id,
      line_id: row.line_id
    })
  },
  SETTLEMENT: {
    table: 'settlement_signals',
    idColumn: 'id',
    sourceEntityColumn: 'source_id',
    extra: row => ({
      settlement_batch_id: row.batch_id,
      item_id: row.item_id,
      reservation_id: row.reservation_id
    })
  },
  PAYOUT: {
    table: 'payout_signals',
    idColumn: 'id',
    sourceEntityColumn: 'source_id',
    extra: row => ({
      payout_instruction_id: row.payout_instruction_id,
      payout_attempt_id: row.payout_attempt_id,
      provider_event_id: row.provider_event_id,
      settlement_batch_id: row.settlement_batch_id,
      reservation_id: row.reservation_id
    })
  }
};

const SEVERITY_WEIGHT = { LOW: 1, MEDIUM: 2, HIGH: 5, CRITICAL: 10 };

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function normalizeSignal(source, row) {
  const config = SOURCE_CONFIG[source];
  return {
    tenant_id: row.tenant_id,
    signal_source: source,
    source_table: config.table,
    source_id: row[config.idColumn],
    signal_type: row.signal_type || row.source_status,
    severity: row.severity,
    signal_status: row.signal_status || row.case_status,
    source_type: row.source_type,
    source_entity_id: row[config.sourceEntityColumn] || row.source_reconciliation_id || null,
    merchant_id: row.merchant_id || null,
    transaction_ref: row.transaction_ref || null,
    gateway_name: row.gateway_name || null,
    settlement_batch_id: row.settlement_batch_id || row.batch_id || null,
    payout_instruction_id: row.payout_instruction_id || null,
    impact_amount: row.impact_amount || null,
    currency: row.currency || null,
    description: row.description || row.resolution_reason || `${source} ${row.signal_type || row.source_status}`,
    suggested_action: row.suggested_action || null,
    correlation_id: row.correlation_id || null,
    metadata: parseJson(row.metadata),
    created_at: row.created_at || row.opened_at,
    updated_at: row.updated_at || row.last_action_at || null,
    ...config.extra(row)
  };
}

function normalizeException(row) {
  const metadata = parseJson(row.metadata);
  return {
    tenant_id: row.tenant_id,
    signal_source: 'RECONCILIATION_EXCEPTION',
    source_table: 'reconciliation_exception_cases',
    source_id: row.id,
    signal_type: row.source_status,
    severity: row.severity,
    signal_status: row.case_status,
    source_type: row.source_type,
    source_entity_id: row.source_reconciliation_id,
    merchant_id: metadata.merchant_id || metadata.merchantId || null,
    transaction_ref: metadata.transaction_ref || metadata.transactionRef || null,
    gateway_name: metadata.gateway_name || metadata.gatewayName || null,
    settlement_batch_id: metadata.settlement_batch_id || metadata.batch_id || null,
    payout_instruction_id: metadata.payout_instruction_id || null,
    impact_amount: metadata.impact_amount || metadata.discrepancy_amount || null,
    currency: metadata.currency || null,
    description: `Reconciliation exception ${row.source_status}`,
    suggested_action: 'Review exception workflow case before financial action.',
    correlation_id: row.correlation_id || null,
    metadata,
    created_at: row.opened_at,
    updated_at: row.updated_at || row.last_action_at || null
  };
}

function filterRows(rows, filters) {
  return rows.filter(row => {
    if (filters.signalSource && row.signal_source !== filters.signalSource) return false;
    if (filters.signalType && row.signal_type !== filters.signalType) return false;
    if (filters.severity && row.severity !== filters.severity) return false;
    if (filters.signalStatus && row.signal_status !== filters.signalStatus) return false;
    if (filters.merchantId && row.merchant_id !== filters.merchantId) return false;
    if (filters.gatewayName && row.gateway_name !== filters.gatewayName) return false;
    if (filters.transactionRef && row.transaction_ref !== filters.transactionRef) return false;
    if (filters.settlementBatchId && row.settlement_batch_id !== filters.settlementBatchId) return false;
    if (filters.payoutInstructionId && row.payout_instruction_id !== filters.payoutInstructionId) return false;
    if (filters.from && new Date(row.created_at) < new Date(filters.from)) return false;
    if (filters.to && new Date(row.created_at) > new Date(filters.to)) return false;
    return true;
  });
}

class SignalRegistryService {
  async sourceRows(source, filters = {}) {
    const config = SOURCE_CONFIG[source];
    let query = db.knex(config.table).orderBy('created_at', 'desc');
    if (filters.tenantId) query = query.where('tenant_id', filters.tenantId);
    if (filters.signalType) query = query.where('signal_type', filters.signalType);
    if (filters.severity) query = query.where('severity', filters.severity);
    if (filters.signalStatus) query = query.where('signal_status', filters.signalStatus);
    if (filters.from) query = query.where('created_at', '>=', filters.from);
    if (filters.to) query = query.where('created_at', '<=', filters.to);
    const rows = await query;
    return rows.map(row => normalizeSignal(source, row));
  }

  async exceptionRows(filters = {}) {
    let query = db.knex('reconciliation_exception_cases').orderBy('opened_at', 'desc');
    if (filters.tenantId) query = query.where('tenant_id', filters.tenantId);
    if (filters.signalType) query = query.where('source_status', filters.signalType);
    if (filters.severity) query = query.where('severity', filters.severity);
    if (filters.signalStatus) query = query.where('case_status', filters.signalStatus);
    if (filters.from) query = query.where('opened_at', '>=', filters.from);
    if (filters.to) query = query.where('opened_at', '<=', filters.to);
    const rows = await query;
    return rows.map(normalizeException);
  }

  async listUnifiedSignals(filters = {}) {
    const sources = filters.signalSource
      ? [filters.signalSource]
      : ['PAYMENT', 'GATEWAY_SETTLEMENT', 'SETTLEMENT', 'PAYOUT', 'RECONCILIATION_EXCEPTION'];

    const rows = [];
    for (const source of sources) {
      if (source === 'RECONCILIATION_EXCEPTION') {
        rows.push(...await this.exceptionRows(filters));
      } else if (SOURCE_CONFIG[source]) {
        rows.push(...await this.sourceRows(source, filters));
      }
    }

    const filtered = filterRows(rows, filters)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const offset = Number(filters.offset || 0);
    const limit = Math.min(Number(filters.limit || 100), 1000);
    return {
      records: filtered.slice(offset, offset + limit),
      count: filtered.length,
      limit,
      offset
    };
  }

  async getUnifiedSignal(source, sourceId, tenantId = null) {
    if (source === 'RECONCILIATION_EXCEPTION') {
      let query = db.knex('reconciliation_exception_cases').where('id', sourceId);
      if (tenantId) query = query.where('tenant_id', tenantId);
      const row = await query.first();
      if (!row) throw new Error('Unified signal not found');
      return normalizeException(row);
    }

    const config = SOURCE_CONFIG[source];
    if (!config) throw new Error(`Unsupported signal source: ${source}`);
    let query = db.knex(config.table).where('id', sourceId);
    if (tenantId) query = query.where('tenant_id', tenantId);
    const row = await query.first();
    if (!row) throw new Error('Unified signal not found');
    return normalizeSignal(source, row);
  }

  async getSignalSummary({ tenantId, from = null, to = null } = {}) {
    const { records } = await this.listUnifiedSignals({ tenantId, from, to, limit: 1000 });
    return records.reduce((acc, row) => {
      acc.total += 1;
      acc.bySource[row.signal_source] = (acc.bySource[row.signal_source] || 0) + 1;
      acc.bySeverity[row.severity] = (acc.bySeverity[row.severity] || 0) + 1;
      acc.byStatus[row.signal_status] = (acc.byStatus[row.signal_status] || 0) + 1;
      acc.impactAmount = Number((acc.impactAmount + Number(row.impact_amount || 0)).toFixed(2));
      return acc;
    }, { total: 0, bySource: {}, bySeverity: {}, byStatus: {}, impactAmount: 0 });
  }

  async getSignalAging({ tenantId, severity = null, signalStatus = 'OPEN' } = {}) {
    const { records } = await this.listUnifiedSignals({ tenantId, severity, signalStatus, limit: 1000 });
    const buckets = {
      '0_1_days': 0,
      '2_3_days': 0,
      '4_7_days': 0,
      '8_15_days': 0,
      '16_plus_days': 0
    };
    const now = Date.now();
    for (const row of records) {
      const days = Math.max(0, Math.floor((now - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000)));
      if (days <= 1) buckets['0_1_days'] += 1;
      else if (days <= 3) buckets['2_3_days'] += 1;
      else if (days <= 7) buckets['4_7_days'] += 1;
      else if (days <= 15) buckets['8_15_days'] += 1;
      else buckets['16_plus_days'] += 1;
    }
    return { tenantId: tenantId || null, severity, signalStatus, buckets, total: records.length };
  }

  rankBy(records, field, limit = 10) {
    const map = new Map();
    for (const row of records) {
      const key = row[field];
      if (!key) continue;
      const existing = map.get(key) || { id: key, count: 0, impactAmount: 0, riskScore: 0, criticalCount: 0, highCount: 0 };
      existing.count += 1;
      existing.impactAmount = Number((existing.impactAmount + Number(row.impact_amount || 0)).toFixed(2));
      existing.riskScore += SEVERITY_WEIGHT[row.severity] || 1;
      if (row.severity === 'CRITICAL') existing.criticalCount += 1;
      if (row.severity === 'HIGH') existing.highCount += 1;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .sort((a, b) => b.riskScore - a.riskScore || b.impactAmount - a.impactAmount || b.count - a.count)
      .slice(0, Number(limit) || 10);
  }

  async getTopRiskMerchants({ tenantId, from = null, to = null, limit = 10 } = {}) {
    const { records } = await this.listUnifiedSignals({ tenantId, from, to, signalStatus: 'OPEN', limit: 1000 });
    return this.rankBy(records, 'merchant_id', limit);
  }

  async getTopRiskGateways({ tenantId, from = null, to = null, limit = 10 } = {}) {
    const { records } = await this.listUnifiedSignals({ tenantId, from, to, signalStatus: 'OPEN', limit: 1000 });
    return this.rankBy(records, 'gateway_name', limit);
  }

  async updateSignal(source, sourceId, tenantId, targetStatus, actor, reason, correlationId) {
    if (source === 'RECONCILIATION_EXCEPTION') {
      if (targetStatus === 'ACKNOWLEDGED') {
        return reconciliationExceptionService.assignCase({
          caseId: sourceId,
          assignedTo: actor || 'reviewer',
          assignedBy: actor || 'system',
          correlationId
        });
      }
      if (targetStatus === 'RESOLVED') {
        return reconciliationExceptionService.resolveCase({
          caseId: sourceId,
          resolutionType: 'MANUAL_REVIEW_COMPLETED',
          resolutionReason: reason || 'Resolved from unified signal registry',
          resolvedBy: actor || 'system',
          correlationId
        });
      }
    }

    const serviceBySource = {
      PAYMENT: paymentSignalService,
      GATEWAY_SETTLEMENT: gatewaySettlementSignalService,
      SETTLEMENT: settlementSignalService,
      PAYOUT: payoutSignalService
    };
    const service = serviceBySource[source];
    if (!service) throw new Error(`Unsupported signal source: ${source}`);
    const params = { signalId: sourceId, tenantId, correlationId: correlationId || requestContext.getCorrelationId() };
    return targetStatus === 'ACKNOWLEDGED'
      ? service.acknowledgeSignal(params)
      : service.resolveSignal(params);
  }

  acknowledgeUnifiedSignal({ source, sourceId, tenantId, acknowledgedBy, correlationId = requestContext.getCorrelationId() }) {
    return this.updateSignal(source, sourceId, tenantId, 'ACKNOWLEDGED', acknowledgedBy, null, correlationId);
  }

  resolveUnifiedSignal({ source, sourceId, tenantId, resolvedBy, reason, correlationId = requestContext.getCorrelationId() }) {
    return this.updateSignal(source, sourceId, tenantId, 'RESOLVED', resolvedBy, reason, correlationId);
  }
}

module.exports = new SignalRegistryService();
module.exports.SignalRegistryService = SignalRegistryService;
