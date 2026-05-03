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

async function assertNoOrphans(knex, { childTable, childColumn, parentTable, parentColumn = 'id' }) {
  if (!(await tableExists(knex, childTable)) || !(await tableExists(knex, parentTable))) return;
  if (!(await columnExists(knex, childTable, childColumn))) return;

  const result = await knex.raw(`
    SELECT c.id, c.${childColumn}
    FROM ${childTable} c
    LEFT JOIN ${parentTable} p ON p.${parentColumn} = c.${childColumn}
    WHERE c.${childColumn} IS NOT NULL
      AND p.${parentColumn} IS NULL
    LIMIT 10
  `);

  if (result.rows.length > 0) {
    const sample = result.rows.map(row => `${row.id}:${row[childColumn]}`).join(', ');
    throw new Error(`Cannot add FK ${childTable}.${childColumn} -> ${parentTable}.${parentColumn}; orphan rows exist: ${sample}`);
  }
}

async function replaceForeignKey(knex, options) {
  const {
    childTable,
    childColumn,
    parentTable,
    parentColumn = 'id',
    constraintName
  } = options;

  if (!(await tableExists(knex, childTable)) || !(await tableExists(knex, parentTable))) return;
  if (!(await columnExists(knex, childTable, childColumn))) return;

  await assertNoOrphans(knex, options);
  await knex.raw(`ALTER TABLE ${childTable} DROP CONSTRAINT IF EXISTS ${constraintName}`);
  await knex.raw(`
    ALTER TABLE ${childTable}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${childColumn})
      REFERENCES ${parentTable} (${parentColumn})
      ON DELETE RESTRICT
  `);
}

async function assertNoInvalidAmounts(knex, tableName, columns, expression = null) {
  if (!(await tableExists(knex, tableName))) return;
  const existingColumns = [];
  for (const column of columns) {
    if (await columnExists(knex, tableName, column)) existingColumns.push(column);
  }
  if (existingColumns.length === 0) return;

  const predicate = expression || existingColumns.map(column => `(${column} IS NOT NULL AND ${column} < 0)`).join(' OR ');
  const result = await knex.raw(`
    SELECT id
    FROM ${tableName}
    WHERE ${predicate}
    LIMIT 10
  `);

  if (result.rows.length > 0) {
    throw new Error(`Cannot add amount check on ${tableName}; invalid rows exist: ${result.rows.map(row => row.id).join(', ')}`);
  }
}

async function addCheckIfMissing(knex, tableName, constraintName, checkSql, columns, invalidExpression = null) {
  if (!(await tableExists(knex, tableName))) return;
  if (await constraintExists(knex, tableName, constraintName)) return;
  await assertNoInvalidAmounts(knex, tableName, columns, invalidExpression);
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} CHECK (${checkSql})`);
}

exports.up = async function(knex) {
  await replaceForeignKey(knex, {
    childTable: 'gateway_settlement_lines',
    childColumn: 'outbox_event_id',
    parentTable: 'outbox_events',
    constraintName: 'gateway_settlement_lines_outbox_event_id_foreign'
  });

  await replaceForeignKey(knex, {
    childTable: 'gateway_settlement_signals',
    childColumn: 'batch_id',
    parentTable: 'gateway_settlement_batches',
    constraintName: 'gateway_settlement_signals_batch_id_foreign'
  });

  await replaceForeignKey(knex, {
    childTable: 'gateway_settlement_signals',
    childColumn: 'line_id',
    parentTable: 'gateway_settlement_lines',
    constraintName: 'gateway_settlement_signals_line_id_foreign'
  });

  await replaceForeignKey(knex, {
    childTable: 'gateway_settlement_lines',
    childColumn: 'pricing_rule_id',
    parentTable: 'pricing_rules',
    constraintName: 'fk_gateway_setl_lines_pricing_rule'
  });

  await addCheckIfMissing(
    knex,
    'gateway_settlement_lines',
    'chk_gateway_setl_line_expected_amounts_nonnegative',
    `
      (expected_gateway_fee IS NULL OR expected_gateway_fee >= 0)
      AND (expected_gst_amount IS NULL OR expected_gst_amount >= 0)
      AND (expected_net_amount IS NULL OR expected_net_amount >= 0)
      AND (fee_discrepancy_amount IS NULL OR fee_discrepancy_amount >= 0)
      AND (gst_discrepancy_amount IS NULL OR gst_discrepancy_amount >= 0)
      AND (net_discrepancy_amount IS NULL OR net_discrepancy_amount >= 0)
    `,
    [
      'expected_gateway_fee',
      'expected_gst_amount',
      'expected_net_amount',
      'fee_discrepancy_amount',
      'gst_discrepancy_amount',
      'net_discrepancy_amount'
    ]
  );

  await addCheckIfMissing(
    knex,
    'gateway_settlement_signals',
    'chk_gateway_setl_signals_impact_nonnegative',
    '(impact_amount IS NULL OR impact_amount >= 0)',
    ['impact_amount']
  );

  await addCheckIfMissing(
    knex,
    'pricing_rules',
    'chk_pricing_rules_amounts_nonnegative',
    `
      (mdr_percentage IS NULL OR mdr_percentage >= 0)
      AND (fixed_fee IS NULL OR fixed_fee >= 0)
      AND (gst_percentage IS NULL OR gst_percentage >= 0)
    `,
    ['mdr_percentage', 'fixed_fee', 'gst_percentage']
  );

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_gateway_setl_batches_tenant_source_ref
      ON gateway_settlement_batches (tenant_id, source_reference);
    CREATE INDEX IF NOT EXISTS idx_gateway_setl_batches_tenant_gateway_settlement_id
      ON gateway_settlement_batches (tenant_id, gateway_settlement_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_setl_lines_tenant_settled_at
      ON gateway_settlement_lines (tenant_id, settled_at);
    CREATE INDEX IF NOT EXISTS idx_gateway_setl_signals_tenant_transaction_ref
      ON gateway_settlement_signals (tenant_id, transaction_ref);
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_gateway_setl_signals_tenant_transaction_ref;
    DROP INDEX IF EXISTS idx_gateway_setl_lines_tenant_settled_at;
    DROP INDEX IF EXISTS idx_gateway_setl_batches_tenant_gateway_settlement_id;
    DROP INDEX IF EXISTS idx_gateway_setl_batches_tenant_source_ref;

    ALTER TABLE IF EXISTS pricing_rules
      DROP CONSTRAINT IF EXISTS chk_pricing_rules_amounts_nonnegative;
    ALTER TABLE IF EXISTS gateway_settlement_signals
      DROP CONSTRAINT IF EXISTS chk_gateway_setl_signals_impact_nonnegative;
    ALTER TABLE IF EXISTS gateway_settlement_lines
      DROP CONSTRAINT IF EXISTS chk_gateway_setl_line_expected_amounts_nonnegative;
    ALTER TABLE IF EXISTS gateway_settlement_lines
      DROP CONSTRAINT IF EXISTS fk_gateway_setl_lines_pricing_rule;
  `);
};
