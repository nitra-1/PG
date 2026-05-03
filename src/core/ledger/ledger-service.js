/**
 * Ledger Service
 * 
 * Core service for double-entry accounting ledger system
 * Implements RBI-compliant posting, balance calculation, and audit trail
 * 
 * Key Principles:
 * - Double-entry accounting: Every transaction must balance (debits = credits)
 * - Immutability: Ledger entries cannot be modified, only reversed
 * - Idempotency: Same idempotency key returns same result
 * - Audit trail: Complete history of all ledger operations
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const accountingPeriodService = require('./accounting-period-service');
const ledgerLockService = require('./ledger-lock-service');
const requestContext = require('../context/request-context');
const { generateEntries, hasTemplate, ledgerEventType } = require('./accounting-templates');
const {
  PeriodClosedError,
  LedgerLockedError,
  AdminOverrideRequiredError,
  InsufficientOverridePrivilegesError
} = require('../errors/accounting-errors');

class LedgerService {
  constructor() {
    this.ACCOUNT_CODES = {
      // Escrow accounts
      ESCROW_BANK: 'ESC-001',
      ESCROW_LIABILITY: 'ESC-002',
      
      // Merchant accounts
      MERCHANT_RECEIVABLES: 'MER-001',
      MERCHANT_PAYABLES: 'MER-002',
      MERCHANT_SETTLEMENT: 'MER-003',
      
      // Gateway accounts
      GATEWAY_RAZORPAY: 'GTW-001-RZP',
      GATEWAY_PAYU: 'GTW-002-PAYU',
      GATEWAY_CCAVENUE: 'GTW-003-CCA',
      GATEWAY_FEE_RAZORPAY: 'GTW-FEE-001',
      GATEWAY_FEE_PAYU: 'GTW-FEE-002',
      GATEWAY_FEE_CCAVENUE: 'GTW-FEE-003',
      GATEWAY_PAYABLES: 'GTW-PAY-001',
      
      // Platform revenue accounts
      PLATFORM_MDR: 'REV-001',
      PLATFORM_COMMISSION: 'REV-002',
      PLATFORM_CONVENIENCE_FEE: 'REV-003',
      PLATFORM_SETTLEMENT_FEE: 'REV-004',
      PLATFORM_RECEIVABLES: 'REV-REC-001',
      
      // Refund and chargeback
      REFUNDS_PAYABLE: 'REF-001',
      CHARGEBACK_LIABILITY: 'CHB-001',
      
      // Adjustments
      MANUAL_ADJUSTMENTS: 'ADJ-001',
      RECONCILIATION_SUSPENSE: 'ADJ-002'
    };
  }

  parseMetadata(metadata) {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch (error) {
        return {};
      }
    }
    return metadata;
  }

  stringifyMetadata(metadata) {
    return JSON.stringify(metadata || {});
  }

  assertBalanced(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Ledger transaction must contain at least one entry');
    }

    let totalDebits = 0;
    let totalCredits = 0;

    for (const entry of entries) {
      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Ledger entry amount must be positive for account ${entry.accountCode || entry.account_id || 'unknown'}`);
      }
      if (!['debit', 'credit'].includes(entry.entryType || entry.entry_type)) {
        throw new Error(`Invalid ledger entry type: ${entry.entryType || entry.entry_type}`);
      }

      if ((entry.entryType || entry.entry_type) === 'debit') {
        totalDebits += amount;
      } else {
        totalCredits += amount;
      }
    }

    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      throw new Error(`Transaction not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}`);
    }

    return { totalDebits, totalCredits, balanced: true };
  }
  
  /**
   * Get account ID by account code
   * @private
   */
  async getAccount(accountCode, tenantId, trx = null) {
    const query = trx || db.knex;
    let accountQuery = query('ledger_accounts')
      .where('account_code', accountCode)
      .where('status', 'active');

    const hasTenantColumn = await db.knex.schema.hasColumn('ledger_accounts', 'tenant_id');
    if (hasTenantColumn) {
      accountQuery = accountQuery.where(function() {
        this.whereNull('tenant_id').orWhere('tenant_id', tenantId);
      });
    }

    const account = await accountQuery.first();
      
    if (!account) {
      throw new Error(`Account not found: ${accountCode}`);
    }
    
    if (account.tenant_id && account.tenant_id !== tenantId) {
      throw new Error(`Account ${accountCode} does not belong to tenant ${tenantId}`);
    }

    return account;
  }

  async getAccountId(accountCode, trx = null, tenantId = null) {
    const account = await this.getAccount(accountCode, tenantId, trx);
    return account.id;
  }
  
  /**
   * Post a ledger transaction with entries
   * Ensures double-entry balance and creates audit trail
   * 
   * @param {Object} params - Transaction parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.transactionRef - Unique transaction reference
   * @param {string} params.idempotencyKey - Idempotency key for duplicate prevention
   * @param {string} params.eventType - Event type (payment_success, refund_completed, etc.)
   * @param {string} params.sourceTransactionId - Source transaction ID
   * @param {string} params.sourceOrderId - Source order ID
   * @param {number} params.amount - Transaction amount
   * @param {string} params.currency - Currency code (default: INR)
   * @param {string} params.description - Transaction description
   * @param {Array} params.entries - Array of ledger entries
   * @param {string} params.entries[].accountCode - Account code
   * @param {string} params.entries[].entryType - 'debit' or 'credit'
   * @param {number} params.entries[].amount - Entry amount
   * @param {string} params.entries[].description - Entry description
   * @param {Object} params.metadata - Additional metadata
   * @param {string} params.createdBy - User who created the transaction
   * @param {string} params.sourceEvent - Source event identifier
   * @param {boolean} params.override - Admin override flag (default: false)
   * @param {string} params.overrideJustification - Required if override=true
   * @param {string} params.userRole - User's role for override validation
   * @param {Date} params.transactionDate - Transaction date for period check (default: now)
   * @returns {Object} Posted transaction with entries
   */
  async postTransaction(params) {
    const {
      tenantId,
      transactionRef,
      idempotencyKey,
      eventType,
      sourceTransactionId,
      sourceOrderId,
      amount,
      currency = 'INR',
      description,
      entries,
      metadata = {},
      createdBy,
      sourceEvent,
      eventId,
      correlationId = requestContext.getCorrelationId(),
      override = false,
      overrideJustification,
      userRole,
      transactionDate = new Date()
    } = params;
    
    const normalizedEventType = ledgerEventType(eventType);
    if (!hasTemplate(eventType)) {
      throw new Error(`No accounting template for event type: ${eventType}`);
    }

    const templateEntries = entries || generateEntries({
      event_type: eventType,
      amount,
      metadata: {
        ...metadata,
        amount,
        sourceTransactionId,
        sourceOrderId
      }
    });

    // Validate required parameters
    if (!tenantId || !transactionRef || !eventType || !templateEntries || templateEntries.length === 0) {
      throw new Error('Missing required parameters for ledger transaction');
    }

    const entryCurrencies = templateEntries
      .map(entry => entry.currency)
      .filter(Boolean);
    const invalidCurrency = entryCurrencies.find(entryCurrency => entryCurrency !== currency);
    if (invalidCurrency) {
      throw new Error(`Ledger entries must use transaction currency ${currency}; found ${invalidCurrency}`);
    }

    const validation = this.assertBalanced(templateEntries);
    const traceMetadata = {
      ...metadata,
      event_id: eventId || metadata.event_id || null,
      correlation_id: correlationId || metadata.correlation_id || null,
      idempotency_key: idempotencyKey || metadata.idempotency_key || null
    };

    // Idempotency must win before period/lock checks so a retried outbox event
    // can safely return the already-posted ledger transaction even after close.
    if (idempotencyKey) {
      const existing = await db.knex('ledger_transactions')
        .where('idempotency_key', idempotencyKey)
        .where('tenant_id', tenantId)
        .first();
        
      if (existing) {
        const existingEntries = await db.knex('ledger_entries')
          .where('transaction_id', existing.id);
        
        return {
          transaction: existing,
          entries: existingEntries,
          duplicate: true,
          validation: this.assertBalanced(existingEntries)
        };
      }
    }
    
    // ============================================================
    // RBI COMPLIANCE: ACCOUNTING PERIOD & LEDGER LOCK CHECKS
    // ============================================================
    
    // Check accounting period for posting
    const periodCheck = await accountingPeriodService.checkPeriodForPosting({
      tenantId,
      transactionDate,
      periodType: 'DAILY'
    });
    
    // If ledger is locked, reject immediately (no override allowed)
    if (periodCheck.locked) {
      throw new LedgerLockedError(
        periodCheck.lock_info.lock_type,
        periodCheck.lock_info.locked_by,
        periodCheck.lock_info.locked_at,
        periodCheck.lock_info.reason
      );
    }
    
    // If posting not allowed and override not requested
    if (!periodCheck.posting_allowed && !override) {
      if (periodCheck.override_required) {
        // SOFT_CLOSED period - admin override is possible
        throw new AdminOverrideRequiredError(
          'post_to_soft_closed_period',
          `Period is ${periodCheck.period.status}. Admin override with justification required.`
        );
      } else {
        // HARD_CLOSED period - no override allowed
        throw new PeriodClosedError(
          periodCheck.period.type,
          periodCheck.period.period_start,
          periodCheck.period.period_end,
          periodCheck.period.status,
          'Cannot post to HARD_CLOSED period - period must be reopened'
        );
      }
    }
    
    // If override requested, validate it
    if (override) {
      // Override only allowed for SOFT_CLOSED periods
      if (!periodCheck.override_required) {
        throw new Error('Override flag is only valid for SOFT_CLOSED periods');
      }
      
      // Validate override permissions
      if (userRole !== 'FINANCE_ADMIN') {
        throw new InsufficientOverridePrivilegesError(
          userRole,
          'FINANCE_ADMIN',
          'post_to_soft_closed_period'
        );
      }
      
      // Justification is mandatory for overrides
      if (!overrideJustification || overrideJustification.trim().length < 10) {
        throw new Error('Override justification must be at least 10 characters');
      }
      
      // Log the override in admin_overrides_log (will be done after transaction creation)
    }
    
    // ============================================================
    // END COMPLIANCE CHECKS
    // ============================================================
    
    // Use database transaction for atomicity
    return await db.knex.transaction(async (trx) => {
      // Create ledger transaction record
      const [transaction] = await trx('ledger_transactions').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        transaction_ref: transactionRef,
        idempotency_key: idempotencyKey,
        event_type: normalizedEventType,
        source_transaction_id: sourceTransactionId,
        source_order_id: sourceOrderId,
        amount,
        currency,
        description,
        status: 'pending',
        metadata: this.stringifyMetadata(traceMetadata),
        created_by: createdBy,
        source_event: sourceEvent,
        correlation_id: correlationId || null
      }).returning('*');
      
      // Validate and create ledger entries
      const createdEntries = [];
      
      for (const entry of templateEntries) {
        const account = await this.getAccount(entry.accountCode, tenantId, trx);
        const entryMetadata = {
          ...(entry.metadata || {}),
          event_id: eventId || null,
          correlation_id: correlationId || null,
          idempotency_key: idempotencyKey || null
        };
        
        const [ledgerEntry] = await trx('ledger_entries').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          transaction_id: transaction.id,
          account_id: account.id,
          entry_type: entry.entryType,
          amount: entry.amount,
          currency: entry.currency || currency,
          description: entry.description || description,
          metadata: this.stringifyMetadata(entryMetadata),
          created_by: createdBy,
          correlation_id: correlationId || null
        }).returning('*');
        
        createdEntries.push(ledgerEntry);
      }

      this.assertBalanced(createdEntries);
      
      // Update transaction status to posted
      await trx('ledger_transactions')
        .where('id', transaction.id)
        .where('status', 'pending')
        .update({ status: 'posted' });
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'ledger_transaction',
        entity_id: transaction.id,
        action: 'post',
        user_id: createdBy,
        source_system: 'ledger_service',
        after_state: JSON.stringify({
          transaction,
          entries: createdEntries,
          balance_validation: validation
        }),
        metadata: this.stringifyMetadata({
          transaction_id: transaction.id,
          event_type: normalizedEventType,
          sourceOrderId,
          event_id: eventId || null,
          idempotency_key: idempotencyKey || null
        }),
        correlation_id: correlationId || null
      });
      
      // If override was used, log it in admin_overrides_log
      if (override) {
        await trx('admin_overrides_log').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          override_type: 'SOFT_CLOSE_POSTING',
          justification: overrideJustification,
          entity_type: 'ledger_transaction',
          entity_id: transaction.id,
          affected_entities: JSON.stringify([transaction.id]),
          override_by: createdBy,
          override_by_role: userRole,
          metadata: JSON.stringify({
            periodId: periodCheck.period.id,
            periodStatus: periodCheck.period.status,
            transactionRef,
            eventType: normalizedEventType
          })
        });
      }
      
      return {
        transaction: { ...transaction, status: 'posted' },
        entries: createdEntries,
        duplicate: false,
        validation,
        override_used: override
      };
    });
  }
  
  /**
   * Reverse a ledger transaction
   * Creates reversing entries with opposite signs
   * 
   * @param {Object} params - Reversal parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.originalTransactionId - ID of transaction to reverse
   * @param {string} params.reason - Reason for reversal
   * @param {string} params.createdBy - User who created the reversal
   * @returns {Object} Reversal transaction
   */
  async reverseTransaction(params) {
    const {
      tenantId,
      originalTransactionId,
      reason,
      createdBy,
      eventId,
      correlationId = requestContext.getCorrelationId(),
      idempotencyKey
    } = params;
    
    if (!tenantId || !originalTransactionId || !reason) {
      throw new Error('Missing required parameters for reversal');
    }
    
    return await db.knex.transaction(async (trx) => {
      // Get original transaction
      const originalTx = await trx('ledger_transactions')
        .where('id', originalTransactionId)
        .where('tenant_id', tenantId)
        .first();
        
      if (!originalTx) {
        throw new Error('Original transaction not found');
      }

      const originalEntries = await trx('ledger_entries')
        .where('transaction_id', originalTransactionId);

      if (originalEntries.length === 0) {
        throw new Error('Original transaction has no entries to reverse');
      }

      this.assertBalanced(originalEntries);
      
      if (originalTx.status === 'reversed') {
        const reversalTx = originalTx.reversed_by_transaction_id
          ? await trx('ledger_transactions')
            .where('id', originalTx.reversed_by_transaction_id)
            .where('tenant_id', tenantId)
            .first()
          : await trx('ledger_transactions')
            .where('transaction_ref', `${originalTx.transaction_ref}-REV`)
            .where('tenant_id', tenantId)
            .first();

        const reversalEntries = reversalTx
          ? await trx('ledger_entries').where('transaction_id', reversalTx.id)
          : [];

        return {
          reversalTransaction: reversalTx,
          reversalEntries,
          originalTransaction: originalTx,
          duplicate: true,
          validation: reversalEntries.length > 0 ? this.assertBalanced(reversalEntries) : null
        };
      }

      if (idempotencyKey) {
        const existingReversal = await trx('ledger_transactions')
          .where('tenant_id', tenantId)
          .where('idempotency_key', idempotencyKey)
          .first();

        if (existingReversal) {
          const reversalEntries = await trx('ledger_entries').where('transaction_id', existingReversal.id);
          return {
            reversalTransaction: existingReversal,
            reversalEntries,
            originalTransaction: originalTx,
            duplicate: true,
            validation: this.assertBalanced(reversalEntries)
          };
        }
      }
      
      // Create reversal transaction
      const reversalRef = `${originalTx.transaction_ref}-REV`;
      const originalMetadata = this.parseMetadata(originalTx.metadata);
      const [reversalTx] = await trx('ledger_transactions').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        transaction_ref: reversalRef,
        idempotency_key: idempotencyKey || `reversal-${originalTransactionId}`,
        event_type: originalTx.event_type,
        source_transaction_id: originalTx.source_transaction_id,
        source_order_id: originalTx.source_order_id,
        amount: originalTx.amount,
        currency: originalTx.currency,
        description: `REVERSAL: ${reason}`,
        status: 'pending',
        reverses_transaction_id: originalTransactionId,
        metadata: this.stringifyMetadata({
          ...originalMetadata,
          reversal_reason: reason,
          event_id: eventId || null,
          correlation_id: correlationId || null,
          idempotency_key: idempotencyKey || `reversal-${originalTransactionId}`
        }),
        created_by: createdBy,
        source_event: 'reversal',
        correlation_id: correlationId || null
      }).returning('*');
      
      // Create reversing entries (swap debit/credit)
      const reversalEntries = [];
      for (const entry of originalEntries) {
        const [reversalEntry] = await trx('ledger_entries').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          transaction_id: reversalTx.id,
          account_id: entry.account_id,
          entry_type: entry.entry_type === 'debit' ? 'credit' : 'debit',
          amount: entry.amount,
          currency: entry.currency,
          description: `REVERSAL: ${entry.description}`,
          metadata: this.stringifyMetadata({
            original_entry_id: entry.id,
            event_id: eventId || null,
            correlation_id: correlationId || null,
            idempotency_key: idempotencyKey || `reversal-${originalTransactionId}`
          }),
          created_by: createdBy,
          correlation_id: correlationId || null
        }).returning('*');
        
        reversalEntries.push(reversalEntry);
      }

      const validation = this.assertBalanced(reversalEntries);

      await trx('ledger_transactions')
        .where('id', reversalTx.id)
        .where('status', 'pending')
        .update({ status: 'posted' });
      
      // Mark original transaction as reversed
      await trx('ledger_transactions')
        .where('id', originalTransactionId)
        .update({
          status: 'reversed',
          reversed_by_transaction_id: reversalTx.id
        });
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'ledger_transaction',
        entity_id: reversalTx.id,
        action: 'reverse',
        user_id: createdBy,
        source_system: 'ledger_service',
        reason,
        before_state: JSON.stringify(originalTx),
        after_state: JSON.stringify({ ...reversalTx, status: 'posted' }),
        metadata: this.stringifyMetadata({
          transaction_id: reversalTx.id,
          event_type: 'reversal',
          original_transaction_id: originalTransactionId,
          event_id: eventId || null,
          idempotency_key: idempotencyKey || `reversal-${originalTransactionId}`
        }),
        correlation_id: correlationId || null
      });
      
      return {
        reversalTransaction: { ...reversalTx, status: 'posted' },
        reversalEntries,
        originalTransaction: originalTx,
        validation
      };
    });
  }
  
  /**
   * Get account balance (derived from entries)
   * 
   * @param {Object} params - Balance query parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.accountCode - Account code
   * @param {Date} params.asOfDate - Calculate balance as of this date (optional)
   * @returns {Object} Account balance details
   */
  async getAccountBalance(params) {
    const { tenantId, accountCode, asOfDate } = params;
    
    let query = db.knex('account_balances')
      .where('tenant_id', tenantId)
      .where('account_code', accountCode);
    
    // If asOfDate provided, calculate historical balance
    if (asOfDate) {
      // Need to calculate from ledger_entries directly
      const account = await db.knex('ledger_accounts')
        .where('account_code', accountCode)
        .first();
        
      if (!account) {
        throw new Error(`Account not found: ${accountCode}`);
      }
      
      const entries = await db.knex('ledger_entries as le')
        .join('ledger_transactions as lt', 'le.transaction_id', 'lt.id')
        .where('le.tenant_id', tenantId)
        .where('le.account_id', account.id)
        .where('lt.status', 'posted')
        .where('le.created_at', '<=', asOfDate)
        .select('le.entry_type', 'le.amount');
      
      let totalDebits = 0;
      let totalCredits = 0;
      
      entries.forEach(entry => {
        if (entry.entry_type === 'debit') {
          totalDebits += parseFloat(entry.amount);
        } else {
          totalCredits += parseFloat(entry.amount);
        }
      });
      
      const balance = account.normal_balance === 'debit' 
        ? totalDebits - totalCredits
        : totalCredits - totalDebits;
      
      return {
        account_code: accountCode,
        account_name: account.account_name,
        account_type: account.account_type,
        normal_balance: account.normal_balance,
        balance,
        total_debits: totalDebits,
        total_credits: totalCredits,
        as_of_date: asOfDate
      };
    }
    
    // Return current balance from view
    const balance = await query.first();
    
    if (!balance) {
      // Account exists but has no entries yet
      const account = await db.knex('ledger_accounts')
        .where('account_code', accountCode)
        .first();
        
      if (!account) {
        throw new Error(`Account not found: ${accountCode}`);
      }
      
      return {
        account_code: accountCode,
        account_name: account.account_name,
        account_type: account.account_type,
        normal_balance: account.normal_balance,
        balance: 0,
        total_debits: 0,
        total_credits: 0,
        entry_count: 0
      };
    }
    
    return balance;
  }
  
  /**
   * Get transaction details with all entries
   * 
   * @param {string} transactionId - Transaction ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Transaction with entries
   */
  async getTransaction(transactionId, tenantId) {
    const transaction = await db.knex('ledger_transactions')
      .where('id', transactionId)
      .where('tenant_id', tenantId)
      .first();
      
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    
    const entries = await db.knex('ledger_entries as le')
      .join('ledger_accounts as la', 'le.account_id', 'la.id')
      .where('le.transaction_id', transactionId)
      .select(
        'le.*',
        'la.account_code',
        'la.account_name',
        'la.account_type'
      );
    
    return {
      transaction,
      entries
    };
  }
  
  /**
   * Get ledger summary for audit/reporting
   * 
   * @param {Object} params - Query parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {Date} params.fromDate - Start date
   * @param {Date} params.toDate - End date
   * @param {string} params.accountType - Filter by account type (optional)
   * @returns {Object} Ledger summary
   */
  async getLedgerSummary(params) {
    const { tenantId, fromDate, toDate, accountType } = params;
    
    let query = db.knex('account_balances')
      .where('tenant_id', tenantId);
    
    if (accountType) {
      query = query.where('account_type', accountType);
    }
    
    const balances = await query;
    
    // Get transaction count and totals for period
    let txQuery = db.knex('ledger_transactions')
      .where('tenant_id', tenantId)
      .where('status', 'posted');
    
    if (fromDate) {
      txQuery = txQuery.where('created_at', '>=', fromDate);
    }
    if (toDate) {
      txQuery = txQuery.where('created_at', '<=', toDate);
    }
    
    const txSummary = await txQuery
      .count('* as transaction_count')
      .sum('amount as total_amount')
      .first();
    
    return {
      balances,
      period: {
        from: fromDate,
        to: toDate,
        transaction_count: txSummary.transaction_count || 0,
        total_amount: txSummary.total_amount || 0
      },
      summary: {
        total_accounts: balances.length,
        accounts_by_type: balances.reduce((acc, b) => {
          acc[b.account_type] = (acc[b.account_type] || 0) + 1;
          return acc;
        }, {})
      }
    };
  }
}

module.exports = new LedgerService();
