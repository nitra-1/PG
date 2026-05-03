const db = require('../../database');
const requestContext = require('../context/request-context');
const settlementSignalService = require('./settlement-signal-service');

const ACTIVE_ITEM_STATUSES = ['RESERVED', 'SETTLED'];
const OPEN_EXCEPTION_STATUSES = ['OPEN', 'IN_REVIEW', 'PENDING_APPROVAL', 'ESCALATED', 'REOPENED'];

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

class SettlementEligibilityService {
  async tableExists(tableName) {
    return db.knex.schema.hasTable(tableName);
  }

  async findSettlementCandidates({ tenantId, merchantId = null, cycleStart = null, cycleEnd = null, limit = 500 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    let query = db.knex('transactions as t')
      .where('t.tenant_id', tenantId)
      .where('t.status', 'success')
      .orderBy('t.completed_at', 'asc')
      .limit(Math.min(Number(limit) || 500, 1000))
      .select('t.*');

    if (cycleStart) {
      query = query.where('t.completed_at', '>=', new Date(cycleStart));
    }
    if (cycleEnd) {
      query = query.where('t.completed_at', '<=', new Date(cycleEnd));
    }
    if (merchantId) {
      query = query.where(function() {
        this.where('t.tenant_id', merchantId)
          .orWhereRaw("COALESCE(t.metadata->>'merchantId', t.metadata->>'merchant_id') = ?", [merchantId]);
      });
    }

    return query;
  }

  async getPaymentLedgerTransaction(transaction, trx = db.knex) {
    return trx('ledger_transactions')
      .where('tenant_id', transaction.tenant_id)
      .where('transaction_ref', transaction.transaction_ref)
      .where('event_type', 'payment_success')
      .where('status', 'posted')
      .first();
  }

  async validateLedgerBalanced(ledgerTransaction, trx = db.knex) {
    if (!ledgerTransaction) return false;
    const totals = await trx('ledger_entries')
      .where('tenant_id', ledgerTransaction.tenant_id)
      .where('transaction_id', ledgerTransaction.id)
      .first(
        db.knex.raw("COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0) as debits"),
        db.knex.raw("COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END), 0) as credits"),
        db.knex.raw('COUNT(*) as count')
      );

    return Number(totals?.count || 0) > 0 && Math.abs(Number(totals.debits || 0) - Number(totals.credits || 0)) <= 0.01;
  }

  async findGatewaySettlementLine(transaction, trx = db.knex) {
    if (!(await this.tableExists('gateway_settlement_lines'))) return null;
    return trx('gateway_settlement_lines')
      .where('tenant_id', transaction.tenant_id)
      .where('transaction_ref', transaction.transaction_ref)
      .where('line_type', 'PAYMENT')
      .where('reconciliation_status', 'MATCHED')
      .whereNotNull('ledger_transaction_id')
      .orderBy('settled_at', 'desc')
      .first();
  }

  async hasMerchantPayableEntry({ tenantId, ledgerTransactionId }, trx = db.knex) {
    const row = await trx('ledger_entries as le')
      .join('ledger_accounts as la', 'la.id', 'le.account_id')
      .where('le.tenant_id', tenantId)
      .where('le.transaction_id', ledgerTransactionId)
      .where('la.account_code', 'MER-002')
      .where('le.entry_type', 'credit')
      .first('le.id');

    return Boolean(row);
  }

  async findActiveSettlementItem(transaction, trx = db.knex) {
    if (!(await this.tableExists('settlement_items'))) return null;
    return trx('settlement_items')
      .where('tenant_id', transaction.tenant_id)
      .where('transaction_ref', transaction.transaction_ref)
      .whereIn('item_status', ACTIVE_ITEM_STATUSES)
      .first();
  }

  async findOpenReconciliationException(transaction, trx = db.knex) {
    if (!(await this.tableExists('reconciliation_transactions')) || !(await this.tableExists('reconciliation_exception_cases'))) {
      return null;
    }

    const reconciliation = await trx('reconciliation_transactions')
      .where('tenant_id', transaction.tenant_id)
      .where('transaction_ref', transaction.transaction_ref)
      .whereNot('reconciliation_status', 'MATCHED')
      .first();

    if (!reconciliation) return null;

    return trx('reconciliation_exception_cases')
      .where('tenant_id', transaction.tenant_id)
      .where('source_type', 'TRANSACTION_LEDGER')
      .where('source_reconciliation_id', reconciliation.id)
      .whereIn('case_status', OPEN_EXCEPTION_STATUSES)
      .first();
  }

  blockedByRefundOrDispute(transaction) {
    const metadata = parseJson(transaction.metadata);
    if (transaction.status === 'refunded' || metadata.refunded === true || metadata.refund_status === 'FULLY_REFUNDED') {
      return 'Transaction is fully refunded';
    }
    if (metadata.dispute_status === 'ACTIVE' || metadata.dispute_status === 'OPEN' || metadata.chargeback_active === true) {
      return 'Transaction has active dispute or chargeback';
    }
    return null;
  }

  holdReason(transaction) {
    const metadata = parseJson(transaction.metadata);
    if (!metadata.settlement_hold_until) return null;
    const holdUntil = new Date(metadata.settlement_hold_until);
    if (!Number.isNaN(holdUntil.getTime()) && holdUntil > new Date()) {
      return `Transaction is under settlement hold until ${holdUntil.toISOString()}`;
    }
    return null;
  }

  async evaluateCandidateEligibility(candidate, options = {}) {
    const trx = options.trx || db.knex;
    const transaction = candidate.transaction || candidate;
    const tenantId = transaction.tenant_id;
    const metadata = parseJson(transaction.metadata);
    const missingControls = [];

    const fail = (reason, signalType = 'SETTLEMENT_ELIGIBILITY_FAILED', details = {}) => ({
      passed: false,
      reason,
      signalType,
      details: {
        ...details,
        missing_controls: missingControls
      }
    });

    if (transaction.status !== 'success') {
      return fail(`Payment is not captured/successful: ${transaction.status}`);
    }

    const refundOrDisputeReason = this.blockedByRefundOrDispute(transaction);
    if (refundOrDisputeReason) {
      return fail(refundOrDisputeReason, 'SETTLEMENT_BLOCKED_BY_REFUND_OR_DISPUTE');
    }

    const holdReason = this.holdReason(transaction);
    if (holdReason) {
      return fail(holdReason);
    }

    const ledgerTransaction = await this.getPaymentLedgerTransaction(transaction, trx);
    if (!ledgerTransaction) {
      return fail('Payment ledger transaction is missing');
    }

    const ledgerBalanced = await this.validateLedgerBalanced(ledgerTransaction, trx);
    if (!ledgerBalanced) {
      return fail('Payment ledger transaction is missing entries or is imbalanced', 'SETTLEMENT_ELIGIBILITY_FAILED', {
        ledger_transaction_id: ledgerTransaction.id
      });
    }

    const hasPayable = await this.hasMerchantPayableEntry({
      tenantId,
      ledgerTransactionId: ledgerTransaction.id
    }, trx);
    if (!hasPayable) {
      return fail('Merchant payable ledger entry is missing', 'INSUFFICIENT_MERCHANT_PAYABLE', {
        ledger_transaction_id: ledgerTransaction.id
      });
    }

    const gatewaySettlementLine = await this.findGatewaySettlementLine(transaction, trx);
    if (!gatewaySettlementLine) {
      return fail('Gateway settlement receivable-to-escrow confirmation is missing');
    }

    const gatewaySettlementLedger = await trx('ledger_transactions')
      .where('tenant_id', tenantId)
      .where('id', gatewaySettlementLine.ledger_transaction_id)
      .where('event_type', 'gateway_settlement')
      .where('status', 'posted')
      .first();

    if (!gatewaySettlementLedger) {
      return fail('Gateway settlement ledger transaction is missing or not posted', 'SETTLEMENT_ELIGIBILITY_FAILED', {
        gateway_settlement_line_id: gatewaySettlementLine.id
      });
    }

    const activeItem = await this.findActiveSettlementItem(transaction, trx);
    if (activeItem) {
      return fail('Transaction is already actively reserved or settled', 'PAYABLE_RESERVED_TWICE_ATTEMPTED', {
        existing_settlement_item_id: activeItem.id,
        existing_batch_id: activeItem.batch_id
      });
    }

    const openException = await this.findOpenReconciliationException(transaction, trx);
    if (openException) {
      return fail('Transaction has an open reconciliation exception', 'SETTLEMENT_BLOCKED_BY_RECONCILIATION_EXCEPTION', {
        exception_case_id: openException.id,
        source_status: openException.source_status
      });
    }

    if (!metadata.merchantId && !metadata.merchant_id) {
      missingControls.push('merchant-specific ledger metadata is not consistently available; tenant-level payable fallback used');
    }
    missingControls.push('refund and chargeback lifecycle tables are not available in current schema; transaction metadata/status checked');

    const grossAmount = roundMoney(gatewaySettlementLine.gross_amount || transaction.amount);
    const feeDeduction = roundMoney(gatewaySettlementLine.gateway_fee || 0);
    const taxDeduction = roundMoney(gatewaySettlementLine.gst_amount || 0);
    const adjustmentAmount = roundMoney(gatewaySettlementLine.adjustment_amount || 0);
    const netAmount = roundMoney(gatewaySettlementLine.net_amount || (grossAmount - feeDeduction - taxDeduction + adjustmentAmount));

    return {
      passed: true,
      reason: 'Eligible for settlement reservation',
      signalType: null,
      ledgerTransaction,
      gatewaySettlementLine,
      amounts: {
        grossAmount,
        feeDeduction,
        taxDeduction,
        adjustmentAmount,
        netAmount,
        currency: gatewaySettlementLine.currency || transaction.currency || 'INR'
      },
      details: {
        ledger_transaction_id: ledgerTransaction.id,
        gateway_settlement_line_id: gatewaySettlementLine.id,
        gateway_settlement_ledger_transaction_id: gatewaySettlementLedger.id,
        missing_controls: missingControls
      }
    };
  }

  async createEligibilitySignal({ batch, item, evaluation, correlationId }, trx = null) {
    if (!evaluation?.signalType) return null;
    return settlementSignalService.createOrUpdateSignal({
      tenantId: item.tenant_id,
      signalType: evaluation.signalType,
      sourceType: 'SETTLEMENT_ITEM',
      sourceId: item.id,
      batchId: batch.id,
      itemId: item.id,
      merchantId: item.merchant_id,
      transactionRef: item.transaction_ref,
      impactAmount: item.net_amount || item.gross_amount,
      currency: item.currency,
      description: evaluation.reason,
      correlationId: correlationId || item.correlation_id || batch.correlation_id || requestContext.getCorrelationId(),
      metadata: evaluation.details || {}
    }, trx);
  }

  async explainIneligibility(candidate) {
    const evaluation = await this.evaluateCandidateEligibility(candidate);
    return evaluation.passed ? null : {
      reason: evaluation.reason,
      signal_type: evaluation.signalType,
      details: evaluation.details
    };
  }

  async evaluateBatchEligibility(batchId) {
    const batch = await db.knex('settlement_batches').where('id', batchId).first();
    if (!batch) throw new Error('Settlement batch not found');

    const items = await db.knex('settlement_items')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batchId);

    const results = [];
    for (const item of items) {
      const transaction = item.transaction_id
        ? await db.knex('transactions').where('id', item.transaction_id).where('tenant_id', item.tenant_id).first()
        : await db.knex('transactions').where('tenant_id', item.tenant_id).where('transaction_ref', item.transaction_ref).first();

      if (!transaction) {
        results.push({ item, passed: false, reason: 'Transaction not found' });
        continue;
      }

      const evaluation = await this.evaluateCandidateEligibility(transaction);
      results.push({ item, ...evaluation });
    }

    return results;
  }
}

module.exports = new SettlementEligibilityService();
module.exports.SettlementEligibilityService = SettlementEligibilityService;
