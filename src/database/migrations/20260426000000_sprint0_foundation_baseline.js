/**
 * Sprint 0 Foundation Baseline
 *
 * Goals:
 * - Ensure tenant_id exists where core business data needs isolation
 * - Replace global business-reference uniqueness with tenant-scoped uniqueness
 * - Add a shared idempotency registry
 * - Add correlation_id fields for request/financial traceability
 */

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function columnExists(knex, tableName, columnName) {
  if (!(await tableExists(knex, tableName))) return false;
  return knex.schema.hasColumn(tableName, columnName);
}

async function assertNoDuplicates(knex, tableName, columns, whereClause = '') {
  if (!(await tableExists(knex, tableName))) return;

  for (const column of columns) {
    if (!(await columnExists(knex, tableName, column))) return;
  }

  const columnList = columns.join(', ');
  const result = await knex.raw(`
    SELECT ${columnList}, COUNT(*) AS duplicate_count
    FROM ${tableName}
    ${whereClause}
    GROUP BY ${columnList}
    HAVING COUNT(*) > 1
    LIMIT 10
  `);

  if (result.rows && result.rows.length > 0) {
    throw new Error(
      `Cannot add tenant-scoped unique baseline for ${tableName}(${columnList}); duplicate rows exist: ` +
      JSON.stringify(result.rows)
    );
  }
}

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  if (!(await tableExists(knex, 'tenants'))) {
    await knex.schema.createTable('tenants', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('tenant_code', 100).notNullable().unique();
      table.string('tenant_name', 255).notNullable();
      table.enum('status', ['active', 'inactive', 'suspended']).notNullable().defaultTo('active').index();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  await knex('tenants')
    .insert({
      id: DEFAULT_TENANT_ID,
      tenant_code: 'default',
      tenant_name: 'Default Tenant',
      status: 'active'
    })
    .onConflict('id')
    .ignore();

  if (await tableExists(knex, 'merchants')) {
    if (!(await columnExists(knex, 'merchants', 'tenant_id'))) {
      await knex.schema.table('merchants', function(table) {
        table.uuid('tenant_id').index();
      });
    }

    await knex('merchants')
      .whereNull('tenant_id')
      .update({ tenant_id: DEFAULT_TENANT_ID });

    await knex.raw(`ALTER TABLE merchants ALTER COLUMN tenant_id SET NOT NULL`);
  }

  if (await tableExists(knex, 'idempotency_keys')) {
    // Keep an existing table, but ensure Sprint 0 columns are present.
    const requiredColumns = [
      ['tenant_id', (table) => table.uuid('tenant_id').index()],
      ['scope', (table) => table.string('scope', 100).notNullable().defaultTo('global')],
      ['idempotency_key', (table) => table.string('idempotency_key', 255).notNullable().defaultTo('legacy')],
      ['request_hash', (table) => table.string('request_hash', 128)],
      ['response_body', (table) => table.jsonb('response_body')],
      ['status', (table) => table.enum('status', ['IN_PROGRESS', 'COMPLETED', 'FAILED']).notNullable().defaultTo('IN_PROGRESS').index()],
      ['error_message', (table) => table.text('error_message')],
      ['locked_until', (table) => table.timestamp('locked_until')],
      ['expires_at', (table) => table.timestamp('expires_at')],
      ['correlation_id', (table) => table.uuid('correlation_id').index()]
    ];

    for (const [columnName, addColumn] of requiredColumns) {
      if (!(await columnExists(knex, 'idempotency_keys', columnName))) {
        await knex.schema.table('idempotency_keys', addColumn);
      }
    }

    await assertNoDuplicates(knex, 'idempotency_keys', ['tenant_id', 'scope', 'idempotency_key']);
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_tenant_scope_key
        ON idempotency_keys (tenant_id, scope, idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_idempotency_tenant_scope_status
        ON idempotency_keys (tenant_id, scope, status);
    `);
  } else {
    await knex.schema.createTable('idempotency_keys', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('scope', 100).notNullable();
      table.string('idempotency_key', 255).notNullable();
      table.string('request_hash', 128).notNullable();
      table.jsonb('response_body');
      table.enum('status', ['IN_PROGRESS', 'COMPLETED', 'FAILED']).notNullable().defaultTo('IN_PROGRESS').index();
      table.text('error_message');
      table.timestamp('locked_until');
      table.timestamp('expires_at');
      table.uuid('correlation_id').index();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique(['tenant_id', 'scope', 'idempotency_key'], {
        indexName: 'uq_idempotency_tenant_scope_key'
      });
      table.index(['tenant_id', 'scope', 'status']);
    });
  }

  for (const tableName of ['audit_logs', 'ledger_audit_logs']) {
    if ((await tableExists(knex, tableName)) && !(await columnExists(knex, tableName, 'correlation_id'))) {
      await knex.schema.table(tableName, function(table) {
        table.uuid('correlation_id').index();
      });
    }
  }

  // Data checks before replacing uniqueness.
  await assertNoDuplicates(knex, 'merchants', ['tenant_id', 'merchant_code']);
  await assertNoDuplicates(knex, 'payment_orders', ['tenant_id', 'order_id']);
  await assertNoDuplicates(knex, 'transactions', ['tenant_id', 'transaction_ref'], 'WHERE transaction_ref IS NOT NULL');
  await assertNoDuplicates(knex, 'transactions', ['tenant_id', 'gateway_transaction_id'], 'WHERE gateway_transaction_id IS NOT NULL');
  await assertNoDuplicates(knex, 'ledger_transactions', ['tenant_id', 'transaction_ref']);
  await assertNoDuplicates(knex, 'ledger_transactions', ['tenant_id', 'idempotency_key'], 'WHERE idempotency_key IS NOT NULL');
  await assertNoDuplicates(knex, 'settlements', ['tenant_id', 'settlement_ref']);
  await assertNoDuplicates(knex, 'settlements', ['tenant_id', 'utr_number'], 'WHERE utr_number IS NOT NULL');

  await knex.raw(`
    ALTER TABLE IF EXISTS merchants DROP CONSTRAINT IF EXISTS merchants_merchant_code_unique;
    ALTER TABLE IF EXISTS payment_orders DROP CONSTRAINT IF EXISTS payment_orders_order_id_unique;
    ALTER TABLE IF EXISTS transactions DROP CONSTRAINT IF EXISTS transactions_transaction_ref_unique;
    ALTER TABLE IF EXISTS ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_transaction_ref_unique;
    ALTER TABLE IF EXISTS ledger_transactions DROP CONSTRAINT IF EXISTS ledger_transactions_idempotency_key_unique;
    ALTER TABLE IF EXISTS settlements DROP CONSTRAINT IF EXISTS settlements_settlement_ref_unique;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_merchants_tenant_merchant_code
      ON merchants (tenant_id, merchant_code);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_tenant_order_id
      ON payment_orders (tenant_id, order_id);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_tenant_transaction_ref
      ON transactions (tenant_id, transaction_ref)
      WHERE transaction_ref IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_tenant_gateway_txn
      ON transactions (tenant_id, gateway_transaction_id)
      WHERE gateway_transaction_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_tenant_ref
      ON ledger_transactions (tenant_id, transaction_ref);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_tenant_idempotency
      ON ledger_transactions (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_tenant_ref
      ON settlements (tenant_id, settlement_ref);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_tenant_utr
      ON settlements (tenant_id, utr_number)
      WHERE utr_number IS NOT NULL;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settlements' AND column_name = 'bank_reference_number'
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_tenant_bank_ref
          ON settlements (tenant_id, bank_reference_number)
          WHERE bank_reference_number IS NOT NULL;
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS uq_settlements_tenant_bank_ref;
    DROP INDEX IF EXISTS uq_settlements_tenant_utr;
    DROP INDEX IF EXISTS uq_settlements_tenant_ref;
    DROP INDEX IF EXISTS uq_ledger_transactions_tenant_idempotency;
    DROP INDEX IF EXISTS uq_ledger_transactions_tenant_ref;
    DROP INDEX IF EXISTS uq_transactions_tenant_gateway_txn;
    DROP INDEX IF EXISTS uq_transactions_tenant_transaction_ref;
    DROP INDEX IF EXISTS uq_payment_orders_tenant_order_id;
    DROP INDEX IF EXISTS uq_merchants_tenant_merchant_code;
  `);

  if (await tableExists(knex, 'idempotency_keys')) {
    await knex.schema.dropTable('idempotency_keys');
  }

  for (const tableName of ['audit_logs', 'ledger_audit_logs']) {
    if (await columnExists(knex, tableName, 'correlation_id')) {
      await knex.schema.table(tableName, function(table) {
        table.dropColumn('correlation_id');
      });
    }
  }

  if (await columnExists(knex, 'merchants', 'tenant_id')) {
    await knex.schema.table('merchants', function(table) {
      table.dropColumn('tenant_id');
    });
  }

  if (await tableExists(knex, 'tenants')) {
    await knex.schema.dropTable('tenants');
  }
};
