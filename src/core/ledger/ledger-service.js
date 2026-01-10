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
  
  /**
   * Get account ID by account code
   * @private
   */
  async getAccountId(accountCode, trx = null) {
    const query = trx || db.knex;
    const account = await query('ledger_accounts')
      .where('account_code', accountCode)
      .where('status', 'active')
      .first();
      
    if (!account) {
      throw new Error(`Account not found: ${accountCode}`);
    }
    
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
      sourceEvent
    } = params;
    
    // Validate required parameters
    if (!tenantId || !transactionRef || !eventType || !entries || entries.length === 0) {
      throw new Error('Missing required parameters for ledger transaction');
    }
    
    // Check idempotency - if this key was already processed, return existing transaction
    if (idempotencyKey) {
      const existing = await db.knex('ledger_transactions')
        .where('idempotency_key', idempotencyKey)
        .first();
        
      if (existing) {
        // Return existing transaction with entries
        const existingEntries = await db.knex('ledger_entries')
          .where('transaction_id', existing.id);
        
        return {
          transaction: existing,
          entries: existingEntries,
          duplicate: true
        };
      }
    }
    
    // Use database transaction for atomicity
    return await db.knex.transaction(async (trx) => {
      // Create ledger transaction record
      const [transaction] = await trx('ledger_transactions').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        transaction_ref: transactionRef,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        source_transaction_id: sourceTransactionId,
        source_order_id: sourceOrderId,
        amount,
        currency,
        description,
        status: 'pending',
        metadata: JSON.stringify(metadata),
        created_by: createdBy,
        source_event: sourceEvent
      }).returning('*');
      
      // Validate and create ledger entries
      const createdEntries = [];
      let totalDebits = 0;
      let totalCredits = 0;
      
      for (const entry of entries) {
        const accountId = await this.getAccountId(entry.accountCode, trx);
        
        const [ledgerEntry] = await trx('ledger_entries').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          transaction_id: transaction.id,
          account_id: accountId,
          entry_type: entry.entryType,
          amount: entry.amount,
          currency,
          description: entry.description || description,
          metadata: JSON.stringify(entry.metadata || {}),
          created_by: createdBy
        }).returning('*');
        
        createdEntries.push(ledgerEntry);
        
        // Accumulate totals for validation
        if (entry.entryType === 'debit') {
          totalDebits += parseFloat(entry.amount);
        } else {
          totalCredits += parseFloat(entry.amount);
        }
      }
      
      // Validate double-entry balance (allow for small rounding differences)
      if (Math.abs(totalDebits - totalCredits) > 0.01) {
        throw new Error(
          `Transaction not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}`
        );
      }
      
      // Update transaction status to posted
      await trx('ledger_transactions')
        .where('id', transaction.id)
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
          balance_validation: { totalDebits, totalCredits }
        }),
        metadata: JSON.stringify({ eventType, sourceOrderId })
      });
      
      return {
        transaction: { ...transaction, status: 'posted' },
        entries: createdEntries,
        duplicate: false,
        validation: { totalDebits, totalCredits, balanced: true }
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
    const { tenantId, originalTransactionId, reason, createdBy } = params;
    
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
      
      if (originalTx.status === 'reversed') {
        throw new Error('Transaction already reversed');
      }
      
      // Get original entries
      const originalEntries = await trx('ledger_entries')
        .where('transaction_id', originalTransactionId);
      
      // Create reversal transaction
      const reversalRef = `${originalTx.transaction_ref}-REV`;
      const [reversalTx] = await trx('ledger_transactions').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        transaction_ref: reversalRef,
        event_type: originalTx.event_type,
        source_transaction_id: originalTx.source_transaction_id,
        source_order_id: originalTx.source_order_id,
        amount: originalTx.amount,
        currency: originalTx.currency,
        description: `REVERSAL: ${reason}`,
        status: 'posted',
        reverses_transaction_id: originalTransactionId,
        metadata: JSON.stringify({ ...originalTx.metadata, reversal_reason: reason }),
        created_by: createdBy,
        source_event: 'reversal'
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
          metadata: JSON.stringify({ original_entry_id: entry.id }),
          created_by: createdBy
        }).returning('*');
        
        reversalEntries.push(reversalEntry);
      }
      
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
        after_state: JSON.stringify(reversalTx),
        metadata: JSON.stringify({ original_transaction_id: originalTransactionId })
      });
      
      return {
        reversalTransaction: reversalTx,
        reversalEntries,
        originalTransaction: originalTx
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
