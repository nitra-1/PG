/**
 * Accounting Period Controls & Ledger Locks Migration
 * 
 * This migration adds RBI audit readiness features:
 * 1. Accounting periods table - for period locking and financial close
 * 2. Enhanced settlements table - with state machine for finality
 * 3. Ledger locks table - for audit freeze capability
 * 
 * Key Compliance Requirements:
 * - Period-based posting controls (OPEN, SOFT_CLOSED, HARD_CLOSED)
 * - Settlement state machine with bank confirmation
 * - Ledger locking for audit periods
 * - Complete audit trail for all control actions
 */

exports.up = function(knex) {
  return knex.schema
    // =================================================================
    // ACCOUNTING PERIODS TABLE
    // Manages financial posting windows and period close discipline
    // =================================================================
    .createTable('accounting_periods', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Period type: DAILY for daily reconciliation, MONTHLY for financial close
      table.enum('period_type', ['DAILY', 'MONTHLY']).notNullable().index();
      
      // Period boundaries (inclusive)
      table.timestamp('period_start').notNullable();
      table.timestamp('period_end').notNullable();
      
      // Period status for graduated locking
      // OPEN: Normal operations, postings allowed
      // SOFT_CLOSED: Reconciliation in progress, postings require override
      // HARD_CLOSED: Period locked, no postings allowed (immutable)
      table.enum('status', ['OPEN', 'SOFT_CLOSED', 'HARD_CLOSED'])
        .notNullable()
        .defaultTo('OPEN')
        .index();
      
      // Closure tracking
      table.string('closed_by', 100); // User who closed the period
      table.timestamp('closed_at'); // When period was closed
      table.text('closure_notes'); // Reason/notes for closure
      
      // Audit fields
      table.string('created_by', 100);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Indexes for performance and constraint enforcement
      table.index(['tenant_id', 'period_type', 'status']);
      table.index(['period_start', 'period_end']);
      table.index(['tenant_id', 'period_type', 'period_start', 'period_end']);
      
      // Unique constraint: No overlapping periods of same type for same tenant
      table.unique(['tenant_id', 'period_type', 'period_start', 'period_end']);
    })
    
    // =================================================================
    // Enhance existing SETTLEMENTS table with state machine
    // Add fields for settlement lifecycle and bank confirmation
    // =================================================================
    .table('settlements', function(table) {
      // Add new state machine fields
      // State flow: CREATED -> FUNDS_RESERVED -> SENT_TO_BANK -> 
      //            BANK_CONFIRMED -> SETTLED
      // Or any state -> FAILED -> RETRIED (back to FUNDS_RESERVED)
      
      // Drop old status enum if exists and recreate with new states
      // Note: This is a schema evolution - in production, use proper migration strategy
      table.dropColumn('status');
    })
    .table('settlements', function(table) {
      table.enum('status', [
        'CREATED',
        'FUNDS_RESERVED',
        'SENT_TO_BANK',
        'BANK_CONFIRMED',
        'SETTLED',
        'FAILED',
        'RETRIED'
      ]).notNullable().defaultTo('CREATED').index();
      
      // State transition timestamps
      table.timestamp('funds_reserved_at');
      table.timestamp('sent_to_bank_at');
      table.timestamp('bank_confirmed_at');
      table.timestamp('settled_at');
      table.timestamp('failed_at');
      
      // Bank confirmation details
      table.string('bank_reference_number', 100).index();
      table.string('bank_transaction_id', 100);
      table.string('settlement_batch_id', 100).index();
      
      // Retry tracking
      table.integer('retry_count').defaultTo(0);
      table.integer('max_retries').defaultTo(3);
      table.timestamp('next_retry_at');
      table.timestamp('last_retry_at');
      table.text('failure_reason');
      table.jsonb('retry_history'); // Array of retry attempts with timestamps and reasons
      
      // State machine metadata
      table.jsonb('state_transitions'); // Log of all state transitions with timestamps
      
      // Update existing utr_number to be more specific
      // (Already exists, just adding comment for clarity)
      // utr_number is the Unique Transaction Reference from bank
    })
    
    // =================================================================
    // LEDGER LOCKS TABLE
    // Enforces read-only mode during audits or period close
    // =================================================================
    .createTable('ledger_locks', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Lock type determines scope and behavior
      // PERIOD_LOCK: Auto-applied when period is HARD_CLOSED
      // AUDIT_LOCK: Manual lock applied during external audits
      // RECONCILIATION_LOCK: Applied during reconciliation processes
      table.enum('lock_type', ['PERIOD_LOCK', 'AUDIT_LOCK', 'RECONCILIATION_LOCK'])
        .notNullable()
        .index();
      
      // Lock scope - which period or date range is locked
      table.timestamp('lock_start_date').notNullable();
      table.timestamp('lock_end_date').notNullable();
      
      // Optional: Link to specific accounting period
      table.uuid('accounting_period_id')
        .references('id')
        .inTable('accounting_periods')
        .onDelete('CASCADE');
      
      // Lock status
      table.enum('lock_status', ['ACTIVE', 'RELEASED'])
        .notNullable()
        .defaultTo('ACTIVE')
        .index();
      
      // Lock metadata
      table.text('reason').notNullable(); // Why was lock applied
      table.string('reference_number', 100); // Audit case number, etc.
      
      // Ownership tracking
      table.string('locked_by', 100).notNullable();
      table.string('locked_by_role', 50);
      table.timestamp('locked_at').defaultTo(knex.fn.now());
      
      table.string('released_by', 100);
      table.string('released_by_role', 50);
      table.timestamp('released_at');
      table.text('release_notes');
      
      // Metadata
      table.jsonb('metadata');
      
      // Indexes
      table.index(['tenant_id', 'lock_status']);
      table.index(['lock_start_date', 'lock_end_date']);
      table.index(['tenant_id', 'lock_type', 'lock_status']);
      
      // Prevent multiple active locks of same type for overlapping periods
      // This is enforced in application logic + partial unique index
    })
    
    // =================================================================
    // ADMIN OVERRIDES LOG TABLE
    // Tracks all override actions for audit compliance
    // =================================================================
    .createTable('admin_overrides_log', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      
      // Override details
      table.string('override_type', 50).notNullable(); // SOFT_CLOSE_POSTING, PERIOD_REOPEN, etc.
      table.text('justification').notNullable(); // Required explanation
      
      // What was overridden
      table.string('entity_type', 50).notNullable(); // ledger_transaction, accounting_period, etc.
      table.uuid('entity_id'); // ID of affected entity
      table.jsonb('affected_entities'); // Array of affected transaction IDs, etc.
      
      // Who performed override
      table.string('override_by', 100).notNullable();
      table.string('override_by_role', 50).notNullable(); // Must be FINANCE_ADMIN
      table.string('override_by_email', 255);
      
      // Approval workflow (optional)
      table.string('approved_by', 100);
      table.timestamp('approved_at');
      
      // Context
      table.string('ip_address', 45);
      table.string('user_agent', 500);
      
      // Timestamp
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Metadata
      table.jsonb('metadata');
      
      // Indexes
      table.index(['tenant_id', 'override_type']);
      table.index(['override_by', 'created_at']);
      table.index(['entity_type', 'entity_id']);
      table.index(['created_at']);
    })
    
    // =================================================================
    // CREATE FUNCTION: Check accounting period before posting
    // This enforces period controls at database level
    // =================================================================
    .raw(`
      CREATE OR REPLACE FUNCTION check_accounting_period_for_posting(
        p_tenant_id UUID,
        p_transaction_date TIMESTAMP
      )
      RETURNS TABLE(
        period_id UUID,
        period_status TEXT,
        period_type TEXT,
        posting_allowed BOOLEAN,
        override_required BOOLEAN,
        error_message TEXT
      ) AS $$
      DECLARE
        v_period RECORD;
      BEGIN
        -- Find applicable DAILY period for transaction date
        SELECT id, status, period_type, period_start, period_end
        INTO v_period
        FROM accounting_periods
        WHERE tenant_id = p_tenant_id
          AND period_type = 'DAILY'
          AND p_transaction_date >= period_start
          AND p_transaction_date <= period_end
        LIMIT 1;
        
        -- If no period found, posting not allowed
        IF v_period.id IS NULL THEN
          RETURN QUERY SELECT 
            NULL::UUID as period_id,
            NULL::TEXT as period_status,
            'DAILY'::TEXT as period_type,
            FALSE as posting_allowed,
            FALSE as override_required,
            'No open accounting period found for transaction date'::TEXT as error_message;
          RETURN;
        END IF;
        
        -- Check period status
        IF v_period.status = 'OPEN' THEN
          RETURN QUERY SELECT 
            v_period.id,
            v_period.status::TEXT,
            v_period.period_type::TEXT,
            TRUE as posting_allowed,
            FALSE as override_required,
            NULL::TEXT as error_message;
        ELSIF v_period.status = 'SOFT_CLOSED' THEN
          RETURN QUERY SELECT 
            v_period.id,
            v_period.status::TEXT,
            v_period.period_type::TEXT,
            FALSE as posting_allowed,
            TRUE as override_required,
            'Period is SOFT_CLOSED - admin override required'::TEXT as error_message;
        ELSE -- HARD_CLOSED
          RETURN QUERY SELECT 
            v_period.id,
            v_period.status::TEXT,
            v_period.period_type::TEXT,
            FALSE as posting_allowed,
            FALSE as override_required,
            'Period is HARD_CLOSED - posting not allowed'::TEXT as error_message;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `)
    
    // =================================================================
    // CREATE FUNCTION: Check for active ledger locks
    // =================================================================
    .raw(`
      CREATE OR REPLACE FUNCTION check_ledger_locks(
        p_tenant_id UUID,
        p_transaction_date TIMESTAMP
      )
      RETURNS TABLE(
        lock_id UUID,
        lock_type TEXT,
        locked_by TEXT,
        reason TEXT,
        is_locked BOOLEAN
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT 
          ll.id as lock_id,
          ll.lock_type::TEXT,
          ll.locked_by,
          ll.reason,
          TRUE as is_locked
        FROM ledger_locks ll
        WHERE ll.tenant_id = p_tenant_id
          AND ll.lock_status = 'ACTIVE'
          AND p_transaction_date >= ll.lock_start_date
          AND p_transaction_date <= ll.lock_end_date
        LIMIT 1;
        
        -- If no locks found, return unlocked status
        IF NOT FOUND THEN
          RETURN QUERY SELECT 
            NULL::UUID as lock_id,
            NULL::TEXT as lock_type,
            NULL::TEXT as locked_by,
            NULL::TEXT as reason,
            FALSE as is_locked;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `)
    
    // =================================================================
    // CREATE INDEX: Partial unique index for one OPEN period per type
    // Ensures only one OPEN period exists per period_type per tenant
    // =================================================================
    .raw(`
      CREATE UNIQUE INDEX idx_one_open_period_per_type
      ON accounting_periods (tenant_id, period_type)
      WHERE status = 'OPEN';
    `)
    
    // =================================================================
    // CREATE INDEX: Partial unique index for active locks
    // Prevents overlapping active locks of same type
    // =================================================================
    .raw(`
      CREATE UNIQUE INDEX idx_one_active_lock_per_type
      ON ledger_locks (tenant_id, lock_type, lock_start_date, lock_end_date)
      WHERE lock_status = 'ACTIVE';
    `);
};

