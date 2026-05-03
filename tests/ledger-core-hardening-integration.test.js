const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const ledgerService = require('../src/core/ledger/ledger-service');
const settlementService = require('../src/core/ledger/settlement-service');
const reconciliationService = require('../src/core/ledger/reconciliation-service');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const { buildEntries } = require('../src/core/ledger/accounting-templates');

async function ensureLedgerAccounts() {
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
        account_code: 'MER-002',
        account_name: 'Merchant Payables',
        account_type: 'merchant',
        normal_balance: 'credit',
        category: 'liability',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'MER-003',
        account_name: 'Merchant Settlement',
        account_type: 'merchant',
        normal_balance: 'credit',
        category: 'liability',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'REV-001',
        account_name: 'Platform MDR',
        account_type: 'platform_revenue',
        normal_balance: 'credit',
        category: 'revenue',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'REV-REC-001',
        account_name: 'Platform Receivable',
        account_type: 'platform_revenue',
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
        account_code: 'GTW-FEE-001',
        account_name: 'Gateway Fee Razorpay',
        account_type: 'gateway',
        normal_balance: 'debit',
        category: 'expense',
        status: 'active',
        metadata: JSON.stringify({ test: true }),
        created_by: 'test'
      },
      {
        account_code: 'GTW-PAY-001',
        account_name: 'Gateway Payables',
        account_type: 'gateway',
        normal_balance: 'credit',
        category: 'liability',
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
    ])
    .onConflict('account_code')
    .ignore();
}

