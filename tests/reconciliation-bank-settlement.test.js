const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const reconciliationService = require('../src/core/ledger/reconciliation-service');
const bankStatementImportService = require('../src/core/bank/bank-statement-import-service');
const payoutInstructionService = require('../src/core/bank/payout-instruction-service');
const createReconciliationRoutes = require('../src/api/reconciliation-routes');
const SecurityService = require('../src/security/security-service');
const config = require('../src/config/config');

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function createTenant(prefix = 'bank-settle-recon') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Bank Settlement Reconciliation Test',
    status: 'active'
  });
  return tenantId;
}

async function createSettlement(tenantId, overrides = {}) {
  const settlementRef = overrides.settlementRef || `SETL-${uuidv4()}`;
  await db.knex('settlements').insert({
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
  });

  return db.knex('settlements').where({ tenant_id: tenantId, settlement_ref: settlementRef }).first();
}

function debitLine(overrides = {}) {
  return {
    transactionDate: overrides.transactionDate || today(),
    valueDate: overrides.valueDate || today(),
    debitAmount: overrides.debitAmount || overrides.amount || '90.00',
    creditAmount: '0.00',
    currency: overrides.currency || 'INR',
    narration: overrides.narration || `merchant payout ${uuidv4()}`,
    counterpartyName: 'Merchant A',
    counterpartyAccount: '9999999999',
    ...overrides
  };
}

async function importDebitLine(tenantId, lineOverrides = {}) {
  await bankStatementImportService.importBankStatementBatch({
    tenantId,
    sourceType: 'MANUAL_UPLOAD',
    sourceFilename: `bank-recon-${uuidv4()}.json`,
    lines: [debitLine(lineOverrides)]
  });

  let query = db.knex('bank_statement_lines').where({ tenant_id: tenantId });
  if (lineOverrides.bankTransactionId) query = query.where('bank_transaction_id', lineOverrides.bankTransactionId);
  if (lineOverrides.utrNumber) query = query.where('utr_number', lineOverrides.utrNumber);
  if (lineOverrides.bankReferenceNumber) query = query.where('bank_reference_number', lineOverrides.bankReferenceNumber);
  if (!lineOverrides.bankTransactionId && !lineOverrides.utrNumber && !lineOverrides.bankReferenceNumber) {
    query = query.where('narration', lineOverrides.narration);
  }
  return query.orderBy('created_at', 'desc').first();
}

async function createPayout(settlement, refs = {}) {
  const instruction = await payoutInstructionService.createPayoutInstruction(settlement);
  await payoutInstructionService.markPayoutSubmitted({
    tenantId: settlement.tenant_id,
    payoutInstructionId: instruction.id
  });
  await payoutInstructionService.markPayoutAccepted({
    tenantId: settlement.tenant_id,
    payoutInstructionId: instruction.id
  });
  return payoutInstructionService.markPayoutSuccess({
    tenantId: settlement.tenant_id,
    payoutInstructionId: instruction.id,
    utrNumber: refs.utrNumber,
    bankReferenceNumber: refs.bankReferenceNumber,
    bankTransactionId: refs.bankTransactionId
  });
}

function tokenFor(tenantId, role = 'FINANCE_ADMIN') {
  return new SecurityService(config).generateJWT({
    userId: `user-${uuidv4()}`,
    tenantId,
    role
  });
}

