const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const reconciliationExceptionService = require('../src/core/ledger/reconciliation-exception-service');

async function createTenant(prefix = 'ri-hardening') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Referential Integrity Hardening Test',
    status: 'active'
  });
  return tenantId;
}

async function createSettlement(tenantId, overrides = {}) {
  const settlementRef = overrides.settlementRef || `SETL-RI-${uuidv4()}`;
  const [settlement] = await db.knex('settlements').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    merchant_id: overrides.merchantId || tenantId,
    settlement_ref: settlementRef,
    settlement_date: new Date(),
    period_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    period_to: new Date(),
    gross_amount: overrides.grossAmount || '100.00',
    fees_amount: overrides.feesAmount || '10.00',
    net_amount: overrides.netAmount || '90.00',
    bank_account_number: '1234567890',
    bank_ifsc: 'TEST0001234',
    bank_name: 'Test Bank',
    status: overrides.status || 'CREATED',
    metadata: JSON.stringify({ currency: overrides.currency || 'INR', test: true }),
    created_by: 'test'
  }).returning('*');
  return settlement;
}

async function createPayoutInstruction(settlement, overrides = {}) {
  const [instruction] = await db.knex('payout_instructions').insert({
    id: overrides.id || uuidv4(),
    tenant_id: settlement.tenant_id,
    settlement_id: settlement.id,
    settlement_ref: settlement.settlement_ref,
    merchant_id: settlement.merchant_id,
    payout_amount: overrides.payoutAmount || settlement.net_amount,
    currency: overrides.currency || 'INR',
    payout_status: overrides.payoutStatus || 'SUCCESS',
    bank_idempotency_key: overrides.bankIdempotencyKey || `payout:${settlement.tenant_id}:${settlement.settlement_ref}:${uuidv4()}`,
    retry_count: 0,
    raw_bank_response: JSON.stringify({ test: true }),
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return instruction;
}

async function createBankStatementLine(tenantId, overrides = {}) {
  const [batch] = await db.knex('bank_statement_batches').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    source_type: 'MANUAL_UPLOAD',
    source_filename: `ri-${uuidv4()}.json`,
    import_status: 'COMPLETED',
    total_lines: 1,
    imported_lines: 1,
    duplicate_lines: 0,
    failed_lines: 0,
    imported_at: new Date(),
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');

  const [line] = await db.knex('bank_statement_lines').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    batch_id: batch.id,
    transaction_date: overrides.transactionDate || new Date(),
    value_date: overrides.valueDate || new Date(),
    bank_transaction_id: overrides.bankTransactionId || `BTX-RI-${uuidv4()}`,
    utr_number: overrides.utrNumber || `UTR-RI-${uuidv4()}`,
    bank_reference_number: overrides.bankReferenceNumber || `BNK-RI-${uuidv4()}`,
    narration: overrides.narration || 'referential integrity bank debit',
    description: overrides.description || 'referential integrity bank debit',
    debit_amount: overrides.debitAmount || '90.00',
    credit_amount: '0.00',
    amount: overrides.amount || overrides.debitAmount || '90.00',
    currency: overrides.currency || 'INR',
    transaction_type: 'DEBIT',
    raw_payload: JSON.stringify({ test: true }),
    normalized_hash: overrides.normalizedHash || uuidv4(),
    reconciliation_status: 'UNMATCHED',
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return line;
}

async function insertBankSettlementRecon({
  settlement,
  payoutInstruction,
  bankStatementLine = null,
  overrides = {}
}) {
  const [row] = await db.knex('reconciliation_bank_settlements').insert({
    id: overrides.id || uuidv4(),
    tenant_id: settlement.tenant_id,
    settlement_id: overrides.settlementId === undefined ? settlement.id : overrides.settlementId,
    settlement_ref: settlement.settlement_ref,
    payout_instruction_id: overrides.payoutInstructionId === undefined ? payoutInstruction.id : overrides.payoutInstructionId,
    bank_statement_line_id: overrides.bankStatementLineId === undefined ? bankStatementLine?.id || null : overrides.bankStatementLineId,
    reconciliation_status: overrides.status || 'MATCHED',
    settlement_amount: overrides.settlementAmount || settlement.net_amount,
    payout_amount: overrides.payoutAmount || payoutInstruction.payout_amount,
    bank_amount: overrides.bankAmount === undefined ? bankStatementLine?.amount || null : overrides.bankAmount,
    discrepancy_amount: overrides.discrepancyAmount || '0.00',
    settlement_currency: overrides.settlementCurrency || payoutInstruction.currency,
    bank_currency: overrides.bankCurrency === undefined ? bankStatementLine?.currency || null : overrides.bankCurrency,
    expected_utr_number: overrides.expectedUtr || payoutInstruction.utr_number || null,
    actual_utr_number: overrides.actualUtr || bankStatementLine?.utr_number || null,
    metadata: JSON.stringify({ test: true }),
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return row;
}

describe('Sprint 2D - referential integrity and financial control hardening', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('reconciliation_bank_settlements requires valid settlement_id', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);

    await expect(insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: { settlementId: uuidv4(), status: 'MISSING_BANK_STATEMENT' }
    })).rejects.toThrow();
  });

  test('reconciliation_bank_settlements requires valid payout_instruction_id', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);

    await expect(insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: { payoutInstructionId: uuidv4(), status: 'MISSING_BANK_STATEMENT' }
    })).rejects.toThrow();
  });

  test('reconciliation_bank_settlements allows null bank_statement_line_id for missing bank statement', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);

    const row = await insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: {
        status: 'MISSING_BANK_STATEMENT',
        bankStatementLineId: null,
        bankAmount: null,
        bankCurrency: null,
        discrepancyAmount: '90.00'
      }
    });

    expect(row.bank_statement_line_id).toBeNull();
    expect(row.reconciliation_status).toBe('MISSING_BANK_STATEMENT');
  });

  test('reconciliation_bank_settlements rejects invalid bank_statement_line_id', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);

    await expect(insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: { bankStatementLineId: uuidv4() }
    })).rejects.toThrow();
  });

  test('ON DELETE behavior is restrictive for settlement and payout parents', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);
    const bankStatementLine = await createBankStatementLine(tenantId);
    const reconciliation = await insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      bankStatementLine
    });

    await expect(db.knex('settlements').where('id', settlement.id).del()).rejects.toThrow();
    await expect(db.knex('payout_instructions').where('id', payoutInstruction.id).del()).rejects.toThrow();

    const preserved = await db.knex('reconciliation_bank_settlements')
      .where('id', reconciliation.id)
      .first();
    expect(preserved).toBeTruthy();
  });

  test('amount check constraints reject negative reconciliation and payout amounts', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);

    await expect(insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: {
        status: 'MISSING_BANK_STATEMENT',
        discrepancyAmount: '-1.00'
      }
    })).rejects.toThrow();

    await expect(createPayoutInstruction(settlement, {
      payoutAmount: '-10.00',
      bankIdempotencyKey: `negative-payout:${uuidv4()}`
    })).rejects.toThrow();
  });

  test('exception service rejects invalid polymorphic source reference', async () => {
    const tenantId = await createTenant();

    await expect(reconciliationExceptionService.createOrUpdateExceptionFromReconciliation({
      tenantId,
      sourceType: 'BANK_SETTLEMENT',
      sourceReconciliationId: uuidv4(),
      sourceStatus: 'MISSING_BANK_STATEMENT'
    })).rejects.toThrow('Source reconciliation record not found');

    const rows = await db.knex('reconciliation_exception_cases')
      .where({ tenant_id: tenantId });
    expect(rows).toHaveLength(0);
  });

  test('exception service accepts valid polymorphic source reference', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payoutInstruction = await createPayoutInstruction(settlement);
    const reconciliation = await insertBankSettlementRecon({
      settlement,
      payoutInstruction,
      overrides: {
        status: 'MISSING_BANK_STATEMENT',
        bankStatementLineId: null,
        bankAmount: null,
        bankCurrency: null,
        discrepancyAmount: '90.00'
      }
    });

    const exceptionCase = await reconciliationExceptionService.createOrUpdateExceptionFromReconciliation({
      tenantId,
      sourceType: 'BANK_SETTLEMENT',
      sourceReconciliationId: reconciliation.id,
      sourceStatus: reconciliation.reconciliation_status
    });

    expect(exceptionCase).toMatchObject({
      tenant_id: tenantId,
      source_type: 'BANK_SETTLEMENT',
      source_reconciliation_id: reconciliation.id,
      case_status: 'OPEN'
    });
  });
});
