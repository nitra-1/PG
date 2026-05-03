const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const { outboxService } = require('../src/core/outbox/outbox-service');
const { OutboxWorker } = require('../src/core/outbox/outbox-worker');
const { generateEntries } = require('../src/core/ledger/accounting-templates');

async function ensureAccounts() {
  await db.knex('ledger_accounts').insert([
    {
      account_code: 'ESC-001',
      account_name: 'Bank Escrow',
      account_type: 'escrow',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ logical: 'BANK_ESCROW' }),
      created_by: 'test'
    },
    {
      account_code: 'GTW-001-RZP',
      account_name: 'Gateway Receivable',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ logical: 'GATEWAY_RECEIVABLE' }),
      created_by: 'test'
    },
    {
      account_code: 'MER-002',
      account_name: 'Merchant Payable',
      account_type: 'merchant',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({ logical: 'MERCHANT_PAYABLE' }),
      created_by: 'test'
    },
    {
      account_code: 'MER-001',
      account_name: 'Merchant Recoverable',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({ logical: 'MERCHANT_RECOVERABLE' }),
      created_by: 'test'
    },
    {
      account_code: 'REV-001',
      account_name: 'Platform Fee Revenue',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({ logical: 'PLATFORM_FEE_REVENUE' }),
      created_by: 'test'
    },
    {
      account_code: 'GTW-FEE-001',
      account_name: 'Gateway Fee Expense',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'expense',
      status: 'active',
      metadata: JSON.stringify({ logical: 'GATEWAY_FEE_EXPENSE' }),
      created_by: 'test'
    },
    {
      account_code: 'CHB-001',
      account_name: 'Chargeback Loss',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'expense',
      status: 'active',
      metadata: JSON.stringify({ logical: 'CHARGEBACK_LOSS' }),
      created_by: 'test'
    }
  ]).onConflict('account_code').ignore();
}

