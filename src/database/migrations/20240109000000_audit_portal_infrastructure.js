/**
 * Audit Portal Infrastructure Migration
 * 
 * Creates infrastructure for RBI-compliant read-only audit access
 * 
 * Key Features:
 * - AUDITOR role added to platform_users
 * - Time-boxed access control for auditors
 * - Compliance reports caching for performance
 * - Complete audit trail for auditor activities
 * 
 * CRITICAL: AUDITOR role has ZERO write capability
 */

exports.up = async function(knex) {
  // ============================================================
  // 1. Add AUDITOR role to platform_users enum
  // ============================================================
  await knex.raw(`
    DO $$ 
    BEGIN
      -- Check if AUDITOR value already exists in the enum
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'AUDITOR' 
        AND enumtypid = (
          SELECT oid FROM pg_type WHERE typname = 'platform_users_role'
        )
      ) THEN
        -- Add AUDITOR to the existing enum
        ALTER TYPE platform_users_role ADD VALUE 'AUDITOR';
      END IF;
    END $$;
  `);

  // ============================================================
  // 2. Create auditor_access_windows table
  // Time-boxed access control for audit periods
  // ============================================================
  await knex.schema.createTable('auditor_access_windows', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('auditor_user_id')
      .notNullable()
      .references('id')
      .inTable('platform_users')
      .onDelete('CASCADE');
    
    // Time-boxed access period
    table.timestamp('access_start_date').notNullable();
    table.timestamp('access_end_date').notNullable();
    
    // Access status
    table.enum('status', ['ACTIVE', 'EXPIRED', 'REVOKED'])
      .notNullable()
      .defaultTo('ACTIVE')
      .index();
    
    // Audit context
    table.string('audit_case_number', 100); // RBI/Bank audit reference
    table.string('audit_type', 100); // 'RBI_INSPECTION', 'BANK_AUDIT', 'STATUTORY_AUDIT', etc.
    table.text('audit_purpose'); // Purpose of audit
    table.string('granted_by', 100).notNullable(); // Who granted access
    table.string('granted_by_role', 50); // Role of grantor
    table.text('revocation_reason'); // If revoked early
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('last_access_at'); // Track when auditor last accessed
    table.timestamp('revoked_at');
    
    // Indexes
    table.index('auditor_user_id');
    table.index(['access_start_date', 'access_end_date']);
    table.index(['status', 'access_end_date']);
  });

  // ============================================================
  // 3. Create compliance_reports_cache table
  // Pre-generated compliance reports for performance
  // ============================================================
  await knex.schema.createTable('compliance_reports_cache', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().index();
    
    // Report metadata
    table.string('report_type', 100).notNullable(); // 'ESCROW_BALANCE', 'MERCHANT_OUTSTANDING', etc.
    table.timestamp('report_date').notNullable(); // Date of report
    table.timestamp('period_start'); // For period-based reports
    table.timestamp('period_end');
    
    // Report data
    table.jsonb('report_data').notNullable(); // Actual report content
    table.jsonb('report_metadata'); // Additional metadata
    
    // Generation tracking
    table.string('generated_by', 100);
    table.timestamp('generated_at').defaultTo(knex.fn.now());
    table.integer('generation_duration_ms'); // Performance tracking
    
    // Cache control
    table.timestamp('expires_at'); // When cache should be refreshed
    table.boolean('is_final').defaultTo(false); // True if period is closed
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes for quick retrieval
    table.index(['tenant_id', 'report_type', 'report_date']);
    table.index(['report_type', 'period_start', 'period_end']);
    table.index('expires_at');
  });

  // ============================================================
  // 4. Create audit_portal_access_log table
  // Track all auditor activities
  // ============================================================
  await knex.schema.createTable('audit_portal_access_log', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('auditor_user_id')
      .notNullable()
      .references('id')
      .inTable('platform_users')
      .onDelete('CASCADE');
    
    // Access details
    table.string('endpoint', 255).notNullable(); // Which endpoint was accessed
    table.string('http_method', 10).notNullable(); // GET, POST, etc.
    table.integer('http_status_code'); // Response status
    
    // Request context
    table.string('ip_address', 50);
    table.string('user_agent', 500);
    table.jsonb('query_parameters'); // Query params used
    table.text('access_purpose'); // Optional: why accessing this data
    
    // Response metadata
    table.integer('response_time_ms'); // Performance tracking
    table.integer('records_returned'); // How many records returned
    
    // Timestamps
    table.timestamp('accessed_at').defaultTo(knex.fn.now()).index();
    
    // Indexes
    table.index('auditor_user_id');
    table.index(['auditor_user_id', 'accessed_at']);
    table.index('endpoint');
  });

  return knex.schema;
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('audit_portal_access_log')
    .dropTableIfExists('compliance_reports_cache')
    .dropTableIfExists('auditor_access_windows');
  
  // Note: We don't remove the AUDITOR enum value as it may have existing data
  // and PostgreSQL doesn't support removing enum values easily
};