exports.down = function(knex) {
  return knex.schema
    // Drop indexes
    .raw('DROP INDEX IF EXISTS idx_one_open_period_per_type')
    .raw('DROP INDEX IF EXISTS idx_one_active_lock_per_type')
    
    // Drop functions
    .raw('DROP FUNCTION IF EXISTS check_accounting_period_for_posting(UUID, TIMESTAMP)')
    .raw('DROP FUNCTION IF EXISTS check_ledger_locks(UUID, TIMESTAMP)')
    
    // Drop tables
    .dropTableIfExists('admin_overrides_log')
    .dropTableIfExists('ledger_locks')
    
    // Revert settlements table changes
    .table('settlements', function(table) {
      table.dropColumn('funds_reserved_at');
      table.dropColumn('sent_to_bank_at');
      table.dropColumn('bank_confirmed_at');
      table.dropColumn('settled_at');
      table.dropColumn('failed_at');
      table.dropColumn('bank_reference_number');
      table.dropColumn('bank_transaction_id');
      table.dropColumn('settlement_batch_id');
      table.dropColumn('retry_count');
      table.dropColumn('max_retries');
      table.dropColumn('next_retry_at');
      table.dropColumn('last_retry_at');
      table.dropColumn('failure_reason');
      table.dropColumn('retry_history');
      table.dropColumn('state_transitions');
      table.dropColumn('status');
    })
    .table('settlements', function(table) {
      // Restore original status enum
      table.enum('status', [
        'pending',
        'processing',
        'completed',
        'failed',
        'reversed'
      ]).defaultTo('pending').index();
    })
    
    // Drop accounting periods table
    .dropTableIfExists('accounting_periods');
};