describe('Sprint 2B Phase 3B - settlement/payout to bank reconciliation', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('MATCHED when payout instruction and bank debit evidence agree', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, {
      utrNumber: 'UTR-MATCH-001',
      bankReferenceNumber: 'BNK-MATCH-001',
      bankTransactionId: 'BTX-MATCH-001'
    });
    const bankLine = await importDebitLine(tenantId, {
      utrNumber: 'UTR-MATCH-001',
      bankReferenceNumber: 'BNK-MATCH-001',
      bankTransactionId: 'BTX-MATCH-001',
      debitAmount: '90.00',
      narration: 'merchant payout matched'
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('MATCHED');
    expect(result.bank_statement_line_id).toBe(bankLine.id);
    expect(result.settlement_id).toBe(settlement.id);
    expect(result.payout_instruction_id).toBe(payout.id);
    expect(Number(result.discrepancy_amount)).toBe(0);
  });

  test('MISSING_BANK_STATEMENT when payout has no external bank evidence', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, { utrNumber: 'UTR-MISSING-BANK' });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('MISSING_BANK_STATEMENT');
    expect(result.bank_statement_line_id).toBeNull();
    expect(Number(result.discrepancy_amount)).toBe(90);
  });

  test('MISSING_PAYOUT_INSTRUCTION when settlement has no payout instruction', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);

    const result = await reconciliationService.reconcileBankSettlement(settlement);

    expect(result.reconciliation_status).toBe('MISSING_PAYOUT_INSTRUCTION');
    expect(result.settlement_id).toBe(settlement.id);
    expect(result.payout_instruction_id).toBeNull();
  });

  test('AMOUNT_MISMATCH when payout amount differs from bank debit amount', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId, {
      grossAmount: '10000.00',
      feesAmount: '300.00',
      netAmount: '9700.00'
    });
    const payout = await createPayout(settlement, { utrNumber: 'UTR-AMOUNT-MISMATCH' });
    await importDebitLine(tenantId, {
      utrNumber: 'UTR-AMOUNT-MISMATCH',
      debitAmount: '9600.00',
      narration: 'merchant payout amount mismatch'
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('AMOUNT_MISMATCH');
    expect(Number(result.discrepancy_amount)).toBe(100);
  });

  test('CURRENCY_MISMATCH when payout and bank line currencies differ', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, { utrNumber: 'UTR-CURRENCY-MISMATCH' });
    await importDebitLine(tenantId, {
      utrNumber: 'UTR-CURRENCY-MISMATCH',
      debitAmount: '90.00',
      currency: 'USD',
      narration: 'merchant payout currency mismatch'
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('CURRENCY_MISMATCH');
  });

  test('UTR_MISMATCH when strong bank transaction id matches but UTR differs', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, {
      utrNumber: 'UTR-EXPECTED-001',
      bankTransactionId: 'BTX-UTR-MISMATCH'
    });
    await importDebitLine(tenantId, {
      utrNumber: 'UTR-ACTUAL-001',
      bankTransactionId: 'BTX-UTR-MISMATCH',
      debitAmount: '90.00',
      narration: 'merchant payout utr mismatch'
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('UTR_MISMATCH');
    expect(result.expected_utr_number).toBe('UTR-EXPECTED-001');
    expect(result.actual_utr_number).toBe('UTR-ACTUAL-001');
  });

  test('BANK_REFERENCE_MISMATCH when strong bank transaction id matches but bank reference differs', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, {
      bankReferenceNumber: 'BNK-EXPECTED-001',
      bankTransactionId: 'BTX-BANKREF-MISMATCH'
    });
    await importDebitLine(tenantId, {
      bankReferenceNumber: 'BNK-ACTUAL-001',
      bankTransactionId: 'BTX-BANKREF-MISMATCH',
      debitAmount: '90.00',
      narration: 'merchant payout bank reference mismatch'
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('BANK_REFERENCE_MISMATCH');
    expect(result.expected_bank_reference_number).toBe('BNK-EXPECTED-001');
    expect(result.actual_bank_reference_number).toBe('BNK-ACTUAL-001');
  });

  test('DUPLICATE_BANK_MATCH when two bank debits are candidates for one payout', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await payoutInstructionService.createPayoutInstruction(settlement);

    await importDebitLine(tenantId, {
      debitAmount: '90.00',
      narration: `weak duplicate bank line A ${uuidv4()}`
    });
    await importDebitLine(tenantId, {
      debitAmount: '90.00',
      narration: `weak duplicate bank line B ${uuidv4()}`
    });

    const result = await reconciliationService.reconcileBankSettlement(payout);

    expect(result.reconciliation_status).toBe('DUPLICATE_BANK_MATCH');
    expect(result.bank_statement_line_id).toBeNull();
  });

  test('DUPLICATE_PAYOUT when one bank line is already linked to another payout', async () => {
    const tenantId = await createTenant();
    const firstSettlement = await createSettlement(tenantId);
    const secondSettlement = await createSettlement(tenantId);
    const firstPayout = await payoutInstructionService.createPayoutInstruction(firstSettlement);
    const secondPayout = await payoutInstructionService.createPayoutInstruction(secondSettlement);
    const bankLine = await importDebitLine(tenantId, {
      debitAmount: '90.00',
      narration: `single weak bank line ${uuidv4()}`
    });

    const first = await reconciliationService.reconcileBankSettlement(firstPayout);
    const second = await reconciliationService.reconcileBankSettlement(secondPayout);

    expect(first.reconciliation_status).toBe('MATCHED');
    expect(first.bank_statement_line_id).toBe(bankLine.id);
    expect(second.reconciliation_status).toBe('DUPLICATE_PAYOUT');
    expect(second.bank_statement_line_id).toBeNull();
  });

  test('RETURNED_OR_REVERSED when payout instruction is returned', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const instruction = await payoutInstructionService.createPayoutInstruction(settlement);
    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: instruction.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: instruction.id });
    await payoutInstructionService.markPayoutProcessing({ tenantId, payoutInstructionId: instruction.id });
    const returned = await payoutInstructionService.markPayoutReturned({
      tenantId,
      payoutInstructionId: instruction.id,
      returnReason: 'bank returned'
    });

    const result = await reconciliationService.reconcileBankSettlement(returned);

    expect(result.reconciliation_status).toBe('RETURNED_OR_REVERSED');
  });

  test('idempotent bank-settlement reconciliation updates one row', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);
    const payout = await createPayout(settlement, { utrNumber: 'UTR-IDEMPOTENT-001' });
    await importDebitLine(tenantId, {
      utrNumber: 'UTR-IDEMPOTENT-001',
      debitAmount: '90.00',
      narration: 'merchant payout idempotent'
    });

    const first = await reconciliationService.reconcileBankSettlement(payout);
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await reconciliationService.reconcileBankSettlement(payout);
    const rows = await db.knex('reconciliation_bank_settlements')
      .where({ tenant_id: tenantId, payout_instruction_id: payout.id });

    expect(rows).toHaveLength(1);
    expect(second.reconciliation_status).toBe('MATCHED');
    expect(new Date(second.checked_at).getTime()).toBeGreaterThanOrEqual(new Date(first.checked_at).getTime());
  });

  test('read-only API filters bank settlement reconciliation and enforces tenant isolation', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const settlement = await createSettlement(tenantId, { netAmount: '100.00', grossAmount: '110.00', feesAmount: '10.00' });
    const payout = await createPayout(settlement, { utrNumber: 'UTR-API-AMOUNT-MISMATCH' });
    await importDebitLine(tenantId, {
      utrNumber: 'UTR-API-AMOUNT-MISMATCH',
      debitAmount: '95.00',
      narration: 'api amount mismatch'
    });
    const otherSettlement = await createSettlement(otherTenantId);
    const otherPayout = await createPayout(otherSettlement, { utrNumber: 'UTR-API-OTHER' });
    await importDebitLine(otherTenantId, {
      utrNumber: 'UTR-API-OTHER',
      debitAmount: '90.00',
      narration: 'api other matched'
    });

    await reconciliationService.reconcileBankSettlement(payout);
    await reconciliationService.reconcileBankSettlement(otherPayout);

    const app = express();
    app.use('/api/reconciliation', createReconciliationRoutes(config));

    const tenantToken = tokenFor(tenantId);
    const response = await request(app)
      .get(`/api/reconciliation/bank-settlements?tenantId=${tenantId}&status=AMOUNT_MISMATCH&utr_number=UTR-API-AMOUNT-MISMATCH`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0]).toMatchObject({
      tenant_id: tenantId,
      settlement_ref: settlement.settlement_ref,
      reconciliation_status: 'AMOUNT_MISMATCH'
    });

    await request(app)
      .get(`/api/reconciliation/bank-settlements?tenantId=${otherTenantId}`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(403);

    const platformToken = tokenFor(tenantId, 'PLATFORM_ADMIN');
    const platformResponse = await request(app)
      .get(`/api/reconciliation/bank-settlements?tenantId=${otherTenantId}&status=MATCHED`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(platformResponse.body.records).toHaveLength(1);
    expect(platformResponse.body.records[0].tenant_id).toBe(otherTenantId);
  });
});
