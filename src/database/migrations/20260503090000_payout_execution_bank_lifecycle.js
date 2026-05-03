const PAYOUT_STATUSES = [
  'CREATED',
  'READY',
  'SUBMITTED',
  'ACCEPTED',
  'QUEUED',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  'RETURNED',
  'REVERSED',
  'TIMEOUT',
  'CANCELLED'
];

const ATTEMPT_STATUSES = [
  'CREATED',
  'SUBMITTED',
  'ACCEPTED',
  'QUEUED',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'REJECTED',
  'TIMEOUT'
];

const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'SKIPPED_TEST_MODE'];
const PROCESSING_STATUSES = [
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
  'PAYOUT_DELAYED',
  'PAYOUT_TIMEOUT',
  'BANK_REJECTED_PAYOUT',
  'PAYOUT_FAILED',
  'PAYOUT_RETURNED',
  'PAYOUT_REVERSED',
  'DUPLICATE_PAYOUT_ATTEMPT',
  'UTR_DUPLICATE_DETECTED',
  'BANK_CONFIRMATION_MISSING',
  'PAYOUT_STATUS_CONFLICT',
  'PAYOUT_WITHOUT_RESERVATION',
  'PAYOUT_BLOCKED_BY_RECONCILIATION_EXCEPTION',
  'PAYOUT_PROVIDER_DOWNTIME',
  'PAYOUT_RETRY_REQUIRED',
  'PAYOUT_READY_FOR_BANK_SUBMISSION'
];
const SIGNAL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SIGNAL_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED'];
const SIGNAL_SOURCE_TYPES = [
  'PAYOUT_INSTRUCTION',
  'PAYOUT_ATTEMPT',
  'PROVIDER_EVENT',
  'RESERVATION',
  'BANK_VALIDATION',
  'RECONCILIATION'
];

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function columnExists(knex, tableName, columnName) {
  if (!(await tableExists(knex, tableName))) return false;
  return knex.schema.hasColumn(tableName, columnName);
}

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(`
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = ?
      AND constraint_name = ?
    LIMIT 1
  `, [tableName, constraintName]);
  return result.rows.length > 0;
}

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (!(await tableExists(knex, tableName))) return;
  if (await columnExists(knex, tableName, columnName)) return;
  await knex.schema.table(tableName, addColumn);
}

