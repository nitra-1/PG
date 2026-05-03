/**
 * Outbox Worker Hardening
 *
 * Adds explicit processing start tracking so crashed workers can be detected
 * and recovered without losing financial side effects.
 */

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('outbox_events');
  if (!exists) {
    return;
  }

  const hasProcessingStartedAt = await knex.schema.hasColumn('outbox_events', 'processing_started_at');
  if (!hasProcessingStartedAt) {
    await knex.schema.table('outbox_events', function(table) {
      table.timestamp('processing_started_at').index();
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_outbox_processing_timeout
      ON outbox_events (tenant_id, status, processing_started_at);
  `);
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('outbox_events');
  if (!exists) {
    return;
  }

  await knex.raw('DROP INDEX IF EXISTS idx_outbox_processing_timeout;');
  const hasProcessingStartedAt = await knex.schema.hasColumn('outbox_events', 'processing_started_at');
  if (hasProcessingStartedAt) {
    await knex.schema.table('outbox_events', function(table) {
      table.dropColumn('processing_started_at');
    });
  }
};
