/**
 * Ledger Core Hardening
 *
 * Adds trace columns and database-level posting guards without changing the
 * existing debit/credit entry model or ledger immutability trigger.
 */

async function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function columnExists(knex, tableName, columnName) {
  return knex.schema.hasColumn(tableName, columnName);
}

exports.up = async function(knex) {
  if (await tableExists(knex, 'ledger_transactions')) {
    if (!(await columnExists(knex, 'ledger_transactions', 'correlation_id'))) {
      await knex.schema.table('ledger_transactions', function(table) {
        table.uuid('correlation_id').index();
      });
    }
  }

  if (await tableExists(knex, 'ledger_entries')) {
    if (!(await columnExists(knex, 'ledger_entries', 'correlation_id'))) {
      await knex.schema.table('ledger_entries', function(table) {
        table.uuid('correlation_id').index();
      });
    }
  }

  if (await tableExists(knex, 'ledger_accounts')) {
    if (!(await columnExists(knex, 'ledger_accounts', 'tenant_id'))) {
      await knex.schema.table('ledger_accounts', function(table) {
        table.uuid('tenant_id').index();
      });
    }
  }

  await knex.raw(`
    CREATE OR REPLACE FUNCTION validate_ledger_transaction_postable()
    RETURNS TRIGGER AS $$
    DECLARE
      v_entry_count INTEGER;
      v_debits NUMERIC(15, 2);
      v_credits NUMERIC(15, 2);
    BEGIN
      IF NEW.status = 'posted' THEN
        SELECT
          COUNT(*),
          COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END), 0)
        INTO v_entry_count, v_debits, v_credits
        FROM ledger_entries
        WHERE transaction_id = NEW.id
          AND tenant_id = NEW.tenant_id;

        IF v_entry_count = 0 THEN
          RAISE EXCEPTION 'Cannot mark ledger transaction posted without entries';
        END IF;

        IF ABS(v_debits - v_credits) > 0.01 THEN
          RAISE EXCEPTION 'Cannot mark ledger transaction posted when entries are imbalanced. Debits: %, Credits: %', v_debits, v_credits;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS enforce_ledger_posting_integrity ON ledger_transactions;
    CREATE TRIGGER enforce_ledger_posting_integrity
    BEFORE UPDATE OF status ON ledger_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_ledger_transaction_postable();
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS enforce_ledger_posting_integrity ON ledger_transactions;
    DROP FUNCTION IF EXISTS validate_ledger_transaction_postable();
  `);

  if (await tableExists(knex, 'ledger_entries') && await columnExists(knex, 'ledger_entries', 'correlation_id')) {
    await knex.schema.table('ledger_entries', function(table) {
      table.dropColumn('correlation_id');
    });
  }

  if (await tableExists(knex, 'ledger_transactions') && await columnExists(knex, 'ledger_transactions', 'correlation_id')) {
    await knex.schema.table('ledger_transactions', function(table) {
      table.dropColumn('correlation_id');
    });
  }

  if (await tableExists(knex, 'ledger_accounts') && await columnExists(knex, 'ledger_accounts', 'tenant_id')) {
    await knex.schema.table('ledger_accounts', function(table) {
      table.dropColumn('tenant_id');
    });
  }
};
