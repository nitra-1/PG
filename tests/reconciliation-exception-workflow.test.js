const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const reconciliationExceptionService = require('../src/core/ledger/reconciliation-exception-service');
const createReconciliationRoutes = require('../src/api/reconciliation-routes');
const SecurityService = require('../src/security/security-service');
const config = require('../src/config/config');

async function createTenant(prefix = 'recon-exception') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Reconciliation Exception Workflow Test',
    status: 'active'
  });
  return tenantId;
}

async function createTransactionRecon(tenantId, status = 'AMOUNT_MISMATCH', overrides = {}) {
  const [row] = await db.knex('reconciliation_transactions').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    transaction_id: overrides.transactionId || uuidv4(),
    transaction_ref: overrides.transactionRef || `TXN-RECON-${uuidv4()}`,
    ledger_transaction_id: overrides.ledgerTransactionId || null,
    reconciliation_status: status,
    transaction_amount: overrides.transactionAmount || '100.00',
    ledger_amount: overrides.ledgerAmount || '90.00',
    currency: overrides.currency || 'INR',
    discrepancy_amount: overrides.discrepancyAmount || '10.00',
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return row;
}

async function createSettlementRecon(tenantId, status = 'NET_AMOUNT_MISMATCH', overrides = {}) {
  const [row] = await db.knex('reconciliation_settlements').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    settlement_id: overrides.settlementId || uuidv4(),
    settlement_ref: overrides.settlementRef || `SETL-RECON-${uuidv4()}`,
    ledger_transaction_id: overrides.ledgerTransactionId || uuidv4(),
    reconciliation_status: status,
    settlement_gross_amount: overrides.settlementGrossAmount || '100.00',
    ledger_gross_amount: overrides.ledgerGrossAmount || '100.00',
    settlement_fee_amount: overrides.settlementFeeAmount || '10.00',
    ledger_fee_amount: overrides.ledgerFeeAmount || '10.00',
    settlement_net_amount: overrides.settlementNetAmount || '90.00',
    ledger_net_amount: overrides.ledgerNetAmount || '85.00',
    discrepancy_amount: overrides.discrepancyAmount || '5.00',
    currency: overrides.currency || 'INR',
    metadata: JSON.stringify({ test: true }),
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return row;
}

async function createSettlement(tenantId, overrides = {}) {
  const settlementRef = overrides.settlementRef || `SETL-${uuidv4()}`;
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

async function createBankSettlementRecon(tenantId, status = 'MISSING_BANK_STATEMENT', overrides = {}) {
  const settlement = overrides.settlement || await createSettlement(tenantId);
  const payoutInstruction = overrides.payoutInstruction || await createPayoutInstruction(settlement);
  const [row] = await db.knex('reconciliation_bank_settlements').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    settlement_id: overrides.settlementId || settlement.id,
    settlement_ref: overrides.settlementRef || settlement.settlement_ref,
    payout_instruction_id: overrides.payoutInstructionId || payoutInstruction.id,
    bank_statement_line_id: overrides.bankStatementLineId || null,
    reconciliation_status: status,
    settlement_amount: overrides.settlementAmount || '90.00',
    payout_amount: overrides.payoutAmount || '90.00',
    bank_amount: overrides.bankAmount || null,
    discrepancy_amount: overrides.discrepancyAmount || '90.00',
    settlement_currency: overrides.settlementCurrency || 'INR',
    bank_currency: overrides.bankCurrency || null,
    expected_utr_number: overrides.expectedUtr || null,
    actual_utr_number: overrides.actualUtr || null,
    metadata: JSON.stringify({ test: true }),
    correlation_id: overrides.correlationId || uuidv4()
  }).returning('*');
  return row;
}

async function createCaseFromSource(sourceType, row) {
  return reconciliationExceptionService.createOrUpdateExceptionFromReconciliation({
    tenantId: row.tenant_id,
    sourceType,
    sourceReconciliationId: row.id,
    sourceStatus: row.reconciliation_status,
    correlationId: row.correlation_id
  });
}

function tokenFor(tenantId, role = 'FINANCE_ADMIN', userId = uuidv4()) {
  return new SecurityService(config).generateJWT({
    userId,
    tenantId,
    role
  });
}

