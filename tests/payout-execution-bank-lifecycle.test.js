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
const payoutExecutionService = require('../src/core/payouts/payout-execution-service');
const payoutCallbackIngestionService = require('../src/core/payouts/payout-callback-ingestion-service');
const payoutSignalService = require('../src/core/payouts/payout-signal-service');
const bankPayoutAdapter = require('../src/core/payouts/bank-payout-adapter');
const createPayoutExecutionRoutes = require('../src/api/payout-execution-routes');
const createPayoutSignalRoutes = require('../src/api/payout-signal-routes');
const createPayoutWebhookRoutes = require('../src/api/payout-webhook-routes');
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

async function createTenant(prefix = 'payout-lifecycle') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Payout Lifecycle Test Tenant',
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
  return db.knex('pricing_rules').insert({
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
}

async function createCapturedTransaction(tenantId, overrides = {}) {
  const [transaction] = await db.knex('transactions').insert({
    id: uuidv4(),
    tenant_id: tenantId,
    order_id: overrides.orderId || `ORD-${uuidv4()}`,
    transaction_ref: overrides.transactionRef || `TXN-${uuidv4()}`,
    payment_method: 'card',
    gateway: 'razorpay',
    amount: overrides.amount || '1000.00',
    currency: 'INR',
    status: 'success',
    gateway_transaction_id: overrides.gatewayTransactionId || `pay_${uuidv4().replace(/-/g, '')}`,
    completed_at: new Date(),
    metadata: JSON.stringify({ merchantId: tenantId, test: true })
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
  await new OutboxWorker().processBatch({ tenantId, limit: 5 });
  expect((await outboxService.getEvent(event.id)).status).toBe('PROCESSED');
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
    currency: 'INR',
    capturedAt: transaction.completed_at,
    settledAt: new Date()
  };
}

async function importGatewaySettlementAndPostEscrow(tenantId, transaction) {
  const result = await gatewaySettlementImportService.importGatewaySettlementBatch({
    tenantId,
    gatewayName: 'razorpay',
    sourceType: 'MANUAL_UPLOAD',
    sourceReference: `src-${uuidv4()}`,
    gatewaySettlementId: `setl_${uuidv4().replace(/-/g, '')}`,
    settlementUtr: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    bankReferenceNumber: `BNK${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    lines: [gatewaySettlementLine(transaction)],
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

async function createReadyPayout(tenantId) {
  const setup = await createReservedBatch(tenantId);
  const result = await payoutExecutionService.createPayoutInstructionForBatch({
    batchId: setup.batch.id,
    requestedBy: 'finance-user',
    correlationId: uuidv4()
  });
  expect(result.payoutInstruction.payout_status).toBe('READY');
  return { ...setup, payoutInstruction: result.payoutInstruction };
}

async function payoutLedgerTransactions(tenantId, payoutInstructionId) {
  return db.knex('ledger_transactions')
    .where('tenant_id', tenantId)
    .where(function() {
      this.where('transaction_ref', `PAYOUT-${payoutInstructionId}`)
        .orWhere('transaction_ref', `PAYOUT_RETURNED-${payoutInstructionId}`)
        .orWhere('transaction_ref', `PAYOUT_REVERSED-${payoutInstructionId}`);
    })
    .orderBy('created_at', 'asc');
}

async function latestPayout(payoutInstructionId) {
  return db.knex('payout_instructions').where('id', payoutInstructionId).first();
}

function signedCallbackPayload(body) {
  const raw = JSON.stringify(body);
  return {
    raw,
    headers: {
      'x-mock-signature': bankPayoutAdapter.signMockPayload(raw),
      'content-type': 'application/json'
    }
  };
}

function createApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use(express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith('/api/payout-webhooks/')) {
        req.rawBody = Buffer.from(buf);
      }
    }
  }));
  app.use('/api/payouts', createPayoutExecutionRoutes(config));
  app.use('/api/payout-signals', createPayoutSignalRoutes(config));
  app.use('/api/payout-webhooks', createPayoutWebhookRoutes(config));
  return app;
}

describe('Sprint 6 - payout execution, bank outcome, and payout risk signals', () => {
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

  test('creates payout instruction only from reserved batch', async () => {
    const tenantId = await createTenant();
    const { batch, reservation } = await createReservedBatch(tenantId);

    const result = await payoutExecutionService.createPayoutInstructionForBatch({
      batchId: batch.id,
      requestedBy: 'finance-user',
      correlationId: uuidv4()
    });
    const signals = await payoutSignalService.listSignals({
      tenantId,
      signalType: 'PAYOUT_READY_FOR_BANK_SUBMISSION'
    });

    expect(result.payoutInstruction.payout_status).toBe('READY');
    expect(result.payoutInstruction.settlement_batch_id).toBe(batch.id);
    expect(result.payoutInstruction.reservation_id).toBe(reservation.id);
    expect(result.payoutInstruction.bank_idempotency_key).toContain(batch.batch_ref);
    expect(signals).toHaveLength(1);
  });

  test('cannot create payout without active reservation', async () => {
    const tenantId = await createTenant();
    const { batch } = await createReservedBatch(tenantId);
    await db.knex('settlement_fund_reservations')
      .where({ tenant_id: tenantId, batch_id: batch.id })
      .update({ reservation_status: 'RELEASED', released_at: new Date() });

    const result = await payoutExecutionService.createPayoutInstructionForBatch({
      batchId: batch.id,
      requestedBy: 'finance-user'
    });
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_WITHOUT_RESERVATION' });

    expect(result.status).toBe('PAYOUT_WITHOUT_RESERVATION');
    expect(result.payoutInstruction).toBeNull();
    expect(signals).toHaveLength(1);
  });

  test('duplicate payout instruction is blocked and idempotent for same batch', async () => {
    const tenantId = await createTenant();
    const { batch } = await createReservedBatch(tenantId);
    const first = await payoutExecutionService.createPayoutInstructionForBatch({ batchId: batch.id, requestedBy: 'finance-user' });
    const second = await payoutExecutionService.createPayoutInstructionForBatch({ batchId: batch.id, requestedBy: 'finance-user' });
    const payouts = await db.knex('payout_instructions').where({ tenant_id: tenantId, settlement_batch_id: batch.id });
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'DUPLICATE_PAYOUT_ATTEMPT' });

    expect(second.duplicate).toBe(true);
    expect(second.payoutInstruction.id).toBe(first.payoutInstruction.id);
    expect(payouts).toHaveLength(1);
    expect(signals).toHaveLength(1);
  });

  test('submit payout success emits outbox and worker posts merchant payable to escrow ledger', async () => {
    const tenantId = await createTenant();
    const { batch, reservation, payoutInstruction } = await createReadyPayout(tenantId);
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'SUCCESS',
      providerPayoutId: `po_${uuidv4().replace(/-/g, '')}`,
      utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      bankReferenceNumber: `BNK${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      bankTransactionId: `BTX${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    });

    const submitted = await payoutExecutionService.submitPayout({
      payoutInstructionId: payoutInstruction.id,
      submittedBy: 'finance-user',
      correlationId: uuidv4()
    });
    const beforeWorkerReservation = await db.knex('settlement_fund_reservations').where('id', reservation.id).first();
    const outboxEvents = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });

    expect(submitted.payoutInstruction.payout_status).toBe('SUCCESS');
    expect(submitted.outboxEvent.event_type).toBe('payout.successful');
    expect(outboxEvents).toHaveLength(1);
    expect(beforeWorkerReservation.reservation_status).toBe('ACTIVE');

    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const finalPayout = await latestPayout(payoutInstruction.id);
    const consumedReservation = await db.knex('settlement_fund_reservations').where('id', reservation.id).first();
    const finalBatch = await db.knex('settlement_batches').where('id', batch.id).first();
    const items = await db.knex('settlement_items').where({ tenant_id: tenantId, batch_id: batch.id });
    const ledgerRows = await payoutLedgerTransactions(tenantId, payoutInstruction.id);

    expect(finalPayout.ledger_transaction_id).toBeTruthy();
    expect(consumedReservation.reservation_status).toBe('CONSUMED');
    expect(finalBatch.batch_status).toBe('PAYOUT_CREATED');
    expect(items.every(item => item.item_status === 'SETTLED')).toBe(true);
    expect(ledgerRows).toHaveLength(1);
  });

  test('accepted or processing payout does not consume reservation or post success ledger', async () => {
    const tenantId = await createTenant();
    const { reservation, payoutInstruction } = await createReadyPayout(tenantId);
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'ACCEPTED',
      providerPayoutId: `po_${uuidv4().replace(/-/g, '')}`
    });

    const submitted = await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    const storedReservation = await db.knex('settlement_fund_reservations').where('id', reservation.id).first();
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'BANK_CONFIRMATION_MISSING' });

    expect(submitted.payoutInstruction.payout_status).toBe('ACCEPTED');
    expect(storedReservation.reservation_status).toBe('ACTIVE');
    expect(events).toHaveLength(0);
    expect(signals).toHaveLength(1);
  });

  test('failed or rejected payout does not consume reservation', async () => {
    const tenantId = await createTenant();
    const { reservation, payoutInstruction } = await createReadyPayout(tenantId);
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'REJECTED',
      failureReason: 'beneficiary account invalid'
    });

    const submitted = await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    const storedReservation = await db.knex('settlement_fund_reservations').where('id', reservation.id).first();
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'BANK_REJECTED_PAYOUT' });

    expect(submitted.payoutInstruction.payout_status).toBe('REJECTED');
    expect(storedReservation.reservation_status).toBe('ACTIVE');
    expect(events).toHaveLength(0);
    expect(signals).toHaveLength(1);
  });

  test('timeout does not assume payout success', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, { status: 'TIMEOUT' });

    const submitted = await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_TIMEOUT' });

    expect(submitted.payoutInstruction.payout_status).toBe('TIMEOUT');
    expect(events).toHaveLength(0);
    expect(signals).toHaveLength(1);
  });

  test('duplicate submit is idempotent and creates one ledger transaction', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'SUCCESS',
      providerPayoutId: `po_${uuidv4().replace(/-/g, '')}`,
      utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    });

    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    const duplicate = await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });
    const ledgerRows = await payoutLedgerTransactions(tenantId, payoutInstruction.id);

    expect(duplicate.duplicate).toBe(true);
    expect(events).toHaveLength(1);
    expect(ledgerRows).toHaveLength(1);
  });

  test('provider callback success stores evidence, emits outbox, and consumes reservation through worker', async () => {
    const tenantId = await createTenant();
    const { reservation, payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'PROCESSING',
      providerPayoutId
    });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });

    const callback = {
      provider_event_id: `evt_${uuidv4().replace(/-/g, '')}`,
      provider_event_type: 'payout.success',
      provider_payout_id: providerPayoutId,
      bank_idempotency_key: payoutInstruction.bank_idempotency_key,
      status: 'SUCCESS',
      utr_number: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    };
    const signed = signedCallbackPayload(callback);
    const result = await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: signed.raw,
      parsedBody: callback,
      headers: signed.headers,
      correlationId: uuidv4()
    });

    expect(result.providerEvent.processing_status).toBe('PROCESSED');
    expect(result.payoutInstruction.payout_status).toBe('SUCCESS');

    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const consumedReservation = await db.knex('settlement_fund_reservations').where('id', reservation.id).first();
    expect(consumedReservation.reservation_status).toBe('CONSUMED');
  });

  test('invalid callback signature is stored and rejected without payout state change', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'PROCESSING',
      providerPayoutId
    });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });

    const callback = {
      provider_event_id: `evt_${uuidv4().replace(/-/g, '')}`,
      provider_payout_id: providerPayoutId,
      bank_idempotency_key: payoutInstruction.bank_idempotency_key,
      status: 'SUCCESS'
    };
    const result = await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: JSON.stringify(callback),
      parsedBody: callback,
      headers: { 'x-mock-signature': 'bad-signature' },
      correlationId: uuidv4()
    });
    const storedPayout = await latestPayout(payoutInstruction.id);
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_STATUS_CONFLICT' });

    expect(result.status).toBe('FAILED');
    expect(storedPayout.payout_status).toBe('PROCESSING');
    expect(signals).toHaveLength(1);
  });

  test('duplicate callback is idempotent and does not duplicate ledger impact', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, { status: 'PROCESSING', providerPayoutId });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });

    const callback = {
      provider_event_id: `evt_${uuidv4().replace(/-/g, '')}`,
      provider_payout_id: providerPayoutId,
      bank_idempotency_key: payoutInstruction.bank_idempotency_key,
      status: 'SUCCESS',
      utr_number: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    };
    const signed = signedCallbackPayload(callback);
    await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: signed.raw,
      parsedBody: callback,
      headers: signed.headers
    });
    const second = await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: signed.raw,
      parsedBody: callback,
      headers: signed.headers
    });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const events = await db.knex('outbox_events').where({ tenant_id: tenantId, event_type: 'payout.successful' });
    const ledgerRows = await payoutLedgerTransactions(tenantId, payoutInstruction.id);

    expect(second.duplicate).toBe(true);
    expect(events).toHaveLength(1);
    expect(ledgerRows).toHaveLength(1);
  });

  test('returned payout after success posts reversal through outbox', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'SUCCESS',
      providerPayoutId,
      utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });

    const callback = {
      provider_event_id: `evt_${uuidv4().replace(/-/g, '')}`,
      provider_payout_id: providerPayoutId,
      bank_idempotency_key: payoutInstruction.bank_idempotency_key,
      status: 'RETURNED',
      return_reason: 'beneficiary bank returned'
    };
    const signed = signedCallbackPayload(callback);
    await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: signed.raw,
      parsedBody: callback,
      headers: signed.headers
    });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const finalPayout = await latestPayout(payoutInstruction.id);
    const ledgerRows = await payoutLedgerTransactions(tenantId, payoutInstruction.id);
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_RETURNED' });

    expect(finalPayout.payout_status).toBe('RETURNED');
    expect(ledgerRows).toHaveLength(2);
    expect(signals).toHaveLength(1);
  });

  test('reversed payout after success posts reversal through outbox', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'SUCCESS',
      providerPayoutId,
      utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });

    const callback = {
      provider_event_id: `evt_${uuidv4().replace(/-/g, '')}`,
      provider_payout_id: providerPayoutId,
      bank_idempotency_key: payoutInstruction.bank_idempotency_key,
      status: 'REVERSED',
      return_reason: 'provider reversal'
    };
    const signed = signedCallbackPayload(callback);
    await payoutCallbackIngestionService.ingestPayoutCallback({
      tenantId,
      providerName: 'mockbank',
      rawBody: signed.raw,
      parsedBody: callback,
      headers: signed.headers
    });
    await new OutboxWorker().processBatch({ tenantId, limit: 5 });
    const finalPayout = await latestPayout(payoutInstruction.id);
    const ledgerRows = await payoutLedgerTransactions(tenantId, payoutInstruction.id);
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_REVERSED' });

    expect(finalPayout.payout_status).toBe('REVERSED');
    expect(ledgerRows).toHaveLength(2);
    expect(signals).toHaveLength(1);
  });

  test('status conflict signal does not blindly downgrade successful payout', async () => {
    const tenantId = await createTenant();
    const { payoutInstruction } = await createReadyPayout(tenantId);
    const providerPayoutId = `po_${uuidv4().replace(/-/g, '')}`;
    bankPayoutAdapter.setMockSubmitResponse(payoutInstruction.bank_idempotency_key, {
      status: 'SUCCESS',
      providerPayoutId,
      utrNumber: `UTR${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`
    });
    await payoutExecutionService.submitPayout({ payoutInstructionId: payoutInstruction.id });
    bankPayoutAdapter.setMockVerifyResponse(providerPayoutId, { status: 'FAILED', providerPayoutId, failureReason: 'provider says failed' });

    await payoutExecutionService.verifyPayoutStatus({ payoutInstructionId: payoutInstruction.id });
    const finalPayout = await latestPayout(payoutInstruction.id);
    const signals = await payoutSignalService.listSignals({ tenantId, signalType: 'PAYOUT_STATUS_CONFLICT' });

    expect(finalPayout.payout_status).toBe('SUCCESS');
    expect(signals).toHaveLength(1);
  });

  test('API RBAC and tenant isolation for payouts and signals', async () => {
    const tenantA = await createTenant('payout-api-a');
    const tenantB = await createTenant('payout-api-b');
    const { payoutInstruction } = await createReadyPayout(tenantB);
    await payoutSignalService.createOrUpdateSignal({
      tenantId: tenantB,
      signalType: 'PAYOUT_DELAYED',
      sourceType: 'PAYOUT_INSTRUCTION',
      sourceId: payoutInstruction.id,
      payoutInstructionId: payoutInstruction.id,
      settlementBatchId: payoutInstruction.settlement_batch_id,
      impactAmount: payoutInstruction.payout_amount,
      currency: payoutInstruction.currency,
      description: 'API filtering payout delay signal'
    });

    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const merchantToken = securityService.generateJWT({ userId: 'merchant-a', tenantId: tenantA, role: 'MERCHANT' });
    const platformToken = securityService.generateJWT({ userId: 'platform', tenantId: tenantA, role: 'PLATFORM_ADMIN' });
    const app = createApp();

    await request(app).get('/api/payouts').expect(401);
    await request(app).get('/api/payouts').set('Authorization', `Bearer ${merchantToken}`).expect(403);
    await request(app).get(`/api/payouts?tenantId=${tenantB}`).set('Authorization', `Bearer ${financeToken}`).expect(403);

    const payoutResponse = await request(app)
      .get(`/api/payouts?tenantId=${tenantB}&payoutStatus=READY`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(payoutResponse.body.records.some(row => row.id === payoutInstruction.id)).toBe(true);
    expect(payoutResponse.body.records.every(row => row.tenant_id === tenantB)).toBe(true);

    const signalResponse = await request(app)
      .get(`/api/payout-signals?tenantId=${tenantB}&signalType=PAYOUT_DELAYED&status=OPEN`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(signalResponse.body.records).toHaveLength(1);
  });

  test('cannot create payout for non-reserved batch', async () => {
    const tenantId = await createTenant();
    await createPricingRule(tenantId);
    const transaction = await createCapturedTransaction(tenantId);
    await importGatewaySettlementAndPostEscrow(tenantId, transaction);
    const result = await settlementBatchingService.createSettlementBatch({
      tenantId,
      cycleStart: new Date(Date.now() - 60 * 60 * 1000),
      cycleEnd: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: 'test'
    });

    await expect(payoutExecutionService.createPayoutInstructionForBatch({
      batchId: result.batch.id,
      requestedBy: 'finance-user'
    })).rejects.toThrow('Cannot create payout');
    const payouts = await db.knex('payout_instructions').where({ tenant_id: tenantId, settlement_batch_id: result.batch.id });
    expect(payouts).toHaveLength(0);
  });
});
