const SOURCE_TYPES = ['CSV_UPLOAD', 'API_FEED', 'MANUAL_UPLOAD', 'GATEWAY_WEBHOOK'];
const IMPORT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'COMPLETED_WITH_ERRORS'];
const LINE_TYPES = ['PAYMENT', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT', 'FEE', 'TAX', 'OTHER'];
const LINE_RECON_STATUSES = [
  'UNMATCHED',
  'MATCHED',
  'AMOUNT_MISMATCH',
  'FEE_MISMATCH',
  'GST_MISMATCH',
  'NET_MISMATCH',
  'MISSING_TRANSACTION',
  'DUPLICATE_LINE',
  'IGNORED',
  'FAILED'
];
const SIGNAL_TYPES = [
  'GATEWAY_SETTLEMENT_DELAYED',
  'GATEWAY_FEE_MISMATCH',
  'GST_MISMATCH',
  'NET_SETTLEMENT_MISMATCH',
  'MISSING_GATEWAY_SETTLEMENT_LINE',
  'UNEXPECTED_GATEWAY_DEDUCTION',
  'ESCROW_NOT_CREDITED',
  'DUPLICATE_GATEWAY_SETTLEMENT_LINE',
  'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH',
  'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT',
  'PRICING_RULE_MISSING',
  'MDR_DEVIATION',
  'GST_CALCULATION_DEVIATION'
];
const SIGNAL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SIGNAL_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED'];
const SIGNAL_SOURCE_TYPES = [
  'GATEWAY_SETTLEMENT_BATCH',
  'GATEWAY_SETTLEMENT_LINE',
  'PRICING_VALIDATION',
  'LEDGER_VALIDATION',
  'RECONCILIATION'
];
const RULE_TYPES = ['MDR_PERCENTAGE', 'FIXED_FEE', 'MIXED'];
const RULE_STATUSES = ['ACTIVE', 'INACTIVE'];

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
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

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (!(await tableExists(knex, 'gateway_settlement_batches'))) {
    await knex.schema.createTable('gateway_settlement_batches', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('gateway_name', 80).notNullable().index();
      table.string('gateway_settlement_id', 255);
      table.timestamp('settlement_cycle_start');
      table.timestamp('settlement_cycle_end');
      table.date('expected_settlement_date');
      table.date('actual_settlement_date').index();
      table.string('settlement_utr', 255).index();
      table.string('bank_reference_number', 255);
      table.enum('source_type', SOURCE_TYPES).notNullable();
      table.string('source_filename', 500);
      table.string('source_reference', 500);
      table.enum('import_status', IMPORT_STATUSES).notNullable().defaultTo('PENDING').index();
      table.integer('total_lines').notNullable().defaultTo(0);
      table.integer('imported_lines').notNullable().defaultTo(0);
      table.integer('duplicate_lines').notNullable().defaultTo(0);
      table.integer('failed_lines').notNullable().defaultTo(0);
      table.decimal('gross_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_gateway_fee', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_gst_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('total_adjustment_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('net_settlement_amount', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.jsonb('raw_payload').notNullable().defaultTo('{}');
      table.text('error_message');
      table.string('imported_by', 100);
      table.timestamp('imported_at');
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now()).index();
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'gateway_name'], 'idx_gateway_setl_batches_tenant_gateway');
      table.index(['tenant_id', 'import_status'], 'idx_gateway_setl_batches_tenant_status');
      table.index(['tenant_id', 'actual_settlement_date'], 'idx_gateway_setl_batches_tenant_actual_date');
    });
  }

  if (!(await tableExists(knex, 'gateway_settlement_lines'))) {
    await knex.schema.createTable('gateway_settlement_lines', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('batch_id').notNullable().references('id').inTable('gateway_settlement_batches').onDelete('RESTRICT').index();
      table.string('gateway_name', 80).notNullable().index();
      table.string('gateway_settlement_id', 255);
      table.string('gateway_settlement_line_id', 255);
      table.uuid('transaction_id').references('id').inTable('transactions').onDelete('RESTRICT').index();
      table.string('transaction_ref', 100).index();
      table.string('gateway_transaction_id', 255).index();
      table.string('gateway_payment_id', 255).index();
      table.string('order_id', 100);
      table.uuid('merchant_id');
      table.enum('line_type', LINE_TYPES).notNullable().defaultTo('PAYMENT').index();
      table.string('gateway_status', 100);
      table.timestamp('transaction_date');
      table.timestamp('captured_at');
      table.timestamp('settled_at').index();
      table.decimal('gross_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('gateway_fee', 15, 2).notNullable().defaultTo(0);
      table.decimal('gst_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('adjustment_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('net_amount', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.decimal('expected_gateway_fee', 15, 2);
      table.decimal('expected_gst_amount', 15, 2);
      table.decimal('expected_net_amount', 15, 2);
      table.decimal('fee_discrepancy_amount', 15, 2);
      table.decimal('gst_discrepancy_amount', 15, 2);
      table.decimal('net_discrepancy_amount', 15, 2);
      table.uuid('pricing_rule_id');
      table.jsonb('pricing_snapshot');
      table.jsonb('raw_payload').notNullable().defaultTo('{}');
      table.string('normalized_hash', 128).notNullable();
      table.enum('reconciliation_status', LINE_RECON_STATUSES).notNullable().defaultTo('UNMATCHED').index();
      table.uuid('ledger_transaction_id').references('id').inTable('ledger_transactions').onDelete('RESTRICT').index();
      table.uuid('outbox_event_id').references('id').inTable('outbox_events').onDelete('RESTRICT').index();
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'batch_id'], 'idx_gateway_setl_lines_tenant_batch');
      table.index(['tenant_id', 'transaction_ref'], 'idx_gateway_setl_lines_tenant_tx_ref');
      table.index(['tenant_id', 'gateway_transaction_id'], 'idx_gateway_setl_lines_tenant_gateway_tx');
      table.index(['tenant_id', 'gateway_payment_id'], 'idx_gateway_setl_lines_tenant_gateway_pay');
      table.index(['tenant_id', 'reconciliation_status'], 'idx_gateway_setl_lines_tenant_recon_status');
    });
  }

  if (!(await tableExists(knex, 'gateway_settlement_signals'))) {
    await knex.schema.createTable('gateway_settlement_signals', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.enum('signal_type', SIGNAL_TYPES).notNullable().index();
      table.enum('severity', SIGNAL_SEVERITIES).notNullable().index();
      table.enum('signal_status', SIGNAL_STATUSES).notNullable().defaultTo('OPEN').index();
      table.enum('source_type', SIGNAL_SOURCE_TYPES).notNullable().index();
      table.uuid('source_id');
      table.uuid('batch_id').references('id').inTable('gateway_settlement_batches').onDelete('RESTRICT').index();
      table.uuid('line_id').references('id').inTable('gateway_settlement_lines').onDelete('RESTRICT').index();
      table.uuid('transaction_id');
      table.string('transaction_ref', 100).index();
      table.string('gateway_name', 80).notNullable().index();
      table.string('gateway_settlement_id', 255);
      table.string('gateway_transaction_id', 255);
      table.decimal('impact_amount', 15, 2);
      table.string('currency', 3);
      table.text('description').notNullable();
      table.text('suggested_action');
      table.uuid('correlation_id').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now()).index();
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'signal_type'], 'idx_gateway_setl_signals_tenant_type');
      table.index(['tenant_id', 'severity'], 'idx_gateway_setl_signals_tenant_severity');
      table.index(['tenant_id', 'signal_status'], 'idx_gateway_setl_signals_tenant_status');
      table.index(['tenant_id', 'gateway_name'], 'idx_gateway_setl_signals_tenant_gateway');
      table.index(['tenant_id', 'created_at'], 'idx_gateway_setl_signals_tenant_created');
    });
  }

  if (!(await tableExists(knex, 'pricing_rules'))) {
    await knex.schema.createTable('pricing_rules', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('merchant_id');
      table.string('gateway_name', 80).notNullable().index();
      table.string('payment_method', 50);
      table.enum('rule_type', RULE_TYPES).notNullable();
      table.decimal('mdr_percentage', 10, 4);
      table.decimal('fixed_fee', 15, 2);
      table.decimal('gst_percentage', 10, 4);
      table.timestamp('effective_from').notNullable().index();
      table.timestamp('effective_to');
      table.enum('status', RULE_STATUSES).notNullable().defaultTo('ACTIVE').index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index(['tenant_id', 'merchant_id'], 'idx_pricing_rules_tenant_merchant');
      table.index(['tenant_id', 'gateway_name'], 'idx_pricing_rules_tenant_gateway');
      table.index(['tenant_id', 'payment_method'], 'idx_pricing_rules_tenant_method');
      table.index(['tenant_id', 'status'], 'idx_pricing_rules_tenant_status');
      table.index(['tenant_id', 'effective_from'], 'idx_pricing_rules_tenant_effective');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_setl_batches_gateway_settlement
      ON gateway_settlement_batches (tenant_id, gateway_name, gateway_settlement_id)
      WHERE gateway_settlement_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_setl_batches_source_reference
      ON gateway_settlement_batches (tenant_id, gateway_name, source_reference)
      WHERE source_reference IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_setl_lines_gateway_line
      ON gateway_settlement_lines (tenant_id, gateway_name, gateway_settlement_line_id)
      WHERE gateway_settlement_line_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_setl_lines_normalized_hash
      ON gateway_settlement_lines (tenant_id, normalized_hash);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_setl_signals_source
      ON gateway_settlement_signals (tenant_id, signal_type, source_type, source_id)
      WHERE source_id IS NOT NULL;
  `);

  await addCheckIfMissing(
    knex,
    'gateway_settlement_batches',
    'chk_gateway_setl_batches_amounts_nonnegative',
    'gross_amount >= 0 AND total_gateway_fee >= 0 AND total_gst_amount >= 0 AND net_settlement_amount >= 0'
  );
  await addCheckIfMissing(
    knex,
    'gateway_settlement_lines',
    'chk_gateway_setl_lines_amounts_nonnegative',
    'gross_amount >= 0 AND gateway_fee >= 0 AND gst_amount >= 0 AND net_amount >= 0'
  );
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS uq_gateway_setl_signals_source;
    DROP INDEX IF EXISTS uq_gateway_setl_lines_normalized_hash;
    DROP INDEX IF EXISTS uq_gateway_setl_lines_gateway_line;
    DROP INDEX IF EXISTS uq_gateway_setl_batches_source_reference;
    DROP INDEX IF EXISTS uq_gateway_setl_batches_gateway_settlement;
  `);

  await knex.schema.dropTableIfExists('pricing_rules');
  await knex.schema.dropTableIfExists('gateway_settlement_signals');
  await knex.schema.dropTableIfExists('gateway_settlement_lines');
  await knex.schema.dropTableIfExists('gateway_settlement_batches');
};
