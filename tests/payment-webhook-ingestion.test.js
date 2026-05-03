const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const paymentWebhookIngestionService = require('../src/core/payment/payment-webhook-ingestion-service');
const paymentSignalService = require('../src/core/payment/payment-signal-service');
const reconciliationService = require('../src/core/ledger/reconciliation-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const { correlationIdMiddleware } = require('../src/core/middleware/correlation-id');
const createPaymentWebhookRoutes = require('../src/api/payment-webhook-routes');
const SecurityService = require('../src/security/security-service');

function mockSignature(rawBody, timestamp) {
  return crypto
    .createHmac('sha256', config.hmacSecret)
    .update(timestamp ? `${timestamp}.${rawBody}` : rawBody)
    .digest('hex');
}

function signedHeaders(payload, options = {}) {
  const raw = JSON.stringify(payload);
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  return {
    rawBody: Buffer.from(raw),
    headers: {
      'x-webhook-timestamp': String(timestamp),
      'x-mock-signature': options.invalid ? 'deadbeef' : mockSignature(raw, timestamp)
    }
  };
}

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

async function createTenant(prefix = 'webhook') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Payment Webhook Test Tenant',
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

async function createTransaction(tenantId, overrides = {}) {
  const id = uuidv4();
  const orderId = overrides.orderId || `ORD-${uuidv4()}`;
  const transactionRef = overrides.transactionRef || `TXN-${uuidv4()}`;
  const gatewayPaymentId = overrides.gatewayPaymentId || `pay_${uuidv4().replace(/-/g, '')}`;

  const [transaction] = await db.knex('transactions').insert({
    id,
    tenant_id: tenantId,
    order_id: orderId,
    transaction_ref: transactionRef,
    payment_method: 'card',
    gateway: 'mock',
    amount: overrides.amount || '100.00',
    currency: overrides.currency || 'INR',
    status: overrides.status || 'pending',
    customer_email: 'webhook@example.com',
    gateway_transaction_id: gatewayPaymentId,
    gateway_response_code: overrides.gatewayResponseCode || null,
    gateway_response_message: overrides.gatewayResponseMessage || null,
    metadata: JSON.stringify({ test: true })
  }).returning('*');

  return transaction;
}

function capturedPayload(transaction, overrides = {}) {
  return {
    eventId: overrides.eventId || `evt_${uuidv4().replace(/-/g, '')}`,
    eventType: overrides.eventType || 'payment.captured',
    paymentId: overrides.paymentId || transaction.gateway_transaction_id,
    orderId: overrides.orderId || transaction.order_id,
    transactionRef: overrides.transactionRef || transaction.transaction_ref,
    status: overrides.status || 'captured',
    amount: overrides.amount || transaction.amount,
    currency: overrides.currency || transaction.currency,
    gatewayVerificationStatus: overrides.gatewayVerificationStatus,
    gatewayVerificationAmount: overrides.gatewayVerificationAmount,
    gatewayVerificationCurrency: overrides.gatewayVerificationCurrency
  };
}

async function ingest(tenantId, payload, options = {}) {
  const signed = signedHeaders(payload, options);
  return paymentWebhookIngestionService.ingestWebhook({
    tenantId,
    gatewayName: 'mock',
    rawBody: signed.rawBody,
    parsedBody: payload,
    headers: signed.headers,
    correlationId: options.correlationId || uuidv4()
  });
}

async function outboxCount(tenantId, transactionId) {
  const row = await db.knex('outbox_events')
    .where({
      tenant_id: tenantId,
      aggregate_type: 'transaction',
      aggregate_id: transactionId,
      event_type: 'payment.captured'
    })
    .count('* as count')
    .first();
  return Number(row.count);
}

describe('Sprint 3 - trusted payment webhook ingestion', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('valid webhook captures payment through outbox and reconciles transaction-ledger', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, { amount: '125.00' });
    const result = await ingest(tenantId, capturedPayload(transaction));

    const webhookEvent = await db.knex('gateway_webhook_events').where('id', result.webhookEvent.id).first();
    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const transitions = await db.knex('payment_state_transitions').where({ webhook_event_id: webhookEvent.id });
    const eventCount = await outboxCount(tenantId, transaction.id);

    expect(webhookEvent.signature_verified).toBe(true);
    expect(webhookEvent.verification_status).toBe('VERIFIED');
    expect(webhookEvent.processing_status).toBe('PROCESSED');
    expect(updatedTransaction.status).toBe('success');
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ previous_status: 'PENDING', new_status: 'CAPTURED' });
    expect(eventCount).toBe(1);

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });
    const ledgerRows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, transaction_ref: transaction.transaction_ref });
    const recon = await reconciliationService.reconcileTransaction(updatedTransaction);

    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].metadata.event_id || JSON.parse(ledgerRows[0].metadata).event_id).toBeTruthy();
    expect(recon.reconciliation_status).toBe('MATCHED');
  });

  test('invalid signature is rejected without transaction update or outbox event', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId);
    const result = await ingest(tenantId, capturedPayload(transaction), { invalid: true });

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'WEBHOOK_SIGNATURE_FAILED' });

    expect(result.webhookEvent.verification_status).toBe('FAILED');
    expect(result.webhookEvent.processing_status).toBe('FAILED');
    expect(updatedTransaction.status).toBe('pending');
    expect(await outboxCount(tenantId, transaction.id)).toBe(0);
    expect(signals).toHaveLength(1);
  });

  test('duplicate webhook is idempotent and cannot duplicate ledger impact', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, { amount: '80.00' });
    const payload = capturedPayload(transaction, { eventId: `evt_dup_${uuidv4().replace(/-/g, '')}` });

    const first = await ingest(tenantId, payload);
    const second = await ingest(tenantId, payload);

    expect(first.status).toBe('PROCESSED');
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe('DUPLICATE');
    expect(await outboxCount(tenantId, transaction.id)).toBe(1);

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });
    await worker.processBatch({ tenantId, limit: 1 });

    const ledgerRows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, transaction_ref: transaction.transaction_ref });
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'DUPLICATE_GATEWAY_EVENT' });

    expect(ledgerRows).toHaveLength(1);
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  test('replay or stale webhook is rejected before financial side effects', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId);
    const oldTimestamp = Math.floor(Date.now() / 1000) - 1000;
    const result = await ingest(tenantId, capturedPayload(transaction), { timestamp: oldTimestamp });

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'WEBHOOK_REPLAY_DETECTED' });

    expect(result.webhookEvent.processing_status).toBe('REPLAY_REJECTED');
    expect(updatedTransaction.status).toBe('pending');
    expect(await outboxCount(tenantId, transaction.id)).toBe(0);
    expect(signals).toHaveLength(1);
  });

  test('out-of-order failed event cannot overwrite captured payment', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, { status: 'success' });
    const result = await ingest(tenantId, capturedPayload(transaction, { status: 'failed', eventType: 'payment.failed' }));

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'OUT_OF_ORDER_PAYMENT_EVENT' });

    expect(result.webhookEvent.processing_status).toBe('OUT_OF_ORDER');
    expect(updatedTransaction.status).toBe('success');
    expect(signals).toHaveLength(1);
  });

  test('late success after non-security failure is explicit and emits one captured event', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, {
      status: 'failed',
      gatewayResponseCode: 'DECLINED',
      gatewayResponseMessage: 'issuer declined'
    });

    const result = await ingest(tenantId, capturedPayload(transaction));
    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'LATE_PAYMENT_SUCCESS' });

    expect(result.transition.lateSuccess).toBe(true);
    expect(updatedTransaction.status).toBe('success');
    expect(await outboxCount(tenantId, transaction.id)).toBe(1);
    expect(signals).toHaveLength(1);
  });

  test('amount mismatch creates signal and blocks capture', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, { amount: '100.00' });
    const result = await ingest(tenantId, capturedPayload(transaction, { amount: '90.00' }));

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'PAYMENT_AMOUNT_MISMATCH' });

    expect(result.webhookEvent.processing_status).toBe('FAILED');
    expect(updatedTransaction.status).toBe('pending');
    expect(await outboxCount(tenantId, transaction.id)).toBe(0);
    expect(signals).toHaveLength(1);
  });

  test('currency mismatch creates signal and blocks capture', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId, { currency: 'INR' });
    const result = await ingest(tenantId, capturedPayload(transaction, { currency: 'USD' }));

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'PAYMENT_CURRENCY_MISMATCH' });

    expect(result.webhookEvent.processing_status).toBe('FAILED');
    expect(updatedTransaction.status).toBe('pending');
    expect(signals).toHaveLength(1);
  });

  test('gateway status conflict creates signal and blocks capture', async () => {
    const tenantId = await createTenant();
    const transaction = await createTransaction(tenantId);
    const result = await ingest(tenantId, capturedPayload(transaction, { gatewayVerificationStatus: 'failed' }));

    const updatedTransaction = await db.knex('transactions').where('id', transaction.id).first();
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'GATEWAY_STATUS_CONFLICT' });

    expect(result.webhookEvent.processing_status).toBe('FAILED');
    expect(updatedTransaction.status).toBe('pending');
    expect(await outboxCount(tenantId, transaction.id)).toBe(0);
    expect(signals).toHaveLength(1);
  });

  test('payment without internal order or transaction is stored and signalled', async () => {
    const tenantId = await createTenant();
    const payload = {
      eventId: `evt_unknown_${uuidv4().replace(/-/g, '')}`,
      eventType: 'payment.captured',
      paymentId: `pay_unknown_${uuidv4().replace(/-/g, '')}`,
      orderId: `ORD-UNKNOWN-${uuidv4()}`,
      status: 'captured',
      amount: '100.00',
      currency: 'INR'
    };

    const result = await ingest(tenantId, payload);
    const signals = await paymentSignalService.listSignals({ tenantId, signalType: 'PAYMENT_WITHOUT_ORDER' });
    const events = await db.knex('outbox_events')
      .where({ tenant_id: tenantId, event_type: 'payment.captured' });

    expect(result.webhookEvent.processing_status).toBe('IGNORED');
    expect(signals).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  test('signals API supports filtering and tenant isolation', async () => {
    const tenantA = await createTenant('signals-a');
    const tenantB = await createTenant('signals-b');
    await paymentSignalService.createSignal({
      tenantId: tenantA,
      signalType: 'PAYMENT_AMOUNT_MISMATCH',
      sourceType: 'WEBHOOK',
      sourceId: uuidv4(),
      description: 'tenant A amount mismatch',
      transactionRef: 'TXN-A'
    });
    await paymentSignalService.createSignal({
      tenantId: tenantB,
      signalType: 'WEBHOOK_SIGNATURE_FAILED',
      sourceType: 'WEBHOOK',
      sourceId: uuidv4(),
      description: 'tenant B signature failure',
      transactionRef: 'TXN-B'
    });

    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const platformToken = securityService.generateJWT({ userId: 'platform', tenantId: tenantA, role: 'PLATFORM_ADMIN' });
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json({
      verify: (req, res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    }));
    app.use('/api', createPaymentWebhookRoutes(config));

    const tenantResponse = await request(app)
      .get('/api/payments/signals?signalType=PAYMENT_AMOUNT_MISMATCH')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const platformResponse = await request(app)
      .get(`/api/payments/signals?tenantId=${tenantB}&severity=CRITICAL&signalStatus=OPEN`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(tenantResponse.body.records).toHaveLength(1);
    expect(tenantResponse.body.records[0]).toMatchObject({ tenant_id: tenantA, signal_type: 'PAYMENT_AMOUNT_MISMATCH' });
    expect(platformResponse.body.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ tenant_id: tenantB, signal_type: 'WEBHOOK_SIGNATURE_FAILED' })])
    );
    expect(platformResponse.body.records.some(row => row.tenant_id === tenantA)).toBe(false);
  });

  test('webhook events API supports filtering and tenant isolation', async () => {
    const tenantA = await createTenant('events-a');
    const tenantB = await createTenant('events-b');
    const transactionA = await createTransaction(tenantA);
    const transactionB = await createTransaction(tenantB);
    await ingest(tenantA, capturedPayload(transactionA, { amount: '90.00' }));
    await ingest(tenantB, capturedPayload(transactionB));

    const securityService = new SecurityService(config);
    const financeToken = securityService.generateJWT({ userId: 'finance-events-a', tenantId: tenantA, role: 'FINANCE_ADMIN' });
    const platformToken = securityService.generateJWT({ userId: 'platform-events', tenantId: tenantA, role: 'PLATFORM_ADMIN' });
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json({
      verify: (req, res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    }));
    app.use('/api', createPaymentWebhookRoutes(config));

    const tenantResponse = await request(app)
      .get(`/api/webhooks/events?gatewayName=mock&processingStatus=FAILED&verificationStatus=VERIFIED&transactionRef=${transactionA.transaction_ref}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const platformResponse = await request(app)
      .get(`/api/webhooks/events?tenantId=${tenantB}&processingStatus=PROCESSED`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(tenantResponse.body.records).toHaveLength(1);
    expect(tenantResponse.body.records[0]).toMatchObject({
      tenant_id: tenantA,
      gateway_name: 'mock',
      processing_status: 'FAILED',
      transaction_ref: transactionA.transaction_ref
    });
    expect(platformResponse.body.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ tenant_id: tenantB, processing_status: 'PROCESSED' })])
    );
    expect(platformResponse.body.records.some(row => row.tenant_id === tenantA)).toBe(false);
  });
});
