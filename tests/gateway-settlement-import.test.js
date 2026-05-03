const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const gatewaySettlementImportService = require('../src/core/gateway-settlements/gateway-settlement-import-service');
const gatewaySettlementReconciliationService = require('../src/core/gateway-settlements/gateway-settlement-reconciliation-service');
const gatewaySettlementSignalService = require('../src/core/gateway-settlements/gateway-settlement-signal-service');
const createGatewaySettlementRoutes = require('../src/api/gateway-settlement-routes');
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

async function createTenant(prefix = 'gw-setl') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Gateway Settlement Test Tenant',
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

async function createPricingRule(tenantId, overrides = {}) {
  const [rule] = await db.knex('pricing_rules').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    merchant_id: overrides.merchantId || null,
    gateway_name: overrides.gatewayName || 'razorpay',
    payment_method: overrides.paymentMethod || 'card',
    rule_type: overrides.ruleType || 'MIXED',
    mdr_percentage: overrides.mdrPercentage ?? '2.0000',
    fixed_fee: overrides.fixedFee ?? '0.00',
    gst_percentage: overrides.gstPercentage ?? '18.0000',
    effective_from: overrides.effectiveFrom || new Date(Date.now() - 24 * 60 * 60 * 1000),
    effective_to: overrides.effectiveTo || null,
    status: 'ACTIVE',
    metadata: JSON.stringify({ test: true })
  }).returning('*');
  return rule;
}

async function createCapturedTransaction(tenantId, overrides = {}) {
  const transactionRef = overrides.transactionRef || `TXN-${uuidv4()}`;
  const gatewayTransactionId = overrides.gatewayTransactionId || `pay_${uuidv4().replace(/-/g, '')}`;
  const completedAt = overrides.completedAt || new Date();
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
    completed_at: completedAt,
    metadata: JSON.stringify({ test: true })
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
    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });
    const finalEvent = await outboxService.getEvent(event.id);
    expect(finalEvent.status).toBe('PROCESSED');
  }

  return transaction;
}

function settlementLine(transaction, overrides = {}) {
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

async function importBatch(tenantId, lines, overrides = {}) {
  return gatewaySettlementImportService.importGatewaySettlementBatch({
    tenantId,
    gatewayName: overrides.gatewayName || 'razorpay',
    sourceType: 'MANUAL_UPLOAD',
    sourceFilename: overrides.sourceFilename || 'settlement.csv',
    sourceReference: overrides.sourceReference || `src-${uuidv4()}`,
    gatewaySettlementId: overrides.gatewaySettlementId || `setl_${uuidv4().replace(/-/g, '')}`,
    settlementUtr: overrides.settlementUtr || `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    bankReferenceNumber: overrides.bankReferenceNumber || `BNK${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    lines,
    importedBy: 'test',
    correlationId: overrides.correlationId || uuidv4()
  });
}

async function balance(tenantId, accountCode) {
  const row = await db.knex('ledger_entries as le')
    .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
    .join('ledger_accounts as la', 'la.id', 'le.account_id')
    .where('le.tenant_id', tenantId)
    .where('lt.status', 'posted')
    .where('la.account_code', accountCode)
    .first(
      db.knex.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END), 0) as debit_balance")
    );
  return Number(row?.debit_balance || 0);
}

