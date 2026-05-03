const SOURCE_TYPES = ['TRANSACTION_LEDGER', 'LEDGER_SETTLEMENT', 'BANK_SETTLEMENT'];
const CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'PENDING_APPROVAL',
  'RESOLVED',
  'IGNORED',
  'ESCALATED',
  'REOPENED',
  'CLOSED'
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const RESOLUTION_TYPES = [
  'MATCH_CONFIRMED',
  'ACCEPTED_DIFFERENCE',
  'DUPLICATE_CONFIRMED',
  'BANK_DELAY_CONFIRMED',
  'MANUAL_REVIEW_COMPLETED',
  'IGNORE_WITH_REASON',
  'ESCALATED_TO_FINANCE',
  'ESCALATED_TO_BANK',
  'CORRECTION_REQUIRED',
  'WRITE_OFF_RECOMMENDED'
];
const COMMENT_TYPES = [
  'NOTE',
  'INVESTIGATION',
  'BANK_FEEDBACK',
  'MERCHANT_FEEDBACK',
  'INTERNAL_DECISION',
  'APPROVAL_NOTE'
];
const ACTION_TYPES = [
  'CASE_OPENED',
  'CASE_ASSIGNED',
  'CASE_UNASSIGNED',
  'STATUS_CHANGED',
  'COMMENT_ADDED',
  'ESCALATED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'RESOLVED',
  'IGNORED',
  'REOPENED',
  'CLOSED'
];

exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('reconciliation_exception_cases'))) {
    await knex.schema.createTable('reconciliation_exception_cases', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.enum('source_type', SOURCE_TYPES).notNullable();
      table.uuid('source_reconciliation_id').notNullable();
      table.string('source_status', 100).notNullable();
      table.enum('case_status', CASE_STATUSES).notNullable().defaultTo('OPEN').index();
      table.enum('severity', SEVERITIES).notNullable().defaultTo('MEDIUM').index();
      table.enum('priority', PRIORITIES).notNullable().defaultTo('NORMAL').index();
      table.string('assigned_to', 100).nullable().index();
      table.string('assigned_by', 100).nullable();
      table.timestamp('assigned_at').nullable();
      table.string('opened_by', 100).nullable();
      table.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
      table.string('resolved_by', 100).nullable();
      table.timestamp('resolved_at').nullable();
      table.enum('resolution_type', RESOLUTION_TYPES).nullable();
      table.text('resolution_reason').nullable();
      table.text('resolution_notes').nullable();
      table.boolean('approval_required').notNullable().defaultTo(false);
      table.uuid('approval_request_id').nullable().index();
      table.timestamp('last_action_at').notNullable().defaultTo(knex.fn.now()).index();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.unique(['tenant_id', 'source_type', 'source_reconciliation_id'], {
        indexName: 'uq_recon_exception_source'
      });
      table.index(['tenant_id', 'case_status'], 'idx_recon_exception_tenant_status');
      table.index(['tenant_id', 'severity'], 'idx_recon_exception_tenant_severity');
      table.index(['tenant_id', 'priority'], 'idx_recon_exception_tenant_priority');
      table.index(['tenant_id', 'assigned_to'], 'idx_recon_exception_tenant_assigned');
      table.index(['tenant_id', 'opened_at'], 'idx_recon_exception_tenant_opened');
      table.index(['tenant_id', 'last_action_at'], 'idx_recon_exception_tenant_last_action');
    });
  }

  if (!(await knex.schema.hasTable('reconciliation_exception_comments'))) {
    await knex.schema.createTable('reconciliation_exception_comments', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('case_id').notNullable().references('id').inTable('reconciliation_exception_cases').onDelete('CASCADE').index();
      table.text('comment_text').notNullable();
      table.enum('comment_type', COMMENT_TYPES).notNullable().defaultTo('NOTE');
      table.string('created_by', 100).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');

      table.index(['tenant_id', 'case_id'], 'idx_recon_exception_comments_case');
      table.index(['tenant_id', 'created_at'], 'idx_recon_exception_comments_created');
    });
  }

  if (!(await knex.schema.hasTable('reconciliation_exception_audit_events'))) {
    await knex.schema.createTable('reconciliation_exception_audit_events', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('case_id').notNullable().references('id').inTable('reconciliation_exception_cases').onDelete('CASCADE').index();
      table.enum('action_type', ACTION_TYPES).notNullable().index();
      table.string('previous_status', 50).nullable();
      table.string('new_status', 50).nullable();
      table.string('performed_by', 100).notNullable();
      table.timestamp('performed_at').notNullable().defaultTo(knex.fn.now()).index();
      table.text('reason').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');

      table.index(['tenant_id', 'case_id'], 'idx_recon_exception_audit_case');
      table.index(['tenant_id', 'action_type'], 'idx_recon_exception_audit_action');
      table.index(['tenant_id', 'performed_at'], 'idx_recon_exception_audit_performed');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('reconciliation_exception_audit_events');
  await knex.schema.dropTableIfExists('reconciliation_exception_comments');
  await knex.schema.dropTableIfExists('reconciliation_exception_cases');
};
