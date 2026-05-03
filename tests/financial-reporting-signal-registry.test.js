const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const gatewaySettlementImportService = require('../src/core/gateway-settlements/gateway-settlement-import-service');
const paymentSignalService = require('../src/core/payment/payment-signal-service');
const gatewaySettlementSignalService = require('../src/core/gateway-settlements/gateway-settlement-signal-service');
const settlementBatchingService = require('../src/core/settlements/settlement-batching-service');
const settlementFundReservationService = require('../src/core/settlements/settlement-fund-reservation-service');
const settlementSignalService = require('../src/core/settlements/settlement-signal-service');
const payoutExecutionService = require('../src/core/payouts/payout-execution-service');
const payoutSignalService = require('../src/core/payouts/payout-signal-service');
const bankPayoutAdapter = require('../src/core/payouts/bank-payout-adapter');
const financialReportingService = require('../src/core/reporting/financial-reporting-service');
const signalRegistryService = require('../src/core/reporting/signal-registry-service');
const opsHealthReportingService = require('../src/core/reporting/ops-health-reporting-service');
const createReportRoutes = require('../src/api/report-routes');
const createSignalRegistryRoutes = require('../src/api/signal-registry-routes');
const { correlationIdMiddleware } = require('../src/core/middleware/correlation-id');
const SecurityService = require('../src/security/security-service');

async function ensureAccounts() {
  await db.knex('ledger_accounts').insert([
    {
      account_code: 'ESC-001',
      account_name: 'Bank Escrow',
      account_type: 'escrow',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'GTW-001-RZP',
      account_name: 'Gateway Receivable',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'MER-002',
      account_name: 'Merchant Payable',
      account_type: 'merchant',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'MER-001',
      account_name: 'Merchant Recoverable',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'REV-001',
      account_name: 'Platform Fee Revenue',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'GTW-FEE-001',
      account_name: 'Gateway Fee Expense',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'expense',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    },
    {
      account_code: 'CHB-001',
      account_name: 'Chargeback Loss',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'expense',
      status: 'active',
      metadata: JSON.stringify({ test: true }),
      created_by: 'test'
    }
  ]).onConflict('account_code').ignore();
}

async function createTenant(prefix = 'fin-report') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Financial Reporting Test Tenant',
    status: 'active'
  });
  await db.knex('accounting_periods').insert({
    tenant_id: tenantId,
    period_type: 'DAILY',
    period_start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    period_end: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'OPEN',
    created_by: 'test'
  });
  return tenantId;
}

async function createPricingRule(tenantId) {
  const [rule] = await db.knex('pricing_rules').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    merchant_id: null,
    gateway_name: 'razorpay',
    payment_method: 'card',
    rule_type: 'MIXED',
    mdr_percentage: '2.0000',
    fixed_fee: '0.00',
    gst_percentage: '18.0000',
    effective_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    effective_to: null,
    status: 'ACTIVE',
    metadata: JSON.stringify({ test: true })
  }).returning('*');
  return rule;
}

async function createCapturedTransaction(tenantId, overrides = {}) {
  const transactionRef = overrides.transactionRef || `TXN-${uuidv4()}`;
  const gatewayTransactionId = overrides.gatewayTransactionId || `pay_${uuidv4().replace(/-/g, '')}`;
  const [transaction] = await db.knex('transactions').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    order_id: overrides.orderId || `ORD-${uuidv4()}`,
    transaction_ref: transactionRef,
    payment_method: overrides.paymentMethod || 'card',
    gateway: overrides.gateway || 'razorpay',
    amount: overrides.amount || '1000.00',
    currency: overrides.currency || 'INR',
    status: overrides.status || 'success',
    gateway_transaction_id: gatewayTransactionId,
    completed_at: overrides.completedAt || new Date(),
    metadata: JSON.stringify(overrides.metadata || { merchantId: tenantId, test: true })
  }).returning('*');

  if (overrides.postLedger !== false) {
    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'transaction',
      aggregateId: transaction.id,
      eventType: 'payment.captured',
      idempotencyKey: `transaction:${transaction.transaction_ref}`,
      correlationId: uuidv4(),
      payload: {
        transactionId: transaction.id,
        transactionRef: transaction.transaction_ref,
        orderId: transaction.order_id,
        gateway: transaction.gateway,
        gatewayTransactionId: transaction.gateway_transaction_id,
        amount: transaction.amount,
        currency: transaction.currency,
        merchantId: tenantId
      }
    });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    expect((await outboxService.getEvent(event.id)).status).toBe('PROCESSED');
  }

  return transaction;
}

