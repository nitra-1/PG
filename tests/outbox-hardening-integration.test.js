const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const PaymentGateway = require('../src/core/payment-gateway');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const reconciliationService = require('../src/core/ledger/reconciliation-service');

const TEST_TENANT_ID = '33333333-3333-4333-8333-333333333333';

async function cleanup() {
  await db.knex('reconciliation_transactions').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('outbox_events').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('idempotency_keys').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('settlements').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('accounting_periods').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('transactions').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('tenants').where('id', TEST_TENANT_ID).del();
}

async function ensureTenant() {
  await db.knex('tenants')
    .insert({
      id: TEST_TENANT_ID,
      tenant_code: 'outbox-hardening-test',
      tenant_name: 'Outbox Hardening Test Tenant',
      status: 'active'
    })
    .onConflict('id')
    .ignore();
}

async function ensureLedgerPrerequisites() {
  await db.knex('ledger_accounts')
    .insert([
      {
        account_code: 'ESC-001',
        account_name: 'Escrow Bank Account',
        account_type: 'escrow',
        normal_balance: 'debit',
        category: 'asset',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'ESC-002',
        account_name: 'Escrow Liability',
        account_type: 'escrow',
        normal_balance: 'credit',
        category: 'liability',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'MER-001',
        account_name: 'Merchant Receivables',
        account_type: 'merchant',
        normal_balance: 'debit',
        category: 'asset',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'GTW-001-RZP',
        account_name: 'Gateway Receivable Razorpay',
        account_type: 'gateway',
        normal_balance: 'debit',
        category: 'asset',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'MER-002',
        account_name: 'Merchant Payables',
        account_type: 'merchant',
        normal_balance: 'credit',
        category: 'liability',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      }
    ])
    .onConflict('account_code')
    .ignore();

  await db.knex('accounting_periods').insert({
    tenant_id: TEST_TENANT_ID,
    period_type: 'DAILY',
    period_start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    period_end: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'OPEN',
    created_by: 'test'
  });
}

