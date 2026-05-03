async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ?
        AND c.conname = ?
      LIMIT 1
    `,
    [tableName, constraintName]
  );

  return result.rows.length > 0;
}

async function assertNoOrphans(knex, {
  childTable,
  childColumn,
  parentTable,
  parentColumn = 'id',
  constraintName
}) {
  const result = await knex.raw(
    `
      SELECT child.id, child.?? AS orphan_reference
      FROM ?? AS child
      LEFT JOIN ?? AS parent ON child.?? = parent.??
      WHERE child.?? IS NOT NULL
        AND parent.?? IS NULL
      LIMIT 10
    `,
    [
      childColumn,
      childTable,
      parentTable,
      childColumn,
      parentColumn,
      childColumn,
      parentColumn
    ]
  );

  if (result.rows.length > 0) {
    const samples = result.rows
      .map(row => `${row.id}:${row.orphan_reference}`)
      .join(', ');
    throw new Error(
      `Cannot add ${constraintName}: found orphan references in ${childTable}.${childColumn}. ` +
      `Sample child_id:orphan_reference values: ${samples}`
    );
  }
}

async function addForeignKeyIfMissing(knex, {
  childTable,
  childColumn,
  parentTable,
  parentColumn = 'id',
  constraintName
}) {
  if (await constraintExists(knex, childTable, constraintName)) return;

  await assertNoOrphans(knex, {
    childTable,
    childColumn,
    parentTable,
    parentColumn,
    constraintName
  });

  await knex.raw(`
    ALTER TABLE ${childTable}
    ADD CONSTRAINT ${constraintName}
    FOREIGN KEY (${childColumn})
    REFERENCES ${parentTable} (${parentColumn})
    ON DELETE RESTRICT
  `);
}

async function assertNoInvalidAmounts(knex, {
  tableName,
  columnName,
  operator,
  value,
  constraintName
}) {
  const result = await knex.raw(
    `
      SELECT id, ?? AS invalid_amount
      FROM ??
      WHERE ?? IS NOT NULL
        AND ?? ${operator} ?
      LIMIT 10
    `,
    [columnName, tableName, columnName, columnName, value]
  );

  if (result.rows.length > 0) {
    const samples = result.rows
      .map(row => `${row.id}:${row.invalid_amount}`)
      .join(', ');
    throw new Error(
      `Cannot add ${constraintName}: found invalid amounts in ${tableName}.${columnName}. ` +
      `Sample id:amount values: ${samples}`
    );
  }
}

async function addCheckIfMissing(knex, {
  tableName,
  columnName,
  minValue,
  allowZero,
  constraintName
}) {
  if (await constraintExists(knex, tableName, constraintName)) return;

  await assertNoInvalidAmounts(knex, {
    tableName,
    columnName,
    operator: allowZero ? '<' : '<=',
    value: minValue,
    constraintName
  });

  const comparator = allowZero ? '>=' : '>';
  await knex.raw(`
    ALTER TABLE ${tableName}
    ADD CONSTRAINT ${constraintName}
    CHECK (${columnName} IS NULL OR ${columnName} ${comparator} ${minValue})
  `);
}

exports.up = async function(knex) {
  await addForeignKeyIfMissing(knex, {
    childTable: 'reconciliation_bank_settlements',
    childColumn: 'settlement_id',
    parentTable: 'settlements',
    constraintName: 'fk_recon_bank_setl_settlement'
  });

  await addForeignKeyIfMissing(knex, {
    childTable: 'reconciliation_bank_settlements',
    childColumn: 'payout_instruction_id',
    parentTable: 'payout_instructions',
    constraintName: 'fk_recon_bank_setl_payout_instruction'
  });

  await addForeignKeyIfMissing(knex, {
    childTable: 'reconciliation_bank_settlements',
    childColumn: 'bank_statement_line_id',
    parentTable: 'bank_statement_lines',
    constraintName: 'fk_recon_bank_setl_bank_statement_line'
  });

  const nonNegativeChecks = [
    ['reconciliation_bank_settlements', 'settlement_amount', 'chk_recon_bank_setl_settlement_amount_nonnegative'],
    ['reconciliation_bank_settlements', 'payout_amount', 'chk_recon_bank_setl_payout_amount_nonnegative'],
    ['reconciliation_bank_settlements', 'bank_amount', 'chk_recon_bank_setl_bank_amount_nonnegative'],
    ['reconciliation_bank_settlements', 'discrepancy_amount', 'chk_recon_bank_setl_discrepancy_amount_nonnegative'],
    ['reconciliation_settlements', 'settlement_gross_amount', 'chk_recon_setl_settlement_gross_nonnegative'],
    ['reconciliation_settlements', 'ledger_gross_amount', 'chk_recon_setl_ledger_gross_nonnegative'],
    ['reconciliation_settlements', 'settlement_fee_amount', 'chk_recon_setl_settlement_fee_nonnegative'],
    ['reconciliation_settlements', 'ledger_fee_amount', 'chk_recon_setl_ledger_fee_nonnegative'],
    ['reconciliation_settlements', 'settlement_net_amount', 'chk_recon_setl_settlement_net_nonnegative'],
    ['reconciliation_settlements', 'ledger_net_amount', 'chk_recon_setl_ledger_net_nonnegative'],
    ['reconciliation_settlements', 'discrepancy_amount', 'chk_recon_setl_discrepancy_nonnegative'],
    ['reconciliation_transactions', 'transaction_amount', 'chk_recon_tx_transaction_amount_nonnegative'],
    ['reconciliation_transactions', 'ledger_amount', 'chk_recon_tx_ledger_amount_nonnegative'],
    ['reconciliation_transactions', 'discrepancy_amount', 'chk_recon_tx_discrepancy_nonnegative']
  ];

  for (const [tableName, columnName, constraintName] of nonNegativeChecks) {
    await addCheckIfMissing(knex, {
      tableName,
      columnName,
      minValue: 0,
      allowZero: true,
      constraintName
    });
  }

  await addCheckIfMissing(knex, {
    tableName: 'payout_instructions',
    columnName: 'payout_amount',
    minValue: 0,
    allowZero: false,
    constraintName: 'chk_payout_instructions_payout_amount_positive'
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_tenant
      ON reconciliation_bank_settlements (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_status
      ON reconciliation_bank_settlements (reconciliation_status);
    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_settlement_ref
      ON reconciliation_bank_settlements (settlement_ref);
    CREATE INDEX IF NOT EXISTS idx_recon_bank_setl_checked_at
      ON reconciliation_bank_settlements (checked_at);

    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_tenant
      ON reconciliation_exception_cases (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_status
      ON reconciliation_exception_cases (case_status);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_severity
      ON reconciliation_exception_cases (severity);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_priority
      ON reconciliation_exception_cases (priority);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_assigned_to
      ON reconciliation_exception_cases (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_opened_at
      ON reconciliation_exception_cases (opened_at);
    CREATE INDEX IF NOT EXISTS idx_recon_exception_cases_last_action_at
      ON reconciliation_exception_cases (last_action_at);

    CREATE INDEX IF NOT EXISTS idx_payout_instructions_tenant_utr
      ON payout_instructions (tenant_id, utr_number);
    CREATE INDEX IF NOT EXISTS idx_payout_instructions_tenant_bank_ref
      ON payout_instructions (tenant_id, bank_reference_number);
    CREATE INDEX IF NOT EXISTS idx_payout_instructions_tenant_bank_txn
      ON payout_instructions (tenant_id, bank_transaction_id);

    CREATE INDEX IF NOT EXISTS idx_bank_stmt_lines_tenant_transaction_date
      ON bank_statement_lines (tenant_id, transaction_date);
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_bank_stmt_lines_tenant_transaction_date;
    DROP INDEX IF EXISTS idx_payout_instructions_tenant_bank_txn;
    DROP INDEX IF EXISTS idx_payout_instructions_tenant_bank_ref;
    DROP INDEX IF EXISTS idx_payout_instructions_tenant_utr;
    DROP INDEX IF EXISTS idx_recon_exception_cases_last_action_at;
    DROP INDEX IF EXISTS idx_recon_exception_cases_opened_at;
    DROP INDEX IF EXISTS idx_recon_exception_cases_assigned_to;
    DROP INDEX IF EXISTS idx_recon_exception_cases_priority;
    DROP INDEX IF EXISTS idx_recon_exception_cases_severity;
    DROP INDEX IF EXISTS idx_recon_exception_cases_status;
    DROP INDEX IF EXISTS idx_recon_exception_cases_tenant;
    DROP INDEX IF EXISTS idx_recon_bank_setl_checked_at;
    DROP INDEX IF EXISTS idx_recon_bank_setl_settlement_ref;
    DROP INDEX IF EXISTS idx_recon_bank_setl_status;
    DROP INDEX IF EXISTS idx_recon_bank_setl_tenant;

    ALTER TABLE payout_instructions
      DROP CONSTRAINT IF EXISTS chk_payout_instructions_payout_amount_positive;
    ALTER TABLE reconciliation_transactions
      DROP CONSTRAINT IF EXISTS chk_recon_tx_discrepancy_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_tx_ledger_amount_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_tx_transaction_amount_nonnegative;
    ALTER TABLE reconciliation_settlements
      DROP CONSTRAINT IF EXISTS chk_recon_setl_discrepancy_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_ledger_net_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_settlement_net_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_ledger_fee_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_settlement_fee_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_ledger_gross_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_setl_settlement_gross_nonnegative;
    ALTER TABLE reconciliation_bank_settlements
      DROP CONSTRAINT IF EXISTS chk_recon_bank_setl_discrepancy_amount_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_bank_setl_bank_amount_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_bank_setl_payout_amount_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_recon_bank_setl_settlement_amount_nonnegative,
      DROP CONSTRAINT IF EXISTS fk_recon_bank_setl_bank_statement_line,
      DROP CONSTRAINT IF EXISTS fk_recon_bank_setl_payout_instruction,
      DROP CONSTRAINT IF EXISTS fk_recon_bank_setl_settlement;
  `);
};