function gatewaySettlementLine(transaction, overrides = {}) {
  return {
    gatewaySettlementLineId: overrides.lineId || `line_${uuidv4().replace(/-/g, '')}`,
    transactionRef: transaction.transaction_ref,
    gatewayTransactionId: transaction.gateway_transaction_id,
    gatewayPaymentId: transaction.gateway_transaction_id,
    orderId: transaction.order_id,
    lineType: 'PAYMENT',
    status: 'settled',
    grossAmount: overrides.grossAmount ?? transaction.amount,
    gatewayFee: overrides.gatewayFee ?? '20.00',
    gstAmount: overrides.gstAmount ?? '3.60',
    adjustmentAmount: overrides.adjustmentAmount ?? '0.00',
    netAmount: overrides.netAmount ?? '976.40',
    currency: overrides.currency || transaction.currency,
    capturedAt: transaction.completed_at,
    settledAt: overrides.settledAt || new Date()
  };
}

async function importGatewaySettlementAndPostEscrow(tenantId, transaction, overrides = {}) {
  const result = await gatewaySettlementImportService.importGatewaySettlementBatch({
    tenantId,
    gatewayName: 'razorpay',
    sourceType: 'MANUAL_UPLOAD',
    sourceReference: overrides.sourceReference || `src-${uuidv4()}`,
    gatewaySettlementId: overrides.gatewaySettlementId || `setl_${uuidv4().replace(/-/g, '')}`,
    settlementUtr: overrides.settlementUtr || `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    bankReferenceNumber: overrides.bankReferenceNumber || `BNK${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    lines: [gatewaySettlementLine(transaction, overrides.line || {})],
    importedBy: 'test',
    correlationId: uuidv4()
  });
  expect(result.batch.import_status).toBe('COMPLETED');
  await new OutboxWorker().processBatch({ tenantId, limit: 5 });
  return result;
}

async function createReservedBatch(tenantId) {
  await createPricingRule(tenantId);
  const transaction = await createCapturedTransaction(tenantId);
  await importGatewaySettlementAndPostEscrow(tenantId, transaction);
  const batchResult = await settlementBatchingService.createSettlementBatch({
    tenantId,
    cycleStart: new Date(Date.now() - 60 * 60 * 1000),
    cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
    scheduledDate: new Date(),
    createdBy: 'test',
    correlationId: uuidv4()
  });
  const reserved = await settlementFundReservationService.reserveFundsForBatch({
    batchId: batchResult.batch.id,
    reservedBy: 'test',
    correlationId: uuidv4()
  });
  expect(reserved.status).toBe('RESERVED');
  return { transaction, batch: reserved.batch, reservation: reserved.reservation };
}

async function createPaidLifecycle(tenantId) {
  const setup = await createReservedBatch(tenantId);
  const payoutResult = await payoutExecutionService.createPayoutInstructionForBatch({
    batchId: setup.batch.id,
    requestedBy: 'finance-user',
    correlationId: uuidv4()
  });
  const payoutInstruction = payoutResult.payoutInstruction;
  bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
    status: 'SUCCESS',
    providerPayoutId: `po_${uuidv4().replace(/-/g, '')}`,
    utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    bankReferenceNumber: `BNK${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    bankTransactionId: `BTX${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
  });
  await payoutExecutionService.submitPayout({
    payoutInstructionId: payoutInstruction.id,
    submittedBy: 'finance-user',
    correlationId: uuidv4()
  });
  await new OutboxWorker().processBatch({ tenantId, limit: 5 });
  return { ...setup, payoutInstruction };
}

function createApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use(express.json());
  app.use('/api/reports', createReportRoutes(config));
  app.use('/api/signals', createSignalRegistryRoutes(config));
  return app;
}

function tokenFor(tenantId, role = 'FINANCE_ADMIN', userId = uuidv4()) {
  return new SecurityService(config).generateJWT({ userId, tenantId, role });
}

async function insertSettlementBatch(tenantId, status, amount = '100.00', overrides = {}) {
  const [batch] = await db.knex('settlement_batches').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    batch_ref: overrides.batchRef || `SETL-REPORT-${uuidv4()}`,
    batch_status: status,
    scheduled_settlement_date: overrides.scheduledSettlementDate || new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    net_settlement_amount: amount,
    reserved_amount: overrides.reservedAmount || '0.00',
    currency: overrides.currency || 'INR',
    item_count: 1,
    eligible_item_count: 1,
    metadata: JSON.stringify({ test: true })
  }).returning('*');
  return batch;
}

async function insertPayoutInstruction(tenantId, status, amount = '100.00', overrides = {}) {
  const [payout] = await db.knex('payout_instructions').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    payout_amount: amount,
    currency: overrides.currency || 'INR',
    payout_status: status,
    bank_idempotency_key: overrides.bankIdempotencyKey || `payout-report-${uuidv4()}`,
    merchant_id: overrides.merchantId || null,
    provider_name: overrides.providerName || 'mockbank',
    provider_payout_id: overrides.providerPayoutId || null,
    submitted_at: overrides.submittedAt || null,
    processing_at: overrides.processingAt || null,
    completed_at: overrides.completedAt || null,
    failed_at: overrides.failedAt || null,
    returned_at: overrides.returnedAt || null,
    correlation_id: uuidv4(),
    metadata: JSON.stringify({ test: true })
  }).returning('*');
  return payout;
}

async function createExceptionCase(tenantId, overrides = {}) {
  const transaction = overrides.transaction || await createCapturedTransaction(tenantId, { amount: '50.00', postLedger: false });
  const [reconciliation] = await db.knex('reconciliation_transactions').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    transaction_id: transaction.id,
    transaction_ref: transaction.transaction_ref,
    reconciliation_status: overrides.sourceStatus || 'AMOUNT_MISMATCH',
    transaction_amount: '50.00',
    ledger_amount: '40.00',
    currency: 'INR',
    discrepancy_amount: overrides.discrepancyAmount || '10.00',
    correlation_id: uuidv4()
  }).returning('*');
  const [exceptionCase] = await db.knex('reconciliation_exception_cases').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    source_type: 'TRANSACTION_LEDGER',
    source_reconciliation_id: reconciliation.id,
    source_status: overrides.sourceStatus || 'AMOUNT_MISMATCH',
    case_status: overrides.caseStatus || 'OPEN',
    severity: overrides.severity || 'HIGH',
    priority: overrides.priority || 'HIGH',
    opened_by: 'test',
    opened_at: overrides.openedAt || new Date(),
    last_action_at: overrides.lastActionAt || new Date(),
    correlation_id: uuidv4(),
    metadata: {
      transaction_ref: transaction.transaction_ref,
      discrepancy_amount: overrides.discrepancyAmount || '10.00',
      impact_amount: overrides.impactAmount || overrides.discrepancyAmount || '10.00',
      currency: 'INR'
    }
  }).returning('*');
  return { reconciliation, exceptionCase, transaction };
}

