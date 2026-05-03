const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const gatewaySettlementImportService = require('../src/core/gateway-settlements/gateway-settlement-import-service');
const settlementBatchingService = require('../src/core/settlements/settlement-batching-service');
const settlementFundReservationService = require('../src/core/settlements/settlement-fund-reservation-service');
const settlementSignalService = require('../src/core/settlements/settlement-signal-service');
const createSettlementBatchRoutes = require('../src/api/settlement-batch-routes');
const createSettlementSignalRoutes = require('../src/api/settlement-signal-routes');
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

async function createTenant(prefix = 'setl-batch') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Settlement Batch Test Tenant',
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
  const [transaction] = await db.knex('transactions').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    order_id: overrides.orderId || `ORD-${uuidv4()}`,
    transaction_ref: overrides.transactionRef || `TXN-${uuidv4()}`,
    payment_method: overrides.paymentMethod || 'card',
    gateway: overrides.gateway || 'razorpay',
    amount: overrides.amount || '1000.00',
    currency: overrides.currency || 'INR',
    status: overrides.status || 'success',
    gateway_transaction_id: overrides.gatewayTransactionId || `pay_${uuidv4().replace(/-/g, '')}`,
    completed_at: overrides.completedAt || new Date(),
    metadata: JSON.stringify(overrides.metadata || { merchantId: tenantId, test: true })
  }).returning('*');

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
  const worker = new OutboxWorker();
  await worker.processBatch({ tenantId, limit: 5 });
  const finalEvent = await outboxService.getEvent(event.id);
  expect(finalEvent.status).toBe('PROCESSED');

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
  const worker = new OutboxWorker();
  await worker.processBatch({ tenantId, limit: 5 });
  return result;
}

async function postFinancialEvent(tenantId, eventType, amount, metadata = {}) {
  const event = await outboxService.createEvent({
    tenantId,
    aggregateType: 'test_financial_adjustment',
    aggregateId: uuidv4(),
    eventType,
    idempotencyKey: `${eventType}:${tenantId}:${uuidv4()}`,
    correlationId: uuidv4(),
    payload: {
      amount,
      currency: 'INR',
      reference: uuidv4(),
      merchantId: tenantId,
      gateway: 'razorpay',
      ...metadata
    }
  });
  const worker = new OutboxWorker();
  await worker.processBatch({ tenantId, limit: 5 });
  const finalEvent = await outboxService.getEvent(event.id);
  expect(finalEvent.status).toBe('PROCESSED');
  return finalEvent;
}

async function createEligibleBatch(tenantId) {
  await createPricingRule(tenantId);
  const transaction = await createCapturedTransaction(tenantId);
  await importGatewaySettlementAndPostEscrow(tenantId, transaction);
  const result = await settlementBatchingService.createSettlementBatch({
    tenantId,
    cycleStart: new Date(Date.now() - 60 * 60 * 1000),
    cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
    scheduledDate: new Date(),
    createdBy: 'test',
    correlationId: uuidv4()
  });
  return { transaction, batch: result.batch, items: result.items };
}

function createApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use(express.json());
  app.use('/api/settlement-batches', createSettlementBatchRoutes(config));
  app.use('/api/settlement-signals', createSettlementSignalRoutes(config));
  return app;
}