describe('Sprint 4 - gateway settlement import, fee validation, and escrow truth', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('successful gateway settlement import posts receivable to escrow through outbox', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId, { amount: '1000.00' });

    const result = await importBatch(tenantId, [settlementLine(transaction)]);

    expect(result.batch.import_status).toBe('COMPLETED');
    expect(result.lines[0].reconciliation_status).toBe('MATCHED');
    expect(Number(result.lines[0].expected_gateway_fee)).toBe(20);
    expect(Number(result.lines[0].expected_gst_amount)).toBe(3.6);
    expect(result.outboxEvent.event_type).toBe('gateway.settlement.received');

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });
    await gatewaySettlementReconciliationService.reconcileGatewaySettlementBatch(result.batch.id);

    const updatedLine = await db.knex('gateway_settlement_lines').where('id', result.lines[0].id).first();
    const settlementLedger = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, event_type: 'gateway_settlement' });

    expect(updatedLine.ledger_transaction_id).toBeTruthy();
    expect(updatedLine.reconciliation_status).toBe('MATCHED');
    expect(settlementLedger).toHaveLength(1);
    expect(Number(await balance(tenantId, 'ESC-001'))).toBeCloseTo(976.4);
  });

  test('escrow does not increase before gateway settlement import', async () => {
    const tenantId = await createTenant();
    const transaction = await createCapturedTransaction(tenantId, { amount: '500.00' });

    const gatewayReceivable = await balance(tenantId, 'GTW-001-RZP');
    const bankEscrow = await balance(tenantId, 'ESC-001');

    expect(gatewayReceivable).toBeCloseTo(500);
    expect(bankEscrow).toBeCloseTo(0);
    expect(transaction.status).toBe('success');
  });

  test('duplicate settlement line is idempotent and does not duplicate ledger impact', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const line = settlementLine(transaction, { lineId: 'line-duplicate-sprint4' });

    const first = await importBatch(tenantId, [line], { gatewaySettlementId: `setl_${uuidv4().replace(/-/g, '')}` });
    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });

    const second = await importBatch(tenantId, [line], {
      gatewaySettlementId: `setl_${uuidv4().replace(/-/g, '')}`,
      sourceReference: `src-dup-${uuidv4()}`
    });
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'DUPLICATE_GATEWAY_SETTLEMENT_LINE' });
    const settlementLedgers = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, event_type: 'gateway_settlement' });

    expect(first.batch.import_status).toBe('COMPLETED');
    expect(second.summary.duplicate_lines).toBe(1);
    expect(second.batch.import_status).toBe('COMPLETED_WITH_ERRORS');
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(settlementLedgers).toHaveLength(1);
  });

  test('missing transaction is signalled and does not post ledger', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const result = await importBatch(tenantId, [{
      gatewaySettlementLineId: `missing-${uuidv4()}`,
      transactionRef: `UNKNOWN-${uuidv4()}`,
      grossAmount: '1000.00',
      gatewayFee: '20.00',
      gstAmount: '3.60',
      netAmount: '976.40',
      currency: 'INR'
    }]);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT' });
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'gateway.settlement.received' });

    expect(result.lines[0].reconciliation_status).toBe('MISSING_TRANSACTION');
    expect(signals).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  test('amount mismatch is detected with financial impact', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId, { amount: '1000.00' });
    const result = await importBatch(tenantId, [settlementLine(transaction, { grossAmount: '900.00', gatewayFee: '18.00', gstAmount: '3.24', netAmount: '878.76' })]);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH' });

    expect(result.lines[0].reconciliation_status).toBe('AMOUNT_MISMATCH');
    expect(Number(signals[0].impact_amount)).toBe(100);
  });

  test('fee mismatch creates one signal only', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction, { gatewayFee: '30.00', gstAmount: '3.60', netAmount: '966.40' })]);
    const feeSignals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'GATEWAY_FEE_MISMATCH' });
    const allSignals = await gatewaySettlementSignalService.listSignals({ tenantId });

    expect(result.lines[0].reconciliation_status).toBe('FEE_MISMATCH');
    expect(Number(result.lines[0].fee_discrepancy_amount)).toBe(10);
    expect(feeSignals).toHaveLength(1);
    expect(allSignals.filter(signal => signal.line_id === result.lines[0].id)).toHaveLength(1);
  });

  test('GST mismatch creates one signal only', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction, { gstAmount: '5.00', netAmount: '975.00' })]);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'GST_MISMATCH' });
    const allSignals = await gatewaySettlementSignalService.listSignals({ tenantId });

    expect(result.lines[0].reconciliation_status).toBe('GST_MISMATCH');
    expect(Number(result.lines[0].gst_discrepancy_amount)).toBeCloseTo(1.4);
    expect(signals).toHaveLength(1);
    expect(allSignals.filter(signal => signal.line_id === result.lines[0].id)).toHaveLength(1);
  });

  test('net settlement mismatch is detected', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction, { netAmount: '970.00' })]);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'NET_SETTLEMENT_MISMATCH' });

    expect(result.lines[0].reconciliation_status).toBe('NET_MISMATCH');
    expect(Number(result.lines[0].net_discrepancy_amount)).toBeCloseTo(6.4);
    expect(signals).toHaveLength(1);
  });

  test('pricing rule missing prevents false match', async () => {
    const tenantId = await createTenant();
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction)]);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'PRICING_RULE_MISSING' });

    expect(result.lines[0].reconciliation_status).toBe('UNMATCHED');
    expect(result.lines[0].pricing_rule_id).toBeNull();
    expect(signals).toHaveLength(1);
  });

  test('settlement delayed beyond SLA generates signal', async () => {
    const tenantId = await createTenant();
    const completedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await createCapturedTransaction(tenantId, { completedAt, amount: '200.00' });

    const result = await gatewaySettlementReconciliationService.detectDelayedSettlements({
      tenantId,
      gatewayName: 'razorpay',
      olderThanDays: 2
    });
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'GATEWAY_SETTLEMENT_DELAYED' });

    expect(result.total).toBe(1);
    expect(signals).toHaveLength(1);
    expect(Number(signals[0].impact_amount)).toBe(200);
  });

  test('escrow not credited is signalled when settlement outbox has not posted ledger', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction)]);

    await gatewaySettlementReconciliationService.reconcileGatewaySettlementBatch(result.batch.id);
    const signals = await gatewaySettlementSignalService.listSignals({ tenantId, signalType: 'ESCROW_NOT_CREDITED' });

    expect(result.outboxEvent.status).toBe('PENDING');
    expect(signals).toHaveLength(1);
  });

  test('gateway settlement line links to outbox after durable enqueue and ledger only after worker success', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const escrowBefore = await balance(tenantId, 'ESC-001');

    const result = await importBatch(tenantId, [settlementLine(transaction)]);
    const beforeWorkerLine = await db.knex('gateway_settlement_lines').where('id', result.lines[0].id).first();
    const escrowBeforeWorker = await balance(tenantId, 'ESC-001');

    expect(beforeWorkerLine.outbox_event_id).toBe(result.outboxEvent.id);
    expect(beforeWorkerLine.ledger_transaction_id).toBeNull();
    expect(escrowBeforeWorker).toBeCloseTo(escrowBefore);

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });

    const afterWorkerLine = await db.knex('gateway_settlement_lines').where('id', result.lines[0].id).first();
    const escrowAfterWorker = await balance(tenantId, 'ESC-001');

    expect(afterWorkerLine.ledger_transaction_id).toBeTruthy();
    expect(escrowAfterWorker).toBeCloseTo(escrowBefore + 976.4);
  });

  test('amount totals mismatch blocks escrow posting and creates one batch signal', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);

    const result = await gatewaySettlementImportService.importGatewaySettlementBatch({
      tenantId,
      gatewayName: 'razorpay',
      sourceType: 'MANUAL_UPLOAD',
      sourceReference: `src-total-mismatch-${uuidv4()}`,
      gatewaySettlementId: `setl_total_${uuidv4().replace(/-/g, '')}`,
      grossAmount: '1000.00',
      totalGatewayFee: '20.00',
      totalGstAmount: '3.60',
      totalAdjustmentAmount: '0.00',
      netSettlementAmount: '900.00',
      lines: [settlementLine(transaction)],
      importedBy: 'test',
      correlationId: uuidv4()
    });
    const signals = await gatewaySettlementSignalService.listSignals({
      tenantId,
      signalType: 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH'
    });
    const events = await db.knex('outbox_events')
      .where({ tenant_id: tenantId, event_type: 'gateway.settlement.received' });

    expect(result.batch.import_status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.outboxEvent).toBeNull();
    expect(signals.filter(signal => signal.batch_id === result.batch.id)).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  test('malformed import fails safely without batch mutation or escrow posting', async () => {
    const tenantId = await createTenant();
    const beforeCount = await db.knex('gateway_settlement_batches').where({ tenant_id: tenantId }).count('* as count').first();

    await expect(gatewaySettlementImportService.importGatewaySettlementBatch({
      tenantId,
      gatewayName: 'razorpay',
      sourceType: 'MANUAL_UPLOAD',
      sourceReference: `src-malformed-${uuidv4()}`,
      lines: 'not-an-array'
    })).rejects.toThrow('lines must be an array');

    const afterCount = await db.knex('gateway_settlement_batches').where({ tenant_id: tenantId }).count('* as count').first();
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'gateway.settlement.received' });

    expect(Number(afterCount.count)).toBe(Number(beforeCount.count));
    expect(events).toHaveLength(0);
  });

  test('malformed settlement line is recorded as failed and does not post escrow ledger', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);

    const result = await importBatch(tenantId, [{
      gatewaySettlementLineId: `bad-line-${uuidv4()}`,
      transactionRef: `BAD-${uuidv4()}`,
      currency: 'INR'
    }], { sourceReference: `src-bad-line-${uuidv4()}` });
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'gateway.settlement.received' });

    expect(result.batch.import_status).toBe('FAILED');
    expect(result.summary.failed_lines).toBe(1);
    expect(result.lines[0].reconciliation_status).toBe('FAILED');
    expect(events).toHaveLength(0);
  });

  test('partial failure completes with explicit counters', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transactionA = await createCapturedTransaction(tenantId);
    const transactionB = await createCapturedTransaction(tenantId);
    const duplicateLine = settlementLine(transactionA, { lineId: `line-partial-dup-${uuidv4()}` });
    await importBatch(tenantId, [duplicateLine], { sourceReference: `src-pre-${uuidv4()}` });

    const result = await importBatch(tenantId, [
      settlementLine(transactionB),
      { gatewaySettlementLineId: `bad-${uuidv4()}`, transactionRef: `BAD-${uuidv4()}`, currency: 'INR' },
      duplicateLine
    ], { sourceReference: `src-partial-${uuidv4()}` });

    expect(result.batch.import_status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.summary.imported_lines).toBe(1);
    expect(result.summary.failed_lines).toBe(1);
    expect(result.summary.duplicate_lines).toBe(1);
  });

  test('signals API filtering and tenant isolation', async () => {
    const tenantA = await createTenant('gw-sig-a');
    const tenantB = await createTenant('gw-sig-b');
    await gatewaySettlementSignalService.createSignal({
      tenantId: tenantA,
      signalType: 'GATEWAY_FEE_MISMATCH',
      sourceType: 'GATEWAY_SETTLEMENT_LINE',
      sourceId: uuidv4(),
      gatewayName: 'razorpay',
      transactionRef: 'TXN-A',
      impactAmount: '10.00',
      currency: 'INR',
      description: 'tenant A fee mismatch'
    });
    await gatewaySettlementSignalService.createSignal({
      tenantId: tenantB,
      signalType: 'GST_MISMATCH',
      sourceType: 'GATEWAY_SETTLEMENT_LINE',
      sourceId: uuidv4(),
      gatewayName: 'razorpay',
      transactionRef: 'TXN-B',
      impactAmount: '2.00',
      currency: 'INR',
      description: 'tenant B GST mismatch'
    });

    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const platformToken = securityService.generateJWT({ userId: 'platform', tenantId: tenantA, role: 'PLATFORM_ADMIN' });
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.use('/api/gateway-settlements', createGatewaySettlementRoutes(config));

    const tenantResponse = await request(app)
      .get('/api/gateway-settlements/signals?signalType=GATEWAY_FEE_MISMATCH&severity=HIGH&status=OPEN')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const platformResponse = await request(app)
      .get(`/api/gateway-settlements/signals?tenantId=${tenantB}&signalType=GST_MISMATCH`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(tenantResponse.body.records).toHaveLength(1);
    expect(tenantResponse.body.records[0]).toMatchObject({ tenant_id: tenantA, signal_type: 'GATEWAY_FEE_MISMATCH' });
    expect(platformResponse.body.records).toHaveLength(1);
    expect(platformResponse.body.records[0]).toMatchObject({ tenant_id: tenantB, signal_type: 'GST_MISMATCH' });
  });

  test('batch and line API filtering is tenant-safe', async () => {
    const tenantA = await createTenant('gw-api-a');
    const tenantB = await createTenant('gw-api-b');
    await createPricingRule(tenantA);
    await createPricingRule(tenantB);
    const transactionA = await createCapturedTransaction(tenantA);
    const transactionB = await createCapturedTransaction(tenantB);
    const batchA = await importBatch(tenantA, [settlementLine(transactionA)], { gatewayName: 'razorpay' });
    await importBatch(tenantB, [settlementLine(transactionB)], { gatewayName: 'razorpay' });

    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-api-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.use('/api/gateway-settlements', createGatewaySettlementRoutes(config));

    const batches = await request(app)
      .get('/api/gateway-settlements/batches?gatewayName=razorpay&importStatus=COMPLETED')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const lines = await request(app)
      .get(`/api/gateway-settlements/lines?gatewayName=razorpay&reconciliationStatus=MATCHED&transactionRef=${transactionA.transaction_ref}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(batches.body.records.some(row => row.id === batchA.batch.id)).toBe(true);
    expect(batches.body.records.every(row => row.tenant_id === tenantA)).toBe(true);
    expect(lines.body.records).toHaveLength(1);
    expect(lines.body.records[0]).toMatchObject({ tenant_id: tenantA, transaction_ref: transactionA.transaction_ref });
  });

  test('RBAC blocks unauthorized gateway settlement API access', async () => {
    const tenantId = await createTenant('gw-rbac');
    const securityService = new SecurityService(config);
    const merchantToken = securityService.generateJWT({ userId: 'merchant-user', tenantId, role: 'MERCHANT' });
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.use('/api/gateway-settlements', createGatewaySettlementRoutes(config));

    await request(app)
      .get('/api/gateway-settlements/batches')
      .expect(401);

    await request(app)
      .get('/api/gateway-settlements/batches')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(403);

    await request(app)
      .post('/api/gateway-settlements/import')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        gatewayName: 'razorpay',
        sourceType: 'MANUAL_UPLOAD',
        sourceReference: `src-rbac-${uuidv4()}`,
        lines: []
      })
      .expect(403);
  });

  test('ledger idempotency prevents duplicate receivable-to-escrow posting', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    const result = await importBatch(tenantId, [settlementLine(transaction)]);
    const worker = new OutboxWorker();
    const [claimed] = await outboxService.fetchDueEvents({ tenantId, limit: 1 });

    await worker.processEvent(claimed);
    await worker.processEvent({ ...claimed, status: 'PROCESSING' });

    const ledgerRows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, event_type: 'gateway_settlement' });
    const event = await outboxService.getEvent(result.outboxEvent.id);

    expect(event.status).toBe('PROCESSED');
    expect(ledgerRows).toHaveLength(1);
  });

  test('outbox retry and DLQ behavior still applies to gateway settlement events', async () => {
    const tenantId = await createTenant();
    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'gateway_settlement_batch',
      aggregateId: uuidv4(),
      eventType: 'gateway.settlement.received',
      idempotencyKey: `gw-settlement-dlq:${uuidv4()}`,
      maxRetries: 2,
      correlationId: uuidv4(),
      payload: {
        gateway: 'razorpay',
        gatewaySettlementId: `setl_dlq_${uuidv4().replace(/-/g, '')}`,
        batchId: uuidv4(),
        amount: '100.00',
        currency: 'INR'
      }
    });
    const worker = new OutboxWorker({
      handlers: {
        'gateway.settlement.received': async () => {
          throw new Error('simulated gateway settlement ledger failure');
        }
      }
    });

    const firstRun = await worker.processBatch({ tenantId, limit: 1 });
    await db.knex('outbox_events')
      .where('id', event.id)
      .update({ next_retry_at: new Date(Date.now() - 1000) });
    const secondRun = await worker.processBatch({ tenantId, limit: 1 });
    const finalEvent = await outboxService.getEvent(event.id);
    const settlementLedgers = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, event_type: 'gateway_settlement' });

    expect(firstRun.results[0]).toMatchObject({ eventId: event.id, status: 'FAILED', retryCount: 1 });
    expect(secondRun.results[0]).toMatchObject({ eventId: event.id, status: 'DLQ', retryCount: 2 });
    expect(finalEvent.status).toBe('DLQ');
    expect(finalEvent.last_error).toContain('simulated gateway settlement ledger failure');
    expect(settlementLedgers).toHaveLength(0);
  });
});
