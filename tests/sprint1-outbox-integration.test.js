const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const PaymentGateway = require('../src/core/payment-gateway');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const { idempotencyService } = require('../src/core/idempotency/idempotency-service');
const { requireIdempotency } = require('../src/core/idempotency/idempotency-middleware');
const { correlationIdMiddleware } = require('../src/core/middleware/correlation-id');
const { authenticateJWT, requireRoles } = require('../src/core/auth/rbac-middleware');
const SecurityService = require('../src/security/security-service');
const createOutboxRoutes = require('../src/api/outbox-routes');

const TEST_TENANT_ID = '11111111-1111-4111-8111-111111111111';

async function cleanup() {
  await db.knex('outbox_events').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('idempotency_keys').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('transactions').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('tenants').where('id', TEST_TENANT_ID).del();
}

async function ensureTenant() {
  await db.knex('tenants')
    .insert({
      id: TEST_TENANT_ID,
      tenant_code: 'sprint1-test',
      tenant_name: 'Sprint 1 Test Tenant',
      status: 'active'
    })
    .onConflict('id')
    .ignore();
}

describe('Sprint 1 - durable financial events', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await cleanup();
    await ensureTenant();
  });

  afterEach(async () => {
    await cleanup();
    await ensureTenant();
  });

  afterAll(async () => {
    await cleanup();
    await db.knex.destroy();
  });

  test('creates an outbox event for a financial transaction write', async () => {
    const paymentGateway = new PaymentGateway({
      ...config,
      defaultTenantId: TEST_TENANT_ID,
      fees: {
        platform: { default: 0 },
        gateway: { default: 0 }
      }
    });
    const transactionRef = `TXN_${uuidv4()}`;

    await paymentGateway.logTransaction(
      {
        tenantId: TEST_TENANT_ID,
        merchantId: TEST_TENANT_ID,
        customerId: 'cust-1',
        orderId: `ORD_${uuidv4()}`,
        paymentMethod: 'card',
        amount: 1250,
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

    const transaction = await db.knex('transactions')
      .where({ tenant_id: TEST_TENANT_ID, transaction_ref: transactionRef })
      .first();
    const event = await db.knex('outbox_events')
      .where({
        tenant_id: TEST_TENANT_ID,
        aggregate_type: 'transaction',
        aggregate_id: transaction.id,
        event_type: 'payment.captured'
      })
      .first();

    expect(transaction).toBeDefined();
    expect(event).toBeDefined();
    expect(event.status).toBe('PENDING');
    expect(event.idempotency_key).toBe(`transaction:${transactionRef}`);
    expect(event.payload.transactionRef).toBe(transactionRef);
  });

  test('retries failed event processing and moves event to DLQ after max retries', async () => {
    const correlationId = uuidv4();
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'payment',
      aggregateId: uuidv4(),
      eventType: 'payment.captured',
      idempotencyKey: `retry:${uuidv4()}`,
      correlationId,
      maxRetries: 2,
      payload: { amount: '100.00', currency: 'INR' }
    });

    const worker = new OutboxWorker({
      handlers: {
        'payment.captured': async () => {
          throw new Error('simulated downstream failure');
        }
      }
    });

    const firstRun = await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });
    await db.knex('outbox_events')
      .where('id', event.id)
      .update({ next_retry_at: new Date(Date.now() - 1000) });
    const secondRun = await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });

    const finalEvent = await outboxService.getEvent(event.id);
    const dlqEvents = await outboxService.getDlqEvents({ tenantId: TEST_TENANT_ID });

    expect(firstRun.results[0]).toMatchObject({
      eventId: event.id,
      status: 'FAILED',
      retryCount: 1
    });
    expect(secondRun.results[0]).toMatchObject({
      eventId: event.id,
      status: 'DLQ',
      retryCount: 2
    });
    expect(finalEvent.status).toBe('DLQ');
    expect(finalEvent.retry_count).toBe(2);
    expect(finalEvent.last_error).toContain('simulated downstream failure');
    expect(finalEvent.correlation_id).toBe(correlationId);
    expect(dlqEvents.map(dlq => dlq.id)).toContain(event.id);
  });

  test('processes event successfully after an initial failure retry', async () => {
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'payment',
      aggregateId: uuidv4(),
      eventType: 'payment.captured',
      idempotencyKey: `eventual-success:${uuidv4()}`,
      maxRetries: 3,
      payload: { amount: '200.00', currency: 'INR' }
    });

    let attempts = 0;
    const worker = new OutboxWorker({
      handlers: {
        'payment.captured': async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('temporary failure');
          }
        }
      }
    });

    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });
    await db.knex('outbox_events')
      .where('id', event.id)
      .update({ next_retry_at: new Date(Date.now() - 1000) });
    await worker.processBatch({ tenantId: TEST_TENANT_ID, limit: 1 });

    const finalEvent = await outboxService.getEvent(event.id);
    expect(finalEvent.status).toBe('PROCESSED');
    expect(finalEvent.retry_count).toBe(1);
    expect(finalEvent.processed_at).toBeTruthy();
  });

  test('enforces idempotency without duplicate processing', async () => {
    const idempotencyKey = `idem_${uuidv4()}`;
    const first = await idempotencyService.begin({
      tenantId: TEST_TENANT_ID,
      scope: 'payments.process',
      idempotencyKey,
      requestBody: { amount: '500.00', currency: 'INR' },
      correlationId: uuidv4()
    });

    await idempotencyService.complete({
      tenantId: TEST_TENANT_ID,
      scope: 'payments.process',
      idempotencyKey,
      responseBody: { success: true, paymentId: 'pay-1' }
    });

    const replay = await idempotencyService.begin({
      tenantId: TEST_TENANT_ID,
      scope: 'payments.process',
      idempotencyKey,
      requestBody: { amount: '500.00', currency: 'INR' },
      correlationId: uuidv4()
    });

    await expect(idempotencyService.begin({
      tenantId: TEST_TENANT_ID,
      scope: 'payments.process',
      idempotencyKey,
      requestBody: { amount: '999.00', currency: 'INR' },
      correlationId: uuidv4()
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.responseBody).toMatchObject({ success: true, paymentId: 'pay-1' });
  });

  test('returns idempotent response through middleware on duplicate request', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.post('/financial-write', (req, res, next) => {
      req.tenantId = TEST_TENANT_ID;
      next();
    }, requireIdempotency('test.financial_write'), async (req, res) => {
      const event = await outboxService.createEvent({
        tenantId: TEST_TENANT_ID,
        aggregateType: 'test',
        aggregateId: uuidv4(),
        eventType: 'test.financial_write',
        idempotencyKey: req.idempotency.key,
        payload: req.body,
        correlationId: req.correlationId
      });

      res.json({
        success: true,
        eventId: event.id,
        idempotencyKey: req.idempotency.key,
        correlationId: req.correlationId
      });
    });

    const idempotencyKey = `api_${uuidv4()}`;
    const body = { amount: '10.00' };
    const first = await request(app)
      .post('/financial-write')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(200);
    const second = await request(app)
      .post('/financial-write')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(200);

    const events = await db.knex('outbox_events')
      .where({ tenant_id: TEST_TENANT_ID, event_type: 'test.financial_write', idempotency_key: idempotencyKey });

    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body.eventId).toBe(first.body.eventId);
    expect(events).toHaveLength(1);
  });

  test('rolls back outbox event on partial failure inside same transaction', async () => {
    const transactionRef = `PARTIAL_${uuidv4()}`;

    await expect(db.knex.transaction(async (trx) => {
      const [transaction] = await trx('transactions')
        .insert({
          tenant_id: TEST_TENANT_ID,
          order_id: `ORD_${uuidv4()}`,
          transaction_ref: transactionRef,
          payment_method: 'card',
          gateway: 'razorpay',
          amount: 10,
          currency: 'INR',
          status: 'success'
        })
        .returning('*');

      await outboxService.createEvent({
        tenantId: TEST_TENANT_ID,
        aggregateType: 'transaction',
        aggregateId: transaction.id,
        eventType: 'payment.captured',
        idempotencyKey: `partial:${transactionRef}`,
        payload: { transactionRef }
      }, trx);

      throw new Error('simulate commit failure');
    })).rejects.toThrow('simulate commit failure');

    const transaction = await db.knex('transactions')
      .where({ tenant_id: TEST_TENANT_ID, transaction_ref: transactionRef })
      .first();
    const event = await db.knex('outbox_events')
      .where({ tenant_id: TEST_TENANT_ID, idempotency_key: `partial:${transactionRef}` })
      .first();

    expect(transaction).toBeUndefined();
    expect(event).toBeUndefined();
  });

  test('exposes DLQ visibility through secured API with trace fields', async () => {
    const securityService = new SecurityService(config);
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.use('/outbox', createOutboxRoutes(config));

    const correlationId = uuidv4();
    const event = await outboxService.createEvent({
      tenantId: TEST_TENANT_ID,
      aggregateType: 'payment',
      aggregateId: uuidv4(),
      eventType: 'payment.captured',
      idempotencyKey: `dlq-api:${uuidv4()}`,
      correlationId,
      maxRetries: 1,
      payload: { amount: '1.00', currency: 'INR' }
    });
    await outboxService.fetchDueEvents({ tenantId: TEST_TENANT_ID, limit: 1 });
    await outboxService.markFailed(event.id, new Error('visible dlq failure'));

    const token = securityService.generateJWT({
      userId: 'finance-dlq',
      tenantId: TEST_TENANT_ID,
      role: 'FINANCE_ADMIN'
    }, 3600);

    const response = await request(app)
      .get('/outbox/dlq')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Correlation-Id', correlationId)
      .expect(200);

    const apiEvent = response.body.events.find(item => item.eventId === event.id);
    expect(apiEvent).toMatchObject({
      eventId: event.id,
      eventType: 'payment.captured',
      idempotencyKey: event.idempotency_key,
      correlationId,
      retryCount: 1,
      maxRetries: 1
    });
    expect(apiEvent.lastError).toContain('visible dlq failure');
  });
});

describe('Sprint 1 - RBAC middleware', () => {
  const securityService = new SecurityService(config);

  test('enforces authenticated role access with JWT, not role headers', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get(
      '/dlq',
      authenticateJWT(config),
      requireRoles(['FINANCE_ADMIN']),
      (req, res) => res.json({ success: true, userId: req.user.userId, role: req.user.role })
    );

    const financeToken = securityService.generateJWT({
      userId: 'finance-user',
      tenantId: TEST_TENANT_ID,
      role: 'FINANCE_ADMIN'
    }, 3600);
    const merchantToken = securityService.generateJWT({
      userId: 'merchant-user',
      tenantId: TEST_TENANT_ID,
      role: 'MERCHANT'
    }, 3600);

    await request(app)
      .get('/dlq')
      .set('x-user-role', 'FINANCE_ADMIN')
      .expect(401);

    await request(app)
      .get('/dlq')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('x-user-role', 'FINANCE_ADMIN')
      .expect(403);

    const allowed = await request(app)
      .get('/dlq')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(allowed.body).toMatchObject({
      success: true,
      userId: 'finance-user',
      role: 'FINANCE_ADMIN'
    });
  });
});