async function createTenant() {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `acct-template-${tenantId.slice(0, 8)}`,
    tenant_name: 'Accounting Template Test Tenant',
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

async function postEvent(tenantId, eventType, payload = {}, options = {}) {
  const event = await outboxService.createEvent({
    tenantId,
    aggregateType: options.aggregateType || eventType,
    aggregateId: options.aggregateId || uuidv4(),
    eventType,
    idempotencyKey: options.idempotencyKey || `${eventType}:${uuidv4()}`,
    correlationId: options.correlationId || uuidv4(),
    maxRetries: options.maxRetries || 3,
    payload
  });
  const worker = new OutboxWorker();
  await worker.processBatch({ tenantId, limit: 1 });
  return outboxService.getEvent(event.id);
}

async function balances(tenantId) {
  const rows = await db.knex('ledger_entries as le')
    .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
    .join('ledger_accounts as la', 'la.id', 'le.account_id')
    .where('le.tenant_id', tenantId)
    .where('lt.status', 'posted')
    .groupBy('la.account_code', 'la.normal_balance')
    .select('la.account_code', 'la.normal_balance')
    .sum({
      debits: db.knex.raw("CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END"),
      credits: db.knex.raw("CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END")
    });

  return rows.reduce((acc, row) => {
    const debits = Number(row.debits || 0);
    const credits = Number(row.credits || 0);
    acc[row.account_code] = row.normal_balance === 'credit' ? credits - debits : debits - credits;
    return acc;
  }, {});
}

function signature(entries) {
  return entries.map(entry => `${entry.accountCode}:${entry.entryType}:${entry.amount}`);
}

describe('Accounting template design', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('template correctness for payment, gateway settlement, platform fee, and gateway fee', () => {
    expect(signature(generateEntries({
      event_type: 'payment_success',
      amount: 100,
      metadata: { merchantId: 'm1', gateway: 'razorpay' }
    }))).toEqual([
      'GTW-001-RZP:debit:100',
      'MER-002:credit:100'
    ]);

    expect(signature(generateEntries({
      event_type: 'gateway_settlement',
      amount: 100,
      metadata: { gatewaySettlementId: 'gstl-1' }
    }))).toEqual([
      'ESC-001:debit:100',
      'GTW-001-RZP:credit:100'
    ]);

    expect(signature(generateEntries({
      event_type: 'platform_fee',
      amount: 10,
      metadata: { merchantId: 'm1' }
    }))).toEqual([
      'MER-002:debit:10',
      'REV-001:credit:10'
    ]);

    expect(signature(generateEntries({
      event_type: 'gateway_fee',
      amount: 2,
      metadata: { gateway: 'razorpay', feeSource: 'bank_escrow' }
    }))).toEqual([
      'GTW-FEE-001:debit:2',
      'ESC-001:credit:2'
    ]);
  });

  test('outbox-driven lifecycle keeps escrow as actual bank funds and payable as merchant obligation', async () => {
    const tenantId = await createTenant();
    const transactionRef = `TXN-${uuidv4()}`;
    const [transaction] = await db.knex('transactions').insert({
      tenant_id: tenantId,
      transaction_ref: transactionRef,
      order_id: `ORD-${uuidv4()}`,
      payment_method: 'card',
      gateway: 'razorpay',
      amount: 100,
      currency: 'INR',
      status: 'success'
    }).returning('*');

    await postEvent(tenantId, 'payment.captured', {
      transactionId: transaction.id,
      transactionRef,
      orderId: transaction.order_id,
      merchantId: tenantId,
      gateway: 'razorpay',
      amount: '100',
      currency: 'INR'
    }, {
      aggregateType: 'transaction',
      aggregateId: transaction.id,
      idempotencyKey: `transaction:${transactionRef}`
    });
    let current = await balances(tenantId);
    expect(current['GTW-001-RZP']).toBe(100);
    expect(current['MER-002']).toBe(100);
    expect(current['ESC-001'] || 0).toBe(0);

    await postEvent(tenantId, 'gateway_settlement', {
      amount: '100',
      gateway: 'razorpay',
      gatewaySettlementId: 'gstl-100'
    });
    await postEvent(tenantId, 'platform_fee', {
      amount: '10',
      merchantId: tenantId,
      reference: 'fee-100'
    });
    await postEvent(tenantId, 'gateway_fee', {
      amount: '2',
      gateway: 'razorpay',
      feeSource: 'bank_escrow',
      reference: 'gateway-fee-100'
    });
    await postEvent(tenantId, 'merchant_payout', {
      settlementAmount: '90',
      merchantId: tenantId,
      settlementRef: 'payout-100',
      utrNumber: 'UTR100'
    });

    current = await balances(tenantId);
    expect(current['GTW-001-RZP']).toBe(0);
    expect(current['MER-002']).toBe(0);
    expect(current['REV-001']).toBe(10);
    expect(current['GTW-FEE-001']).toBe(2);
    expect(current['ESC-001']).toBe(8);
  });

  test('refund before payout reduces payable; refund after payout creates merchant recoverable', async () => {
    const tenantId = await createTenant();

    await postEvent(tenantId, 'refund', {
      refundAmount: '25',
      merchantId: tenantId,
      refundId: 'pre-refund',
      afterPayout: false
    });
    await postEvent(tenantId, 'refund', {
      refundAmount: '30',
      merchantId: tenantId,
      refundId: 'post-refund',
      afterPayout: true
    });

    const current = await balances(tenantId);
    expect(current['MER-002']).toBe(-25);
    expect(current['MER-001']).toBe(30);
    expect(current['ESC-001']).toBe(-55);
  });

  test('chargeback loss and reversal move real bank cash without touching payable', async () => {
    const tenantId = await createTenant();

    await postEvent(tenantId, 'chargeback', {
      chargebackAmount: '40',
      merchantId: tenantId,
      chargebackId: 'chb-1',
      recoverFromMerchant: false
    });
    await postEvent(tenantId, 'chargeback_reversal', {
      chargebackAmount: '40',
      merchantId: tenantId,
      chargebackId: 'chb-1',
      recoverFromMerchant: false
    });

    const current = await balances(tenantId);
    expect(current['CHB-001']).toBe(0);
    expect(current['ESC-001']).toBe(0);
    expect(current['MER-002'] || 0).toBe(0);
  });

  test('same event processed twice creates one ledger transaction', async () => {
    const tenantId = await createTenant();
    const idempotencyKey = `platform-fee:${uuidv4()}`;

    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'platform_fee',
      aggregateId: uuidv4(),
      eventType: 'platform_fee',
      idempotencyKey,
      payload: { amount: '7', merchantId: tenantId }
    });
    const worker = new OutboxWorker();
    const [claimed] = await outboxService.fetchDueEvents({ tenantId, limit: 1 });
    await worker.processEvent(claimed);
    await worker.processEvent({ ...claimed, status: 'PROCESSING' });

    const rows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, idempotency_key: idempotencyKey });
    const finalEvent = await outboxService.getEvent(event.id);

    expect(finalEvent.status).toBe('PROCESSED');
    expect(rows).toHaveLength(1);
  });

  test('invalid accounting event goes to DLQ without partial ledger writes', async () => {
    const tenantId = await createTenant();
    const event = await outboxService.createEvent({
      tenantId,
      aggregateType: 'gateway_settlement',
      aggregateId: uuidv4(),
      eventType: 'gateway_settlement',
      idempotencyKey: `bad-template:${uuidv4()}`,
      maxRetries: 1,
      payload: { gatewaySettlementId: 'missing-amount' }
    });

    const worker = new OutboxWorker();
    await worker.processBatch({ tenantId, limit: 1 });

    const finalEvent = await outboxService.getEvent(event.id);
    const rows = await db.knex('ledger_transactions')
      .where({ tenant_id: tenantId, idempotency_key: event.idempotency_key });

    expect(finalEvent.status).toBe('DLQ');
    expect(finalEvent.last_error).toContain('Invalid amount');
    expect(rows).toHaveLength(0);
  });
});