async function createTenantContext() {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `ledger-core-${tenantId.slice(0, 8)}`,
    tenant_name: 'Ledger Core Hardening Test',
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

async function postBalancedLedger(tenantId, overrides = {}) {
  const transactionId = overrides.sourceTransactionId || uuidv4();
  return ledgerService.postTransaction({
    tenantId,
    transactionRef: overrides.transactionRef || `LEDGER-${uuidv4()}`,
    idempotencyKey: overrides.idempotencyKey || `idem-${uuidv4()}`,
    eventType: overrides.eventType || 'payment_success',
    sourceTransactionId: transactionId,
    sourceOrderId: overrides.sourceOrderId || `ORD-${uuidv4()}`,
    amount: overrides.amount || 100,
    description: 'balanced ledger test',
    entries: overrides.entries || [
      { accountCode: 'ESC-001', entryType: 'debit', amount: overrides.amount || 100 },
      { accountCode: 'ESC-002', entryType: 'credit', amount: overrides.amount || 100 }
    ],
    metadata: overrides.metadata || {},
    eventId: overrides.eventId,
    correlationId: overrides.correlationId,
    createdBy: 'test'
  });
}

describe('Sprint 2A - ledger core hardening', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureLedgerAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('rejects imbalanced ledger transactions before commit', async () => {
    const tenantId = await createTenantContext();

    await expect(ledgerService.postTransaction({
      tenantId,
      transactionRef: `BAD-${uuidv4()}`,
      idempotencyKey: `bad-${uuidv4()}`,
      eventType: 'payment_success',
      sourceTransactionId: uuidv4(),
      sourceOrderId: `ORD-${uuidv4()}`,
      amount: 100,
      description: 'imbalanced test',
      entries: [
        { accountCode: 'ESC-001', entryType: 'debit', amount: 100 },
        { accountCode: 'ESC-002', entryType: 'credit', amount: 99 }
      ],
      createdBy: 'test'
    })).rejects.toThrow('Transaction not balanced');

    const rows = await db.knex('ledger_transactions')
      .where('tenant_id', tenantId)
      .where('transaction_ref', 'like', 'BAD-%');
    expect(rows).toHaveLength(0);
  });

  test('posts balanced ledger transaction with outbox trace metadata and audit correlation', async () => {
    const tenantId = await createTenantContext();
    const eventId = uuidv4();
    const correlationId = uuidv4();
    const idempotencyKey = `trace-${uuidv4()}`;

    const result = await postBalancedLedger(tenantId, {
      idempotencyKey,
      eventId,
      correlationId
    });

    const ledgerTx = await db.knex('ledger_transactions').where('id', result.transaction.id).first();
    const entries = await db.knex('ledger_entries').where('transaction_id', result.transaction.id);
    const audit = await db.knex('ledger_audit_logs')
      .where({ tenant_id: tenantId, entity_id: result.transaction.id, action: 'post' })
      .first();

    expect(ledgerTx.status).toBe('posted');
    expect(ledgerTx.correlation_id).toBe(correlationId);
    expect(ledgerTx.metadata.event_id).toBe(eventId);
    expect(ledgerTx.idempotency_key).toBe(idempotencyKey);
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.correlation_id === correlationId)).toBe(true);
    expect(entries.every(entry => entry.metadata.event_id === eventId)).toBe(true);
    expect(audit.correlation_id).toBe(correlationId);
    expect(audit.metadata.transaction_id).toBe(result.transaction.id);
  });

  test('same idempotency key returns existing ledger transaction without duplicate impact', async () => {
    const tenantId = await createTenantContext();
    const idempotencyKey = `idem-${uuidv4()}`;

    const first = await postBalancedLedger(tenantId, { idempotencyKey });
    const second = await postBalancedLedger(tenantId, { idempotencyKey });

    const rows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, idempotency_key: idempotencyKey });

    expect(second.duplicate).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(rows).toHaveLength(1);
  });

  test('outbox payment event creates exactly one mapped ledger transaction', async () => {
    const tenantId = await createTenantContext();
    const transactionRef = `TXN-${uuidv4()}`;
    const orderId = `ORD-${uuidv4()}`;
    const [transaction] = await db.knex('transactions').insert({
      tenant_id: tenantId,
      transaction_ref: transactionRef,
      order_id: orderId,
      payment_method: 'card',
      gateway: 'razorpay',
      amount: 100,
      currency: 'INR',
      status: 'success'
    }).returning('*');
    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'transaction',
      aggregateId: transaction.id,
      eventType: 'payment.captured',
      idempotencyKey: `transaction:${transactionRef}`,
      correlationId: uuidv4(),
      payload: {
        transactionId: transaction.id,
        transactionRef,
        orderId,
        merchantId: tenantId,
        gateway: 'razorpay',
        amount: '100',
        currency: 'INR',
        platformFee: '0',
        gatewayFee: '0'
      }
    });

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });
    await worker.processEvent({ ...event, status: 'PROCESSING' });

    const ledgerRows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, transaction_ref: transactionRef });
    const finalEvent = await outboxService.getEvent(event.id);

    expect(finalEvent.status).toBe('PROCESSED');
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].source_transaction_id).toBe(transaction.id);
    expect(ledgerRows[0].metadata.event_id).toBe(event.id);
  });

  test('missing successful transaction source sends payment event to DLQ', async () => {
    const tenantId = await createTenantContext();
    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'transaction',
      aggregateId: uuidv4(),
      eventType: 'payment.captured',
      idempotencyKey: `missing:${uuidv4()}`,
      maxRetries: 1,
      payload: {
        transactionId: uuidv4(),
        transactionRef: `MISSING-${uuidv4()}`,
        amount: '100',
        merchantId: tenantId
      }
    });

    const worker = new OutboxWorker();
    const result = await worker.processBatch({ tenantId, limit: 1 });
    const finalEvent = await outboxService.getEvent(event.id);

    expect(result.results[0]).toMatchObject({ eventId: event.id, status: 'DLQ' });
    expect(finalEvent.status).toBe('DLQ');
    expect(finalEvent.last_error).toContain('source transaction not found');
  });

  test('ledger entries remain immutable', async () => {
    const tenantId = await createTenantContext();
    const result = await postBalancedLedger(tenantId);
    const entry = result.entries[0];

    await expect(db.knex('ledger_entries')
      .where('id', entry.id)
      .update({ amount: 999 }))
      .rejects.toThrow('Ledger entries are immutable');

    await expect(db.knex('ledger_entries')
      .where('id', entry.id)
      .del())
      .rejects.toThrow('Ledger entries are immutable');
  });

  test('database guard prevents posted state without entries or with imbalance', async () => {
    const tenantId = await createTenantContext();
    const [emptyTx] = await db.knex('ledger_transactions').insert({
      tenant_id: tenantId,
      transaction_ref: `EMPTY-${uuidv4()}`,
      idempotency_key: `empty-${uuidv4()}`,
      event_type: 'payment_success',
      source_transaction_id: uuidv4(),
      amount: 100,
      status: 'pending',
      created_by: 'test'
    }).returning('*');

    await expect(db.knex('ledger_transactions')
      .where('id', emptyTx.id)
      .update({ status: 'posted' }))
      .rejects.toThrow('Cannot mark ledger transaction posted without entries');

    const accountDebit = await db.knex('ledger_accounts').where('account_code', 'ESC-001').first();
    const accountCredit = await db.knex('ledger_accounts').where('account_code', 'ESC-002').first();
    const [imbalancedTx] = await db.knex('ledger_transactions').insert({
      tenant_id: tenantId,
      transaction_ref: `IMB-${uuidv4()}`,
      idempotency_key: `imb-${uuidv4()}`,
      event_type: 'payment_success',
      source_transaction_id: uuidv4(),
      amount: 100,
      status: 'pending',
      created_by: 'test'
    }).returning('*');
    await db.knex('ledger_entries').insert([
      {
        tenant_id: tenantId,
        transaction_id: imbalancedTx.id,
        account_id: accountDebit.id,
        entry_type: 'debit',
        amount: 100,
        created_by: 'test'
      },
      {
        tenant_id: tenantId,
        transaction_id: imbalancedTx.id,
        account_id: accountCredit.id,
        entry_type: 'credit',
        amount: 90,
        created_by: 'test'
      }
    ]);

    await expect(db.knex('ledger_transactions')
      .where('id', imbalancedTx.id)
      .update({ status: 'posted' }))
      .rejects.toThrow('Cannot mark ledger transaction posted when entries are imbalanced');
  });

  test('accounting templates generate expected payment and refund accounts', () => {
    const paymentEntries = buildEntries('payment_success', {
      orderId: 'ORD-TEMPLATE',
      merchantId: 'merchant-1',
      gateway: 'razorpay',
      amount: 100,
      platformFee: 2,
      gatewayFee: 1
    });
    const refundEntries = buildEntries('refund_completed', {
      orderId: 'ORD-TEMPLATE',
      refundId: 'REF-TEMPLATE',
      merchantId: 'merchant-1',
      refundAmount: 100,
      platformFeeRefund: 2
    });

    expect(paymentEntries.map(entry => `${entry.accountCode}:${entry.entryType}:${entry.amount}`)).toEqual([
      'GTW-001-RZP:debit:100',
      'MER-002:credit:100'
    ]);
    expect(refundEntries.map(entry => `${entry.accountCode}:${entry.entryType}`)).toEqual([
      'MER-002:debit',
      'ESC-001:credit'
    ]);
  });

  test('reversal creates a new balanced transaction and links both sides', async () => {
    const tenantId = await createTenantContext();
    const original = await postBalancedLedger(tenantId);
    const reversal = await ledgerService.reverseTransaction({
      tenantId,
      originalTransactionId: original.transaction.id,
      reason: 'customer dispute accepted',
      createdBy: 'test',
      eventId: uuidv4(),
      correlationId: uuidv4(),
      idempotencyKey: `rev-${uuidv4()}`
    });

    const originalAfter = await db.knex('ledger_transactions').where('id', original.transaction.id).first();
    const reversalRows = await db.knex('ledger_entries').where('transaction_id', reversal.reversalTransaction.id);

    expect(reversal.reversalTransaction.id).not.toBe(original.transaction.id);
    expect(reversal.reversalTransaction.reverses_transaction_id).toBe(original.transaction.id);
    expect(originalAfter.status).toBe('reversed');
    expect(originalAfter.reversed_by_transaction_id).toBe(reversal.reversalTransaction.id);
    expect(reversalRows).toHaveLength(original.entries.length);
    expect(ledgerService.assertBalanced(reversalRows).balanced).toBe(true);
  });

  test('settlement validation rejects ledger amount mismatch and stores correct ledger reference', async () => {
    const tenantId = await createTenantContext();
    const ledger = await postBalancedLedger(tenantId, {
      amount: 100,
      metadata: { platformFee: 2, gatewayFee: 1 }
    });

    await expect(settlementService.createSettlement({
      tenantId,
      merchantId: tenantId,
      settlementRef: `SETL-BAD-${uuidv4()}`,
      settlementDate: new Date(),
      periodFrom: new Date(),
      periodTo: new Date(),
      grossAmount: 100,
      feesAmount: 4,
      netAmount: 96,
      ledgerTransactionId: ledger.transaction.id,
      createdBy: 'test'
    })).rejects.toThrow('fees_amount mismatch');

    const settlement = await settlementService.createSettlement({
      tenantId,
      merchantId: tenantId,
      settlementRef: `SETL-GOOD-${uuidv4()}`,
      settlementDate: new Date(),
      periodFrom: new Date(),
      periodTo: new Date(),
      grossAmount: 100,
      feesAmount: 3,
      netAmount: 97,
      ledgerTransactionId: ledger.transaction.id,
      createdBy: 'test'
    });

    expect(settlement.ledger_transaction_id).toBe(ledger.transaction.id);

    const reconciliation = await reconciliationService.reconcileSettlement(settlement);
    expect(reconciliation.reconciliation_status).toBe('MATCHED');
  });
});
