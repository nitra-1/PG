/**
 * Database Migration: PCI-DSS Compliance Tables
 * Creates tables for audit trail, tokenization vault, and compliance tracking
 */

exports.up = async function(knex) {
  // Audit Trail Table
  await knex.schema.createTable('audit_trail', function(table) {
    table.increments('id').primary();
    table.string('event_id', 100).notNullable().unique().index();
    table.string('event_type', 50).notNullable().index(); // DATA_ACCESS, AUTHENTICATION, TRANSACTION, etc.
    table.string('user_id', 100).index();
    table.string('action', 50); // READ, WRITE, UPDATE, DELETE, EXPORT
    table.string('resource', 100); // CARD_DATA, CUSTOMER_INFO, TRANSACTION, etc.
    table.string('resource_id', 100);
    table.string('data_type', 50); // PCI_DATA, PII, FINANCIAL, etc.
    table.string('ip_address', 45); // IPv4 or IPv6
    table.text('user_agent');
    table.boolean('success').defaultTo(true);
    table.text('reason');
    table.jsonb('metadata'); // Additional event data
    table.timestamp('timestamp').notNullable().index();
    table.string('hash', 64).notNullable(); // SHA-256 hash for tamper detection
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Token Vault Table (for storing encrypted sensitive data)
  await knex.schema.createTable('token_vault', function(table) {
    table.increments('id').primary();
    table.string('vault_id', 100).notNullable().unique().index();
    table.string('token', 255).notNullable().unique().index();
    table.string('token_type', 50).notNullable(); // CARD, EMAIL, PHONE, NAME, ADDRESS
    table.text('encrypted_data').notNullable(); // Encrypted original data
    table.string('iv', 32).notNullable(); // Initialization vector
    table.string('auth_tag', 32).notNullable(); // GCM authentication tag
    table.string('last_4', 10); // Last 4 digits (for card tokens)
    table.string('first_6', 10); // First 6 digits/BIN (for card tokens)
    table.string('masked_value', 255); // Masked version for display
    table.timestamp('expires_at'); // Token expiration
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('last_accessed_at');
    table.integer('access_count').defaultTo(0);
    table.boolean('revoked').defaultTo(false);
  });

  // PCI Compliance Log Table
  await knex.schema.createTable('pci_compliance_log', function(table) {
    table.increments('id').primary();
    table.string('check_id', 100).notNullable().unique();
    table.string('requirement', 20).notNullable().index(); // e.g., "3.4", "4.1", etc.
    table.string('requirement_name', 255).notNullable();
    table.string('status', 20).notNullable(); // COMPLIANT, NON_COMPLIANT, REVIEW_REQUIRED
    table.text('description');
    table.jsonb('violations'); // List of violations if any
    table.jsonb('controls'); // Controls in place
    table.string('checked_by', 100);
    table.timestamp('checked_at').notNullable().index();
    table.timestamp('next_review_date');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Sensitive Data Access Log (additional tracking for PCI data)
  await knex.schema.createTable('sensitive_data_access', function(table) {
    table.increments('id').primary();
    table.string('access_id', 100).notNullable().unique().index();
    table.string('user_id', 100).notNullable().index();
    table.string('user_role', 50);
    table.string('data_type', 50).notNullable(); // PAN, CVV, TRACK_DATA, etc.
    table.string('data_id', 100); // ID of the accessed data
    table.string('access_method', 50); // API, DIRECT_DB, EXPORT, etc.
    table.string('justification', 500); // Business justification
    table.string('approved_by', 100); // Who approved this access
    table.string('ip_address', 45);
    table.text('user_agent');
    table.boolean('authorized').defaultTo(true);
    table.text('denial_reason');
    table.timestamp('accessed_at').notNullable().index();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Data Retention Policy Tracking
  await knex.schema.createTable('data_retention_tracking', function(table) {
    table.increments('id').primary();
    table.string('data_id', 100).notNullable().index();
    table.string('data_type', 50).notNullable(); // TRANSACTION, CARD_TOKEN, CUSTOMER_INFO, etc.
    table.string('table_name', 100).notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('scheduled_deletion_at').index();
    table.integer('retention_days').notNullable();
    table.boolean('deleted').defaultTo(false);
    table.timestamp('deleted_at');
    table.string('deletion_method', 50); // AUTOMATED, MANUAL, SECURE_WIPE
    table.string('deleted_by', 100);
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Security Alerts Table
  await knex.schema.createTable('security_alerts', function(table) {
    table.increments('id').primary();
    table.string('alert_id', 100).notNullable().unique().index();
    table.string('alert_type', 50).notNullable().index(); // BRUTE_FORCE, SUSPICIOUS_ACCESS, DATA_BREACH, etc.
    table.string('severity', 20).notNullable().index(); // LOW, MEDIUM, HIGH, CRITICAL
    table.text('description').notNullable();
    table.string('affected_user', 100);
    table.string('affected_resource', 255);
    table.string('ip_address', 45);
    table.jsonb('details'); // Additional alert details
    table.string('status', 20).defaultTo('OPEN'); // OPEN, INVESTIGATING, RESOLVED, FALSE_POSITIVE
    table.text('resolution_notes');
    table.string('resolved_by', 100);
    table.timestamp('resolved_at');
    table.timestamp('triggered_at').notNullable().index();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Add indexes for performance
  await knex.schema.raw(`
    CREATE INDEX idx_audit_trail_user_timestamp ON audit_trail(user_id, timestamp DESC);
    CREATE INDEX idx_audit_trail_event_type_timestamp ON audit_trail(event_type, timestamp DESC);
    CREATE INDEX idx_token_vault_type ON token_vault(token_type);
    CREATE INDEX idx_sensitive_access_user_time ON sensitive_data_access(user_id, accessed_at DESC);
    CREATE INDEX idx_security_alerts_severity_status ON security_alerts(severity, status);
  `);

  console.log('PCI-DSS compliance tables created successfully');
};

exports.down = async function(knex) {
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('security_alerts');
  await knex.schema.dropTableIfExists('data_retention_tracking');
  await knex.schema.dropTableIfExists('sensitive_data_access');
  await knex.schema.dropTableIfExists('pci_compliance_log');
  await knex.schema.dropTableIfExists('token_vault');
  await knex.schema.dropTableIfExists('audit_trail');

  console.log('PCI-DSS compliance tables dropped');
};