async function createSignalsAcrossSources(tenantId, overrides = {}) {
  const payment = await paymentSignalService.createOrUpdateSignal({
    tenantId,
    signalType: 'PAYMENT_AMOUNT_MISMATCH',
    sourceType: 'GATEWAY_VERIFICATION',
    sourceId: overrides.paymentSourceId || uuidv4(),
    transactionRef: overrides.transactionRef || `TXN-SIGNAL-${uuidv4()}`,
    gatewayName: 'razorpay',
    impactAmount: overrides.paymentImpact || '500.00',
    currency: 'INR',
    description: 'Payment amount mismatch for reporting test',
    metadata: { merchant_id: overrides.merchantId || null }
  });
  const gateway = await gatewaySettlementSignalService.createOrUpdateSignal({
    tenantId,
    signalType: 'GATEWAY_SETTLEMENT_DELAYED',
    sourceType: 'GATEWAY_SETTLEMENT_BATCH',
    sourceId: overrides.gatewaySourceId || uuidv4(),
    gatewayName: 'razorpay',
    impactAmount: overrides.gatewayImpact || '200.00',
    currency: 'INR',
    description: 'Gateway settlement delayed for reporting test'
  });
  const settlement = await settlementSignalService.createOrUpdateSignal({
    tenantId,
    signalType: 'INSUFFICIENT_ESCROW_FOR_SETTLEMENT',
    sourceType: 'SETTLEMENT_BATCH',
    sourceId: overrides.settlementSourceId || uuidv4(),
    merchantId: overrides.merchantId || uuidv4(),
    impactAmount: overrides.settlementImpact || '300.00',
    currency: 'INR',
    description: 'Insufficient escrow for reporting test'
  });
  const payout = await payoutSignalService.createOrUpdateSignal({
    tenantId,
    signalType: 'PAYOUT_TIMEOUT',
    sourceType: 'PAYOUT_INSTRUCTION',
    sourceId: overrides.payoutSourceId || uuidv4(),
    payoutInstructionId: overrides.payoutInstructionId || null,
    settlementBatchId: overrides.settlementBatchId || null,
    merchantId: overrides.merchantId || uuidv4(),
    impactAmount: overrides.payoutImpact || '400.00',
    currency: 'INR',
    description: 'Payout timeout for reporting test'
  });
  return { payment, gateway, settlement, payout };
}

