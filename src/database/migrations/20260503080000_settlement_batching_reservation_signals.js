const BATCH_STATUSES = [
  'DRAFT',
  'ELIGIBILITY_CHECKED',
  'RESERVED',
  'RESERVATION_FAILED',
  'CANCELLED',
  'EXPIRED',
  'READY_FOR_PAYOUT',
  'PAYOUT_CREATED',
  'FAILED'
];

const ITEM_STATUSES = [
  'CANDIDATE',
  'ELIGIBLE',
  'INELIGIBLE',
  'RESERVED',
  'RELEASED',
  'SETTLED',
  'CANCELLED'
];

const ELIGIBILITY_STATUSES = ['PASSED', 'FAILED', 'PENDING'];
const RESERVATION_STATUSES = ['ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED', 'FAILED'];
const SIGNAL_TYPES = [
  'SETTLEMENT_DELAYED_BEYOND_SLA',
  'SETTLEMENT_ELIGIBILITY_FAILED',
  'INSUFFICIENT_ESCROW_FOR_SETTLEMENT',
  'INSUFFICIENT_MERCHANT_PAYABLE',
  'PAYABLE_RESERVED_TWICE_ATTEMPTED',
  'RESERVATION_EXPIRED',
  'RESERVATION_RELEASED',
  'SETTLEMENT_BATCH_CANCELLED',
  'SETTLEMENT_AMOUNT_MISMATCH',
  'SETTLEMENT_BLOCKED_BY_RECONCILIATION_EXCEPTION',
  'SETTLEMENT_BLOCKED_BY_REFUND_OR_DISPUTE',
  'SETTLEMENT_READY_FOR_PAYOUT'
];
const SIGNAL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SIGNAL_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED'];
const SIGNAL_SOURCE_TYPES = [
  'SETTLEMENT_BATCH',
  'SETTLEMENT_ITEM',
  'FUND_RESERVATION',
  'ELIGIBILITY_ENGINE',
  'LEDGER_VALIDATION',
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

async function addCheckIfMissing(knex, tableName, constraintName, checkSql) {
  if (!(await tableExists(knex, tableName))) return;
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${checkSql})`);
}

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  if (!(await tableExists(knex, tableName))) return;
  if (await columnExists(knex, tableName, columnName)) return;
  await knex.schema.table(tableName, addColumn);
}

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (!(await tableExists(knex, 'settlement_batches'))) {
    await knex.schema.createTable('settlement_batches', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('batch_ref', 120).notNullable();
      table.uuid('merchant_id').nullable().references('id').inTable('merchants').onDelete('RESTRICT').index();
      table.uuid('beneficiary_id').nullable().references('id').inTable('beneficiaries').onDelete('RESTRICT').index();
      table.uuid('bank_account_id').nullable().index();
      table.timestamp('settlement_cycle_start').nullable();
      table.timestamp('settlement_cycle_end').nullable();
      table.date('scheduled_settlement_date').nullable().index();
      table.enum('batch_status', BATCH_STATUSES).notNullable().defaultTo('DRAFT').index();
      table.decimal('gross_payable_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_fee_deduction', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_tax_deduction', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_adjustment_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('net_settlement_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('reserved_amount', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.integer('item_count').notNullable().defaultTo(0);
      table.integer('eligible_item_count').notNullable().defaultTo(0);
      table.integer('ineligible_item_count').notNullable().defaultTo(0);
      table.timestamp('reservation_expires_at').nullable();
      table.timestamp('reserved_at').nullable();
      table.string('reserved_by', 100).nullable();
      table.timestamp('cancelled_at').nullable();
      table.string('cancelled_by', 100).nullable();
      table.text('cancellation_reason').nullable();
      table.uuid('payout_instruction_id').nullable().references('id').inTable('payout_instructions').onDelete('RESTRICT').index();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.unique(['tenant_id', 'batch_ref'], {
        indexName: 'uq_settlement_batches_tenant_ref'
      });
      table.index(['tenant_id', 'merchant_id'], 'idx_settlement_batches_tenant_merchant');
      table.index(['tenant_id', 'batch_status'], 'idx_settlement_batches_tenant_status');
      table.index(['tenant_id', 'scheduled_settlement_date'], 'idx_settlement_batches_tenant_schedule');
      table.index(['tenant_id', 'created_at'], 'idx_settlement_batches_tenant_created');
    });
  }

  if (!(await tableExists(knex, 'settlement_items'))) {
    await knex.schema.createTable('settlement_items', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('batch_id').notNullable().references('id').inTable('settlement_batches').onDelete('RESTRICT').index();
      table.uuid('transaction_id').nullable().references('id').inTable('transactions').onDelete('RESTRICT').index();
      table.string('transaction_ref', 100).notNullable().index();
      table.uuid('merchant_id').nullable().index();
      table.uuid('ledger_transaction_id').nullable().references('id').inTable('ledger_transactions').onDelete('RESTRICT').index();
      table.uuid('gateway_settlement_line_id').nullable().references('id').inTable('gateway_settlement_lines').onDelete('RESTRICT').index();
      table.enum('item_status', ITEM_STATUSES).notNullable().defaultTo('CANDIDATE').index();
      table.enum('eligibility_status', ELIGIBILITY_STATUSES).notNullable().defaultTo('PENDING').index();
      table.text('eligibility_reason').nullable();
      table.jsonb('eligibility_details').notNullable().defaultTo('{}');
      table.decimal('gross_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('fee_deduction', 15, 2).notNullable().defaultTo(0);
      table.decimal('tax_deduction', 15, 2).notNullable().defaultTo(0);
      table.decimal('adjustment_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('net_amount', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.decimal('reserved_amount', 15, 2).notNullable().defaultTo(0);
      table.timestamp('reserved_at').nullable();
      table.timestamp('released_at').nullable();
      table.text('release_reason').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.index(['tenant_id', 'batch_id'], 'idx_settlement_items_tenant_batch');
      table.index(['tenant_id', 'merchant_id'], 'idx_settlement_items_tenant_merchant');
      table.index(['tenant_id', 'transaction_ref'], 'idx_settlement_items_tenant_tx_ref');
      table.index(['tenant_id', 'item_status'], 'idx_settlement_items_tenant_item_status');
      table.index(['tenant_id', 'eligibility_status'], 'idx_settlement_items_tenant_eligibility');
    });
  }

  if (!(await tableExists(knex, 'settlement_fund_reservations'))) {
    await knex.schema.createTable('settlement_fund_reservations', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('reservation_ref', 120).notNullable();
      table.uuid('batch_id').notNullable().references('id').inTable('settlement_batches').onDelete('RESTRICT').index();
      table.uuid('merchant_id').nullable().index();
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.enum('reservation_status', RESERVATION_STATUSES).notNullable().defaultTo('ACTIVE').index();
      table.decimal('reserved_amount', 15, 2).notNullable();
      table.decimal('available_escrow_amount', 15, 2).nullable();
      table.decimal('available_merchant_payable_amount', 15, 2).nullable();
      table.timestamp('reserved_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at').nullable().index();
      table.timestamp('released_at').nullable();
      table.timestamp('consumed_at').nullable();
      table.text('failure_reason').nullable();
      table.string('idempotency_key', 255).notNullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.unique(['tenant_id', 'reservation_ref'], {
        indexName: 'uq_settlement_reservations_tenant_ref'
      });
      table.unique(['tenant_id', 'idempotency_key'], {
        indexName: 'uq_settlement_reservations_tenant_idempotency'
      });
      table.index(['tenant_id', 'batch_id'], 'idx_settlement_reservations_tenant_batch');
      table.index(['tenant_id', 'merchant_id'], 'idx_settlement_reservations_tenant_merchant');
      table.index(['tenant_id', 'reservation_status'], 'idx_settlement_reservations_tenant_status');
      table.index(['tenant_id', 'expires_at'], 'idx_settlement_reservations_tenant_expires');
    });
  }

  if (!(await tableExists(knex, 'settlement_signals'))) {
    await knex.schema.createTable('settlement_signals', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.enum('signal_type', SIGNAL_TYPES).notNullable().index();
      table.enum('severity', SIGNAL_SEVERITIES).notNullable().index();
      table.enum('signal_status', SIGNAL_STATUSES).notNullable().defaultTo('OPEN').index();
      table.enum('source_type', SIGNAL_SOURCE_TYPES).notNullable().index();
      table.uuid('source_id').nullable();
      table.uuid('batch_id').nullable().references('id').inTable('settlement_batches').onDelete('RESTRICT').index();
      table.uuid('item_id').nullable().references('id').inTable('settlement_items').onDelete('RESTRICT').index();
      table.uuid('reservation_id').nullable().references('id').inTable('settlement_fund_reservations').onDelete('RESTRICT').index();
      table.uuid('merchant_id').nullable().index();
      table.string('transaction_ref', 100).nullable().index();
      table.decimal('impact_amount', 15, 2).nullable();
      table.string('currency', 3).nullable();
      table.text('description').notNullable();
      table.text('suggested_action').nullable();
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.index(['tenant_id', 'signal_type'], 'idx_settlement_signals_tenant_type');
      table.index(['tenant_id', 'severity'], 'idx_settlement_signals_tenant_severity');
      table.index(['tenant_id', 'signal_status'], 'idx_settlement_signals_tenant_status');
      table.index(['tenant_id', 'batch_id'], 'idx_settlement_signals_tenant_batch');
      table.index(['tenant_id', 'merchant_id'], 'idx_settlement_signals_tenant_merchant');
      table.index(['tenant_id', 'transaction_ref'], 'idx_settlement_signals_tenant_tx_ref');
      table.index(['tenant_id', 'created_at'], 'idx_settlement_signals_tenant_created');
    });
  }

  await addColumnIfMissing(knex, 'settlement_batches', 'payout_instruction_id', table => {
    table.uuid('payout_instruction_id').nullable().references('id').inTable('payout_instructions').onDelete('RESTRICT').index();
  });

  await addCheckIfMissing(
    knex,
    'settlement_batches',
    'chk_settlement_batches_amounts_nonnegative',
    `
      gross_payable_amount >= 0
      AND total_fee_deduction >= 0
      AND total_tax_deduction >= 0
      AND net_settlement_amount >= 0
      AND reserved_amount >= 0
      AND item_count >= 0
      AND eligible_item_count >= 0
      AND ineligible_item_count >= 0
    `
  );
  await addCheckIfMissing(
    knex,
    'settlement_items',
    'chk_settlement_items_amounts_nonnegative',
    `
      gross_amount >= 0
      AND fee_deduction >= 0
      AND tax_deduction >= 0
      AND net_amount >= 0
      AND reserved_amount >= 0
    `
  );
  await addCheckIfMissing(
    knex,
    'settlement_fund_reservations',
    'chk_settlement_reservations_reserved_positive',
    'reserved_amount > 0'
  );
  await addCheckIfMissing(
    knex,
    'settlement_signals',
    'chk_settlement_signals_impact_nonnegative',
    '(impact_amount IS NULL OR impact_amount >= 0)'
  );

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_items_active_transaction
      ON settlement_items (tenant_id, transaction_ref)
      WHERE item_status IN ('RESERVED', 'SETTLED');

    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_signals_source
      ON settlement_signals (tenant_id, signal_type, source_type, source_id)
      WHERE source_id IS NOT NULL;
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS uq_settlement_signals_source;
    DROP INDEX IF EXISTS uq_settlement_items_active_transaction;
  `);

  await knex.schema.dropTableIfExists('settlement_signals');
  await knex.schema.dropTableIfExists('settlement_fund_reservations');
  await knex.schema.dropTableIfExists('settlement_items');
  await knex.schema.dropTableIfExists('settlement_batches');
};
