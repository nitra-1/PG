const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const bankStatementImportService = require('../src/core/bank/bank-statement-import-service');
const payoutInstructionService = require('../src/core/bank/payout-instruction-service');
const createBankStatementRoutes = require('../src/api/bank-statement-routes');
const createPayoutInstructionRoutes = require('../src/api/payout-instruction-routes');
const SecurityService = require('../src/security/security-service');
const config = require('../src/config/config');

async function createTenant(prefix = 'bank-foundation') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Bank Payout Foundation Test',
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

function tokenFor(tenantId, role = 'FINANCE_ADMIN') {
  return new SecurityService(config).generateJWT({
    userId: `user-${uuidv4()}`,
    tenantId,
    role
  });
}

function validCreditLine(overrides = {}) {
  return {
    transactionDate: overrides.transactionDate || '2026-05-01',
    valueDate: overrides.valueDate || '2026-05-01',
    creditAmount: overrides.creditAmount || '90.00',
    debitAmount: overrides.debitAmount || '0.00',
    currency: overrides.currency || 'INR',
    narration: overrides.narration || `NEFT/UTR${uuidv4().replace(/-/g, '').slice(0, 12)} REF:BNK${uuidv4().slice(0, 8)} TXN:BTX${uuidv4().slice(0, 8)}`,
    counterpartyName: 'Merchant A',
    counterpartyAccount: '9999999999',
    ...overrides
  };
}

