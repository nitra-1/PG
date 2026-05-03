/**
 * Reconciliation Service
 * 
 * Handles reconciliation between internal ledger and external sources:
 * - Gateway settlement reports (Razorpay, PayU, CCAvenue)
 * - Bank escrow statements
 * - Merchant payout confirmations
 * 
 * Identifies discrepancies:
 * - Missing transactions (in one system but not the other)
 * - Amount mismatches
 * - Duplicate entries
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logging/logger');
const requestContext = require('../context/request-context');

const TRANSACTION_LEDGER_STATUSES = {
  MATCHED: 'MATCHED',
  MISSING_LEDGER: 'MISSING_LEDGER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  DUPLICATE_LEDGER: 'DUPLICATE_LEDGER',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH'
};

const SETTLEMENT_LEDGER_STATUSES = {
  MATCHED: 'MATCHED',
  MISSING_LEDGER_TRANSACTION: 'MISSING_LEDGER_TRANSACTION',
  MISSING_SETTLEMENT: 'MISSING_SETTLEMENT',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  FEE_MISMATCH: 'FEE_MISMATCH',
  NET_AMOUNT_MISMATCH: 'NET_AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  DUPLICATE_SETTLEMENT: 'DUPLICATE_SETTLEMENT',
  LEDGER_ENTRIES_MISSING: 'LEDGER_ENTRIES_MISSING'
};

const BANK_SETTLEMENT_STATUSES = {
  MATCHED: 'MATCHED',
  MISSING_BANK_STATEMENT: 'MISSING_BANK_STATEMENT',
  MISSING_PAYOUT_INSTRUCTION: 'MISSING_PAYOUT_INSTRUCTION',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  UTR_MISMATCH: 'UTR_MISMATCH',
  BANK_REFERENCE_MISMATCH: 'BANK_REFERENCE_MISMATCH',
  BANK_TRANSACTION_ID_MISMATCH: 'BANK_TRANSACTION_ID_MISMATCH',
  DATE_MISMATCH: 'DATE_MISMATCH',
  DUPLICATE_BANK_MATCH: 'DUPLICATE_BANK_MATCH',
  DUPLICATE_PAYOUT: 'DUPLICATE_PAYOUT',
  RETURNED_OR_REVERSED: 'RETURNED_OR_REVERSED',
  UNMATCHED_BANK_DEBIT: 'UNMATCHED_BANK_DEBIT',
  UNMATCHED_BANK_CREDIT: 'UNMATCHED_BANK_CREDIT',
  TENANT_MISMATCH: 'TENANT_MISMATCH'
};

const BANK_RECON_DATE_TOLERANCE_DAYS = 2;

function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch (error) {
    return {};
  }
}

function amountToCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  const normalized = String(value).trim();
  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^-/, '');
  const [wholePart, fractionalPart = ''] = unsigned.split('.');
  const whole = BigInt(wholePart || '0') * 100n;
  const centsText = (fractionalPart + '00').slice(0, 2);
  return Number((whole + BigInt(centsText || '0')) * BigInt(sign));
}

function centsToAmount(cents) {
  return (Math.abs(cents) / 100).toFixed(2);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  if (!left || !right) return 0;
  const leftDate = new Date(`${left}T00:00:00.000Z`);
  const rightDate = new Date(`${right}T00:00:00.000Z`);
  return Math.abs(Math.round((leftDate - rightDate) / (24 * 60 * 60 * 1000)));
}

class ReconciliationService {
  async resolveSuccessfulTransaction(transactionOrRef, tenantId = null) {
    if (!transactionOrRef) {
      throw new Error('Transaction is required for reconciliation');
    }

    if (typeof transactionOrRef === 'object' && transactionOrRef.id && transactionOrRef.transaction_ref) {
      if (transactionOrRef.status !== 'success') {
        throw new Error(`Only successful transactions can be reconciled: ${transactionOrRef.transaction_ref}`);
      }
      return transactionOrRef;
    }

    const query = db.knex('transactions').where('status', 'success');

    if (tenantId) {
      query.where('tenant_id', tenantId);
    }

    if (typeof transactionOrRef === 'string') {
      query.where(function() {
        this.where('id', transactionOrRef).orWhere('transaction_ref', transactionOrRef);
      });
    } else if (transactionOrRef.id) {
      query.where('id', transactionOrRef.id);
    } else if (transactionOrRef.transaction_ref) {
      query.where('transaction_ref', transactionOrRef.transaction_ref);
    }

    const transaction = await query.first();
    if (!transaction) {
      throw new Error('Successful transaction not found for reconciliation');
    }

    return transaction;
  }

  async summarizeLedgerEntries(ledgerTransactionId) {
    const entries = await db.knex('ledger_entries')
      .where('transaction_id', ledgerTransactionId)
      .select('entry_type', 'amount', 'currency');

    const debitCents = entries
      .filter(entry => entry.entry_type === 'debit')
      .reduce((sum, entry) => sum + amountToCents(entry.amount), 0);
    const creditCents = entries
      .filter(entry => entry.entry_type === 'credit')
      .reduce((sum, entry) => sum + amountToCents(entry.amount), 0);
    const currencies = [...new Set(entries.map(entry => entry.currency).filter(Boolean))];

    return {
      entries,
      debitCents,
      creditCents,
      ledgerAmountCents: debitCents === creditCents ? debitCents : Math.max(debitCents, creditCents),
      currencies,
      balanced: entries.length > 0 && debitCents === creditCents
    };
  }

  async persistTransactionReconciliation(result) {
    const row = {
      id: uuidv4(),
      tenant_id: result.tenant_id,
      transaction_id: result.transaction_id,
      transaction_ref: result.transaction_ref,
      ledger_transaction_id: result.ledger_transaction_id,
      reconciliation_status: result.reconciliation_status,
      transaction_amount: result.transaction_amount,
      ledger_amount: result.ledger_amount,
      currency: result.currency,
      discrepancy_amount: result.discrepancy_amount,
      checked_at: db.knex.fn.now(),
      correlation_id: result.correlation_id || null,
      updated_at: db.knex.fn.now()
    };

    const [saved] = await db.knex('reconciliation_transactions')
      .insert(row)
      .onConflict(['tenant_id', 'transaction_ref'])
      .merge({
        transaction_id: row.transaction_id,
        ledger_transaction_id: row.ledger_transaction_id,
        reconciliation_status: row.reconciliation_status,
        transaction_amount: row.transaction_amount,
        ledger_amount: row.ledger_amount,
        currency: row.currency,
        discrepancy_amount: row.discrepancy_amount,
        checked_at: row.checked_at,
        correlation_id: row.correlation_id,
        updated_at: row.updated_at
      })
      .returning('*');

    return saved;
  }

  /**
   * Reconcile one successful payment transaction against its ledger posting.
   * This detector is intentionally read-only for transactions and ledger tables.
   */
  async reconcileTransaction(transactionOrRef, options = {}) {
    const correlationId = options.correlationId || requestContext.getCorrelationId() || null;
    const transaction = await this.resolveSuccessfulTransaction(transactionOrRef, options.tenantId);
    const transactionAmountCents = amountToCents(transaction.amount);

    const ledgerTransactions = await db.knex('ledger_transactions')
      .where({
        tenant_id: transaction.tenant_id,
        transaction_ref: transaction.transaction_ref
      })
      .orderBy('created_at', 'asc');

    let status = TRANSACTION_LEDGER_STATUSES.MATCHED;
    let ledgerTransactionId = null;
    let ledgerAmountCents = 0;
    let ledgerCorrelationId = null;

    if (ledgerTransactions.length === 0) {
      status = TRANSACTION_LEDGER_STATUSES.MISSING_LEDGER;
    } else if (ledgerTransactions.length > 1) {
      status = TRANSACTION_LEDGER_STATUSES.DUPLICATE_LEDGER;
      ledgerTransactionId = ledgerTransactions[0].id;
      ledgerAmountCents = amountToCents(ledgerTransactions[0].amount);
      ledgerCorrelationId = ledgerTransactions[0].correlation_id || parseMetadata(ledgerTransactions[0].metadata).correlation_id;
    } else {
      const ledgerTransaction = ledgerTransactions[0];
      const summary = await this.summarizeLedgerEntries(ledgerTransaction.id);
      ledgerTransactionId = ledgerTransaction.id;
      ledgerAmountCents = summary.ledgerAmountCents;
      ledgerCorrelationId = ledgerTransaction.correlation_id || parseMetadata(ledgerTransaction.metadata).correlation_id;

      const ledgerCurrencyMismatch = summary.entries.length > 0 && (
        ledgerTransaction.currency !== transaction.currency ||
        summary.currencies.length !== 1 ||
        summary.currencies[0] !== transaction.currency
      );

      if (!summary.balanced || ledgerAmountCents !== transactionAmountCents) {
        status = TRANSACTION_LEDGER_STATUSES.AMOUNT_MISMATCH;
      } else if (ledgerCurrencyMismatch) {
        status = TRANSACTION_LEDGER_STATUSES.CURRENCY_MISMATCH;
      }
    }

    const discrepancyCents = status === TRANSACTION_LEDGER_STATUSES.MATCHED
      ? 0
      : Math.abs(transactionAmountCents - ledgerAmountCents);

    const result = {
      tenant_id: transaction.tenant_id,
      transaction_id: transaction.id,
      transaction_ref: transaction.transaction_ref,
      ledger_transaction_id: ledgerTransactionId,
      reconciliation_status: status,
      transaction_amount: centsToAmount(transactionAmountCents),
      ledger_amount: ledgerTransactions.length === 0 ? null : centsToAmount(ledgerAmountCents),
      currency: transaction.currency,
      discrepancy_amount: centsToAmount(discrepancyCents),
      correlation_id: correlationId || ledgerCorrelationId || null
    };

    const saved = await this.persistTransactionReconciliation(result);

    logger.info('Transaction-ledger reconciliation checked', {
      transaction_ref: result.transaction_ref,
      reconciliation_status: result.reconciliation_status,
      discrepancy_amount: result.discrepancy_amount,
      correlation_id: result.correlation_id,
      tenant_id: result.tenant_id
    });

    return saved;
  }

  async reconcileAllTransactions(params = {}) {
    const { tenantId, from, to, limit } = params;
    let query = db.knex('transactions')
      .where('status', 'success')
      .whereNotNull('transaction_ref')
      .orderBy('created_at', 'asc');

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);
    if (limit) query = query.limit(Number(limit));

    const transactions = await query;
    const results = [];

    for (const transaction of transactions) {
      results.push(await this.reconcileTransaction(transaction, {
        correlationId: params.correlationId
      }));
    }

    return {
      total: results.length,
      by_status: results.reduce((acc, row) => {
        acc[row.reconciliation_status] = (acc[row.reconciliation_status] || 0) + 1;
        return acc;
      }, {}),
      results
    };
  }

  async listTransactionReconciliations(filters = {}) {
    const { tenantId, status, from, to, limit = 100, offset = 0 } = filters;
    let query = db.knex('reconciliation_transactions')
      .orderBy('checked_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (status) query = query.where('reconciliation_status', status);
    if (from) query = query.where('checked_at', '>=', from);
    if (to) query = query.where('checked_at', '<=', to);

    return query;
  }

  async resolveSettlement(settlementOrRef, tenantId = null) {
    if (!settlementOrRef) {
      throw new Error('Settlement is required for reconciliation');
    }

    if (typeof settlementOrRef === 'object' && settlementOrRef.id && settlementOrRef.settlement_ref) {
      return settlementOrRef;
    }

    const query = db.knex('settlements');

    if (tenantId) {
      query.where('tenant_id', tenantId);
    }

    if (typeof settlementOrRef === 'string') {
      query.where(function() {
        this.where('id', settlementOrRef).orWhere('settlement_ref', settlementOrRef);
      });
    } else if (settlementOrRef.id) {
      query.where('id', settlementOrRef.id);
    } else if (settlementOrRef.settlement_ref) {
      query.where('settlement_ref', settlementOrRef.settlement_ref);
    }

    const settlement = await query.first();
    if (!settlement) {
      throw new Error('Settlement not found for reconciliation');
    }

    return settlement;
  }

  async fetchSettlementDuplicates(settlement) {
    if (!settlement?.settlement_ref) return [];
    return db.knex('settlements')
      .where({
        tenant_id: settlement.tenant_id,
        settlement_ref: settlement.settlement_ref
      })
      .orderBy('created_at', 'asc');
  }

  async summarizeSettlementLedger(ledgerTransaction) {
    const entries = await db.knex('ledger_entries as le')
      .join('ledger_accounts as la', 'la.id', 'le.account_id')
      .where('le.transaction_id', ledgerTransaction.id)
      .select(
        'le.entry_type',
        'le.amount',
        'le.currency',
        'la.account_code'
      );

    const metadata = parseMetadata(ledgerTransaction.metadata);
    const derivedFeeCents = entries.reduce((sum, entry) => {
      const amount = amountToCents(entry.amount);
      if (entry.account_code === 'REV-001' && entry.entry_type === 'credit') return sum + amount;
      if (entry.account_code === 'GTW-FEE-001' && entry.entry_type === 'debit') return sum + amount;
      return sum;
    }, 0);

    const ledgerGrossSource = firstDefined(
      metadata.grossAmount,
      metadata.gross_amount,
      metadata.settlementGrossAmount,
      metadata.settlement_gross_amount,
      ledgerTransaction.amount
    );
    const ledgerFeeSource = firstDefined(
      metadata.feesAmount,
      metadata.feeAmount,
      metadata.fees_amount,
      metadata.settlementFeeAmount,
      metadata.settlement_fee_amount,
      (metadata.platformFee !== undefined || metadata.gatewayFee !== undefined)
        ? Number(metadata.platformFee || 0) + Number(metadata.gatewayFee || 0)
        : undefined,
      derivedFeeCents > 0 ? centsToAmount(derivedFeeCents) : undefined
    );

    const grossCents = amountToCents(ledgerGrossSource);
    const feeCents = amountToCents(ledgerFeeSource);
    const netSource = firstDefined(
      metadata.netAmount,
      metadata.net_amount,
      metadata.settlementNetAmount,
      metadata.settlement_net_amount
    );
    const netCents = netSource === undefined ? grossCents - feeCents : amountToCents(netSource);
    const currencies = [...new Set(entries.map(entry => entry.currency).filter(Boolean))];

    return {
      entries,
      grossCents,
      feeCents,
      netCents,
      currencies,
      metadata
    };
  }

  async persistSettlementReconciliation(result) {
    const row = {
      id: uuidv4(),
      tenant_id: result.tenant_id,
      settlement_id: result.settlement_id || null,
      settlement_ref: result.settlement_ref || null,
      ledger_transaction_id: result.ledger_transaction_id || null,
      reconciliation_status: result.reconciliation_status,
      settlement_gross_amount: result.settlement_gross_amount,
      ledger_gross_amount: result.ledger_gross_amount,
      settlement_fee_amount: result.settlement_fee_amount,
      ledger_fee_amount: result.ledger_fee_amount,
      settlement_net_amount: result.settlement_net_amount,
      ledger_net_amount: result.ledger_net_amount,
      discrepancy_amount: result.discrepancy_amount,
      currency: result.currency || null,
      checked_at: db.knex.fn.now(),
      correlation_id: result.correlation_id || null,
      metadata: JSON.stringify(result.metadata || {}),
      updated_at: db.knex.fn.now()
    };

    const [saved] = await db.knex('reconciliation_settlements')
      .insert(row)
      .onConflict(['tenant_id', 'settlement_ref'])
      .merge({
        settlement_id: row.settlement_id,
        ledger_transaction_id: row.ledger_transaction_id,
        reconciliation_status: row.reconciliation_status,
        settlement_gross_amount: row.settlement_gross_amount,
        ledger_gross_amount: row.ledger_gross_amount,
        settlement_fee_amount: row.settlement_fee_amount,
        ledger_fee_amount: row.ledger_fee_amount,
        settlement_net_amount: row.settlement_net_amount,
        ledger_net_amount: row.ledger_net_amount,
        discrepancy_amount: row.discrepancy_amount,
        currency: row.currency,
        checked_at: row.checked_at,
        correlation_id: row.correlation_id,
        metadata: row.metadata,
        updated_at: row.updated_at
      })
      .returning('*');

    return saved;
  }

  async reconcileSettlement(settlementOrRef, options = {}) {
    const correlationId = options.correlationId || requestContext.getCorrelationId() || null;
    const settlement = await this.resolveSettlement(settlementOrRef, options.tenantId);
    const duplicateSettlements = await this.fetchSettlementDuplicates(settlement);
    const settlementMetadata = parseMetadata(settlement.metadata);

    const settlementGrossCents = amountToCents(settlement.gross_amount);
    const settlementFeeCents = amountToCents(settlement.fees_amount);
    const settlementNetCents = amountToCents(settlement.net_amount);
    const settlementCurrency = firstDefined(settlement.currency, settlementMetadata.currency);

    let status = SETTLEMENT_LEDGER_STATUSES.MATCHED;
    let ledgerTransaction = null;
    let ledgerSummary = null;
    let ledgerGrossCents = 0;
    let ledgerFeeCents = 0;
    let ledgerNetCents = 0;
    let discrepancyCents = 0;
    const metadata = {
      duplicate_settlement_count: duplicateSettlements.length
    };

    if (duplicateSettlements.length > 1) {
      status = SETTLEMENT_LEDGER_STATUSES.DUPLICATE_SETTLEMENT;
    } else if (!settlement.ledger_transaction_id) {
      status = SETTLEMENT_LEDGER_STATUSES.MISSING_LEDGER_TRANSACTION;
      discrepancyCents = settlementNetCents;
    } else {
      ledgerTransaction = await db.knex('ledger_transactions')
        .where('id', settlement.ledger_transaction_id)
        .first();

      if (!ledgerTransaction) {
        status = SETTLEMENT_LEDGER_STATUSES.MISSING_LEDGER_TRANSACTION;
        discrepancyCents = settlementNetCents;
      } else if (ledgerTransaction.tenant_id !== settlement.tenant_id) {
        status = SETTLEMENT_LEDGER_STATUSES.TENANT_MISMATCH;
      } else {
        ledgerSummary = await this.summarizeSettlementLedger(ledgerTransaction);
        ledgerGrossCents = ledgerSummary.grossCents;
        ledgerFeeCents = ledgerSummary.feeCents;
        ledgerNetCents = ledgerSummary.netCents;

        const effectiveSettlementCurrency = settlementCurrency || ledgerTransaction.currency;
        const ledgerCurrencyMismatch = ledgerTransaction.currency !== effectiveSettlementCurrency ||
          (ledgerSummary.entries.length > 0 &&
            ledgerSummary.currencies.length > 0 &&
            !ledgerSummary.currencies.every(currency => currency === effectiveSettlementCurrency));

        if (ledgerSummary.entries.length === 0) {
          status = SETTLEMENT_LEDGER_STATUSES.LEDGER_ENTRIES_MISSING;
          discrepancyCents = settlementNetCents;
        } else if (ledgerTransaction.status !== 'posted') {
          status = SETTLEMENT_LEDGER_STATUSES.MISSING_LEDGER_TRANSACTION;
          discrepancyCents = settlementNetCents;
        } else if (Math.abs(settlementGrossCents - ledgerGrossCents) > 0) {
          status = SETTLEMENT_LEDGER_STATUSES.AMOUNT_MISMATCH;
          discrepancyCents = Math.abs(settlementGrossCents - ledgerGrossCents);
        } else if (Math.abs(settlementFeeCents - ledgerFeeCents) > 0) {
          status = SETTLEMENT_LEDGER_STATUSES.FEE_MISMATCH;
          discrepancyCents = Math.abs(settlementFeeCents - ledgerFeeCents);
        } else if (Math.abs(settlementNetCents - ledgerNetCents) > 0) {
          status = SETTLEMENT_LEDGER_STATUSES.NET_AMOUNT_MISMATCH;
          discrepancyCents = Math.abs(settlementNetCents - ledgerNetCents);
        } else if (ledgerCurrencyMismatch) {
          status = SETTLEMENT_LEDGER_STATUSES.CURRENCY_MISMATCH;
        }
      }
    }

    const currency = settlementCurrency || ledgerTransaction?.currency || null;
    const result = {
      tenant_id: settlement.tenant_id,
      settlement_id: settlement.id,
      settlement_ref: settlement.settlement_ref,
      ledger_transaction_id: settlement.ledger_transaction_id,
      reconciliation_status: status,
      settlement_gross_amount: centsToAmount(settlementGrossCents),
      ledger_gross_amount: ledgerTransaction ? centsToAmount(ledgerGrossCents) : null,
      settlement_fee_amount: centsToAmount(settlementFeeCents),
      ledger_fee_amount: ledgerTransaction ? centsToAmount(ledgerFeeCents) : null,
      settlement_net_amount: centsToAmount(settlementNetCents),
      ledger_net_amount: ledgerTransaction ? centsToAmount(ledgerNetCents) : null,
      discrepancy_amount: centsToAmount(discrepancyCents),
      currency,
      correlation_id: correlationId || ledgerTransaction?.correlation_id || null,
      metadata
    };

    const saved = await this.persistSettlementReconciliation(result);

    logger.info('Ledger-settlement reconciliation checked', {
      settlement_ref: result.settlement_ref,
      ledger_transaction_id: result.ledger_transaction_id,
      reconciliation_status: result.reconciliation_status,
      discrepancy_amount: result.discrepancy_amount,
      tenant_id: result.tenant_id,
      correlation_id: result.correlation_id
    });

    return saved;
  }

  async reconcileMissingSettlementForLedger(ledgerTransaction, options = {}) {
    const correlationId = options.correlationId || requestContext.getCorrelationId() || null;
    const ledgerSummary = await this.summarizeSettlementLedger(ledgerTransaction);
    const metadata = parseMetadata(ledgerTransaction.metadata);
    const settlementRef = metadata.settlementRef || metadata.settlement_ref || `MISSING-${ledgerTransaction.transaction_ref}`;
    const result = {
      tenant_id: ledgerTransaction.tenant_id,
      settlement_id: null,
      settlement_ref: settlementRef,
      ledger_transaction_id: ledgerTransaction.id,
      reconciliation_status: SETTLEMENT_LEDGER_STATUSES.MISSING_SETTLEMENT,
      settlement_gross_amount: null,
      ledger_gross_amount: centsToAmount(ledgerSummary.grossCents),
      settlement_fee_amount: null,
      ledger_fee_amount: centsToAmount(ledgerSummary.feeCents),
      settlement_net_amount: null,
      ledger_net_amount: centsToAmount(ledgerSummary.netCents),
      discrepancy_amount: centsToAmount(ledgerSummary.netCents),
      currency: ledgerTransaction.currency,
      correlation_id: correlationId || ledgerTransaction.correlation_id || null,
      metadata: { source: 'ledger_without_settlement' }
    };

    const saved = await this.persistSettlementReconciliation(result);

    logger.info('Ledger-settlement reconciliation checked', {
      settlement_ref: result.settlement_ref,
      ledger_transaction_id: result.ledger_transaction_id,
      reconciliation_status: result.reconciliation_status,
      discrepancy_amount: result.discrepancy_amount,
      tenant_id: result.tenant_id,
      correlation_id: result.correlation_id
    });

    return saved;
  }

  async reconcileAllSettlements(params = {}) {
    const { tenantId, from, to, limit } = params;
    let settlementQuery = db.knex('settlements').orderBy('created_at', 'asc');

    if (tenantId) settlementQuery = settlementQuery.where('tenant_id', tenantId);
    if (from) settlementQuery = settlementQuery.where('created_at', '>=', from);
    if (to) settlementQuery = settlementQuery.where('created_at', '<=', to);
    if (limit) settlementQuery = settlementQuery.limit(Number(limit));

    const settlements = await settlementQuery;
    const results = [];

    for (const settlement of settlements) {
      results.push(await this.reconcileSettlement(settlement, {
        correlationId: params.correlationId
      }));
    }

    let ledgerQuery = db.knex('ledger_transactions')
      .where('event_type', 'settlement')
      .where('status', 'posted')
      .whereNotExists(function() {
        this.select('*')
          .from('settlements')
          .whereRaw('settlements.ledger_transaction_id = ledger_transactions.id');
      })
      .orderBy('created_at', 'asc');

    if (tenantId) ledgerQuery = ledgerQuery.where('tenant_id', tenantId);
    if (from) ledgerQuery = ledgerQuery.where('created_at', '>=', from);
    if (to) ledgerQuery = ledgerQuery.where('created_at', '<=', to);
    if (limit) ledgerQuery = ledgerQuery.limit(Number(limit));

    const ledgersWithoutSettlements = await ledgerQuery;
    for (const ledgerTransaction of ledgersWithoutSettlements) {
      results.push(await this.reconcileMissingSettlementForLedger(ledgerTransaction, {
        correlationId: params.correlationId
      }));
    }

    return {
      total: results.length,
      by_status: results.reduce((acc, row) => {
        acc[row.reconciliation_status] = (acc[row.reconciliation_status] || 0) + 1;
        return acc;
      }, {}),
      results
    };
  }

  async listSettlementReconciliations(filters = {}) {
    const { tenantId, status, settlementRef, from, to, limit = 100, offset = 0 } = filters;
    let query = db.knex('reconciliation_settlements')
      .orderBy('checked_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (status) query = query.where('reconciliation_status', status);
    if (settlementRef) query = query.where('settlement_ref', settlementRef);
    if (from) query = query.where('checked_at', '>=', from);
    if (to) query = query.where('checked_at', '<=', to);

    return query;
  }

  async resolveSettlementForPayout(payoutInstruction) {
    if (!payoutInstruction) return null;

    const query = db.knex('settlements').where('tenant_id', payoutInstruction.tenant_id);

    if (payoutInstruction.settlement_id) {
      query.where('id', payoutInstruction.settlement_id);
    } else if (payoutInstruction.settlement_ref) {
      query.where('settlement_ref', payoutInstruction.settlement_ref);
    } else {
      return null;
    }

    return query.first();
  }

  async resolveBankSettlementTarget(target, tenantId = null) {
    if (!target) {
      throw new Error('Payout instruction or settlement is required for bank reconciliation');
    }

    if (typeof target === 'object' && (target.payout_amount !== undefined || target.bank_idempotency_key || target.payout_status)) {
      const payoutInstruction = target;
      const settlement = await this.resolveSettlementForPayout(payoutInstruction);
      return { payoutInstruction, settlement };
    }

    if (typeof target === 'object' && target.id && target.settlement_ref) {
      const settlement = target;
      const payoutInstruction = await db.knex('payout_instructions')
        .where({
          tenant_id: settlement.tenant_id,
          settlement_id: settlement.id
        })
        .orWhere(function() {
          this.where({
            tenant_id: settlement.tenant_id,
            settlement_ref: settlement.settlement_ref
          });
        })
        .orderBy('created_at', 'desc')
        .first();
      return { payoutInstruction: payoutInstruction || null, settlement };
    }

    const payoutQuery = db.knex('payout_instructions');
    if (tenantId) payoutQuery.where('tenant_id', tenantId);

    if (typeof target === 'string') {
      payoutQuery.where(function() {
        this.where('id', target).orWhere('settlement_ref', target);
      });
    } else if (target.id) {
      payoutQuery.where('id', target.id);
    } else if (target.settlement_ref) {
      payoutQuery.where('settlement_ref', target.settlement_ref);
    }

    const payoutInstruction = await payoutQuery.orderBy('created_at', 'desc').first();
    if (payoutInstruction) {
      return {
        payoutInstruction,
        settlement: await this.resolveSettlementForPayout(payoutInstruction)
      };
    }

    const settlement = await this.resolveSettlement(target, tenantId);
    return { payoutInstruction: null, settlement };
  }

  expectedPayoutDate(payoutInstruction) {
    return dateOnly(firstDefined(
      payoutInstruction.completed_at,
      payoutInstruction.accepted_at,
      payoutInstruction.submitted_at,
      payoutInstruction.created_at
    ));
  }

  actualBankDate(bankLine) {
    return dateOnly(firstDefined(bankLine?.value_date, bankLine?.transaction_date));
  }

  async findBankLineCandidates(payoutInstruction) {
    const referenceKeys = [
      ['bank_transaction_id', payoutInstruction.bank_transaction_id],
      ['utr_number', payoutInstruction.utr_number],
      ['bank_reference_number', payoutInstruction.bank_reference_number]
    ];

    for (const [column, value] of referenceKeys) {
      if (!value) continue;

      const allMatches = await db.knex('bank_statement_lines')
        .where(column, value)
        .where('transaction_type', 'DEBIT')
        .orderBy('created_at', 'asc');
      const tenantMatches = allMatches.filter(line => line.tenant_id === payoutInstruction.tenant_id);

      if (tenantMatches.length > 0) {
        return {
          candidates: tenantMatches,
          matchType: column,
          tenantMismatchCandidates: []
        };
      }

      if (allMatches.length > 0) {
        return {
          candidates: [],
          matchType: column,
          tenantMismatchCandidates: allMatches
        };
      }
    }

    const expectedDate = this.expectedPayoutDate(payoutInstruction);
    const fromDate = addDays(expectedDate, -BANK_RECON_DATE_TOLERANCE_DAYS);
    const toDate = addDays(expectedDate, BANK_RECON_DATE_TOLERANCE_DAYS);
    let query = db.knex('bank_statement_lines')
      .where({
        tenant_id: payoutInstruction.tenant_id,
        transaction_type: 'DEBIT',
        currency: payoutInstruction.currency
      })
      .where('amount', payoutInstruction.payout_amount)
      .orderBy('created_at', 'asc');

    if (fromDate && toDate) {
      query = query.where(function() {
        this.whereBetween('transaction_date', [fromDate, toDate])
          .orWhereBetween('value_date', [fromDate, toDate]);
      });
    }

    return {
      candidates: await query,
      matchType: 'amount_currency_date_debit',
      tenantMismatchCandidates: []
    };
  }

  async persistBankSettlementReconciliation(result) {
    const now = db.knex.fn.now();
    const row = {
      id: uuidv4(),
      tenant_id: result.tenant_id,
      settlement_id: result.settlement_id || null,
      settlement_ref: result.settlement_ref || null,
      payout_instruction_id: result.payout_instruction_id || null,
      bank_statement_line_id: result.bank_statement_line_id || null,
      reconciliation_status: result.reconciliation_status,
      settlement_amount: result.settlement_amount || null,
      payout_amount: result.payout_amount || null,
      bank_amount: result.bank_amount || null,
      discrepancy_amount: result.discrepancy_amount || '0.00',
      settlement_currency: result.settlement_currency || null,
      bank_currency: result.bank_currency || null,
      expected_utr_number: result.expected_utr_number || null,
      actual_utr_number: result.actual_utr_number || null,
      expected_bank_reference_number: result.expected_bank_reference_number || null,
      actual_bank_reference_number: result.actual_bank_reference_number || null,
      expected_bank_transaction_id: result.expected_bank_transaction_id || null,
      actual_bank_transaction_id: result.actual_bank_transaction_id || null,
      expected_bank_date: result.expected_bank_date || null,
      actual_bank_date: result.actual_bank_date || null,
      checked_at: now,
      correlation_id: result.correlation_id || null,
      metadata: JSON.stringify(result.metadata || {}),
      updated_at: now
    };

    const existingQuery = db.knex('reconciliation_bank_settlements')
      .where('tenant_id', row.tenant_id);

    if (row.payout_instruction_id) {
      existingQuery.where('payout_instruction_id', row.payout_instruction_id);
    } else if (row.bank_statement_line_id) {
      existingQuery.where('bank_statement_line_id', row.bank_statement_line_id);
    } else if (row.settlement_id) {
      existingQuery.where('settlement_id', row.settlement_id).whereNull('payout_instruction_id');
    } else {
      existingQuery.whereRaw('1 = 0');
    }

    const existing = await existingQuery.first();
    if (existing) {
      const [updated] = await db.knex('reconciliation_bank_settlements')
        .where('id', existing.id)
        .update({
          settlement_id: row.settlement_id,
          settlement_ref: row.settlement_ref,
          payout_instruction_id: row.payout_instruction_id,
          bank_statement_line_id: row.bank_statement_line_id,
          reconciliation_status: row.reconciliation_status,
          settlement_amount: row.settlement_amount,
          payout_amount: row.payout_amount,
          bank_amount: row.bank_amount,
          discrepancy_amount: row.discrepancy_amount,
          settlement_currency: row.settlement_currency,
          bank_currency: row.bank_currency,
          expected_utr_number: row.expected_utr_number,
          actual_utr_number: row.actual_utr_number,
          expected_bank_reference_number: row.expected_bank_reference_number,
          actual_bank_reference_number: row.actual_bank_reference_number,
          expected_bank_transaction_id: row.expected_bank_transaction_id,
          actual_bank_transaction_id: row.actual_bank_transaction_id,
          expected_bank_date: row.expected_bank_date,
          actual_bank_date: row.actual_bank_date,
          checked_at: row.checked_at,
          correlation_id: row.correlation_id,
          metadata: row.metadata,
          updated_at: row.updated_at
        })
        .returning('*');
      return updated;
    }

    const [saved] = await db.knex('reconciliation_bank_settlements')
      .insert(row)
      .returning('*');

    return saved;
  }

  buildBankSettlementResult({
    payoutInstruction,
    settlement,
    bankLine,
    status,
    discrepancyCents = 0,
    correlationId,
    metadata = {}
  }) {
    const settlementMetadata = parseMetadata(settlement?.metadata);
    const settlementCents = amountToCents(firstDefined(settlement?.net_amount, payoutInstruction?.payout_amount));
    const payoutCents = amountToCents(payoutInstruction?.payout_amount);
    const bankCents = bankLine ? amountToCents(firstDefined(bankLine.debit_amount, bankLine.amount)) : 0;

    return {
      tenant_id: payoutInstruction?.tenant_id || settlement?.tenant_id || bankLine?.tenant_id,
      settlement_id: settlement?.id || payoutInstruction?.settlement_id || null,
      settlement_ref: settlement?.settlement_ref || payoutInstruction?.settlement_ref || null,
      payout_instruction_id: payoutInstruction?.id || null,
      bank_statement_line_id: bankLine?.id || null,
      reconciliation_status: status,
      settlement_amount: settlement ? centsToAmount(settlementCents) : null,
      payout_amount: payoutInstruction ? centsToAmount(payoutCents) : null,
      bank_amount: bankLine ? centsToAmount(bankCents) : null,
      discrepancy_amount: centsToAmount(discrepancyCents),
      settlement_currency: firstDefined(payoutInstruction?.currency, settlement?.currency, settlementMetadata.currency),
      bank_currency: bankLine?.currency || null,
      expected_utr_number: payoutInstruction?.utr_number || null,
      actual_utr_number: bankLine?.utr_number || null,
      expected_bank_reference_number: payoutInstruction?.bank_reference_number || null,
      actual_bank_reference_number: bankLine?.bank_reference_number || null,
      expected_bank_transaction_id: payoutInstruction?.bank_transaction_id || null,
      actual_bank_transaction_id: bankLine?.bank_transaction_id || null,
      expected_bank_date: payoutInstruction ? this.expectedPayoutDate(payoutInstruction) : null,
      actual_bank_date: bankLine ? this.actualBankDate(bankLine) : null,
      correlation_id: correlationId || payoutInstruction?.correlation_id || bankLine?.correlation_id || null,
      metadata
    };
  }

  async reconcileMissingPayoutInstruction(settlement, options = {}) {
    const correlationId = options.correlationId || requestContext.getCorrelationId() || null;
    const result = this.buildBankSettlementResult({
      settlement,
      payoutInstruction: null,
      bankLine: null,
      status: BANK_SETTLEMENT_STATUSES.MISSING_PAYOUT_INSTRUCTION,
      discrepancyCents: amountToCents(settlement.net_amount),
      correlationId,
      metadata: { source: 'settlement_without_payout_instruction' }
    });

    const saved = await this.persistBankSettlementReconciliation(result);

    logger.info('Bank-settlement reconciliation checked', {
      tenant_id: saved.tenant_id,
      settlement_ref: saved.settlement_ref,
      payout_instruction_id: saved.payout_instruction_id,
      bank_statement_line_id: saved.bank_statement_line_id,
      reconciliation_status: saved.reconciliation_status,
      discrepancy_amount: saved.discrepancy_amount,
      correlation_id: saved.correlation_id
    });

    return saved;
  }

  async reconcileBankSettlement(target, options = {}) {
    const correlationId = options.correlationId || requestContext.getCorrelationId() || null;
    const { payoutInstruction, settlement } = await this.resolveBankSettlementTarget(target, options.tenantId);

    if (!payoutInstruction) {
      return this.reconcileMissingPayoutInstruction(settlement, { correlationId });
    }

    const payoutCents = amountToCents(payoutInstruction.payout_amount);
    let status = BANK_SETTLEMENT_STATUSES.MATCHED;
    let bankLine = null;
    let discrepancyCents = 0;
    const metadata = {};

    if (!settlement) {
      status = BANK_SETTLEMENT_STATUSES.MISSING_PAYOUT_INSTRUCTION;
      discrepancyCents = payoutCents;
      metadata.internal_state = 'payout_instruction_references_missing_settlement';
    } else if (settlement.tenant_id !== payoutInstruction.tenant_id) {
      status = BANK_SETTLEMENT_STATUSES.TENANT_MISMATCH;
      metadata.settlement_tenant_id = settlement.tenant_id;
      metadata.payout_tenant_id = payoutInstruction.tenant_id;
    } else if (['RETURNED', 'REVERSED'].includes(payoutInstruction.payout_status)) {
      status = BANK_SETTLEMENT_STATUSES.RETURNED_OR_REVERSED;
      metadata.payout_status = payoutInstruction.payout_status;
    } else {
      const candidateResult = await this.findBankLineCandidates(payoutInstruction);
      metadata.match_type = candidateResult.matchType;
      metadata.candidate_count = candidateResult.candidates.length;

      if (candidateResult.tenantMismatchCandidates.length > 0) {
        status = BANK_SETTLEMENT_STATUSES.TENANT_MISMATCH;
        metadata.candidate_tenant_ids = candidateResult.tenantMismatchCandidates.map(candidate => candidate.tenant_id);
      } else if (candidateResult.candidates.length === 0) {
        status = BANK_SETTLEMENT_STATUSES.MISSING_BANK_STATEMENT;
        discrepancyCents = payoutCents;
      } else if (candidateResult.candidates.length > 1) {
        status = BANK_SETTLEMENT_STATUSES.DUPLICATE_BANK_MATCH;
        metadata.candidate_bank_statement_line_ids = candidateResult.candidates.map(candidate => candidate.id);
      } else {
        bankLine = candidateResult.candidates[0];
        const existingBankMatch = await db.knex('reconciliation_bank_settlements')
          .where({
            tenant_id: payoutInstruction.tenant_id,
            bank_statement_line_id: bankLine.id
          })
          .whereNot('payout_instruction_id', payoutInstruction.id)
          .first();

        if (existingBankMatch) {
          status = BANK_SETTLEMENT_STATUSES.DUPLICATE_PAYOUT;
          metadata.existing_payout_instruction_id = existingBankMatch.payout_instruction_id;
          metadata.candidate_bank_statement_line_id = bankLine.id;
          bankLine = { ...bankLine, id: null };
        } else {
          const bankCents = amountToCents(firstDefined(bankLine.debit_amount, bankLine.amount));
          const expectedDate = this.expectedPayoutDate(payoutInstruction);
          const actualDate = this.actualBankDate(bankLine);

          if (bankLine.tenant_id !== payoutInstruction.tenant_id) {
            status = BANK_SETTLEMENT_STATUSES.TENANT_MISMATCH;
          } else if (bankLine.transaction_type !== 'DEBIT') {
            status = BANK_SETTLEMENT_STATUSES.MISSING_BANK_STATEMENT;
            discrepancyCents = payoutCents;
            metadata.invalid_direction = bankLine.transaction_type;
          } else if (payoutCents !== bankCents) {
            status = BANK_SETTLEMENT_STATUSES.AMOUNT_MISMATCH;
            discrepancyCents = Math.abs(payoutCents - bankCents);
          } else if (bankLine.currency !== payoutInstruction.currency) {
            status = BANK_SETTLEMENT_STATUSES.CURRENCY_MISMATCH;
          } else if (payoutInstruction.utr_number && payoutInstruction.utr_number !== bankLine.utr_number) {
            status = BANK_SETTLEMENT_STATUSES.UTR_MISMATCH;
          } else if (payoutInstruction.bank_reference_number && payoutInstruction.bank_reference_number !== bankLine.bank_reference_number) {
            status = BANK_SETTLEMENT_STATUSES.BANK_REFERENCE_MISMATCH;
          } else if (payoutInstruction.bank_transaction_id && payoutInstruction.bank_transaction_id !== bankLine.bank_transaction_id) {
            status = BANK_SETTLEMENT_STATUSES.BANK_TRANSACTION_ID_MISMATCH;
          } else if (expectedDate && actualDate && daysBetween(expectedDate, actualDate) > BANK_RECON_DATE_TOLERANCE_DAYS) {
            status = BANK_SETTLEMENT_STATUSES.DATE_MISMATCH;
            metadata.date_tolerance_days = BANK_RECON_DATE_TOLERANCE_DAYS;
          } else if (candidateResult.matchType === 'amount_currency_date_debit') {
            metadata.match_confidence = 'WEAK_UNIQUE_AMOUNT_DATE';
          }
        }
      }
    }

    const result = this.buildBankSettlementResult({
      payoutInstruction,
      settlement,
      bankLine,
      status,
      discrepancyCents,
      correlationId,
      metadata
    });
    const saved = await this.persistBankSettlementReconciliation(result);

    logger.info('Bank-settlement reconciliation checked', {
      tenant_id: saved.tenant_id,
      settlement_ref: saved.settlement_ref,
      payout_instruction_id: saved.payout_instruction_id,
      bank_statement_line_id: saved.bank_statement_line_id,
      reconciliation_status: saved.reconciliation_status,
      discrepancy_amount: saved.discrepancy_amount,
      correlation_id: saved.correlation_id
    });

    return saved;
  }

  async reconcileAllBankSettlements(params = {}) {
    const { tenantId, from, to, limit } = params;
    let payoutQuery = db.knex('payout_instructions').orderBy('created_at', 'asc');

    if (tenantId) payoutQuery = payoutQuery.where('tenant_id', tenantId);
    if (from) payoutQuery = payoutQuery.where('created_at', '>=', from);
    if (to) payoutQuery = payoutQuery.where('created_at', '<=', to);
    if (limit) payoutQuery = payoutQuery.limit(Number(limit));

    const payoutInstructions = await payoutQuery;
    const results = [];

    for (const payoutInstruction of payoutInstructions) {
      results.push(await this.reconcileBankSettlement(payoutInstruction, {
        correlationId: params.correlationId
      }));
    }

    let settlementQuery = db.knex('settlements')
      .whereNotExists(function() {
        this.select('*')
          .from('payout_instructions')
          .whereRaw('payout_instructions.settlement_id = settlements.id');
      })
      .orderBy('created_at', 'asc');

    if (tenantId) settlementQuery = settlementQuery.where('tenant_id', tenantId);
    if (from) settlementQuery = settlementQuery.where('created_at', '>=', from);
    if (to) settlementQuery = settlementQuery.where('created_at', '<=', to);
    if (limit) settlementQuery = settlementQuery.limit(Number(limit));

    const settlementsWithoutPayouts = await settlementQuery;
    for (const settlement of settlementsWithoutPayouts) {
      results.push(await this.reconcileMissingPayoutInstruction(settlement, {
        correlationId: params.correlationId
      }));
    }

    return {
      total: results.length,
      by_status: results.reduce((acc, row) => {
        acc[row.reconciliation_status] = (acc[row.reconciliation_status] || 0) + 1;
        return acc;
      }, {}),
      results
    };
  }

  async listBankSettlementReconciliations(filters = {}) {
    const {
      tenantId,
      status,
      settlementRef,
      payoutInstructionId,
      bankStatementLineId,
      utr_number: utrNumber,
      bank_reference_number: bankReferenceNumber,
      bank_transaction_id: bankTransactionId,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('reconciliation_bank_settlements')
      .orderBy('checked_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (status) query = query.where('reconciliation_status', status);
    if (settlementRef) query = query.where('settlement_ref', settlementRef);
    if (payoutInstructionId) query = query.where('payout_instruction_id', payoutInstructionId);
    if (bankStatementLineId) query = query.where('bank_statement_line_id', bankStatementLineId);
    if (utrNumber) {
      query = query.where(function() {
        this.where('expected_utr_number', utrNumber).orWhere('actual_utr_number', utrNumber);
      });
    }
    if (bankReferenceNumber) {
      query = query.where(function() {
        this.where('expected_bank_reference_number', bankReferenceNumber)
          .orWhere('actual_bank_reference_number', bankReferenceNumber);
      });
    }
    if (bankTransactionId) {
      query = query.where(function() {
        this.where('expected_bank_transaction_id', bankTransactionId)
          .orWhere('actual_bank_transaction_id', bankTransactionId);
      });
    }
    if (from) query = query.where('checked_at', '>=', from);
    if (to) query = query.where('checked_at', '<=', to);

    return query;
  }

  /**
   * Create a new reconciliation batch
   * 
   * @param {Object} params - Batch parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.reconciliationType - Type: gateway_settlement, bank_escrow_statement, merchant_payout
   * @param {string} params.gatewayName - Gateway name (if gateway reconciliation)
   * @param {Date} params.periodFrom - Start date of reconciliation period
   * @param {Date} params.periodTo - End date of reconciliation period
   * @param {string} params.createdBy - User creating the batch
   * @returns {Object} Created reconciliation batch
   */
  async createReconciliationBatch(params) {
    const {
      tenantId,
      reconciliationType,
      gatewayName,
      gatewaySettlementId,
      periodFrom,
      periodTo,
      fileName,
      filePath,
      createdBy
    } = params;
    
    const batchRef = `RECON-${Date.now()}-${reconciliationType.toUpperCase()}`;
    
    const [batch] = await db.knex('reconciliation_batches').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      batch_ref: batchRef,
      reconciliation_type: reconciliationType,
      gateway_name: gatewayName,
      gateway_settlement_id: gatewaySettlementId,
      period_from: periodFrom,
      period_to: periodTo,
      status: 'in_progress',
      file_name: fileName,
      file_path: filePath,
      created_by: createdBy,
      total_transactions: 0,
      matched_transactions: 0,
      missing_transactions: 0,
      mismatched_transactions: 0,
      duplicate_transactions: 0
    }).returning('*');
    
    return batch;
  }
  
  /**
   * Reconcile gateway settlement report
   * 
   * @param {Object} params - Reconciliation parameters
   * @param {string} params.batchId - Reconciliation batch ID
   * @param {Array} params.externalTransactions - Transactions from gateway report
   * @param {string} params.externalTransactions[].externalRef - Gateway transaction ID
   * @param {string} params.externalTransactions[].orderId - Order ID
   * @param {number} params.externalTransactions[].amount - Transaction amount
   * @param {Date} params.externalTransactions[].date - Transaction date
   * @returns {Object} Reconciliation results
   */
  async reconcileGatewaySettlement(params) {
    const { batchId, externalTransactions } = params;
    
    return await db.knex.transaction(async (trx) => {
      // Get batch details
      const batch = await trx('reconciliation_batches')
        .where('id', batchId)
        .first();
        
      if (!batch) {
        throw new Error('Reconciliation batch not found');
      }
      
      const results = {
        matched: [],
        missing_internal: [],
        missing_external: [],
        amount_mismatch: [],
        duplicates: []
      };
      
      // Get internal transactions for the period
      const internalTransactions = await trx('ledger_transactions as lt')
        .join('ledger_entries as le', 'lt.id', 'le.transaction_id')
        .join('ledger_accounts as la', 'le.account_id', 'la.id')
        .where('lt.tenant_id', batch.tenant_id)
        .where('lt.created_at', '>=', batch.period_from)
        .where('lt.created_at', '<=', batch.period_to)
        .where('lt.status', 'posted')
        .where('la.gateway_name', batch.gateway_name)
        .select(
          'lt.id as transaction_id',
          'lt.source_order_id',
          'lt.amount',
          'lt.created_at'
        )
        .groupBy('lt.id', 'lt.source_order_id', 'lt.amount', 'lt.created_at');
      
      // Create maps for efficient lookup
      const internalMap = new Map();
      internalTransactions.forEach(tx => {
        const key = `${tx.source_order_id}`;
        if (internalMap.has(key)) {
          // Duplicate in internal system
          results.duplicates.push(tx);
        } else {
          internalMap.set(key, tx);
        }
      });
      
      const externalMap = new Map();
      externalTransactions.forEach(tx => {
        const key = `${tx.orderId}`;
        externalMap.set(key, tx);
      });
      
      // Match external transactions with internal
      for (const extTx of externalTransactions) {
        const key = `${extTx.orderId}`;
        const intTx = internalMap.get(key);
        
        if (!intTx) {
          // Transaction in external but not in internal
          results.missing_internal.push(extTx);
          
          await trx('reconciliation_items').insert({
            id: uuidv4(),
            tenant_id: batch.tenant_id,
            batch_id: batchId,
            external_ref: extTx.externalRef,
            external_transaction_id: extTx.externalRef,
            match_status: 'missing_internal',
            external_amount: extTx.amount,
            internal_amount: null,
            difference_amount: extTx.amount,
            resolution_status: 'unresolved',
            metadata: JSON.stringify({ external_data: extTx })
          });
        } else {
          // Check amount match
          const amountDiff = Math.abs(parseFloat(intTx.amount) - parseFloat(extTx.amount));
          
          if (amountDiff > 0.01) {
            // Amount mismatch
            results.amount_mismatch.push({ internal: intTx, external: extTx, difference: amountDiff });
            
            await trx('reconciliation_items').insert({
              id: uuidv4(),
              tenant_id: batch.tenant_id,
              batch_id: batchId,
              transaction_id: intTx.transaction_id,
              external_ref: extTx.externalRef,
              external_transaction_id: extTx.externalRef,
              match_status: 'amount_mismatch',
              internal_amount: intTx.amount,
              external_amount: extTx.amount,
              difference_amount: amountDiff,
              resolution_status: 'unresolved',
              metadata: JSON.stringify({ internal_data: intTx, external_data: extTx })
            });
          } else {
            // Perfect match
            results.matched.push({ internal: intTx, external: extTx });
            
            await trx('reconciliation_items').insert({
              id: uuidv4(),
              tenant_id: batch.tenant_id,
              batch_id: batchId,
              transaction_id: intTx.transaction_id,
              external_ref: extTx.externalRef,
              external_transaction_id: extTx.externalRef,
              match_status: 'matched',
              internal_amount: intTx.amount,
              external_amount: extTx.amount,
              difference_amount: 0,
              resolution_status: 'resolved',
              metadata: JSON.stringify({ internal_data: intTx, external_data: extTx })
            });
          }
          
          // Remove from internal map
          internalMap.delete(key);
        }
      }
      
      // Remaining items in internalMap are missing in external
      for (const [key, intTx] of internalMap) {
        if (!results.duplicates.find(d => d.transaction_id === intTx.transaction_id)) {
          results.missing_external.push(intTx);
          
          await trx('reconciliation_items').insert({
            id: uuidv4(),
            tenant_id: batch.tenant_id,
            batch_id: batchId,
            transaction_id: intTx.transaction_id,
            match_status: 'missing_external',
            internal_amount: intTx.amount,
            external_amount: null,
            difference_amount: intTx.amount,
            resolution_status: 'unresolved',
            metadata: JSON.stringify({ internal_data: intTx })
          });
        }
      }
      
      // Calculate totals
      const expectedAmount = internalTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const actualAmount = externalTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const differenceAmount = Math.abs(expectedAmount - actualAmount);
      
      // Update batch with results
      const status = (results.missing_internal.length === 0 && 
                     results.missing_external.length === 0 && 
                     results.amount_mismatch.length === 0)
                     ? 'completed'
                     : 'discrepancy_found';
      
      await trx('reconciliation_batches')
        .where('id', batchId)
        .update({
          status,
          total_transactions: externalTransactions.length,
          matched_transactions: results.matched.length,
          missing_transactions: results.missing_internal.length + results.missing_external.length,
          mismatched_transactions: results.amount_mismatch.length,
          duplicate_transactions: results.duplicates.length,
          expected_amount: expectedAmount,
          actual_amount: actualAmount,
          difference_amount: differenceAmount,
          completed_at: new Date(),
          discrepancies: JSON.stringify({
            summary: {
              matched: results.matched.length,
              missing_internal: results.missing_internal.length,
              missing_external: results.missing_external.length,
              amount_mismatch: results.amount_mismatch.length,
              duplicates: results.duplicates.length
            }
          })
        });
      
      return {
        batch_id: batchId,
        status,
        results,
        summary: {
          total_external: externalTransactions.length,
          total_internal: internalTransactions.length,
          matched: results.matched.length,
          missing_internal: results.missing_internal.length,
          missing_external: results.missing_external.length,
          amount_mismatch: results.amount_mismatch.length,
          duplicates: results.duplicates.length,
          expected_amount: expectedAmount,
          actual_amount: actualAmount,
          difference_amount: differenceAmount
        }
      };
    });
  }
  
  /**
   * Reconcile bank escrow statement
   * 
   * @param {Object} params - Reconciliation parameters
   * @param {string} params.batchId - Reconciliation batch ID
   * @param {Array} params.bankTransactions - Transactions from bank statement
   * @returns {Object} Reconciliation results
   */
  async reconcileBankEscrowStatement(params) {
    const { batchId, bankTransactions } = params;
    
    return await db.knex.transaction(async (trx) => {
      const batch = await trx('reconciliation_batches')
        .where('id', batchId)
        .first();
        
      if (!batch) {
        throw new Error('Reconciliation batch not found');
      }
      
      const results = {
        matched: [],
        missing_internal: [],
        missing_external: [],
        amount_mismatch: []
      };
      
      // Get escrow account balance from ledger
      const escrowEntries = await trx('ledger_entries as le')
        .join('ledger_transactions as lt', 'le.transaction_id', 'lt.id')
        .join('ledger_accounts as la', 'le.account_id', 'la.id')
        .where('le.tenant_id', batch.tenant_id)
        .where('la.account_code', 'ESC-001') // Escrow Bank Account
        .where('lt.status', 'posted')
        .where('le.created_at', '>=', batch.period_from)
        .where('le.created_at', '<=', batch.period_to)
        .select(
          'le.id as entry_id',
          'le.entry_type',
          'le.amount',
          'le.description',
          'lt.transaction_ref'
        );
      
      // Calculate escrow balance from ledger
      let ledgerBalance = 0;
      escrowEntries.forEach(entry => {
        if (entry.entry_type === 'debit') {
          ledgerBalance += parseFloat(entry.amount);
        } else {
          ledgerBalance -= parseFloat(entry.amount);
        }
      });
      
      // Calculate bank balance
      const bankBalance = bankTransactions.reduce((sum, tx) => {
        return sum + (tx.type === 'credit' ? parseFloat(tx.amount) : -parseFloat(tx.amount));
      }, 0);
      
      const balanceDifference = Math.abs(ledgerBalance - bankBalance);
      
      // Update batch
      const status = balanceDifference < 0.01 ? 'completed' : 'discrepancy_found';
      
      await trx('reconciliation_batches')
        .where('id', batchId)
        .update({
          status,
          total_transactions: bankTransactions.length,
          expected_amount: ledgerBalance,
          actual_amount: bankBalance,
          difference_amount: balanceDifference,
          completed_at: new Date(),
          discrepancies: JSON.stringify({
            ledger_balance: ledgerBalance,
            bank_balance: bankBalance,
            difference: balanceDifference,
            entry_count: escrowEntries.length
          })
        });
      
      return {
        batch_id: batchId,
        status,
        ledger_balance: ledgerBalance,
        bank_balance: bankBalance,
        difference: balanceDifference,
        balanced: balanceDifference < 0.01
      };
    });
  }
  
  /**
   * Get reconciliation batch details
   * 
   * @param {string} batchId - Batch ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Batch with items
   */
  async getReconciliationBatch(batchId, tenantId) {
    const batch = await db.knex('reconciliation_batches')
      .where('id', batchId)
      .where('tenant_id', tenantId)
      .first();
      
    if (!batch) {
      throw new Error('Reconciliation batch not found');
    }
    
    const items = await db.knex('reconciliation_items')
      .where('batch_id', batchId)
      .where('tenant_id', tenantId);
    
    return {
      batch,
      items,
      summary: {
        total: items.length,
        by_status: items.reduce((acc, item) => {
          acc[item.match_status] = (acc[item.match_status] || 0) + 1;
          return acc;
        }, {}),
        by_resolution: items.reduce((acc, item) => {
          acc[item.resolution_status] = (acc[item.resolution_status] || 0) + 1;
          return acc;
        }, {})
      }
    };
  }
  
  /**
   * Resolve a reconciliation discrepancy
   * 
   * @param {Object} params - Resolution parameters
   * @param {string} params.itemId - Reconciliation item ID
   * @param {string} params.resolution - Resolution: resolved, investigating, written_off
   * @param {string} params.notes - Resolution notes
   * @param {string} params.resolvedBy - User resolving the item
   */
  async resolveReconciliationItem(params) {
    const { itemId, resolution, notes, resolvedBy } = params;
    
    await db.knex('reconciliation_items')
      .where('id', itemId)
      .update({
        resolution_status: resolution,
        resolution_notes: notes,
        resolved_by: resolvedBy,
        resolved_at: new Date()
      });
    
    return { success: true, item_id: itemId, resolution };
  }
}

module.exports = new ReconciliationService();
