const STATUSES = [
  'MATCHED',
  'MISSING_LEDGER',
  'AMOUNT_MISMATCH',
  'DUPLICATE_LEDGER',
  'CURRENCY_MISMATCH'
];

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('reconciliation_transactions');

  if (!exists) {
    await knex.schema.createTable('reconciliation_transactions', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('transaction_id').notNullable().index();
      table.string('transaction_ref', 100).notNullable();
      table.uuid('ledger_transaction_id').nullable().index();
      table.enum('reconciliation_status', STATUSES).notNullable().index();
      table.decimal('transaction_amount', 15, 2).notNullable();
      table.decimal('ledger_amount', 15, 2).nullable();
      table.string('currency', 3).notNullable();
      table.decimal('discrepancy_amount', 15, 2).notNullable().defaultTo(0);
      table.timestamp('checked_at').notNullable().defaultTo(knex.fn.now());
      table.uuid('correlation_id').nullable().index();
      table.timestamps(true, true);

      table.unique(['tenant_id', 'transaction_ref'], {
        indexName: 'uq_reconciliation_transactions_tenant_ref'
      });
      table.index(['tenant_id', 'reconciliation_status'], 'idx_recon_tx_tenant_status');
      table.index(['tenant_id', 'checked_at'], 'idx_recon_tx_tenant_checked_at');
    });
    return;
  }

  const addColumnIfMissing = async (columnName, addColumn) => {
    const hasColumn = await knex.schema.hasColumn('reconciliation_transactions', columnName);
    if (!hasColumn) {
      await knex.schema.table('reconciliation_transactions', addColumn);
    }
  };

  await addColumnIfMissing('tenant_id', table => table.uuid('tenant_id').index());
  await addColumnIfMissing('transaction_id', table => table.uuid('transaction_id').index());
  await addColumnIfMissing('transaction_ref', table => table.string('transaction_ref', 100));
  await addColumnIfMissing('ledger_transaction_id', table => table.uuid('ledger_transaction_id').nullable().index());
  await addColumnIfMissing('reconciliation_status', table => table.enum('reconciliation_status', STATUSES).index());
  await addColumnIfMissing('transaction_amount', table => table.decimal('transaction_amount', 15, 2));
  await addColumnIfMissing('ledger_amount', table => table.decimal('ledger_amount', 15, 2).nullable());
  await addColumnIfMissing('currency', table => table.string('currency', 3));
  await addColumnIfMissing('discrepancy_amount', table => table.decimal('discrepancy_amount', 15, 2).defaultTo(0));
  await addColumnIfMissing('checked_at', table => table.timestamp('checked_at').defaultTo(knex.fn.now()));
  await addColumnIfMissing('correlation_id', table => table.uuid('correlation_id').nullable().index());

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_transactions_tenant_ref
      ON reconciliation_transactions (tenant_id, transaction_ref);
    CREATE INDEX IF NOT EXISTS idx_recon_tx_tenant_status
      ON reconciliation_transactions (tenant_id, reconciliation_status);
    CREATE INDEX IF NOT EXISTS idx_recon_tx_tenant_checked_at
      ON reconciliation_transactions (tenant_id, checked_at);
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('reconciliation_transactions');
};