describe('Sprint 7 - financial reporting and unified signal registry', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  beforeEach(() => {
    bankPayoutAdapter.resetMockResponses();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('escrow balance is derived from ledger and ignores raw transaction rows', async () => {
    const tenantId = await createTenant();
    await createPaidLifecycle(tenantId);
    await createCapturedTransaction(tenantId, { amount: '9999.00', postLedger: false });

    const report = await financialReportingService.getEscrowBalance({ tenantId, currency: 'INR' });

    expect(report.basis).toBe('ledger_entries');
    expect(report.totalBalance).toBeCloseTo(0);
    expect(report.records[0].debits).toBeCloseTo(976.4);
    expect(report.records[0].credits).toBeCloseTo(976.4);
  });

  test('gateway receivable balance is ledger-derived after partial gateway settlement clearing', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId, { amount: '1000.00' });
    await importGatewaySettlementAndPostEscrow(tenantId, transaction);

    const report = await financialReportingService.getGatewayReceivableBalance({
      tenantId,
      gatewayName: 'razorpay',
      currency: 'INR'
    });

    expect(report.basis).toBe('ledger_entries');
    expect(report.totalBalance).toBeCloseTo(23.6);
  });

  test('merchant payable balance is calculated from ledger entries after payout success', async () => {
    const tenantId = await createTenant();
    await createPaidLifecycle(tenantId);

    const report = await financialReportingService.getMerchantPayableBalance({
      tenantId,
      currency: 'INR'
    });

    expect(report.basis).toBe('ledger_entries');
    expect(report.totalBalance).toBeCloseTo(23.6);
  });

  test('merchant payable aging buckets payable ledger entries by posting date', async () => {
    const tenantId = await createTenant();
    const recent = await createCapturedTransaction(tenantId, { amount: '100.00' });
    const old = await createCapturedTransaction(tenantId, { amount: '200.00' });
    await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, transaction_ref: recent.transaction_ref })
      .update({ created_at: new Date(Date.now() - 12 * 60 * 60 * 1000) });
    await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, transaction_ref: old.transaction_ref })
      .update({ created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) });

    const report = await financialReportingService.getMerchantPayableAging({ tenantId, merchantId: tenantId, currency: 'INR' });

    expect(report.buckets['0_1_days'].amount).toBeCloseTo(100);
    expect(report.buckets['4_7_days'].amount).toBeCloseTo(200);
    expect(report.totalBalance).toBeCloseTo(300);
  });

  test('settlement aging report summarizes operational batch statuses and delays', async () => {
    const tenantId = await createTenant();
    await insertSettlementBatch(tenantId, 'RESERVED', '100.00');
    await insertSettlementBatch(tenantId, 'RESERVATION_FAILED', '200.00');
    await insertSettlementBatch(tenantId, 'READY_FOR_PAYOUT', '300.00');
    await insertSettlementBatch(tenantId, 'PAYOUT_CREATED', '400.00');

    const report = await financialReportingService.getSettlementAging({ tenantId });

    expect(report.basis).toBe('settlement_batches_operational');
    expect(report.summaryByStatus.RESERVED.count).toBe(1);
    expect(report.summaryByStatus.RESERVATION_FAILED.amount).toBeCloseTo(200);
    expect(report.summaryByStatus.READY_FOR_PAYOUT.delayedAmount).toBeCloseTo(300);
    expect(report.summaryByStatus.PAYOUT_CREATED.delayedAmount).toBe(0);
  });

  test('payout aging report summarizes pending, failed, returned, and success payout states', async () => {
    const tenantId = await createTenant();
    await insertPayoutInstruction(tenantId, 'PROCESSING', '100.00', { processingAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    await insertPayoutInstruction(tenantId, 'TIMEOUT', '200.00');
    await insertPayoutInstruction(tenantId, 'FAILED', '300.00');
    await insertPayoutInstruction(tenantId, 'RETURNED', '400.00');
    await insertPayoutInstruction(tenantId, 'SUCCESS', '500.00', { completedAt: new Date() });

    const report = await financialReportingService.getPayoutAging({ tenantId });

    expect(report.basis).toBe('payout_instructions_operational');
    expect(report.summaryByStatus.PROCESSING.amount).toBeCloseTo(100);
    expect(report.summaryByStatus.TIMEOUT.amount).toBeCloseTo(200);
    expect(report.summaryByStatus.FAILED.amount).toBeCloseTo(300);
    expect(report.summaryByStatus.RETURNED.amount).toBeCloseTo(400);
    expect(report.summaryByStatus.SUCCESS.amount).toBeCloseTo(500);
  });

  test('outbox and DLQ reports expose status counts, retry distribution, and event types', async () => {
    const tenantId = await createTenant();
    const pending = await outboxService.createEvent({
      tenantId,
      aggregateType: 'report-test',
      aggregateId: uuidv4(),
      eventType: 'payment.captured',
      idempotencyKey: `report-pending-${uuidv4()}`,
      payload: { amount: '10.00', currency: 'INR' }
    });
    const failed = await outboxService.createEvent({
      tenantId,
      aggregateType: 'report-test',
      aggregateId: uuidv4(),
      eventType: 'gateway.settlement.received',
      idempotencyKey: `report-failed-${uuidv4()}`,
      payload: { amount: '20.00', currency: 'INR' }
    });
    const dlq = await outboxService.createEvent({
      tenantId,
      aggregateType: 'report-test',
      aggregateId: uuidv4(),
      eventType: 'payout.successful',
      idempotencyKey: `report-dlq-${uuidv4()}`,
      payload: { settlementAmount: '30.00', currency: 'INR' }
    });
    await db.knex('outbox_events').where('id', pending.id).update({ created_at: new Date(Date.now() - 2000) });
    await db.knex('outbox_events').where('id', failed.id).update({ status: 'FAILED', retry_count: 2 });
    await db.knex('outbox_events').where('id', dlq.id).update({ status: 'DLQ', retry_count: 3, dlq_at: new Date() });

    const health = await opsHealthReportingService.getOutboxHealth({ tenantId });
    const dlqReport = await opsHealthReportingService.getDLQReport({ tenantId });

    expect(health.pendingCount).toBe(1);
    expect(health.failedCount).toBe(1);
    expect(health.dlqCount).toBe(1);
    expect(health.retryDistribution[2]).toBe(1);
    expect(dlqReport.byEventType['payout.successful']).toBe(1);
  });

  test('webhook health report summarizes invalid, replayed, duplicate, and out-of-order webhook evidence', async () => {
    const tenantId = await createTenant();
    const rows = [
      ['evt-invalid', 'FAILED', 'FAILED'],
      ['evt-replay', 'VERIFIED', 'REPLAY_REJECTED'],
      ['evt-duplicate', 'VERIFIED', 'DUPLICATE'],
      ['evt-order', 'VERIFIED', 'OUT_OF_ORDER']
    ];
    for (const [eventId, verificationStatus, processingStatus] of rows) {
      await db.knex('gateway_webhook_events').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        gateway_name: 'razorpay',
        gateway_event_id: `${eventId}-${uuidv4()}`,
        gateway_event_type: eventId === 'evt-order' ? 'payment.failed' : 'payment.captured',
        raw_payload: JSON.stringify({ eventId }),
        raw_headers: JSON.stringify({ test: true }),
        payload_hash: `${eventId}-${uuidv4()}`,
        signature_verified: verificationStatus === 'VERIFIED',
        verification_status: verificationStatus,
        processing_status: processingStatus,
        received_at: new Date(),
        metadata: JSON.stringify({ test: true })
      });
    }

    const report = await opsHealthReportingService.getWebhookHealth({ tenantId });

    expect(report.invalidSignatureCount).toBe(1);
    expect(report.replayRejectedCount).toBe(1);
    expect(report.duplicateWebhookCount).toBe(1);
    expect(report.outOfOrderCount).toBe(1);
  });

  test('reconciliation exception summary includes status, severity, and aging buckets', async () => {
    const tenantId = await createTenant();
    await createExceptionCase(tenantId, { caseStatus: 'OPEN', severity: 'HIGH', openedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) });
    await createExceptionCase(tenantId, { caseStatus: 'IN_REVIEW', severity: 'CRITICAL' });
    await createExceptionCase(tenantId, { caseStatus: 'RESOLVED', severity: 'LOW' });

    const report = await opsHealthReportingService.getReconciliationExceptionSummary({ tenantId });

    expect(report.openCases).toBe(1);
    expect(report.inReview).toBe(1);
    expect(report.resolved).toBe(1);
    expect(report.bySeverity.CRITICAL).toBe(1);
    expect(report.agingBuckets['4_7_days']).toBe(1);
  });

  test('unified signal registry lists payment, gateway settlement, settlement, payout, and exception sources', async () => {
    const tenantId = await createTenant();
    await createSignalsAcrossSources(tenantId);
    await createExceptionCase(tenantId, { sourceStatus: 'MISSING_LEDGER', severity: 'HIGH' });

    const result = await signalRegistryService.listUnifiedSignals({ tenantId, limit: 100 });
    const sources = new Set(result.records.map(row => row.signal_source));
    const highSignals = await signalRegistryService.listUnifiedSignals({ tenantId, severity: 'HIGH', limit: 100 });

    expect(sources.has('PAYMENT')).toBe(true);
    expect(sources.has('GATEWAY_SETTLEMENT')).toBe(true);
    expect(sources.has('SETTLEMENT')).toBe(true);
    expect(sources.has('PAYOUT')).toBe(true);
    expect(sources.has('RECONCILIATION_EXCEPTION')).toBe(true);
    expect(highSignals.records.every(row => row.severity === 'HIGH')).toBe(true);
  });

  test('unified signal acknowledge and resolve update the underlying payout signal', async () => {
    const tenantId = await createTenant();
    const { payout } = await createSignalsAcrossSources(tenantId, { payoutImpact: '25.00' });

    await signalRegistryService.acknowledgeUnifiedSignal({
      source: 'PAYOUT',
      sourceId: payout.id,
      tenantId,
      acknowledgedBy: 'ops-user'
    });
    let stored = await db.knex('payout_signals').where('id', payout.id).first();
    expect(stored.signal_status).toBe('ACKNOWLEDGED');

    await signalRegistryService.resolveUnifiedSignal({
      source: 'PAYOUT',
      sourceId: payout.id,
      tenantId,
      resolvedBy: 'ops-user',
      reason: 'provider status confirmed'
    });
    stored = await db.knex('payout_signals').where('id', payout.id).first();
    expect(stored.signal_status).toBe('RESOLVED');
  });

  test('amount at risk returns category breakdown and separates quantified operational risk', async () => {
    const tenantId = await createTenant();
    await createSignalsAcrossSources(tenantId, { paymentImpact: '500.00', payoutImpact: '150.00' });
    await insertPayoutInstruction(tenantId, 'TIMEOUT', '200.00');
    await insertSettlementBatch(tenantId, 'RESERVATION_FAILED', '300.00');
    await createExceptionCase(tenantId, { discrepancyAmount: '50.00', impactAmount: '50.00' });

    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'report-risk',
      aggregateId: uuidv4(),
      eventType: 'payout.successful',
      idempotencyKey: `report-risk-${uuidv4()}`,
      payload: { settlementAmount: '75.00', currency: 'INR' }
    });
    await db.knex('outbox_events').where('id', event.id).update({ status: 'DLQ', retry_count: 3, dlq_at: new Date() });

    const report = await financialReportingService.getAmountAtRisk({ tenantId, currency: 'INR' });

    expect(report.basis).toBe('operational_risk_breakdown_estimated');
    expect(report.categories.openHighCriticalSignals.quantifiedAmount).toBeGreaterThanOrEqual(650);
    expect(report.categories.riskyPayouts.quantifiedAmount).toBeCloseTo(200);
    expect(report.categories.riskySettlements.quantifiedAmount).toBeCloseTo(300);
    expect(report.categories.dlqFinancialEvents.quantifiedAmount).toBeCloseTo(75);
    expect(report.categories.reconciliationExceptions.quantifiedAmount).toBeCloseTo(50);
  });

  test('top risk merchants are ranked by severity, impact, and signal count', async () => {
    const tenantId = await createTenant();
    const merchantA = uuidv4();
    const merchantB = uuidv4();
    await settlementSignalService.createOrUpdateSignal({
      tenantId,
      signalType: 'INSUFFICIENT_ESCROW_FOR_SETTLEMENT',
      sourceType: 'SETTLEMENT_BATCH',
      sourceId: uuidv4(),
      merchantId: merchantA,
      impactAmount: '500.00',
      currency: 'INR',
      description: 'merchant A critical risk'
    });
    await payoutSignalService.createOrUpdateSignal({
      tenantId,
      signalType: 'PAYOUT_TIMEOUT',
      sourceType: 'PAYOUT_INSTRUCTION',
      sourceId: uuidv4(),
      merchantId: merchantB,
      impactAmount: '100.00',
      currency: 'INR',
      description: 'merchant B high risk'
    });

    const records = await signalRegistryService.getTopRiskMerchants({ tenantId, limit: 2 });

    expect(records[0].id).toBe(merchantA);
    expect(records[0].riskScore).toBeGreaterThan(records[1].riskScore);
  });

  test('top risk gateways are ranked from payment and gateway settlement signals', async () => {
    const tenantId = await createTenant();
    await paymentSignalService.createOrUpdateSignal({
      tenantId,
      signalType: 'PAYMENT_AMOUNT_MISMATCH',
      sourceType: 'GATEWAY_VERIFICATION',
      sourceId: uuidv4(),
      gatewayName: 'razorpay',
      impactAmount: '100.00',
      currency: 'INR',
      description: 'razorpay amount mismatch'
    });
    await gatewaySettlementSignalService.createOrUpdateSignal({
      tenantId,
      signalType: 'GATEWAY_SETTLEMENT_DELAYED',
      sourceType: 'GATEWAY_SETTLEMENT_BATCH',
      sourceId: uuidv4(),
      gatewayName: 'payu',
      impactAmount: '100.00',
      currency: 'INR',
      description: 'payu delayed'
    });

    const records = await signalRegistryService.getTopRiskGateways({ tenantId, limit: 2 });

    expect(records[0].id).toBe('razorpay');
    expect(records.some(row => row.id === 'payu')).toBe(true);
  });

  test('finance summary snapshot stores report output without mutating source data', async () => {
    const app = createApp();
    const tenantId = await createTenant();
    await createCapturedTransaction(tenantId, { amount: '100.00' });
    const token = tokenFor(tenantId, 'FINANCE_ADMIN', 'snapshot-user');
    const beforeLedgerCount = Number((await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first()).count);

    const response = await request(app)
      .post('/api/reports/finance/snapshots')
      .set('Authorization', `Bearer ${token}`)
      .send({ reportType: 'ESCROW_BALANCE', currency: 'INR' })
      .expect(201);
    const stored = await db.knex('financial_report_snapshots').where('id', response.body.snapshot.id).first();
    const afterLedgerCount = Number((await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first()).count);

    expect(stored.report_type).toBe('ESCROW_BALANCE');
    expect(stored.snapshot_payload.reportType).toBe('ESCROW_BALANCE');
    expect(afterLedgerCount).toBe(beforeLedgerCount);
  });

  test('report and signal APIs enforce RBAC and tenant isolation', async () => {
    const app = createApp();
    const tenantA = await createTenant('fin-api-a');
    const tenantB = await createTenant('fin-api-b');
    await createSignalsAcrossSources(tenantB);
    await insertSettlementBatch(tenantB, 'READY_FOR_PAYOUT', '111.00');
    const financeToken = tokenFor(tenantA, 'FINANCE_ADMIN', 'finance-a');
    const merchantToken = tokenFor(tenantA, 'MERCHANT', 'merchant-a');
    const platformToken = tokenFor(tenantA, 'PLATFORM_ADMIN', 'platform');

    await request(app).get('/api/reports/finance/summary').expect(401);
    await request(app).get('/api/signals').set('Authorization', `Bearer ${merchantToken}`).expect(403);
    await request(app)
      .get(`/api/reports/settlements/aging?tenantId=${tenantB}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
    await request(app)
      .get(`/api/signals?tenantId=${tenantB}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);

    const reportResponse = await request(app)
      .get(`/api/reports/settlements/aging?tenantId=${tenantB}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    const signalResponse = await request(app)
      .get(`/api/signals?tenantId=${tenantB}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(reportResponse.body.report.records).toHaveLength(1);
    expect(signalResponse.body.records.length).toBeGreaterThanOrEqual(4);
  });

  test('report APIs are read-only apart from explicit snapshot and signal state endpoints', async () => {
    const app = createApp();
    const tenantId = await createTenant();
    await createSignalsAcrossSources(tenantId);
    await createCapturedTransaction(tenantId, { amount: '100.00' });
    const token = tokenFor(tenantId, 'FINANCE_ADMIN', 'finance-readonly');
    const before = {
      ledger: Number((await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first()).count),
      payouts: Number((await db.knex('payout_instructions').where({ tenant_id: tenantId }).count('* as count').first()).count),
      paymentSignals: Number((await db.knex('payment_signals').where({ tenant_id: tenantId }).count('* as count').first()).count),
      exceptions: Number((await db.knex('reconciliation_exception_cases').where({ tenant_id: tenantId }).count('* as count').first()).count)
    };

    await request(app).get('/api/reports/finance/summary').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/reports/ops/outbox-health').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/signals').set('Authorization', `Bearer ${token}`).expect(200);

    const after = {
      ledger: Number((await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first()).count),
      payouts: Number((await db.knex('payout_instructions').where({ tenant_id: tenantId }).count('* as count').first()).count),
      paymentSignals: Number((await db.knex('payment_signals').where({ tenant_id: tenantId }).count('* as count').first()).count),
      exceptions: Number((await db.knex('reconciliation_exception_cases').where({ tenant_id: tenantId }).count('* as count').first()).count)
    };

    expect(after).toEqual(before);
  });
});
