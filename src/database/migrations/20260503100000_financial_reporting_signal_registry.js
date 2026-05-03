const REPORT_TYPES = [
  'ESCROW_BALANCE',
  'GATEWAY_RECEIVABLE',
  'MERCHANT_PAYABLE',
  'MERCHANT_PAYABLE_AGING',
  'SETTLEMENT_AGING',
  'PAYOUT_AGING',
  'AMOUNT_AT_RISK',
  'OUTBOX_HEALTH',
  'SIGNAL_SUMMARY',
  'RECONCILIATION_EXCEPTION_SUMMARY'
];

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

function quotedList(values) {
  return values.map(value => `'${value}'`).join(', ');
}

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (!(await tableExists(knex, 'financial_report_snapshots'))) {
    await knex.schema.createTable('financial_report_snapshots', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').nullable().index();
      table.string('report_type', 80).notNullable().index();
      table.timestamp('report_period_start').nullable().index();
      table.timestamp('report_period_end').nullable().index();
      table.string('currency', 3).nullable().index();
      table.string('generated_by', 100).nullable();
      table.timestamp('generated_at').notNullable().defaultTo(knex.fn.now()).index();
      table.jsonb('snapshot_payload').notNullable().defaultTo('{}');
      table.uuid('correlation_id').nullable().index();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['tenant_id', 'report_type'], 'idx_fin_report_snapshots_tenant_type');
      table.index(['tenant_id', 'generated_at'], 'idx_fin_report_snapshots_tenant_generated');
      table.index(['tenant_id', 'report_period_start', 'report_period_end'], 'idx_fin_report_snapshots_period');
    });

    await knex.raw(`
      ALTER TABLE financial_report_snapshots
        ADD CONSTRAINT chk_financial_report_snapshots_type
        CHECK (report_type IN (${quotedList(REPORT_TYPES)}));
    `);
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('financial_report_snapshots');
};