describe('Sprint 5 - settlement batching, eligibility, and fund reservation signals', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('eligible captured and gateway-settled transaction enters batch', async () => {
    const tenantId = await createTenant();
    const { batch, items } = await createEligibleBatch(tenantId);

    expect(batch.batch_status).toBe('ELIGIBILITY_CHECKED');
    expect(items).toHaveLength(1);
    expect(items[0].item_status).toBe('ELIGIBLE');
    expect(items[0].eligibility_status).toBe('PASSED');
    expect(Number(batch.gross_payable_amount)).toBeCloseTo(1000);
    expect(Number(batch.total_fee_deduction)).toBeCloseTo(20);
    expect(Number(batch.total_tax_deduction)).toBeCloseTo(3.6);
    expect(Number(batch.net_settlement_amount)).toBeCloseTo(976.4);
  });

  test('payment without gateway escrow movement is ineligible', async () => {
    const tenantId = await createTenant();
    const transaction = await createCapturedTransaction(tenantId);
    const result = await settlementBatchingService.createSettlementBatch({
      tenantId,
      cycleStart: new Date(Date.now() - 60 * 60 * 1000),
      cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: 'test'
    });
    const signals = await settlementSignalService.listSignals({
      tenantId,
      signalType: 'SETTLEMENT_ELIGIBILITY_FAILED',
      transactionRef: transaction.transaction_ref
    });

    expect(result.items[0].item_status).toBe('INELIGIBLE');
    expect(result.items[0].eligibility_reason).toContain('Gateway settlement');
    expect(signals).toHaveLength(1);
  });

  test('transaction with open reconciliation exception is blocked', async () => {
    const tenantId = await createTenant();
    const { transaction } = await createEligibleBatch(tenantId);
    const [reconciliation] = await db.knex('reconciliation_transactions').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      transaction_id: transaction.id,
      transaction_ref: transaction.transaction_ref,
      reconciliation_status: 'AMOUNT_MISMATCH',
      transaction_amount: '1000.00',
      ledger_amount: '900.00',
      currency: 'INR',
      discrepancy_amount: '100.00',
      correlation_id: uuidv4()
    }).returning('*');
    await db.knex('reconciliation_exception_cases').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      source_type: 'TRANSACTION_LEDGER',
      source_reconciliation_id: reconciliation.id,
      source_status: 'AMOUNT_MISMATCH',
      case_status: 'OPEN',
      severity: 'HIGH',
      priority: 'HIGH',
      opened_by: 'test',
      correlation_id: uuidv4(),
      metadata: JSON.stringify({ transaction_ref: transaction.transaction_ref })
    });

    const result = await settlementBatchingService.createSettlementBatch({
      tenantId,
      cycleStart: new Date(Date.now() - 60 * 60 * 1000),
      cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: 'test'
    });
    const item = result.items.find(row => row.transaction_ref === transaction.transaction_ref);
    const signals = await settlementSignalService.listSignals({
      tenantId,
      signalType: 'SETTLEMENT_BLOCKED_BY_RECONCILIATION_EXCEPTION',
      transactionRef: transaction.transaction_ref
    });

    expect(item.item_status).toBe('INELIGIBLE');
    expect(item.eligibility_reason).toContain('reconciliation exception');
    expect(signals).toHaveLength(1);
  });

  test('duplicate settlement prevention blocks second reservation', async () => {
    const tenantId = await createTenant();
    const { transaction, batch } = await createEligibleBatch(tenantId);
    await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'test' });

    const second = await settlementBatchingService.createSettlementBatch({
      tenantId,
      cycleStart: new Date(Date.now() - 60 * 60 * 1000),
      cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: 'test'
    });
    const secondReserve = await settlementFundReservationService.reserveFundsForBatch({ batchId: second.batch.id, reservedBy: 'test' });
    const signals = await settlementSignalService.listSignals({
      tenantId,
      signalType: 'PAYABLE_RESERVED_TWICE_ATTEMPTED',
      transactionRef: transaction.transaction_ref
    });

    expect(second.items[0].item_status).toBe('INELIGIBLE');
    expect(secondReserve.status).toBe('RESERVATION_FAILED');
    expect(signals).toHaveLength(1);
  });

  test('successful fund reservation marks batch and items reserved', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);

    const result = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });
    const storedItems = await db.knex('settlement_items').where({ tenant_id: tenantId, batch_id: batch.id });
    const payouts = await db.knex('payout_instructions').where({ tenant_id: tenantId });

    expect(result.status).toBe('RESERVED');
    expect(result.reservation.reservation_status).toBe('ACTIVE');
    expect(result.batch.batch_status).toBe('RESERVED');
    expect(storedItems.every(item => item.item_status === 'RESERVED')).toBe(true);
    expect(Number(result.reservation.reserved_amount)).toBeCloseTo(Number(batch.net_settlement_amount));
    expect(payouts).toHaveLength(0);
  });

  test('insufficient escrow blocks reservation', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    await postFinancialEvent(tenantId, 'gateway_fee', '950.00');

    const result = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });
    const signals = await settlementSignalService.listSignals({
      tenantId,
      signalType: 'INSUFFICIENT_ESCROW_FOR_SETTLEMENT'
    });

    expect(result.status).toBe('RESERVATION_FAILED');
    expect(result.reservation).toBeNull();
    expect(result.batch.batch_status).toBe('RESERVATION_FAILED');
    expect(signals).toHaveLength(1);
  });

  test('insufficient merchant payable blocks reservation', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    await postFinancialEvent(tenantId, 'platform_fee', '950.00');

    const result = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });
    const signals = await settlementSignalService.listSignals({
      tenantId,
      signalType: 'INSUFFICIENT_MERCHANT_PAYABLE'
    });

    expect(result.status).toBe('RESERVATION_FAILED');
    expect(result.reservation).toBeNull();
    expect(signals).toHaveLength(1);
  });

  test('concurrent reservation attempt is idempotent and does not double reserve', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);

    const results = await Promise.all([
      settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'worker-a' }),
      settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'worker-b' })
    ]);
    const reservations = await db.knex('settlement_fund_reservations')
      .where({ tenant_id: tenantId, batch_id: batch.id, reservation_status: 'ACTIVE' });
    const items = await db.knex('settlement_items').where({ tenant_id: tenantId, batch_id: batch.id });

    expect(reservations).toHaveLength(1);
    expect(results.filter(result => ['RESERVED', 'ALREADY_RESERVED'].includes(result.status))).toHaveLength(2);
    expect(items.every(item => item.item_status === 'RESERVED')).toBe(true);
  });

  test('cancel reserved batch releases reservation', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    const reserved = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });

    const cancelled = await settlementBatchingService.cancelBatch({
      batchId: batch.id,
      reason: 'operator cancelled test batch',
      cancelledBy: 'finance-user'
    });
    const reservation = await db.knex('settlement_fund_reservations').where('id', reserved.reservation.id).first();
    const items = await db.knex('settlement_items').where({ tenant_id: tenantId, batch_id: batch.id });
    const signals = await settlementSignalService.listSignals({ tenantId, signalType: 'SETTLEMENT_BATCH_CANCELLED' });

    expect(cancelled.batch_status).toBe('CANCELLED');
    expect(reservation.reservation_status).toBe('RELEASED');
    expect(items.every(item => item.item_status === 'CANCELLED')).toBe(true);
    expect(signals).toHaveLength(1);
  });

  test('reservation expiry releases items and marks batch expired', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    const reserved = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });
    await db.knex('settlement_fund_reservations')
      .where('id', reserved.reservation.id)
      .update({ expires_at: new Date(Date.now() - 1000) });

    await settlementFundReservationService.expireReservations({ tenantId, now: new Date() });
    const reservation = await db.knex('settlement_fund_reservations').where('id', reserved.reservation.id).first();
    const expiredBatch = await db.knex('settlement_batches').where('id', batch.id).first();
    const item = await db.knex('settlement_items').where({ tenant_id: tenantId, batch_id: batch.id }).first();
    const signals = await settlementSignalService.listSignals({ tenantId, signalType: 'RESERVATION_EXPIRED' });

    expect(reservation.reservation_status).toBe('EXPIRED');
    expect(expiredBatch.batch_status).toBe('EXPIRED');
    expect(item.item_status).toBe('RELEASED');
    expect(signals).toHaveLength(1);
  });

  test('batch cannot reserve if totals mismatch items', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    await db.knex('settlement_batches')
      .where('id', batch.id)
      .update({ net_settlement_amount: '999.99' });

    const result = await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });
    const signals = await settlementSignalService.listSignals({ tenantId, signalType: 'SETTLEMENT_AMOUNT_MISMATCH' });

    expect(result.status).toBe('RESERVATION_FAILED');
    expect(result.reservation).toBeNull();
    expect(signals).toHaveLength(1);
  });

  test('API RBAC and tenant isolation', async () => {
    const tenantA = await createTenant('setl-api-a');
    const tenantB = await createTenant('setl-api-b');
    const batchB = await createEligibleBatch(tenantB);
    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const merchantToken = securityService.generateJWT({ userId: 'merchant-a', tenantId: tenantA, role: 'MERCHANT' });
    const platformToken = securityService.generateJWT({ userId: 'platform', tenantId: tenantA, role: 'PLATFORM_ADMIN' });
    const app = createApp();

    await request(app).get('/api/settlement-batches').expect(401);
    await request(app)
      .get('/api/settlement-batches')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(403);
    await request(app)
      .get(`/api/settlement-batches?tenantId=${tenantB}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);

    const platformResponse = await request(app)
      .get(`/api/settlement-batches?tenantId=${tenantB}&batchStatus=ELIGIBILITY_CHECKED`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(platformResponse.body.records.some(row => row.id === batchB.batch.id)).toBe(true);
    expect(platformResponse.body.records.every(row => row.tenant_id === tenantB)).toBe(true);
  });

  test('settlement signal filtering works by signal, severity, status, merchant, and transaction ref', async () => {
    const tenantId = await createTenant('setl-sig');
    const transactionRef = `TXN-SIG-${uuidv4()}`;
    await settlementSignalService.createSignal({
      tenantId,
      signalType: 'SETTLEMENT_ELIGIBILITY_FAILED',
      sourceType: 'ELIGIBILITY_ENGINE',
      sourceId: uuidv4(),
      merchantId: null,
      transactionRef,
      impactAmount: '100.00',
      currency: 'INR',
      description: 'eligibility failed for signal filtering'
    });
    await settlementSignalService.createSignal({
      tenantId,
      signalType: 'INSUFFICIENT_ESCROW_FOR_SETTLEMENT',
      sourceType: 'FUND_RESERVATION',
      sourceId: uuidv4(),
      impactAmount: '500.00',
      currency: 'INR',
      description: 'escrow insufficient for signal filtering'
    });
    const securityService = new SecurityService(config);
    const token = securityService.generateJWT({ userId: 'finance-sig', tenantId, role: 'FINANCE_ADMIN' });
    const app = createApp();

    const response = await request(app)
      .get(`/api/settlement-signals?signalType=SETTLEMENT_ELIGIBILITY_FAILED&severity=MEDIUM&status=OPEN&transactionRef=${transactionRef}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0]).toMatchObject({
      tenant_id: tenantId,
      signal_type: 'SETTLEMENT_ELIGIBILITY_FAILED',
      transaction_ref: transactionRef
    });
  });

  test('reservation does not execute payout or submit bank instruction', async () => {
    const tenantId = await createTenant();
    const { batch } = await createEligibleBatch(tenantId);
    await settlementFundReservationService.reserveFundsForBatch({ batchId: batch.id, reservedBy: 'finance-user' });

    const payouts = await db.knex('payout_instructions').where({ tenant_id: tenantId });
    const storedBatch = await db.knex('settlement_batches').where('id', batch.id).first();

    expect(payouts).toHaveLength(0);
    expect(storedBatch.payout_instruction_id).toBeNull();
    expect(storedBatch.batch_status).toBe('RESERVED');
  });
});
