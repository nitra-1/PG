const WEBHOOK_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'SKIPPED_TEST_MODE'];
const WEBHOOK_PROCESSING_STATUSES = [
  'RECEIVED',
  'VERIFIED',
  'DUPLICATE',
  'REPLAY_REJECTED',
  'OUT_OF_ORDER',
  'PROCESSED',
  'IGNORED',
  'FAILED',
  'DLQ'
];
const SIGNAL_TYPES = [
  'WEBHOOK_SIGNATURE_FAILED',
  'WEBHOOK_REPLAY_DETECTED',
  'DUPLICATE_GATEWAY_EVENT',
  'OUT_OF_ORDER_PAYMENT_EVENT',
  'LATE_PAYMENT_SUCCESS',
  'GATEWAY_STATUS_CONFLICT',
  'PAYMENT_AMOUNT_MISMATCH',
  'PAYMENT_CURRENCY_MISMATCH',
  'PAYMENT_WITHOUT_ORDER',
  'PAYMENT_WITHOUT_LEDGER',
  'SUSPICIOUS_WEBHOOK_ATTEMPT'
];
const SIGNAL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SIGNAL_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED'];
const SIGNAL_SOURCE_TYPES = ['WEBHOOK', 'PAYMENT_STATE_MACHINE', 'GATEWAY_VERIFICATION', 'RECONCILIATION'];

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function columnExists(knex, tableName, columnName) {
  if (!(await tableExists(knex, tableName))) return false;
  return knex.schema.hasColumn(tableName, columnName);
}

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (!(await columnExists(knex, tableName, columnName))) {
    await knex.schema.table(tableName, addColumn);
  }
}

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (!(await tableExists(knex, 'gateway_webhook_events'))) {
    await knex.schema.createTable('gateway_webhook_events', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('gateway_name', 80).notNullable().index();
      table.string('gateway_event_id', 255);
      table.string('gateway_event_type', 150).notNullable();
      table.string('gateway_payment_id', 255);
      table.string('gateway_order_id', 255);
      table.string('transaction_ref', 100);
      table.string('order_id', 100);
      table.jsonb('raw_payload').notNullable().defaultTo('{}');
      table.jsonb('raw_headers').notNullable().defaultTo('{}');
      table.string('payload_hash', 128).notNullable();
      table.string('signature_header', 500);
      table.boolean('signature_verified').notNullable().defaultTo(false);
      table.enum('verification_status', WEBHOOK_VERIFICATION_STATUSES).notNullable().defaultTo('PENDING').index();
      table.timestamp('event_created_at');
      table.timestamp('received_at').notNullable().defaultTo(knex.fn.now()).index();
      table.timestamp('processed_at');
      table.enum('processing_status', WEBHOOK_PROCESSING_STATUSES).notNullable().defaultTo('RECEIVED').index();
      table.text('failure_reason');
      table.integer('retry_count').notNullable().defaultTo(0);
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'gateway_name'], 'idx_gateway_webhooks_tenant_gateway');
      table.index(['tenant_id', 'gateway_payment_id'], 'idx_gateway_webhooks_payment');
      table.index(['tenant_id', 'gateway_order_id'], 'idx_gateway_webhooks_gateway_order');
      table.index(['tenant_id', 'transaction_ref'], 'idx_gateway_webhooks_transaction_ref');
      table.index(['tenant_id', 'processing_status'], 'idx_gateway_webhooks_processing_status');
      table.index(['tenant_id', 'verification_status'], 'idx_gateway_webhooks_verification_status');
      table.index(['tenant_id', 'received_at'], 'idx_gateway_webhooks_received_at');
    });
  } else {
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'tenant_id', table => table.uuid('tenant_id').index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'gateway_name', table => table.string('gateway_name', 80).index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'gateway_event_id', table => table.string('gateway_event_id', 255));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'gateway_event_type', table => table.string('gateway_event_type', 150));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'gateway_payment_id', table => table.string('gateway_payment_id', 255));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'gateway_order_id', table => table.string('gateway_order_id', 255));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'transaction_ref', table => table.string('transaction_ref', 100));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'order_id', table => table.string('order_id', 100));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'raw_payload', table => table.jsonb('raw_payload').notNullable().defaultTo('{}'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'raw_headers', table => table.jsonb('raw_headers').notNullable().defaultTo('{}'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'payload_hash', table => table.string('payload_hash', 128));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'signature_header', table => table.string('signature_header', 500));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'signature_verified', table => table.boolean('signature_verified').notNullable().defaultTo(false));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'verification_status', table => table.enum('verification_status', WEBHOOK_VERIFICATION_STATUSES).notNullable().defaultTo('PENDING').index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'event_created_at', table => table.timestamp('event_created_at'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'received_at', table => table.timestamp('received_at').defaultTo(knex.fn.now()).index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'processed_at', table => table.timestamp('processed_at'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'processing_status', table => table.enum('processing_status', WEBHOOK_PROCESSING_STATUSES).notNullable().defaultTo('RECEIVED').index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'failure_reason', table => table.text('failure_reason'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'retry_count', table => table.integer('retry_count').notNullable().defaultTo(0));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'correlation_id', table => table.uuid('correlation_id').index());
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'metadata', table => table.jsonb('metadata').notNullable().defaultTo('{}'));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'created_at', table => table.timestamp('created_at').defaultTo(knex.fn.now()));
    await addColumnIfMissing(knex, 'gateway_webhook_events', 'updated_at', table => table.timestamp('updated_at').defaultTo(knex.fn.now()));
  }

  if (!(await tableExists(knex, 'payment_state_transitions'))) {
    await knex.schema.createTable('payment_state_transitions', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('transaction_id');
      table.string('transaction_ref', 100).notNullable();
      table.string('gateway_name', 80);
      table.string('gateway_payment_id', 255);
      table.string('previous_status', 50).notNullable();
      table.string('new_status', 50).notNullable();
      table.string('transition_reason', 150).notNullable();
      table.string('gateway_event_id', 255);
      table.uuid('webhook_event_id');
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'transaction_ref'], 'idx_payment_transitions_transaction_ref');
      table.index(['tenant_id', 'gateway_payment_id'], 'idx_payment_transitions_gateway_payment');
      table.index(['tenant_id', 'webhook_event_id'], 'idx_payment_transitions_webhook_event');
      table.index(['tenant_id', 'created_at'], 'idx_payment_transitions_created_at');
    });
  }

  if (!(await tableExists(knex, 'payment_signals'))) {
    await knex.schema.createTable('payment_signals', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.enum('signal_type', SIGNAL_TYPES).notNullable().index();
      table.enum('severity', SIGNAL_SEVERITIES).notNullable().index();
      table.enum('signal_status', SIGNAL_STATUSES).notNullable().defaultTo('OPEN').index();
      table.enum('source_type', SIGNAL_SOURCE_TYPES).notNullable().index();
      table.uuid('source_id');
      table.uuid('transaction_id');
      table.string('transaction_ref', 100);
      table.string('gateway_name', 80);
      table.string('gateway_payment_id', 255);
      table.string('gateway_event_id', 255);
      table.decimal('impact_amount', 15, 2);
      table.string('currency', 3);
      table.text('description').notNullable();
      table.text('suggested_action');
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'signal_type'], 'idx_payment_signals_tenant_type');
      table.index(['tenant_id', 'severity'], 'idx_payment_signals_tenant_severity');
      table.index(['tenant_id', 'signal_status'], 'idx_payment_signals_tenant_status');
      table.index(['tenant_id', 'transaction_ref'], 'idx_payment_signals_transaction_ref');
      table.index(['tenant_id', 'gateway_payment_id'], 'idx_payment_signals_gateway_payment');
      table.index(['tenant_id', 'created_at'], 'idx_payment_signals_created_at');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_webhook_event_id
      ON gateway_webhook_events (tenant_id, gateway_name, gateway_event_id)
      WHERE gateway_event_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_webhook_payload_hash_without_event_id
      ON gateway_webhook_events (tenant_id, gateway_name, payload_hash)
      WHERE gateway_event_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_signals_source
      ON payment_signals (tenant_id, signal_type, source_type, source_id)
      WHERE source_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_gateway_name
      ON gateway_webhook_events (gateway_name);
    CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_gateway_payment_id
      ON gateway_webhook_events (gateway_payment_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_gateway_order_id
      ON gateway_webhook_events (gateway_order_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_processing_status
      ON gateway_webhook_events (processing_status);
    CREATE INDEX IF NOT EXISTS idx_gateway_webhooks_received_at
      ON gateway_webhook_events (received_at);
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_gateway_webhooks_received_at;
    DROP INDEX IF EXISTS idx_gateway_webhooks_processing_status;
    DROP INDEX IF EXISTS idx_gateway_webhooks_gateway_order_id;
    DROP INDEX IF EXISTS idx_gateway_webhooks_gateway_payment_id;
    DROP INDEX IF EXISTS idx_gateway_webhooks_gateway_name;
    DROP INDEX IF EXISTS uq_payment_signals_source;
    DROP INDEX IF EXISTS uq_gateway_webhook_payload_hash_without_event_id;
    DROP INDEX IF EXISTS uq_gateway_webhook_event_id;
  `);

  await knex.schema.dropTableIfExists('payment_signals');
  await knex.schema.dropTableIfExists('payment_state_transitions');
  await knex.schema.dropTableIfExists('gateway_webhook_events');
};
