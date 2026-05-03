const STATUSES = [
  'MATCHED',
  'MISSING_LEDGER_TRANSACTION',
  'MISSING_SETTLEMENT',
  'AMOUNT_MISMATCH',
  'FEE_MISMATCH',
  'NET_AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'TENANT_MISMATCH',
  'DUPLICATE_SETTLEMENT',
  'LEDGER_ENTRIES_MISSING'
];

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('reconciliation_settlements');

  if (!exists) {
    await knex.schema.createTable('reconciliation_settlements', function(table) {
      table.uuid('id').primary();
      table.uuid('tenant_id').notNullable().index();
      table.uuid('settlement_id').nullable().index();
      table.string('settlement_ref', 100).nullable();
      table.uuid('ledger_transaction_id').nullable().index();
      table.enum('reconciliation_status', STATUSES).notNullable().index();
      table.decimal('settlement_gross_amount', 15, 2).nullable();
      table.decimal('ledger_gross_amount', 15, 2).nullable();
      table.decimal('settlement_fee_amount', 15, 2).nullable();
      table.decimal('ledger_fee_amount', 15, 2).nullable();
      table.decimal('settlement_net_amount', 15, 2).nullable();
      table.decimal('ledger_net_amount', 15, 2).nullable();
      table.decimal('discrepancy_amount', 15, 2).notNullable().defaultTo(0);
      table.string('currency', 3).nullable();
      table.timestamp('checked_at').notNullable().defaultTo(knex.fn.now());
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').defaultTo('{}');
      table.timestamps(true, true);

      table.unique(['tenant_id', 'settlement_ref'], {
        indexName: 'uq_reconciliation_settlements_tenant_ref'
      });
      table.index(['tenant_id', 'reconciliation_status'], 'idx_recon_settlements_tenant_status');
      table.index(['tenant_id', 'checked_at'], 'idx_recon_settlements_tenant_checked_at');
      table.index(['tenant_id', 'settlement_ref'], 'idx_recon_settlements_tenant_ref');
    });
    return;
  }

  const addColumnIfMissing = async (columnName, addColumn) => {
    const hasColumn = await knex.schema.hasColumn('reconciliation_settlements', columnName);
    if (!hasColumn) {
      await knex.schema.table('reconciliation_settlements', addColumn);
    }
  };

  await addColumnIfMissing('tenant_id', table => table.uuid('tenant_id').index());
  await addColumnIfMissing('settlement_id', table => table.uuid('settlement_id').nullable().index());
  await addColumnIfMissing('settlement_ref', table => table.string('settlement_ref', 100).nullable());
  await addColumnIfMissing('ledger_transaction_id', table => table.uuid('ledger_transaction_id').nullable().index());
  await addColumnIfMissing('reconciliation_status', table => table.enum('reconciliation_status', STATUSES).index());
  await addColumnIfMissing('settlement_gross_amount', table => table.decimal('settlement_gross_amount', 15, 2).nullable());
  await addColumnIfMissing('ledger_gross_amount', table => table.decimal('ledger_gross_amount', 15, 2).nullable());
  await addColumnIfMissing('settlement_fee_amount', table => table.decimal('settlement_fee_amount', 15, 2).nullable());
  await addColumnIfMissing('ledger_fee_amount', table => table.decimal('ledger_fee_amount', 15, 2).nullable());
  await addColumnIfMissing('settlement_net_amount', table => table.decimal('settlement_net_amount', 15, 2).nullable());
  await addColumnIfMissing('ledger_net_amount', table => table.decimal('ledger_net_amount', 15, 2).nullable());
  await addColumnIfMissing('discrepancy_amount', table => table.decimal('discrepancy_amount', 15, 2).defaultTo(0));
  await addColumnIfMissing('currency', table => table.string('currency', 3).nullable());
  await addColumnIfMissing('checked_at', table => table.timestamp('checked_at').defaultTo(knex.fn.now()));
  await addColumnIfMissing('correlation_id', table => table.uuid('correlation_id').nullable().index());
  await addColumnIfMissing('metadata', table => table.jsonb('metadata').defaultTo('{}'));

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_settlements_tenant_ref
      ON reconciliation_settlements (tenant_id, settlement_ref);
    CREATE INDEX IF NOT EXISTS idx_recon_settlements_tenant_status
      ON reconciliation_settlements (tenant_id, reconciliation_status);
    CREATE INDEX IF NOT EXISTS idx_recon_settlements_tenant_checked_at
      ON reconciliation_settlements (tenant_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_recon_settlements_tenant_ref
      ON reconciliation_settlements (tenant_id, settlement_ref);
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('reconciliation_settlements');
};