describe('Sprint 2C - reconciliation exception workflow', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('generates exception from transaction-ledger mismatch', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');

    const result = await reconciliationExceptionService.createCasesForAllOpenMismatches({
      tenantId,
      sourceType: 'TRANSACTION_LEDGER'
    });

    expect(result.total).toBe(1);
    expect(result.cases[0]).toMatchObject({
      tenant_id: tenantId,
      source_type: 'TRANSACTION_LEDGER',
      source_reconciliation_id: source.id,
      source_status: 'AMOUNT_MISMATCH',
      case_status: 'OPEN',
      severity: 'HIGH'
    });
  });

  test('generates exception from ledger-settlement mismatch', async () => {
    const tenantId = await createTenant();
    const source = await createSettlementRecon(tenantId, 'NET_AMOUNT_MISMATCH');

    const exceptionCase = await createCaseFromSource('LEDGER_SETTLEMENT', source);

    expect(exceptionCase).toMatchObject({
      tenant_id: tenantId,
      source_type: 'LEDGER_SETTLEMENT',
      source_reconciliation_id: source.id,
      severity: 'HIGH'
    });
  });

  test('generates exception from bank-settlement mismatch', async () => {
    const tenantId = await createTenant();
    const source = await createBankSettlementRecon(tenantId, 'MISSING_BANK_STATEMENT');

    const exceptionCase = await createCaseFromSource('BANK_SETTLEMENT', source);

    expect(exceptionCase).toMatchObject({
      tenant_id: tenantId,
      source_type: 'BANK_SETTLEMENT',
      source_reconciliation_id: source.id,
      severity: 'HIGH'
    });
  });

  test('does not create case for MATCHED reconciliation', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'MATCHED', {
      ledgerAmount: '100.00',
      discrepancyAmount: '0.00'
    });

    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);
    const rows = await db.knex('reconciliation_exception_cases')
      .where({ tenant_id: tenantId, source_reconciliation_id: source.id });

    expect(exceptionCase).toBeNull();
    expect(rows).toHaveLength(0);
  });

  test('duplicate generation is idempotent', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');

    await createCaseFromSource('TRANSACTION_LEDGER', source);
    await createCaseFromSource('TRANSACTION_LEDGER', source);

    const rows = await db.knex('reconciliation_exception_cases')
      .where({
        tenant_id: tenantId,
        source_type: 'TRANSACTION_LEDGER',
        source_reconciliation_id: source.id
      });

    expect(rows).toHaveLength(1);
  });

  test('assignment workflow moves case into review and writes audit event', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);

    const assigned = await reconciliationExceptionService.assignCase({
      caseId: exceptionCase.id,
      assignedTo: 'analyst-1',
      assignedBy: 'finance-admin'
    });
    const audit = await db.knex('reconciliation_exception_audit_events')
      .where({ tenant_id: tenantId, case_id: exceptionCase.id, action_type: 'CASE_ASSIGNED' });

    expect(assigned.assigned_to).toBe('analyst-1');
    expect(assigned.case_status).toBe('IN_REVIEW');
    expect(audit).toHaveLength(1);
  });

  test('comment workflow writes comment and audit event', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);

    const comment = await reconciliationExceptionService.addComment({
      caseId: exceptionCase.id,
      commentText: 'Investigating ledger difference',
      commentType: 'INVESTIGATION',
      createdBy: 'analyst-1'
    });
    const audit = await db.knex('reconciliation_exception_audit_events')
      .where({ tenant_id: tenantId, case_id: exceptionCase.id, action_type: 'COMMENT_ADDED' });

    expect(comment.comment_text).toBe('Investigating ledger difference');
    expect(comment.comment_type).toBe('INVESTIGATION');
    expect(audit).toHaveLength(1);
  });

  test('escalation workflow changes status and writes audit event', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);

    const escalated = await reconciliationExceptionService.escalateCase({
      caseId: exceptionCase.id,
      reason: 'Requires finance manager review',
      performedBy: 'analyst-1'
    });
    const audit = await db.knex('reconciliation_exception_audit_events')
      .where({ tenant_id: tenantId, case_id: exceptionCase.id, action_type: 'ESCALATED' });

    expect(escalated.case_status).toBe('ESCALATED');
    expect(audit).toHaveLength(1);
  });

  test('resolves low-risk case without approval', async () => {
    const tenantId = await createTenant();
    const source = await createBankSettlementRecon(tenantId, 'DATE_MISMATCH', {
      discrepancyAmount: '0.00'
    });
    const exceptionCase = await createCaseFromSource('BANK_SETTLEMENT', source);

    const resolved = await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'MATCH_CONFIRMED',
      resolutionReason: 'Value date delay confirmed',
      resolvedBy: 'finance-user'
    });
    const audit = await db.knex('reconciliation_exception_audit_events')
      .where({ tenant_id: tenantId, case_id: exceptionCase.id, action_type: 'RESOLVED' });

    expect(resolved.case_status).toBe('RESOLVED');
    expect(resolved.resolved_by).toBe('finance-user');
    expect(resolved.resolved_at).toBeTruthy();
    expect(audit).toHaveLength(1);
  });

  test('high-risk ignore moves to pending approval and links approval request', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);

    const pending = await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'IGNORE_WITH_REASON',
      resolutionReason: 'Business approved tolerance request',
      resolvedBy: uuidv4()
    });
    const approvalRequest = await db.knex('approval_requests')
      .where('id', pending.approval_request_id)
      .first();

    expect(pending.case_status).toBe('PENDING_APPROVAL');
    expect(pending.approval_required).toBe(true);
    expect(pending.approval_request_id).toBeTruthy();
    expect(approvalRequest.status).toBe('pending');
  });

  test('cannot resolve pending-approval case without approved approval', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);
    const pending = await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'IGNORE_WITH_REASON',
      resolutionReason: 'Needs maker checker',
      resolvedBy: uuidv4()
    });

    await expect(reconciliationExceptionService.resolveCase({
      caseId: pending.id,
      resolutionType: 'IGNORE_WITH_REASON',
      resolutionReason: 'Trying without checker approval',
      resolvedBy: 'finance-user'
    })).rejects.toThrow('Approval is pending');
  });

  test('reopens resolved case', async () => {
    const tenantId = await createTenant();
    const source = await createBankSettlementRecon(tenantId, 'DATE_MISMATCH', {
      discrepancyAmount: '0.00'
    });
    const exceptionCase = await createCaseFromSource('BANK_SETTLEMENT', source);
    const resolved = await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'MATCH_CONFIRMED',
      resolutionReason: 'Confirmed',
      resolvedBy: 'finance-user'
    });

    const reopened = await reconciliationExceptionService.reopenCase({
      caseId: resolved.id,
      reason: 'New bank evidence received',
      reopenedBy: 'finance-user'
    });
    const audit = await db.knex('reconciliation_exception_audit_events')
      .where({ tenant_id: tenantId, case_id: resolved.id, action_type: 'REOPENED' });

    expect(reopened.case_status).toBe('REOPENED');
    expect(audit).toHaveLength(1);
  });

  test('invalid transition from closed to resolved is rejected for normal user', async () => {
    const tenantId = await createTenant();
    const source = await createBankSettlementRecon(tenantId, 'DATE_MISMATCH', {
      discrepancyAmount: '0.00'
    });
    const exceptionCase = await createCaseFromSource('BANK_SETTLEMENT', source);
    const resolved = await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'MATCH_CONFIRMED',
      resolutionReason: 'Confirmed',
      resolvedBy: 'finance-user'
    });
    const closed = await reconciliationExceptionService.closeCase({
      caseId: resolved.id,
      reason: 'Operational closure',
      closedBy: 'finance-user'
    });

    await expect(reconciliationExceptionService.resolveCase({
      caseId: closed.id,
      resolutionType: 'MATCH_CONFIRMED',
      resolutionReason: 'Invalid direct resolve',
      resolvedBy: 'finance-user'
    })).rejects.toThrow('Invalid exception case transition CLOSED -> RESOLVED');
  });

  test('API listing filters cases and enforces tenant isolation', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'AMOUNT_MISMATCH');
    const otherSource = await createBankSettlementRecon(otherTenantId, 'MISSING_BANK_STATEMENT');
    await createCaseFromSource('TRANSACTION_LEDGER', source);
    await createCaseFromSource('BANK_SETTLEMENT', otherSource);

    const app = express();
    app.use(express.json());
    app.use('/api/reconciliation', createReconciliationRoutes(config));
    const tenantToken = tokenFor(tenantId, 'FINANCE_ADMIN');

    const response = await request(app)
      .get(`/api/reconciliation/exceptions?tenantId=${tenantId}&severity=HIGH&caseStatus=OPEN`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0]).toMatchObject({
      tenant_id: tenantId,
      severity: 'HIGH',
      case_status: 'OPEN'
    });

    await request(app)
      .get(`/api/reconciliation/exceptions?tenantId=${otherTenantId}`)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(403);

    const platformToken = tokenFor(tenantId, 'PLATFORM_ADMIN');
    const platformResponse = await request(app)
      .get(`/api/reconciliation/exceptions?tenantId=${otherTenantId}&sourceType=BANK_SETTLEMENT`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(platformResponse.body.records).toHaveLength(1);
    expect(platformResponse.body.records[0].tenant_id).toBe(otherTenantId);
  });

  test('workflow actions do not mutate source reconciliation data', async () => {
    const tenantId = await createTenant();
    const source = await createTransactionRecon(tenantId, 'CURRENCY_MISMATCH', {
      discrepancyAmount: '0.00'
    });
    const before = await db.knex('reconciliation_transactions').where('id', source.id).first();
    const exceptionCase = await createCaseFromSource('TRANSACTION_LEDGER', source);

    await reconciliationExceptionService.assignCase({
      caseId: exceptionCase.id,
      assignedTo: 'analyst-1',
      assignedBy: 'finance-admin'
    });
    await reconciliationExceptionService.addComment({
      caseId: exceptionCase.id,
      commentText: 'Source must remain untouched',
      createdBy: 'analyst-1'
    });
    await reconciliationExceptionService.resolveCase({
      caseId: exceptionCase.id,
      resolutionType: 'MANUAL_REVIEW_COMPLETED',
      resolutionReason: 'No financial mutation in this sprint',
      resolvedBy: 'finance-admin'
    });

    const after = await db.knex('reconciliation_transactions').where('id', source.id).first();
    expect(after).toMatchObject({
      id: before.id,
      tenant_id: before.tenant_id,
      transaction_ref: before.transaction_ref,
      reconciliation_status: before.reconciliation_status,
      discrepancy_amount: before.discrepancy_amount
    });
  });
});
