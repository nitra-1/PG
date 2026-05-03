const BATCH_SOURCE_TYPES = ['CSV_UPLOAD', 'API_FEED', 'MANUAL_UPLOAD', 'BANK_WEBHOOK'];
const IMPORT_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];
const TRANSACTION_TYPES = ['CREDIT', 'DEBIT'];
const LINE_RECON_STATUSES = ['UNMATCHED', 'MATCH_CANDIDATE', 'MATCHED', 'DUPLICATE', 'IGNORED'];
const PAYOUT_STATUSES = [
  'CREATED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'RETURNED',
  'REVERSED',
  'TIMEOUT'
];

async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.table(tableName, addColumn);
  }
}

exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('bank_statement_batches'))) {
    await knex.schema.createTable('bank_statement_batches', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('bank_account_id').nullable().index();
      table.enum('source_type', BATCH_SOURCE_TYPES).notNullable();
      table.string('source_filename', 255).nullable();
      table.string('source_reference', 255).nullable().index();
      table.string('imported_by', 100).nullable();
      table.enum('import_status', IMPORT_STATUSES).notNullable().defaultTo('PENDING').index();
      table.integer('total_lines').notNullable().defaultTo(0);
      table.integer('imported_lines').notNullable().defaultTo(0);
      table.integer('duplicate_lines').notNullable().defaultTo(0);
      table.integer('failed_lines').notNullable().defaultTo(0);
      table.text('error_message').nullable();
      table.timestamp('imported_at').nullable().index();
      table.timestamps(true, true);
      table.uuid('correlation_id').nullable().index();

      table.index(['tenant_id', 'import_status'], 'idx_bank_stmt_batches_tenant_status');
      table.index(['tenant_id', 'imported_at'], 'idx_bank_stmt_batches_tenant_imported');
      table.index(['tenant_id', 'source_reference'], 'idx_bank_stmt_batches_tenant_source_ref');
    });
  }

  if (!(await knex.schema.hasTable('bank_statement_lines'))) {
    await knex.schema.createTable('bank_statement_lines', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('batch_id').notNullable().references('id').inTable('bank_statement_batches').onDelete('CASCADE').index();
      table.uuid('bank_account_id').nullable().index();
      table.date('transaction_date').notNullable().index();
      table.date('value_date').nullable();
      table.string('bank_transaction_id', 100).nullable();
      table.string('utr_number', 100).nullable();
      table.string('bank_reference_number', 100).nullable();
      table.string('external_reference', 255).nullable();
      table.text('narration').nullable();
      table.text('description').nullable();
      table.decimal('debit_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('credit_amount', 15, 2).notNullable().defaultTo(0);
      table.decimal('amount', 15, 2).notNullable();
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.enum('transaction_type', TRANSACTION_TYPES).notNullable().index();
      table.string('counterparty_name', 255).nullable();
      table.string('counterparty_account', 100).nullable();
      table.jsonb('raw_payload').notNullable().defaultTo('{}');
      table.string('normalized_hash', 128).notNullable();
      table.enum('reconciliation_status', LINE_RECON_STATUSES).notNullable().defaultTo('UNMATCHED').index();
      table.timestamps(true, true);
      table.uuid('correlation_id').nullable().index();

      table.unique(['tenant_id', 'normalized_hash'], {
        indexName: 'uq_bank_stmt_lines_tenant_hash'
      });
      table.index(['tenant_id', 'utr_number'], 'idx_bank_stmt_lines_tenant_utr');
      table.index(['tenant_id', 'bank_reference_number'], 'idx_bank_stmt_lines_tenant_bank_ref');
      table.index(['tenant_id', 'bank_transaction_id'], 'idx_bank_stmt_lines_tenant_bank_txn');
      table.index(['tenant_id', 'reconciliation_status'], 'idx_bank_stmt_lines_tenant_recon_status');
      table.index(['tenant_id', 'amount'], 'idx_bank_stmt_lines_tenant_amount');
      table.index(['tenant_id', 'transaction_type'], 'idx_bank_stmt_lines_tenant_type');
    });

    await knex.raw(`
      ALTER TABLE bank_statement_lines
      ADD CONSTRAINT chk_bank_statement_amount_positive
      CHECK (amount > 0);

      ALTER TABLE bank_statement_lines
      ADD CONSTRAINT chk_bank_statement_debit_credit_exclusive
      CHECK (
        (debit_amount > 0 AND credit_amount = 0 AND transaction_type = 'DEBIT')
        OR
        (credit_amount > 0 AND debit_amount = 0 AND transaction_type = 'CREDIT')
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_stmt_lines_tenant_bank_txn
        ON bank_statement_lines (tenant_id, bank_transaction_id)
        WHERE bank_transaction_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_stmt_lines_tenant_utr
        ON bank_statement_lines (tenant_id, utr_number)
        WHERE utr_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_stmt_lines_tenant_bank_ref
        ON bank_statement_lines (tenant_id, bank_reference_number)
        WHERE bank_reference_number IS NOT NULL;
    `);
  }

  if (!(await knex.schema.hasTable('payout_instructions'))) {
    await knex.schema.createTable('payout_instructions', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('settlement_id').notNullable().index();
      table.string('settlement_ref', 100).notNullable().index();
      table.uuid('merchant_id').nullable().index();
      table.uuid('beneficiary_id').nullable().index();
      table.uuid('bank_account_id').nullable().index();
      table.decimal('payout_amount', 15, 2).notNullable();
      table.string('currency', 3).notNullable().defaultTo('INR');
      table.enum('payout_status', PAYOUT_STATUSES).notNullable().defaultTo('CREATED').index();
      table.string('bank_idempotency_key', 255).notNullable();
      table.string('utr_number', 100).nullable();
      table.string('bank_reference_number', 100).nullable();
      table.string('bank_transaction_id', 100).nullable();
      table.timestamp('submitted_at').nullable();
      table.timestamp('accepted_at').nullable();
      table.timestamp('completed_at').nullable();
      table.timestamp('failed_at').nullable();
      table.timestamp('returned_at').nullable();
      table.timestamp('reversed_at').nullable();
      table.text('return_reason').nullable();
      table.text('failure_reason').nullable();
      table.integer('retry_count').notNullable().defaultTo(0);
      table.jsonb('raw_bank_response').notNullable().defaultTo('{}');
      table.timestamps(true, true);
      table.uuid('correlation_id').nullable().index();

      table.unique(['tenant_id', 'bank_idempotency_key'], {
        indexName: 'uq_payout_instruction_tenant_idempotency'
      });
      table.index(['tenant_id', 'payout_status'], 'idx_payout_instruction_tenant_status');
      table.index(['tenant_id', 'settlement_ref'], 'idx_payout_instruction_tenant_settlement_ref');
      table.index(['tenant_id', 'created_at'], 'idx_payout_instruction_tenant_created');
    });

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_utr
        ON payout_instructions (tenant_id, utr_number)
        WHERE utr_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_bank_ref
        ON payout_instructions (tenant_id, bank_reference_number)
        WHERE bank_reference_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_bank_txn
        ON payout_instructions (tenant_id, bank_transaction_id)
        WHERE bank_transaction_id IS NOT NULL;
    `);
  } else {
    await addColumnIfMissing(knex, 'payout_instructions', 'tenant_id', table => table.uuid('tenant_id').index());
    await addColumnIfMissing(knex, 'payout_instructions', 'settlement_id', table => table.uuid('settlement_id').index());
    await addColumnIfMissing(knex, 'payout_instructions', 'settlement_ref', table => table.string('settlement_ref', 100).index());
    await addColumnIfMissing(knex, 'payout_instructions', 'merchant_id', table => table.uuid('merchant_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'beneficiary_id', table => table.uuid('beneficiary_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'bank_account_id', table => table.uuid('bank_account_id').nullable().index());
    await addColumnIfMissing(knex, 'payout_instructions', 'payout_amount', table => table.decimal('payout_amount', 15, 2));
    await addColumnIfMissing(knex, 'payout_instructions', 'currency', table => table.string('currency', 3).defaultTo('INR'));
    await addColumnIfMissing(knex, 'payout_instructions', 'payout_status', table => table.enum('payout_status', PAYOUT_STATUSES).defaultTo('CREATED').index());
    await addColumnIfMissing(knex, 'payout_instructions', 'bank_idempotency_key', table => table.string('bank_idempotency_key', 255));
    await addColumnIfMissing(knex, 'payout_instructions', 'utr_number', table => table.string('utr_number', 100).nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'bank_reference_number', table => table.string('bank_reference_number', 100).nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'bank_transaction_id', table => table.string('bank_transaction_id', 100).nullable());
    await addColumnIfMissing(knex, 'payout_instructions', 'raw_bank_response', table => table.jsonb('raw_bank_response').defaultTo('{}'));
    await addColumnIfMissing(knex, 'payout_instructions', 'correlation_id', table => table.uuid('correlation_id').nullable().index());

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_idempotency
        ON payout_instructions (tenant_id, bank_idempotency_key);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_utr
        ON payout_instructions (tenant_id, utr_number)
        WHERE utr_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_bank_ref
        ON payout_instructions (tenant_id, bank_reference_number)
        WHERE bank_reference_number IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_instruction_tenant_bank_txn
        ON payout_instructions (tenant_id, bank_transaction_id)
        WHERE bank_transaction_id IS NOT NULL;
    `);
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('payout_instructions');
  await knex.schema.dropTableIfExists('bank_statement_lines');
  await knex.schema.dropTableIfExists('bank_statement_batches');
};