async function addCheckIfMissing(knex, tableName, constraintName, checkSql) {
  if (!(await tableExists(knex, tableName))) return;
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${checkSql})`);
}

async function assertNoOrphans(knex, { childTable, childColumn, parentTable, parentColumn = 'id' }) {
  if (!(await tableExists(knex, childTable)) || !(await tableExists(knex, parentTable))) return;
  if (!(await columnExists(knex, childTable, childColumn))) return;

  const result = await knex.raw(`
    SELECT c.id, c.${childColumn}
    FROM ${childTable} c
    LEFT JOIN ${parentTable} p ON p.${parentColumn} = c.${childColumn}
    WHERE c.${childColumn} IS NOT NULL
      AND p.${parentColumn} IS NULL
    LIMIT 10
  `);

  if (result.rows.length > 0) {
    const sample = result.rows.map(row => `${row.id}:${row[childColumn]}`).join(', ');
    throw new Error(`Cannot add FK ${childTable}.${childColumn} -> ${parentTable}.${parentColumn}; orphan rows exist: ${sample}`);
  }
}

async function replaceForeignKey(knex, options) {
  const { childTable, childColumn, parentTable, parentColumn = 'id', constraintName } = options;
  if (!(await tableExists(knex, childTable)) || !(await tableExists(knex, parentTable))) return;
  if (!(await columnExists(knex, childTable, childColumn))) return;
  await assertNoOrphans(knex, options);
  await knex.raw(`ALTER TABLE ${childTable} DROP CONSTRAINT IF EXISTS ${constraintName}`);
  await knex.raw(`
    ALTER TABLE ${childTable}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${childColumn})
      REFERENCES ${parentTable} (${parentColumn})
      ON DELETE RESTRICT
  `);
}

function quotedList(values) {
  return values.map(value => `'${value}'`).join(', ');
}

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (await tableExists(knex, 'payout_instructions')) {
    await knex.raw(`
      ALTER TABLE payout_instructions
        ALTER COLUMN settlement_id DROP NOT NULL,
        ALTER COLUMN settlement_ref DROP NOT NULL;
    `);

    await addColumnIfMissing(knex, 'payout_instructions', 'settlement_batch_id', table => table.uuid('settlement_batch_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'reservation_id', table => table.uuid('reservation_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'batch_ref', table => table.string('batch_ref', 120).nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'provider_name', table => table.string('provider_name', 80).nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'provider_payout_id', table => table.string('provider_payout_id', 255).nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'provider_status', table => table.string('provider_status', 80).nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'queued_at', table => table.timestamp('queued_at').nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'processing_at', table => table.timestamp('processing_at').nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'timeout_at', table => table.timestamp('timeout_at').nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'cancelled_at', table => table.timestamp('cancelled_at').nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'provider_status_reason', table => table.text('provider_status_reason').nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'max_retries', table => table.integer('max_retries').notNullable().defaultTo(3));
    await addColumnIfMissing(knex, 'payout_instructions', 'raw_callback_payload', table => table.jsonb('raw_callback_payload').notNullable().defaultTo('{}'));
    await addColumnIfMissing(knex, 'payout_instructions', 'outbox_event_id', table => table.uuid('outbox_event_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'ledger_transaction_id', table => table.uuid('ledger_transaction_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'metadata', table => table.jsonb('metadata').notNullable().defaultTo('{}'));

    await knex.raw(`
      ALTER TABLE payout_instructions
        DROP CONSTRAINT IF EXISTS payout_instructions_payout_status_check;

      ALTER TABLE payout_instructions
        ADD CONSTRAINT payout_instructions_payout_status_check
        CHECK (payout_status IN (${quotedList(PAYOUT_STATUSES)}));
    `);

    await replaceForeignKey(knex, {
      childTable: 'payout_instructions',
      childColumn: 'settlement_batch_id',
      parentTable: 'settlement_batches',
      constraintName: 'fk_payout_instruction_settlement_batch'
    });
    await replaceForeignKey(knex, {
      childTable: 'payout_instructions',
      childColumn: 'reservation_id',
      parentTable: 'settlement_fund_reservations',
      constraintName: 'fk_payout_instruction_reservation'
    });
    await replaceForeignKey(knex, {
      childTable: 'payout_instructions',
      childColumn: 'outbox_event_id',
      parentTable: 'outbox_events',
      constraintName: 'fk_payout_instruction_outbox_event'
    });
    await replaceForeignKey(knex, {
      childTable: 'payout_instructions',
      childColumn: 'ledger_transaction_id',
      parentTable: 'ledger_transactions',
      constraintName: 'fk_payout_instruction_ledger_transaction'
    });

    await addCheckIfMissing(
      knex,
      'payout_instructions',
      'chk_payout_instruction_amount_positive',
      'payout_amount > 0'
    );

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_provider_payout
        ON payout_instructions (tenant_id, provider_name, provider_payout_id)
        WHERE provider_payout_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_live_batch
        ON payout_instructions (tenant_id, settlement_batch_id)
        WHERE settlement_batch_id IS NOT NULL
          AND payout_status NOT IN ('FAILED', 'REJECTED', 'CANCELLED');

      CREATE INDEX IF NOT EXISTS idx_payout_instruction_tenant_batch
        ON payout_instructions (tenant_id, settlement_batch_id);
      CREATE INDEX IF NOT EXISTS idx_payout_instruction_tenant_reservation
        ON payout_instructions (tenant_id, reservation_id);
      CREATE INDEX IF NOT EXISTS idx_payout_instruction_tenant_provider
        ON payout_instructions (tenant_id, provider_name);
    `);
  }

  if (!(await tableExists(knex, 'payout_attempts'))) {
    await knex.schema.createTable('payout_attempts', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('payout_instruction_id').notNullable().references('id').inTable('payout_instructions').onDelete('RESTRICT').index();
      table.integer('attempt_number').notNullable();
      table.string('provider_name', 80).notNullable();
      table.string('bank_idempotency_key', 255).notNullable();
      table.jsonb('request_payload').notNullable().defaultTo('{}');
      table.jsonb('response_payload').nullable();
      table.string('provider_payout_id', 255).nullable().index();
      table.string('provider_status', 80).nullable();
      table.enum('attempt_status', ATTEMPT_STATUSES).notNullable().defaultTo('CREATED').index();
      table.text('failure_reason').nullable();
      table.timestamp('submitted_at').nullable();
      table.timestamp('completed_at').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.unique(['tenant_id', 'payout_instruction_id', 'attempt_number'], {
        indexName: 'uq_payout_attempt_instruction_number'
      });
      table.unique(['tenant_id', 'provider_name', 'bank_idempotency_key'], {
        indexName: 'uq_payout_attempt_provider_idempotency'
      });
      table.index(['tenant_id', 'attempt_status'], 'idx_payout_attempt_tenant_status');
      table.index(['tenant_id', 'created_at'], 'idx_payout_attempt_tenant_created');
    });
  }

  if (!(await tableExists(knex, 'payout_provider_events'))) {
    await knex.schema.createTable('payout_provider_events', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('provider_name', 80).notNullable().index();
      table.string('provider_event_id', 255).nullable();
      table.string('provider_event_type', 100).notNullable();
      table.string('provider_payout_id', 255).nullable().index();
      table.string('bank_idempotency_key', 255).nullable().index();
      table.uuid('payout_instruction_id').nullable().references('id').inTable('payout_instructions').onDelete('RESTRICT').index();
      table.jsonb('raw_payload').notNullable().defaultTo('{}');
      table.jsonb('raw_headers').notNullable().defaultTo('{}');
      table.string('payload_hash', 128).notNullable();
      table.string('signature_header', 500).nullable();
      table.boolean('signature_verified').notNullable().defaultTo(false);
      table.enum('verification_status', VERIFICATION_STATUSES).notNullable().defaultTo('PENDING').index();
      table.timestamp('event_created_at').nullable();
      table.timestamp('received_at').notNullable().defaultTo(knex.fn.now()).index();
      table.timestamp('processed_at').nullable();
      table.enum('processing_status', PROCESSING_STATUSES).notNullable().defaultTo('RECEIVED').index();
      table.text('failure_reason').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.index(['tenant_id', 'provider_name'], 'idx_payout_provider_events_tenant_provider');
      table.index(['tenant_id', 'provider_payout_id'], 'idx_payout_provider_events_tenant_payout');
      table.index(['tenant_id', 'bank_idempotency_key'], 'idx_payout_provider_events_tenant_key');
      table.index(['tenant_id', 'processing_status'], 'idx_payout_provider_events_tenant_status');
      table.index(['tenant_id', 'received_at'], 'idx_payout_provider_events_tenant_received');
    });

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_provider_event_id
        ON payout_provider_events (tenant_id, provider_name, provider_event_id)
        WHERE provider_event_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_provider_event_payload_hash
        ON payout_provider_events (tenant_id, provider_name, payload_hash)
        WHERE provider_event_id IS NULL;
    `);
  }

  if (!(await tableExists(knex, 'payout_signals'))) {
    await knex.schema.createTable('payout_signals', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.enum('signal_type', SIGNAL_TYPES).notNullable().index();
      table.enum('severity', SIGNAL_SEVERITIES).notNullable().index();
      table.enum('signal_status', SIGNAL_STATUSES).notNullable().defaultTo('OPEN').index();
      table.enum('source_type', SIGNAL_SOURCE_TYPES).notNullable().index();
      table.uuid('source_id').nullable();
      table.uuid('payout_instruction_id').nullable().references('id').inTable('payout_instructions').onDelete('RESTRICT').index();
      table.uuid('payout_attempt_id').nullable().references('id').inTable('payout_attempts').onDelete('RESTRICT').index();
      table.uuid('provider_event_id').nullable().references('id').inTable('payout_provider_events').onDelete('RESTRICT').index();
      table.uuid('settlement_batch_id').nullable().references('id').inTable('settlement_batches').onDelete('RESTRICT').index();
      table.uuid('reservation_id').nullable().references('id').inTable('settlement_fund_reservations').onDelete('RESTRICT').index();
      table.uuid('merchant_id').nullable().index();
      table.decimal('impact_amount', 15, 2).nullable();
      table.string('currency', 3).nullable();
      table.text('description').notNullable();
      table.text('suggested_action').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.index(['tenant_id', 'signal_type'], 'idx_payout_signals_tenant_type');
      table.index(['tenant_id', 'severity'], 'idx_payout_signals_tenant_severity');
      table.index(['tenant_id', 'signal_status'], 'idx_payout_signals_tenant_status');
      table.index(['tenant_id', 'payout_instruction_id'], 'idx_payout_signals_tenant_instruction');
      table.index(['tenant_id', 'settlement_batch_id'], 'idx_payout_signals_tenant_batch');
      table.index(['tenant_id', 'merchant_id'], 'idx_payout_signals_tenant_merchant');
      table.index(['tenant_id', 'created_at'], 'idx_payout_signals_tenant_created');
    });

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_signals_source
        ON payout_signals (tenant_id, signal_type, source_type, source_id)
        WHERE source_id IS NOT NULL;
    `);
  }

  await addCheckIfMissing(
    knex,
    'payout_signals',
    'chk_payout_signals_impact_nonnegative',
    '(impact_amount IS NULL OR impact_amount >= 0)'
  );
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS uq_payout_signals_source;
    DROP INDEX IF EXISTS uq_payout_provider_event_payload_hash;
    DROP INDEX IF EXISTS uq_payout_provider_event_id;
    DROP INDEX IF EXISTS uq_payout_instruction_live_batch;
    DROP INDEX IF EXISTS uq_payout_instruction_tenant_provider_payout;
  `);

  await knex.schema.dropTableIfExists('payout_signals');
  await knex.schema.dropTableIfExists('payout_provider_events');
  await knex.schema.dropTableIfExists('payout_attempts');
};
