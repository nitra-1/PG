const STATUSES = [
  'MATCHED',
  'MISSING_BANK_STATEMENT',
  'MISSING_PAYOUT_INSTRUCTION',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'UTR_MISMATCH',
  'BANK_REFERENCE_MISMATCH',
  'BANK_TRANSACTION_ID_MISMATCH',
  'DATE_MISMATCH',
  'DUPLICATE_BANK_MATCH',
  'DUPLICATE_PAYOUT',
  'RETURNED_OR_REVERSED',
  'UNMATCHED_BANK_DEBIT',
  'UNMATCHED_BANK_CREDIT',
  'TENANT_MISMATCH'
];

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('reconciliation_bank_settlements');

  if (!exists) {
    await knex.schema.createTable('reconciliation_bank_settlements', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('settlement_id').nullable().index();
      table.string('settlement_ref', 100).nullable();
      table.uuid('payout_instruction_id').nullable().index();
      table.uuid('bank_statement_line_id').nullable().index();
      table.enum('reconciliation_status', STATUSES).notNullable().index();
      table.decimal('settlement_amount', 15, 2).nullable();
      table.decimal('payout_amount', 15, 2).nullable();
      table.decimal('bank_amount', 15, 2).nullable();
      table.decimal('discrepancy_amount', 15, 2).notNullable().defaultTo(0);
      table.string('settlement_currency', 3).nullable();
      table.string('bank_currency', 3).nullable();
      table.string('expected_utr_number', 100).nullable();
      table.string('actual_utr_number', 100).nullable();
      table.string('expected_bank_reference_number', 100).nullable();
      table.string('actual_bank_reference_number', 100).nullable();
      table.string('expected_bank_transaction_id', 100).nullable();
      table.string('actual_bank_transaction_id', 100).nullable();
      table.date('expected_bank_date').nullable();
      table.date('actual_bank_date').nullable();
      table.timestamp('checked_at').notNullable().defaultTo(knex.fn.now());
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamps(true, true);

      table.index(['tenant_id', 'reconciliation_status'], 'idx_recon_bank_setl_tenant_status');
      table.index(['tenant_id', 'settlement_ref'], 'idx_recon_bank_setl_tenant_ref');
      table.index(['tenant_id', 'checked_at'], 'idx_recon_bank_setl_tenant_checked');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_bank_setl_tenant_payout
      ON reconciliation_bank_settlements (tenant_id, payout_instruction_id)
      WHERE payout_instruction_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_bank_setl_tenant_bank_line
      ON reconciliation_bank_settlements (tenant_id, bank_statement_line_id)
      WHERE bank_statement_line_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_bank_setl_missing_payout
      ON reconciliation_bank_settlements (tenant_id, settlement_id)
      WHERE payout_instruction_id IS NULL AND settlement_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_payout
      ON reconciliation_bank_settlements (payout_instruction_id);

    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_bank_line
      ON reconciliation_bank_settlements (bank_statement_line_id);
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('reconciliation_bank_settlements');
};
