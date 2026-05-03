/**
 * Sprint 1 Outbox Events
 *
 * Durable event storage for financial side effects.
 */

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('outbox_events');

  if (!exists) {
    await knex.schema.createTable('outbox_events', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('aggregate_type', 100).notNullable();
      table.string('aggregate_id', 100).notNullable();
      table.string('event_type', 150).notNullable();
      table.integer('event_version').notNullable().defaultTo(1);
      table.string('idempotency_key', 255).notNullable();
      table.uuid('correlation_id').index();
      table.jsonb('payload').notNullable();
      table.enum('status', ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DLQ'])
        .notNullable()
        .defaultTo('PENDING')
        .index();
      table.integer('retry_count').notNullable().defaultTo(0);
      table.integer('max_retries').notNullable().defaultTo(3);
      table.timestamp('next_retry_at').index();
      table.text('last_error');
      table.timestamp('locked_until').index();
      table.timestamp('processing_started_at').index();
      table.timestamp('processed_at');
      table.timestamp('dlq_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique(['tenant_id', 'event_type', 'idempotency_key'], {
        indexName: 'uq_outbox_tenant_event_idempotency'
      });
      table.index(['tenant_id', 'status', 'next_retry_at'], 'idx_outbox_dispatch');
      table.index(['tenant_id', 'aggregate_type', 'aggregate_id'], 'idx_outbox_aggregate');
    });

    return;
  }

  const requiredColumns = [
    ['tenant_id', (table) => table.uuid('tenant_id').index()],
    ['aggregate_type', (table) => table.string('aggregate_type', 100)],
    ['aggregate_id', (table) => table.string('aggregate_id', 100)],
    ['event_type', (table) => table.string('event_type', 150)],
    ['event_version', (table) => table.integer('event_version').notNullable().defaultTo(1)],
    ['idempotency_key', (table) => table.string('idempotency_key', 255)],
    ['correlation_id', (table) => table.uuid('correlation_id').index()],
    ['payload', (table) => table.jsonb('payload')],
    ['status', (table) => table.enum('status', ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DLQ']).notNullable().defaultTo('PENDING').index()],
    ['retry_count', (table) => table.integer('retry_count').notNullable().defaultTo(0)],
    ['max_retries', (table) => table.integer('max_retries').notNullable().defaultTo(3)],
    ['next_retry_at', (table) => table.timestamp('next_retry_at').index()],
    ['last_error', (table) => table.text('last_error')],
    ['locked_until', (table) => table.timestamp('locked_until').index()],
    ['processing_started_at', (table) => table.timestamp('processing_started_at').index()],
    ['processed_at', (table) => table.timestamp('processed_at')],
    ['dlq_at', (table) => table.timestamp('dlq_at')],
    ['created_at', (table) => table.timestamp('created_at').defaultTo(knex.fn.now())],
    ['updated_at', (table) => table.timestamp('updated_at').defaultTo(knex.fn.now())]
  ];

  for (const [columnName, addColumn] of requiredColumns) {
    const hasColumn = await knex.schema.hasColumn('outbox_events', columnName);
    if (!hasColumn) {
      await knex.schema.table('outbox_events', addColumn);
    }
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_tenant_event_idempotency
      ON outbox_events (tenant_id, event_type, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_outbox_dispatch
      ON outbox_events (tenant_id, status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
      ON outbox_events (tenant_id, aggregate_type, aggregate_id);
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('outbox_events');
};
