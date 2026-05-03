const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const ledgerService = require('../src/core/ledger/ledger-service');
const reconciliationService = require('../src/core/ledger/reconciliation-service');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const createReconciliationRoutes = require('../src/api/reconciliation-routes');
const SecurityService = require('../src/security/security-service');
const config = require('../src/config/config');

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
    }
  ]).onConflict('account_code').ignore();
}

async function createTenant() {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `tx-recon-${tenantId.slice(0, 8)}`,
    tenant_name: 'Transaction Ledger Reconciliation Test',
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

async function createSuccessTransaction(tenantId, overrides = {}) {
  const transactionId = overrides.id || uuidv4();
  const transactionRef = overrides.transactionRef || `TXN-${uuidv4()}`;

  await db.knex('transactions').insert({
    id: transactionId,
    tenant_id: tenantId,
    order_id: overrides.orderId || `ORD-${uuidv4()}`,
    transaction_ref: transactionRef,
    payment_method: 'card',
    gateway: 'razorpay',
    amount: overrides.amount || '100.00',
    currency: overrides.currency || 'INR',
    status: 'success',
    customer_email: 'recon@example.com',
    completed_at: new Date(),
    metadata: JSON.stringify({ test: true })
  });

  return db.knex('transactions').where({ id: transactionId }).first();
}

async function postPaymentLedger(tenantId, transaction, overrides = {}) {
  return ledgerService.postTransaction({
    tenantId,
    transactionRef: transaction.transaction_ref,
    idempotencyKey: overrides.idempotencyKey || `ledger:${uuidv4()}`,
    eventType: 'payment_success',
    sourceTransactionId: transaction.id,
    sourceOrderId: transaction.order_id,
    amount: overrides.amount || transaction.amount,
    currency: overrides.currency || transaction.currency,
    description: 'transaction reconciliation test',
    metadata: { event_id: overrides.eventId || uuidv4() },
    eventId: overrides.eventId || uuidv4(),
    correlationId: overrides.correlationId || uuidv4(),
    createdBy: 'test'
  });
}

async function processPaymentOutbox(tenantId, transaction, overrides = {}) {
  const event = await outboxService.createEvent({
    tenantId,
    aggregateType: 'transaction',
    aggregateId: transaction.id,
    eventType: 'payment.captured',
    idempotencyKey: `transaction:${transaction.transaction_ref}`,
    correlationId: overrides.correlationId || uuidv4(),
    payload: {
      transactionId: transaction.id,
      transactionRef: transaction.transaction_ref,
      orderId: transaction.order_id,
      gateway: 'razorpay',
      amount: transaction.amount,
      currency: transaction.currency,
      merchantId: tenantId
    }
  });

  const worker = new OutboxWorker();
  await worker.processBatch({ tenantId, limit: 1 });
  return outboxService.getEvent(event.id);
}

describe('Sprint 2B Phase 1 - transaction to ledger reconciliation', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('MATCHED when successful payment has exactly one matching ledger transaction', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '125.00' });
    const finalEvent = await processPaymentOutbox(tenantId, transaction);

    expect(finalEvent.status).toBe('PROCESSED');

    const result = await reconciliationService.reconcileTransaction(transaction);

    expect(result.reconciliation_status).toBe('MATCHED');
    expect(result.ledger_transaction_id).toBeTruthy();
    expect(Number(result.transaction_amount)).toBe(125);
    expect(Number(result.ledger_amount)).toBe(125);
    expect(Number(result.discrepancy_amount)).toBe(0);
  });

  test('MISSING_LEDGER when transaction succeeds but no ledger transaction exists', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '100.00' });
    const ledgerCountBefore = await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first();

    const result = await reconciliationService.reconcileTransaction(transaction);
    const ledgerCountAfter = await db.knex('ledger_transactions').where({ tenant_id: tenantId }).count('* as count').first();

    expect(result.reconciliation_status).toBe('MISSING_LEDGER');
    expect(result.ledger_transaction_id).toBeNull();
    expect(result.ledger_amount).toBeNull();
    expect(Number(result.discrepancy_amount)).toBe(100);
    expect(Number(ledgerCountAfter.count)).toBe(Number(ledgerCountBefore.count));
  });

  test('DUPLICATE_LEDGER when more than one ledger transaction shares the same tenant transaction_ref', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '100.00' });
    let firstLedger;
    let secondLedger;

    await db.knex.raw('DROP INDEX IF EXISTS uq_ledger_transactions_tenant_ref;');

    try {
      firstLedger = await postPaymentLedger(tenantId, transaction, { idempotencyKey: `dup-a:${uuidv4()}` });
      secondLedger = await postPaymentLedger(tenantId, transaction, { idempotencyKey: `dup-b:${uuidv4()}` });

      const result = await reconciliationService.reconcileTransaction(transaction);

      expect(result.reconciliation_status).toBe('DUPLICATE_LEDGER');
      expect(result.ledger_transaction_id).toBe(firstLedger.transaction.id);
    } finally {
      if (secondLedger?.transaction?.id) {
        await db.knex('ledger_transactions')
          .where('id', secondLedger.transaction.id)
          .update({ transaction_ref: `${transaction.transaction_ref}-DUPLICATE-REPAIRED` });
      }
      await db.knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_tenant_ref
          ON ledger_transactions (tenant_id, transaction_ref);
      `);
    }
  });

  test('AMOUNT_MISMATCH when ledger entries do not equal transaction amount', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '100.00' });
    await postPaymentLedger(tenantId, transaction, { amount: '90.00' });

    const result = await reconciliationService.reconcileTransaction(transaction);

    expect(result.reconciliation_status).toBe('AMOUNT_MISMATCH');
    expect(Number(result.transaction_amount)).toBe(100);
    expect(Number(result.ledger_amount)).toBe(90);
    expect(Number(result.discrepancy_amount)).toBe(10);
  });

  test('CURRENCY_MISMATCH when ledger currency differs from transaction currency', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '100.00', currency: 'INR' });
    await postPaymentLedger(tenantId, transaction, { amount: '100.00', currency: 'USD' });

    const result = await reconciliationService.reconcileTransaction(transaction);

    expect(result.reconciliation_status).toBe('CURRENCY_MISMATCH');
    expect(Number(result.discrepancy_amount)).toBe(0);
  });

  test('idempotent reconciliation updates the same row instead of inserting duplicates', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '50.00' });
    await postPaymentLedger(tenantId, transaction);

    const first = await reconciliationService.reconcileTransaction(transaction);
    const second = await reconciliationService.reconcileTransaction(transaction);
    const rows = await db.knex('reconciliation_transactions')
      .where({ tenant_id: tenantId, transaction_ref: transaction.transaction_ref });

    expect(first.transaction_ref).toBe(second.transaction_ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].reconciliation_status).toBe('MATCHED');
  });

  test('partial ledger failure with header but no entries is AMOUNT_MISMATCH', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '70.00' });

    await db.knex('ledger_transactions').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      transaction_ref: transaction.transaction_ref,
      idempotency_key: `partial:${uuidv4()}`,
      event_type: 'payment_success',
      source_transaction_id: transaction.id,
      source_order_id: transaction.order_id,
      amount: '70.00',
      currency: 'INR',
      description: 'partial ledger failure simulation',
      status: 'pending',
      metadata: JSON.stringify({ event_id: uuidv4() }),
      created_by: 'test'
    });

    const result = await reconciliationService.reconcileTransaction(transaction);

    expect(result.reconciliation_status).toBe('AMOUNT_MISMATCH');
    expect(Number(result.ledger_amount)).toBe(0);
    expect(Number(result.discrepancy_amount)).toBe(70);
  });

  test('bulk reconciliation processes only successful transactions for the tenant', async () => {
    const tenantId = await createTenant();
    const matched = await createSuccessTransaction(tenantId, { amount: '20.00' });
    const missing = await createSuccessTransaction(tenantId, { amount: '30.00' });
    await postPaymentLedger(tenantId, matched);

    const result = await reconciliationService.reconcileAllTransactions({ tenantId });

    expect(result.total).toBe(2);
    expect(result.by_status.MATCHED).toBe(1);
    expect(result.by_status.MISSING_LEDGER).toBe(1);

    const rows = await db.knex('reconciliation_transactions')
      .whereIn('transaction_ref', [matched.transaction_ref, missing.transaction_ref])
      .where({ tenant_id: tenantId });
    expect(rows).toHaveLength(2);
  });

  test('read-only API lists reconciliation records with tenant and status filters', async () => {
    const tenantId = await createTenant();
    const transaction = await createSuccessTransaction(tenantId, { amount: '44.00' });
    await postPaymentLedger(tenantId, transaction);
    await reconciliationService.reconcileTransaction(transaction);

    const securityService = new SecurityService(config);
    const token = securityService.generateJWT({
      userId: 'finance-user',
      tenantId,
      role: 'FINANCE_ADMIN'
    });
    const app = express();
    app.use('/api/reconciliation', createReconciliationRoutes(config));

    const response = await request(app)
      .get(`/api/reconciliation/transactions?tenantId=${tenantId}&status=MATCHED`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: tenantId,
          transaction_ref: transaction.transaction_ref,
          reconciliation_status: 'MATCHED'
        })
      ])
    );
  });
});