describe('Sprint 2B Phase 3A - bank/payout external truth foundation', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('imports a bank statement batch with valid lines', async () => {
    const tenantId = await createTenant();
    const result = await bankStatementImportService.importBankStatementBatch({
      tenantId,
      sourceType: 'MANUAL_UPLOAD',
      sourceFilename: 'sample.csv',
      lines: [validCreditLine(), validCreditLine({ creditAmount: '125.50' })]
    });

    const lines = await db.knex('bank_statement_lines').where({ tenant_id: tenantId, batch_id: result.batch.id });

    expect(result.batch.import_status).toBe('COMPLETED');
    expect(Number(result.batch.total_lines)).toBe(2);
    expect(Number(result.batch.imported_lines)).toBe(2);
    expect(lines).toHaveLength(2);
    expect(lines.every(line => line.reconciliation_status === 'UNMATCHED')).toBe(true);
  });

  test('marks duplicate bank statement lines without failing the batch', async () => {
    const tenantId = await createTenant();
    const line = validCreditLine({
      narration: 'NEFT/UTRABC123456789 REF:BNK-DUP-001 TXN:BTX-DUP-001'
    });

    const result = await bankStatementImportService.importBankStatementBatch({
      tenantId,
      sourceType: 'MANUAL_UPLOAD',
      sourceFilename: 'dups.csv',
      lines: [line, line]
    });
    const lines = await db.knex('bank_statement_lines').where({ tenant_id: tenantId });

    expect(result.batch.import_status).toBe('COMPLETED');
    expect(Number(result.batch.imported_lines)).toBe(1);
    expect(Number(result.batch.duplicate_lines)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].reconciliation_status).toBe('DUPLICATE');
  });

  test('continues import when a bank statement line is invalid', async () => {
    const tenantId = await createTenant();
    const result = await bankStatementImportService.importBankStatementBatch({
      tenantId,
      sourceType: 'MANUAL_UPLOAD',
      sourceFilename: 'invalid.csv',
      lines: [
        validCreditLine(),
        {
          transactionDate: '2026-05-01',
          creditAmount: '10.00',
          debitAmount: '10.00',
          narration: 'bad both debit and credit'
        }
      ]
    });

    expect(result.batch.import_status).toBe('COMPLETED');
    expect(Number(result.batch.imported_lines)).toBe(1);
    expect(Number(result.batch.failed_lines)).toBe(1);
  });

  test('extracts normalized references from narration', async () => {
    const normalized = bankStatementImportService.normalizeBankStatementLine(validCreditLine({
      narration: 'IMPS/UTR987654321 REF:BNKREF-12345 TXN:BTXN-77777'
    }));

    expect(normalized.utr_number).toBe('UTR987654321');
    expect(normalized.bank_reference_number).toBe('BNKREF-12345');
    expect(normalized.bank_transaction_id).toBe('BTXN-77777');
  });

  test('creates payout instruction idempotently from settlement', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId);

    const first = await payoutInstructionService.createPayoutInstruction(settlement);
    const second = await payoutInstructionService.createPayoutInstruction(settlement);
    const rows = await db.knex('payout_instructions').where({ tenant_id: tenantId, settlement_ref: settlement.settlement_ref });

    expect(first.id).toBe(second.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].bank_idempotency_key).toBe(`payout:${tenantId}:${settlement.settlement_ref}`);
  });

  test('enforces payout status transitions', async () => {
    const tenantId = await createTenant();
    const successSettlement = await createSettlement(tenantId);
    const successInstruction = await payoutInstructionService.createPayoutInstruction(successSettlement);

    const submitted = await payoutInstructionService.markPayoutSubmitted({
      tenantId,
      payoutInstructionId: successInstruction.id,
      rawBankResponse: { requestId: 'REQ-1' }
    });
    const accepted = await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: submitted.id });
    const success = await payoutInstructionService.markPayoutSuccess({
      tenantId,
      payoutInstructionId: accepted.id,
      utrNumber: 'UTR-PAYOUT-SUCCESS',
      bankReferenceNumber: 'BNK-PAYOUT-SUCCESS',
      bankTransactionId: 'BTX-PAYOUT-SUCCESS'
    });
    expect(success.payout_status).toBe('SUCCESS');
    await expect(payoutInstructionService.markPayoutSubmitted({
      tenantId,
      payoutInstructionId: success.id
    })).rejects.toThrow('Cannot transition terminal payout status SUCCESS to SUBMITTED');

    const rejected = await payoutInstructionService.createPayoutInstruction(await createSettlement(tenantId));
    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: rejected.id });
    const rejectedFinal = await payoutInstructionService.markPayoutRejected({
      tenantId,
      payoutInstructionId: rejected.id,
      failureReason: 'beneficiary rejected'
    });
    expect(rejectedFinal.payout_status).toBe('REJECTED');

    const returned = await payoutInstructionService.createPayoutInstruction(await createSettlement(tenantId));
    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: returned.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: returned.id });
    await payoutInstructionService.markPayoutProcessing({ tenantId, payoutInstructionId: returned.id });
    const returnedFinal = await payoutInstructionService.markPayoutReturned({
      tenantId,
      payoutInstructionId: returned.id,
      returnReason: 'bank return'
    });
    expect(returnedFinal.payout_status).toBe('RETURNED');

    const timeout = await payoutInstructionService.createPayoutInstruction(await createSettlement(tenantId));
    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: timeout.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: timeout.id });
    await payoutInstructionService.markPayoutProcessing({ tenantId, payoutInstructionId: timeout.id });
    const timeoutFinal = await payoutInstructionService.markPayoutTimeout({ tenantId, payoutInstructionId: timeout.id });
    expect(timeoutFinal.payout_status).toBe('TIMEOUT');
    await expect(payoutInstructionService.markPayoutSuccess({
      tenantId,
      payoutInstructionId: timeoutFinal.id
    })).rejects.toThrow('Cannot transition terminal payout status TIMEOUT to SUCCESS');
  });

  test('enforces tenant-scoped payout UTR uniqueness', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const first = await payoutInstructionService.createPayoutInstruction(await createSettlement(tenantId));
    const second = await payoutInstructionService.createPayoutInstruction(await createSettlement(tenantId));
    const otherTenantInstruction = await payoutInstructionService.createPayoutInstruction(await createSettlement(otherTenantId));

    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: first.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: first.id });
    await payoutInstructionService.markPayoutSuccess({ tenantId, payoutInstructionId: first.id, utrNumber: 'UTR-UNIQUE-001' });

    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: second.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: second.id });
    await expect(payoutInstructionService.markPayoutSuccess({
      tenantId,
      payoutInstructionId: second.id,
      utrNumber: 'UTR-UNIQUE-001'
    })).rejects.toThrow();

    await payoutInstructionService.markPayoutSubmitted({ tenantId: otherTenantId, payoutInstructionId: otherTenantInstruction.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId: otherTenantId, payoutInstructionId: otherTenantInstruction.id });
    const other = await payoutInstructionService.markPayoutSuccess({
      tenantId: otherTenantId,
      payoutInstructionId: otherTenantInstruction.id,
      utrNumber: 'UTR-UNIQUE-001'
    });
    expect(other.payout_status).toBe('SUCCESS');
  });

  test('bank statement APIs filter records and enforce tenant isolation', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    await bankStatementImportService.importBankStatementBatch({
      tenantId,
      sourceType: 'MANUAL_UPLOAD',
      sourceFilename: 'api.csv',
      lines: [validCreditLine({
        creditAmount: '77.00',
        narration: 'NEFT/UTRAPI123456 REF:BNK-API-001 TXN:BTX-API-001'
      })]
    });
    await bankStatementImportService.importBankStatementBatch({
      tenantId: otherTenantId,
      sourceType: 'MANUAL_UPLOAD',
      sourceFilename: 'other.csv',
      lines: [validCreditLine()]
    });

    const app = express();
    app.use(express.json());
    app.use('/api/bank-statements', createBankStatementRoutes(config));
    const token = tokenFor(tenantId);

    const byUtr = await request(app)
      .get(`/api/bank-statements/lines?tenantId=${tenantId}&utr_number=UTRAPI123456`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byUtr.body.records).toHaveLength(1);

    const byAmount = await request(app)
      .get(`/api/bank-statements/lines?tenantId=${tenantId}&amount=77.00&transaction_type=CREDIT&reconciliation_status=UNMATCHED`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byAmount.body.records).toHaveLength(1);

    await request(app)
      .get(`/api/bank-statements/lines?tenantId=${otherTenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  test('payout instruction APIs filter records and enforce tenant isolation', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const settlement = await createSettlement(tenantId, { settlementRef: `SETL-API-${uuidv4()}` });
    const instruction = await payoutInstructionService.createPayoutInstruction(settlement);
    await payoutInstructionService.markPayoutSubmitted({ tenantId, payoutInstructionId: instruction.id });
    await payoutInstructionService.markPayoutAccepted({ tenantId, payoutInstructionId: instruction.id });
    await payoutInstructionService.markPayoutSuccess({
      tenantId,
      payoutInstructionId: instruction.id,
      bankReferenceNumber: 'BNK-API-PAYOUT-001',
      utrNumber: `UTR-API-PAYOUT-${uuidv4().slice(0, 8)}`
    });

    const otherInstruction = await payoutInstructionService.createPayoutInstruction(await createSettlement(otherTenantId));
    expect(otherInstruction.tenant_id).toBe(otherTenantId);

    const app = express();
    app.use('/api/payout-instructions', createPayoutInstructionRoutes(config));
    const token = tokenFor(tenantId);

    const byStatus = await request(app)
      .get(`/api/payout-instructions?tenantId=${tenantId}&status=SUCCESS&settlementRef=${settlement.settlement_ref}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byStatus.body.records).toHaveLength(1);

    const byBankRef = await request(app)
      .get(`/api/payout-instructions?tenantId=${tenantId}&bank_reference_number=BNK-API-PAYOUT-001`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byBankRef.body.records).toHaveLength(1);

    await request(app)
      .get(`/api/payout-instructions?tenantId=${otherTenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  test('bank statement import API accepts JSON input', async () => {
    const tenantId = await createTenant();
    const app = express();
    app.use(express.json());
    app.use('/api/bank-statements', createBankStatementRoutes(config));

    const response = await request(app)
      .post('/api/bank-statements/import')
      .set('Authorization', `Bearer ${tokenFor(tenantId)}`)
      .send({
        sourceType: 'MANUAL_UPLOAD',
        sourceFilename: 'json-import.csv',
        lines: [validCreditLine({ narration: 'NEFT/UTRJSON123456 REF:BNK-JSON-001 TXN:BTX-JSON-001' })]
      })
      .expect(201);

    expect(response.body.batch.import_status).toBe('COMPLETED');
    expect(response.body.summary.imported_lines).toBe(1);
  });
});
