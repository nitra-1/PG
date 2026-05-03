const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const { LOGICAL_ACCOUNTS } = require('../ledger/accounting-templates');

const DAY_MS = 24 * 60 * 60 * 1000;
const FINANCIAL_EVENT_TYPES = [
  'payment.captured',
  'gateway.settlement.received',
  'payout.successful',
  'payout.returned',
  'payout.reversed',
  'gateway_settlement',
  'payment_success',
  'settlement',
  'merchant_payout',
  'refund',
  'refund_completed',
  'chargeback',
  'chargeback_debit',
  'chargeback_reversal',
  'platform_fee',
  'gateway_fee'
];

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
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

function asDate(value, fallback = new Date()) {
  return value ? new Date(value) : fallback;
}

function ageDays(from, asOf = new Date()) {
  if (!from) return 0;
  return Math.max(0, Math.floor((asDate(asOf).getTime() - asDate(from).getTime()) / DAY_MS));
}

function agingBucket(days) {
  if (days <= 1) return '0_1_days';
  if (days <= 3) return '2_3_days';
  if (days <= 7) return '4_7_days';
  if (days <= 15) return '8_15_days';
  return '16_plus_days';
}

function emptyAgingBuckets() {
  return {
    '0_1_days': { amount: 0, count: 0 },
    '2_3_days': { amount: 0, count: 0 },
    '4_7_days': { amount: 0, count: 0 },
    '8_15_days': { amount: 0, count: 0 },
    '16_plus_days': { amount: 0, count: 0 }
  };
}

class FinancialReportingService {
  async getLedgerAccountBalances({ tenantId, accountCodes, currency = null, asOf = null, merchantId = null, gatewayName = null }) {
    let query = db.knex('ledger_entries as le')
      .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
      .join('ledger_accounts as la', 'la.id', 'le.account_id')
      .where('lt.status', 'posted')
      .whereIn('la.account_code', accountCodes)
      .groupBy('la.account_code', 'la.account_name', 'la.account_type', 'la.normal_balance', 'le.currency')
      .select('la.account_code', 'la.account_name', 'la.account_type', 'la.normal_balance', 'le.currency')
      .sum({
        debits: db.knex.raw("CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END"),
        credits: db.knex.raw("CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END")
      });

    if (tenantId) query = query.where('le.tenant_id', tenantId).where('lt.tenant_id', tenantId);
    if (currency) query = query.where('le.currency', currency);
    if (asOf) query = query.where('lt.created_at', '<=', asOf);
    if (merchantId) {
      query = query.whereRaw(
        "COALESCE(le.metadata->>'merchantId', le.metadata->>'merchant_id', lt.metadata->>'merchantId', lt.metadata->>'merchant_id') = ?",
        [merchantId]
      );
    }
    if (gatewayName) {
      query = query.whereRaw(
        "LOWER(COALESCE(le.metadata->>'gateway', lt.metadata->>'gateway', '')) = LOWER(?)",
        [gatewayName]
      );
    }

    const rows = await query;
    return rows.map(row => {
      const debits = Number(row.debits || 0);
      const credits = Number(row.credits || 0);
      const normalBalance = row.normal_balance || (['liability', 'revenue'].includes(row.account_type) ? 'credit' : 'debit');
      const balance = normalBalance === 'credit' ? credits - debits : debits - credits;
      return {
        ...row,
        debits: roundMoney(debits),
        credits: roundMoney(credits),
        balance: roundMoney(balance)
      };
    });
  }

