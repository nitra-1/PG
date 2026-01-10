/**
 * Double-Entry Ledger System Migration
 * 
 * This migration creates the core tables for an RBI-compliant double-entry accounting ledger system
 * for a Payment Aggregator (PA).
 * 
 * Key Design Principles:
 * - Immutable ledger entries (no UPDATE/DELETE allowed)
 * - Double-entry accounting (every transaction has balanced debits and credits)
 * - Four separate ledgers: Merchant, Gateway, Escrow, Platform Revenue
 * - Audit trail for all operations
 * - Idempotency support
 * - Balances are derived, never stored as source of truth
 */

exports.up = function(knex) {
  return knex.schema
    // =================================================================
    // LEDGER ACCOUNTS TABLE
    // Defines the chart of accounts for the double-entry system
    // =================================================================
    .createTable('ledger_accounts', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('account_code', 50).notNullable().unique();
      table.string('account_name', 255).notNullable();
      
      // Account Type: determines which ledger this account belongs to
      // - merchant: Merchant receivables and payouts
      // - gateway: Gateway collections and fees
      // - escrow: RBI-mandated nodal/escrow account
      // - platform_revenue: Platform MDR, commissions, fees
      table.enum('account_type', [
        'merchant',
        'gateway', 
        'escrow',
        'platform_revenue'
      ]).notNullable().index();
      
      // Normal Balance: defines if increases are debits or credits
      // - debit: Asset accounts (increases with debit)
      // - credit: Liability/Revenue accounts (increases with credit)
      table.enum('normal_balance', ['debit', 'credit']).notNullable();
      
      // Account Category for detailed classification
      table.enum('category', [
        'asset',           // Cash, receivables
        'liability',       // Payables, escrow obligations
        'revenue',         // Platform earnings
        'expense',         // Gateway fees, costs
        'equity'          // Owner's equity, retained earnings
      ]).notNullable().index();
      
      // Optional: Link to specific merchant or gateway
      table.uuid('merchant_id').index();
      table.string('gateway_name', 50).index();
      
      // Account status
      table.enum('status', ['active', 'inactive', 'closed']).defaultTo('active').index();
      
      // Metadata for additional context
      table.jsonb('metadata');
      
      // Audit fields
      table.string('created_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Indexes for performance
      table.index(['account_type', 'status']);
      table.index(['merchant_id', 'status']);
    })
    
    // =================================================================
    // LEDGER TRANSACTIONS TABLE
    // Groups related ledger entries (ensures balanced transactions)
    // =================================================================
    .createTable('ledger_transactions', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Transaction reference for grouping entries
      table.string('transaction_ref', 100).notNullable().unique();
      
      // Idempotency key to prevent duplicate processing
      table.string('idempotency_key', 255).unique().index();
      
      // Event that triggered this ledger transaction
      table.enum('event_type', [
        'payment_success',
        'payment_failure',
        'refund_initiated',
        'refund_completed',
        'settlement',
        'gateway_fee',
        'platform_fee',
        'chargeback_debit',
        'chargeback_reversal',
        'manual_adjustment'
      ]).notNullable().index();
      
      // Source transaction details
      table.uuid('source_transaction_id').index(); // Link to transactions table
      table.string('source_order_id', 100).index();
      
      // Transaction amount and currency
      table.decimal('amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      
      // Transaction description
      table.text('description');
      
      // Status tracking
      table.enum('status', ['pending', 'posted', 'reversed', 'failed']).defaultTo('pending').index();
      
      // Reversal tracking
      table.uuid('reverses_transaction_id').index(); // If this reverses another transaction
      table.uuid('reversed_by_transaction_id').index(); // If this was reversed by another
      
      // Metadata for additional context
      table.jsonb('metadata');
      
      // Audit fields (immutable after creation)
      table.string('created_by', 100);
      table.string('source_event', 255); // Original event that triggered this
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes for queries
      table.index(['tenant_id', 'event_type']);
      table.index(['tenant_id', 'status']);
      table.index(['tenant_id', 'created_at']);
    })
    
    // =================================================================
    // LEDGER ENTRIES TABLE
    // Individual debit/credit entries (immutable records)
    // =================================================================
    .createTable('ledger_entries', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Link to parent transaction
      table.uuid('transaction_id').notNullable().references('id').inTable('ledger_transactions').onDelete('RESTRICT');
      
      // Account being debited or credited
      table.uuid('account_id').notNullable().references('id').inTable('ledger_accounts').onDelete('RESTRICT');
      
      // Entry type: debit or credit
      table.enum('entry_type', ['debit', 'credit']).notNullable();
      
      // Amount (always positive, entry_type determines direction)
      table.decimal('amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      
      // Entry description/narration
      table.text('description');
      
      // Metadata for additional context
      table.jsonb('metadata');
      
      // Audit fields (IMMUTABLE - no updates allowed)
      table.string('created_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes for balance calculation and queries
      table.index(['tenant_id', 'account_id']);
      table.index(['tenant_id', 'transaction_id']);
      table.index(['account_id', 'created_at']);
      table.index(['tenant_id', 'created_at']);
      table.index(['entry_type', 'account_id']);
    })
    
    // =================================================================
    // SETTLEMENTS TABLE
    // Tracks merchant settlements and payouts
    // =================================================================
    .createTable('settlements', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('merchant_id').notNullable().index();
      
      // Settlement reference
      table.string('settlement_ref', 100).notNullable().unique();
      
      // Settlement period
      table.date('settlement_date').notNullable().index();
      table.date('period_from').notNullable();
      table.date('period_to').notNullable();
      
      // Settlement amounts
      table.decimal('gross_amount', 15, 2).notNullable(); // Total transaction amount
      table.decimal('fees_amount', 15, 2).notNullable();  // Platform + gateway fees
      table.decimal('net_amount', 15, 2).notNullable();   // Amount to be paid
      
      // Bank transfer details
      table.string('bank_account_number', 50);
      table.string('bank_ifsc', 20);
      table.string('bank_name', 100);
      table.string('utr_number', 50).index(); // Unique Transaction Reference
      
      // Status tracking
      table.enum('status', [
        'pending',
        'processing',
        'completed',
        'failed',
        'reversed'
      ]).defaultTo('pending').index();
      
      // Link to ledger transaction
      table.uuid('ledger_transaction_id').references('id').inTable('ledger_transactions');
      
      // Metadata
      table.jsonb('metadata');
      
      // Audit fields
      table.string('created_by', 100);
      table.string('approved_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('approved_at');
      table.timestamp('completed_at');
      
      // Indexes
      table.index(['tenant_id', 'status']);
      table.index(['merchant_id', 'settlement_date']);
      table.index(['settlement_date', 'status']);
    })
    
    // =================================================================
    // RECONCILIATION BATCHES TABLE
    // Tracks gateway and bank reconciliation
    // =================================================================
    .createTable('reconciliation_batches', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Batch reference
      table.string('batch_ref', 100).notNullable().unique();
      
      // Reconciliation type
      table.enum('reconciliation_type', [
        'gateway_settlement',
        'bank_escrow_statement',
        'merchant_payout'
      ]).notNullable().index();
      
      // For gateway reconciliation
      table.string('gateway_name', 50).index();
      table.string('gateway_settlement_id', 100);
      
      // Reconciliation period
      table.date('period_from').notNullable();
      table.date('period_to').notNullable();
      
      // Summary statistics
      table.integer('total_transactions').defaultTo(0);
      table.integer('matched_transactions').defaultTo(0);
      table.integer('missing_transactions').defaultTo(0);
      table.integer('mismatched_transactions').defaultTo(0);
      table.integer('duplicate_transactions').defaultTo(0);
      
      // Amount summary
      table.decimal('expected_amount', 15, 2);
      table.decimal('actual_amount', 15, 2);
      table.decimal('difference_amount', 15, 2);
      
      // Status
      table.enum('status', [
        'in_progress',
        'completed',
        'discrepancy_found',
        'resolved'
      ]).defaultTo('in_progress').index();
      
      // File reference (if uploaded)
      table.string('file_name', 255);
      table.string('file_path', 500);
      
      // Metadata
      table.jsonb('metadata');
      table.jsonb('discrepancies'); // Detailed discrepancy information
      
      // Audit fields
      table.string('created_by', 100);
      table.string('resolved_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at');
      table.timestamp('resolved_at');
      
      // Indexes
      table.index(['tenant_id', 'reconciliation_type']);
      table.index(['gateway_name', 'period_from', 'period_to']);
      table.index(['status', 'created_at']);
    })
    
    // =================================================================
    // RECONCILIATION ITEMS TABLE
    // Individual transaction reconciliation status
    // =================================================================
    .createTable('reconciliation_items', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Link to reconciliation batch
      table.uuid('batch_id').notNullable().references('id').inTable('reconciliation_batches').onDelete('CASCADE');
      
      // Link to internal transaction
      table.uuid('transaction_id').index();
      table.uuid('ledger_transaction_id').index();
      
      // External reference from gateway/bank
      table.string('external_ref', 100);
      table.string('external_transaction_id', 100);
      
      // Reconciliation status
      table.enum('match_status', [
        'matched',
        'missing_internal',  // In external statement but not in our system
        'missing_external',  // In our system but not in external statement
        'amount_mismatch',
        'duplicate',
        'pending'
      ]).notNullable().index();
      
      // Amount comparison
      table.decimal('internal_amount', 15, 2);
      table.decimal('external_amount', 15, 2);
      table.decimal('difference_amount', 15, 2);
      
      // Resolution tracking
      table.enum('resolution_status', [
        'unresolved',
        'investigating',
        'resolved',
        'written_off'
      ]).defaultTo('unresolved').index();
      
      table.text('resolution_notes');
      table.string('resolved_by', 100);
      table.timestamp('resolved_at');
      
      // Metadata
      table.jsonb('metadata');
      
      // Audit fields
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['batch_id', 'match_status']);
      table.index(['tenant_id', 'match_status']);
    })
    
    // =================================================================
    // AUDIT LOGS FOR LEDGER (Enhanced)
    // Specific audit trail for ledger operations
    // =================================================================
    .createTable('ledger_audit_logs', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Entity being audited
      table.string('entity_type', 50).notNullable(); // ledger_transaction, ledger_entry, settlement, etc.
      table.uuid('entity_id').notNullable();
      
      // Action performed
      table.enum('action', [
        'create',
        'post',
        'reverse',
        'reconcile',
        'adjust',
        'approve',
        'reject'
      ]).notNullable();
      
      // Who performed the action
      table.string('user_id', 100);
      table.string('user_email', 255);
      table.string('user_role', 50);
      
      // Context
      table.string('ip_address', 45);
      table.string('user_agent', 500);
      table.string('source_system', 100); // API, admin_panel, batch_job, etc.
      
      // Changes (for compliance)
      table.jsonb('before_state');
      table.jsonb('after_state');
      table.text('reason'); // Required for manual adjustments
      
      // Metadata
      table.jsonb('metadata');
      
      // Timestamp (immutable)
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes for audit queries
      table.index(['tenant_id', 'entity_type', 'entity_id']);
      table.index(['tenant_id', 'action']);
      table.index(['user_id', 'created_at']);
      table.index(['created_at']);
    })
    
    // =================================================================
    // CREATE VIEW: Account Balances (Derived, Never Authoritative)
    // Balances are calculated from ledger entries, not stored
    // =================================================================
    .raw(`
      CREATE OR REPLACE VIEW account_balances AS
      SELECT 
        le.tenant_id,
        le.account_id,
        la.account_code,
        la.account_name,
        la.account_type,
        la.normal_balance,
        la.category,
        la.merchant_id,
        la.gateway_name,
        -- Calculate debit total
        SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END) as total_debits,
        -- Calculate credit total
        SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) as total_credits,
        -- Calculate balance based on normal balance type
        CASE 
          WHEN la.normal_balance = 'debit' THEN 
            SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END) - 
            SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END)
          WHEN la.normal_balance = 'credit' THEN 
            SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) - 
            SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END)
        END as balance,
        le.currency,
        MAX(le.created_at) as last_entry_at,
        COUNT(*) as entry_count
      FROM ledger_entries le
      INNER JOIN ledger_accounts la ON le.account_id = la.id
      INNER JOIN ledger_transactions lt ON le.transaction_id = lt.id
      WHERE lt.status = 'posted'  -- Only include posted transactions
      GROUP BY 
        le.tenant_id,
        le.account_id,
        la.account_code,
        la.account_name,
        la.account_type,
        la.normal_balance,
        la.category,
        la.merchant_id,
        la.gateway_name,
        le.currency
    `)
    
    // =================================================================
    // CREATE TRIGGER: Prevent updates to ledger_entries (Immutability)
    // =================================================================
    .raw(`
      CREATE OR REPLACE FUNCTION prevent_ledger_entry_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Ledger entries are immutable and cannot be updated. Use reversals instead.';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Ledger entries are immutable and cannot be deleted. Use reversals instead.';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      CREATE TRIGGER enforce_ledger_entry_immutability
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ledger_entry_modification();
    `)
    
    // =================================================================
    // CREATE FUNCTION: Validate double-entry balance
    // =================================================================
    .raw(`
      CREATE OR REPLACE FUNCTION validate_transaction_balance(p_transaction_id UUID)
      RETURNS BOOLEAN AS $$
      DECLARE
        v_total_debits DECIMAL(15,2);
        v_total_credits DECIMAL(15,2);
      BEGIN
        -- Calculate total debits
        SELECT COALESCE(SUM(amount), 0) INTO v_total_debits
        FROM ledger_entries
        WHERE transaction_id = p_transaction_id AND entry_type = 'debit';
        
        -- Calculate total credits
        SELECT COALESCE(SUM(amount), 0) INTO v_total_credits
        FROM ledger_entries
        WHERE transaction_id = p_transaction_id AND entry_type = 'credit';
        
        -- Check if balanced (allowing for small rounding differences)
        IF ABS(v_total_debits - v_total_credits) > 0.01 THEN
          RAISE EXCEPTION 'Transaction % is not balanced. Debits: %, Credits: %', 
            p_transaction_id, v_total_debits, v_total_credits;
        END IF;
        
        RETURN TRUE;
      END;
      $$ LANGUAGE plpgsql;
    `);
};

exports.down = function(knex) {
  return knex.schema
    // Drop trigger and functions
    .raw('DROP TRIGGER IF EXISTS enforce_ledger_entry_immutability ON ledger_entries')
    .raw('DROP FUNCTION IF EXISTS prevent_ledger_entry_modification()')
    .raw('DROP FUNCTION IF EXISTS validate_transaction_balance(UUID)')
    .raw('DROP VIEW IF EXISTS account_balances')
    
    // Drop tables in reverse order
    .dropTableIfExists('ledger_audit_logs')
    .dropTableIfExists('reconciliation_items')
    .dropTableIfExists('reconciliation_batches')
    .dropTableIfExists('settlements')
    .dropTableIfExists('ledger_entries')
    .dropTableIfExists('ledger_transactions')
    .dropTableIfExists('ledger_accounts');
};