describe('Outbox hardening - financial correctness', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await cleanup();
    await ensureTenant();
    await ensureLedgerPrerequisites();
  });

  afterEach(async () => {
    await cleanup();
    await ensureTenant();
    await ensureLedgerPrerequisites();
  });

  afterAll(async () => {
    await cleanup();
    await db.knex.destroy();
  });

  test('payment request flow only commits transaction plus outbox event; ledger is posted by worker', async () => {
    const paymentGateway = new PaymentGateway({
      ...config,
      defaultTenantId: TEST_TENANT_ID,
      fees: {
        platform: { default: 0 },
        gateway: { default: 0 }
      }
    });
    const transactionRef = `TXN_${uuidv4()}`;
    const orderId = `ORD_${uuidv4()}`;

    await paymentGateway.logTransaction(
      {
        tenantId: TEST_TENANT_ID,
        merchantId: TEST_TENANT_ID,
        customerId: 'cust-hardening',
        orderId,
        paymentMethod: 'card',
        amount: 100,
        currency: 'INR'
      },
      {
        transactionId: transactionRef,
        status: 'success',
        responseCode: '00',
        message: 'captured'
      },
      'razorpay'
    );

    const eventBeforeWorker = await db.knex('outbox_events')
      .where({ tenant_id: TEST_TENANT_ID, idempotency_key: `transaction:${transactionRef}` })
      .first();
    const ledgerBeforeWorker = await db.knex('ledger_transactions')
      .where({ tenant_id: TEST_TENANT_ID, source_order_id: orderId });

    expect(eventBeforeWorker.status).toBe('PENDING');
    expect(ledgerBeforeWorker).toHaveLength(0);

    const worker = new OutboxWorker();
    const result = await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });

    const ledgerAfterWorker = await db.knex('ledger_transactions')
      .where({ tenant_id: TEST_TENANT_ID, source_order_id: orderId });
    const eventAfterWorker = await outboxService.getEvent(eventBeforeWorker.id);

    expect(result.results[0]).toMatchObject({ eventId: eventBeforeWorker.id, status: 'PROCESSED' });
    expect(eventAfterWorker.status).toBe('PROCESSED');
    expect(ledgerAfterWorker).toHaveLength(1);

    const transaction = await db.knex('transactions')
      .where({ tenant_id: TEST_TENANT_ID, transaction_ref: transactionRef })
      .first();
    const reconciliation = await reconciliationService.reconcileTransaction(transaction);
    expect(reconciliation.reconciliation_status).toBe('MATCHED');
  });

  test('concurrent workers process the same due event only once', async () => {
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'test',
      aggregateId: uuidv4(),
      eventType: 'test.concurrent',
      idempotencyKey: `concurrent:${uuidv4()}`,
      payload: { amount: '10.00' }
    });

    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 100));
    };
    const workerA = new OutboxWorker({ handlers: { 'test.concurrent': handler } });
    const workerB = new OutboxWorker({ handlers: { 'test.concurrent': handler } });

    const [first, second] = await Promise.all([
      workerA.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 }),
      workerB.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 })
    ]);

    const finalEvent = await outboxService.getEvent(event.id);
    expect(first.processedCount + second.processedCount).toBe(1);
    expect(handlerCalls).toBe(1);
    expect(finalEvent.status).toBe('PROCESSED');
  });

  test('crashed worker PROCESSING event is recovered to PENDING with retry increment', async () => {
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'test',
      aggregateId: uuidv4(),
      eventType: 'test.crash',
      idempotencyKey: `crash:${uuidv4()}`,
      payload: { amount: '15.00' }
    });

    const claimed = await outboxService.fetchDueEvents({ tenantId: TEST_TENANT_ID, limit: 1 });
    expect(claimed[0].id).toBe(event.id);

    await db.knex('outbox_events')
      .where('id', event.id)
      .update({
        processing_started_at: new Date(Date.now() - 10 * 60 * 1000),
        locked_until: new Date(Date.now() - 10 * 60 * 1000)
      });

    const recovered = await outboxService.recoverTimedOutEvents({ tenantId: TEST_TENANT_ID });
    const finalEvent = await outboxService.getEvent(event.id);

    expect(recovered.map(item => item.id)).toContain(event.id);
    expect(finalEvent.status).toBe('PENDING');
    expect(finalEvent.retry_count).toBe(1);
    expect(finalEvent.processing_started_at).toBeNull();
  });

  test('payment handler is idempotent when the same event is executed twice', async () => {
    const transactionId = uuidv4();
    const transactionRef = `TXN_${transactionId}`;
    await db.knex('transactions').insert({
      id: transactionId,
      tenant_id: TEST_TENANT_ID,
      order_id: `ORD_${transactionId}`,
      transaction_ref: transactionRef,
      payment_method: 'card',
      gateway: 'razorpay',
      amount: 75,
      currency: 'INR',
      status: 'success'
    });

    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'transaction',
      aggregateId: transactionId,
      eventType: 'payment.captured',
      idempotencyKey: `transaction:${transactionId}`,
      payload: {
        transactionId,
        transactionRef,
        orderId: `ORD_${transactionId}`,
        gateway: 'razorpay',
        amount: '75',
        currency: 'INR',
        platformFee: '0',
        gatewayFee: '0',
        merchantId: TEST_TENANT_ID
      }
    });

    const [claimed] = await outboxService.fetchDueEvents({ tenantId: TEST_TENANT_ID, limit: 1 });
    const worker = new OutboxWorker();

    await worker.processEvent(claimed);
    await worker.processEvent({ ...claimed, status: 'PROCESSING' });

    const ledgerRows = await db.knex('ledger_transactions')
      .where({ tenant_id: TEST_TENANT_ID, transaction_ref: transactionRef });
    const ledgerEntries = ledgerRows.length
      ? await db.knex('ledger_entries as le')
        .join('ledger_accounts as la', 'la.id', 'le.account_id')
        .where({ 'le.tenant_id': TEST_TENANT_ID, 'le.transaction_id': ledgerRows[0].id })
        .select('le.*', 'la.account_code')
        .orderBy('le.created_at', 'asc')
      : [];
    const finalEvent = await outboxService.getEvent(event.id);

    expect(finalEvent.status).toBe('PROCESSED');
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map(entry => `${entry.account_code}:${entry.entry_type}:${Number(entry.amount)}`).sort())
      .toEqual([
        'GTW-001-RZP:debit:75',
        'MER-002:credit:75'
      ].sort());
  });

  test('retry respects next_retry_at before succeeding', async () => {
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'test',
      aggregateId: uuidv4(),
      eventType: 'test.retry-success',
      idempotencyKey: `retry-success:${uuidv4()}`,
      maxRetries: 3,
      payload: { amount: '1.00' }
    });

    let attempts = 0;
    const worker = new OutboxWorker({
      handlers: {
        'test.retry-success': async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('temporary failure');
          }
        }
      }
    });

    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });
    const blockedRetry = await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });
    await db.knex('outbox_events')
      .where('id', event.id)
      .update({ next_retry_at: new Date(Date.now() - 1000) });
    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });

    const finalEvent = await outboxService.getEvent(event.id);
    expect(blockedRetry.processedCount).toBe(0);
    expect(finalEvent.status).toBe('PROCESSED');
    expect(finalEvent.retry_count).toBe(1);
    expect(attempts).toBe(2);
  });

  test('repeated failure moves to DLQ with dlq timestamp', async () => {
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'test',
      aggregateId: uuidv4(),
      eventType: 'test.dlq',
      idempotencyKey: `dlq:${uuidv4()}`,
      maxRetries: 2,
      payload: { amount: '1.00' }
    });

    const worker = new OutboxWorker({
      handlers: {
        'test.dlq': async () => {
          throw new Error('permanent failure');
        }
      }
    });

    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });
    await db.knex('outbox_events')
      .where('id', event.id)
      .update({ next_retry_at: new Date(Date.now() - 1000) });
    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });

    const finalEvent = await outboxService.getEvent(event.id);
    expect(finalEvent.status).toBe('DLQ');
    expect(finalEvent.retry_count).toBe(2);
    expect(finalEvent.dlq_at).toBeTruthy();
    expect(finalEvent.last_error).toContain('permanent failure');
  });
});