  async getEscrowBalance({ tenantId, currency = null, asOf = null } = {}) {
    const records = await this.getLedgerAccountBalances({
      tenantId,
      accountCodes: [LOGICAL_ACCOUNTS.BANK_ESCROW],
      currency,
      asOf
    });

    return {
      reportType: 'ESCROW_BALANCE',
      basis: 'ledger_entries',
      accountCode: LOGICAL_ACCOUNTS.BANK_ESCROW,
      tenantId: tenantId || null,
      asOf: asOf || null,
      currency: currency || null,
      totalBalance: roundMoney(records.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
      records
    };
  }

  async getGatewayReceivableBalance({ tenantId, gatewayName = null, currency = null, asOf = null } = {}) {
    const records = await this.getLedgerAccountBalances({
      tenantId,
      accountCodes: [LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE],
      currency,
      asOf,
      gatewayName
    });

    return {
      reportType: 'GATEWAY_RECEIVABLE',
      basis: 'ledger_entries',
      accountCode: LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE,
      tenantId: tenantId || null,
      gatewayName,
      asOf: asOf || null,
      currency: currency || null,
      totalBalance: roundMoney(records.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
      records
    };
  }

  async getMerchantPayableBalance({ tenantId, merchantId = null, currency = null, asOf = null } = {}) {
    let records = await this.getLedgerAccountBalances({
      tenantId,
      accountCodes: [LOGICAL_ACCOUNTS.MERCHANT_PAYABLE],
      currency,
      asOf,
      merchantId
    });

    if (merchantId && records.length === 0) {
      records = await this.getLedgerAccountBalances({
        tenantId,
        accountCodes: [LOGICAL_ACCOUNTS.MERCHANT_PAYABLE],
        currency,
        asOf
      });
    }

    return {
      reportType: 'MERCHANT_PAYABLE',
      basis: 'ledger_entries',
      accountCode: LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
      tenantId: tenantId || null,
      merchantId,
      asOf: asOf || null,
      currency: currency || null,
      totalBalance: roundMoney(records.reduce((sum, row) => sum + Number(row.balance || 0), 0)),
      records
    };
  }

  async getMerchantPayableAging({ tenantId, merchantId = null, currency = null, asOf = new Date() } = {}) {
    let query = db.knex('ledger_entries as le')
      .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
      .join('ledger_accounts as la', 'la.id', 'le.account_id')
      .where('lt.status', 'posted')
      .where('la.account_code', LOGICAL_ACCOUNTS.MERCHANT_PAYABLE)
      .where('lt.created_at', '<=', asOf)
      .select('le.amount', 'le.entry_type', 'le.currency', 'lt.created_at', 'le.metadata', 'lt.metadata as transaction_metadata');

    if (tenantId) query = query.where('le.tenant_id', tenantId).where('lt.tenant_id', tenantId);
    if (currency) query = query.where('le.currency', currency);
    if (merchantId) {
      query = query.whereRaw(
        "COALESCE(le.metadata->>'merchantId', le.metadata->>'merchant_id', lt.metadata->>'merchantId', lt.metadata->>'merchant_id') = ?",
        [merchantId]
      );
    }

    let entries = await query;
    if (merchantId && entries.length === 0) {
      entries = await db.knex('ledger_entries as le')
        .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
        .join('ledger_accounts as la', 'la.id', 'le.account_id')
        .where('lt.status', 'posted')
        .where('la.account_code', LOGICAL_ACCOUNTS.MERCHANT_PAYABLE)
        .where('lt.created_at', '<=', asOf)
        .modify(q => {
          if (tenantId) q.where('le.tenant_id', tenantId).where('lt.tenant_id', tenantId);
          if (currency) q.where('le.currency', currency);
        })
        .select('le.amount', 'le.entry_type', 'le.currency', 'lt.created_at', 'le.metadata', 'lt.metadata as transaction_metadata');
    }

    const buckets = emptyAgingBuckets();
    const records = [];
    for (const entry of entries) {
      const signedAmount = entry.entry_type === 'credit' ? Number(entry.amount || 0) : -Number(entry.amount || 0);
      if (Math.abs(signedAmount) <= 0.001) continue;
      const days = ageDays(entry.created_at, asOf);
      const bucket = agingBucket(days);
      buckets[bucket].amount = roundMoney(buckets[bucket].amount + signedAmount);
      buckets[bucket].count += 1;
      records.push({
        amount: roundMoney(signedAmount),
        currency: entry.currency,
        ageDays: days,
        bucket,
        ledgerCreatedAt: entry.created_at
      });
    }

    return {
      reportType: 'MERCHANT_PAYABLE_AGING',
      basis: 'ledger_entries',
      tenantId: tenantId || null,
      merchantId,
      asOf,
      currency: currency || null,
      buckets,
      totalBalance: roundMoney(records.reduce((sum, row) => sum + row.amount, 0)),
      records
    };
  }

  async getSettlementAging({ tenantId, merchantId = null, from = null, to = null, asOf = new Date() } = {}) {
    let query = db.knex('settlement_batches')
      .orderBy('created_at', 'desc');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    const rows = await query;
    const summaryByStatus = {};
    const records = rows.map(row => {
      const dueDate = row.scheduled_settlement_date || row.created_at;
      const delayedDays = ['PAYOUT_CREATED', 'CANCELLED'].includes(row.batch_status) ? 0 : ageDays(dueDate, asOf);
      summaryByStatus[row.batch_status] = summaryByStatus[row.batch_status] || { count: 0, amount: 0, delayedAmount: 0 };
      summaryByStatus[row.batch_status].count += 1;
      summaryByStatus[row.batch_status].amount = roundMoney(summaryByStatus[row.batch_status].amount + Number(row.net_settlement_amount || 0));
      if (delayedDays > 0) {
        summaryByStatus[row.batch_status].delayedAmount = roundMoney(summaryByStatus[row.batch_status].delayedAmount + Number(row.net_settlement_amount || 0));
      }
      return {
        batchId: row.id,
        batchRef: row.batch_ref,
        tenantId: row.tenant_id,
        merchantId: row.merchant_id,
        batchStatus: row.batch_status,
        scheduledSettlementDate: row.scheduled_settlement_date,
        netSettlementAmount: Number(row.net_settlement_amount || 0),
        reservedAmount: Number(row.reserved_amount || 0),
        currency: row.currency,
        delayedDays
      };
    });

    return { reportType: 'SETTLEMENT_AGING', basis: 'settlement_batches_operational', tenantId: tenantId || null, summaryByStatus, records };
  }

  async getPayoutAging({ tenantId, merchantId = null, payoutStatus = null, from = null, to = null, asOf = new Date() } = {}) {
    let query = db.knex('payout_instructions').orderBy('created_at', 'desc');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (payoutStatus) query = query.where('payout_status', payoutStatus);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    const rows = await query;
    const summaryByStatus = {};
    const records = rows.map(row => {
      const ageBasis = row.submitted_at || row.processing_at || row.created_at;
      const days = ageDays(ageBasis, asOf);
      summaryByStatus[row.payout_status] = summaryByStatus[row.payout_status] || { count: 0, amount: 0 };
      summaryByStatus[row.payout_status].count += 1;
      summaryByStatus[row.payout_status].amount = roundMoney(summaryByStatus[row.payout_status].amount + Number(row.payout_amount || 0));
      return {
        payoutInstructionId: row.id,
        tenantId: row.tenant_id,
        merchantId: row.merchant_id,
        payoutStatus: row.payout_status,
        providerName: row.provider_name,
        providerPayoutId: row.provider_payout_id,
        payoutAmount: Number(row.payout_amount || 0),
        currency: row.currency,
        submittedAt: row.submitted_at,
        ageDays: days
      };
    });

    return { reportType: 'PAYOUT_AGING', basis: 'payout_instructions_operational', tenantId: tenantId || null, summaryByStatus, records };
  }

  amountFromOutboxPayload(payload) {
    const parsed = parseJson(payload);
    return roundMoney(parsed.amount || parsed.settlementAmount || parsed.payout_amount || parsed.payoutAmount || 0);
  }

  async getAmountAtRisk({ tenantId, from = null, to = null, currency = null } = {}) {
    const signalRegistryService = require('./signal-registry-service');
    const openSignals = await signalRegistryService.listUnifiedSignals({
      tenantId,
      severity: null,
      signalStatus: 'OPEN',
      from,
      to,
      limit: 1000
    });

    const highSignals = openSignals.records.filter(signal => ['HIGH', 'CRITICAL'].includes(signal.severity));
    const signalRisk = highSignals.reduce((sum, signal) => sum + Number(signal.impact_amount || 0), 0);

    let payoutQuery = db.knex('payout_instructions')
      .whereIn('payout_status', ['TIMEOUT', 'FAILED', 'RETURNED', 'REVERSED']);
    if (tenantId) payoutQuery = payoutQuery.where('tenant_id', tenantId);
    if (currency) payoutQuery = payoutQuery.where('currency', currency);
    if (from) payoutQuery = payoutQuery.where('created_at', '>=', from);
    if (to) payoutQuery = payoutQuery.where('created_at', '<=', to);
    const riskyPayouts = await payoutQuery;

    let settlementQuery = db.knex('settlement_batches')
      .whereIn('batch_status', ['RESERVATION_FAILED', 'EXPIRED', 'FAILED']);
    if (tenantId) settlementQuery = settlementQuery.where('tenant_id', tenantId);
    if (currency) settlementQuery = settlementQuery.where('currency', currency);
    if (from) settlementQuery = settlementQuery.where('created_at', '>=', from);
    if (to) settlementQuery = settlementQuery.where('created_at', '<=', to);
    const riskySettlements = await settlementQuery;

    let outboxQuery = db.knex('outbox_events')
      .where('status', 'DLQ')
      .whereIn('event_type', FINANCIAL_EVENT_TYPES);
    if (tenantId) outboxQuery = outboxQuery.where('tenant_id', tenantId);
    if (from) outboxQuery = outboxQuery.where('created_at', '>=', from);
    if (to) outboxQuery = outboxQuery.where('created_at', '<=', to);
    const dlqEvents = await outboxQuery;

    let exceptionQuery = db.knex('reconciliation_exception_cases')
      .whereIn('case_status', ['OPEN', 'IN_REVIEW', 'PENDING_APPROVAL', 'ESCALATED', 'REOPENED']);
    if (tenantId) exceptionQuery = exceptionQuery.where('tenant_id', tenantId);
    if (from) exceptionQuery = exceptionQuery.where('opened_at', '>=', from);
    if (to) exceptionQuery = exceptionQuery.where('opened_at', '<=', to);
    const exceptions = await exceptionQuery;

    const categories = {
      openHighCriticalSignals: {
        basis: 'unified_signals',
        count: highSignals.length,
        quantifiedAmount: roundMoney(signalRisk),
        unquantifiedCount: highSignals.filter(signal => signal.impact_amount == null).length
      },
      riskyPayouts: {
        basis: 'payout_instructions',
        count: riskyPayouts.length,
        quantifiedAmount: roundMoney(riskyPayouts.reduce((sum, row) => sum + Number(row.payout_amount || 0), 0))
      },
      riskySettlements: {
        basis: 'settlement_batches',
        count: riskySettlements.length,
        quantifiedAmount: roundMoney(riskySettlements.reduce((sum, row) => sum + Number(row.net_settlement_amount || 0), 0))
      },
      dlqFinancialEvents: {
        basis: 'outbox_events',
        count: dlqEvents.length,
        quantifiedAmount: roundMoney(dlqEvents.reduce((sum, row) => sum + this.amountFromOutboxPayload(row.payload), 0)),
        unquantifiedCount: dlqEvents.filter(row => this.amountFromOutboxPayload(row.payload) === 0).length
      },
      reconciliationExceptions: {
        basis: 'reconciliation_exception_cases',
        count: exceptions.length,
        quantifiedAmount: roundMoney(exceptions.reduce((sum, row) => sum + Number(parseJson(row.metadata).discrepancy_amount || parseJson(row.metadata).impact_amount || 0), 0)),
        unquantifiedCount: exceptions.filter(row => !parseJson(row.metadata).discrepancy_amount && !parseJson(row.metadata).impact_amount).length
      }
    };

    const estimatedTotal = Object.values(categories)
      .reduce((sum, category) => sum + Number(category.quantifiedAmount || 0), 0);

    return {
      reportType: 'AMOUNT_AT_RISK',
      basis: 'operational_risk_breakdown_estimated',
      tenantId: tenantId || null,
      from,
      to,
      currency: currency || null,
      estimatedTotal: roundMoney(estimatedTotal),
      deduplication: 'category_breakdown_not_global_deduped',
      categories
    };
  }

  async getFinanceDashboardSummary({ tenantId, from = null, to = null, currency = null } = {}) {
    const [escrow, gatewayReceivable, merchantPayable, settlementAging, payoutAging, amountAtRisk] = await Promise.all([
      this.getEscrowBalance({ tenantId, currency, asOf: to }),
      this.getGatewayReceivableBalance({ tenantId, currency, asOf: to }),
      this.getMerchantPayableBalance({ tenantId, currency, asOf: to }),
      this.getSettlementAging({ tenantId, from, to }),
      this.getPayoutAging({ tenantId, from, to }),
      this.getAmountAtRisk({ tenantId, from, to, currency })
    ]);

    return {
      reportType: 'FINANCE_DASHBOARD_SUMMARY',
      tenantId: tenantId || null,
      from,
      to,
      currency: currency || null,
      ledgerTruth: {
        escrowBalance: escrow.totalBalance,
        gatewayReceivable: gatewayReceivable.totalBalance,
        merchantPayable: merchantPayable.totalBalance
      },
      operationalTruth: {
        settlementAging: settlementAging.summaryByStatus,
        payoutAging: payoutAging.summaryByStatus,
        amountAtRisk
      }
    };
  }

  async createReportSnapshot({ tenantId, reportType, payload, generatedBy = null, correlationId = requestContext.getCorrelationId(), from = null, to = null, currency = null, metadata = {} }) {
    const [snapshot] = await db.knex('financial_report_snapshots')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId || null,
        report_type: reportType,
        report_period_start: from || null,
        report_period_end: to || null,
        currency: currency || null,
        generated_by: generatedBy,
        generated_at: new Date(),
        snapshot_payload: payload || {},
        correlation_id: correlationId || null,
        metadata
      })
      .returning('*');
    return snapshot;
  }
}

module.exports = new FinancialReportingService();
module.exports.FinancialReportingService = FinancialReportingService;
