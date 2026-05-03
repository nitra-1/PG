const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const ledgerService = require('../src/core/ledger/ledger-service');
const reconciliationService = require('../src/core/ledger/reconciliation-service');
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
    }
  ]).onConflict('account_code').ignore();
}

async function createTenant(prefix = 'settle-recon') {
  const tenantId = uuidv4();
  await db.knex('tenants').insert({
    id: tenantId,
    tenant_code: `${prefix}-${tenantId.slice(0, 8)}`,
    tenant_name: 'Ledger Settlement Reconciliation Test',
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

async function postSettlementLedger(tenantId, overrides = {}) {
  const grossAmount = overrides.grossAmount || '100.00';
  const platformFee = overrides.platformFee || '10.00';
  const gatewayFee = overrides.gatewayFee || '0.00';
  const netAmount = overrides.netAmount || String(Number(grossAmount) - Number(platformFee) - Number(gatewayFee));

  return ledgerService.postTransaction({
    tenantId,
    transactionRef: overrides.transactionRef || `SETTLE-LEDGER-${uuidv4()}`,
    idempotencyKey: overrides.idempotencyKey || `settlement-ledger:${uuidv4()}`,
    eventType: 'payment_success',
    sourceTransactionId: overrides.sourceTransactionId || uuidv4(),
    sourceOrderId: overrides.sourceOrderId || `ORD-${uuidv4()}`,
    amount: overrides.ledgerAmount || grossAmount,
    currency: overrides.currency || 'INR',
    description: 'settlement reconciliation ledger test',
    metadata: {
      settlementRef: overrides.settlementRef,
      grossAmount,
      platformFee,
      gatewayFee,
      feesAmount: String(Number(platformFee) + Number(gatewayFee)),
      netAmount,
      currency: overrides.currency || 'INR'
    },
    eventId: overrides.eventId || uuidv4(),
    correlationId: overrides.correlationId || uuidv4(),
    createdBy: 'test'
  });
}

async function createSettlement(tenantId, ledgerTransactionId, overrides = {}) {
  const settlementRef = overrides.settlementRef || `SETL-${uuidv4()}`;
  await db.knex('settlements').insert({
    id: overrides.id || uuidv4(),
    tenant_id: tenantId,
    merchant_id: overrides.merchantId || tenantId,
    settlement_ref: settlementRef,
    settlement_date: new Date(),
    period_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    period_to: new Date(),
    gross_amount: overrides.grossAmount || '100.00',
    fees_amount: overrides.feesAmount || '10.00',
    net_amount: overrides.netAmount || '90.00',
    bank_account_number: '1234567890',
    bank_ifsc: 'TEST0001234',
    bank_name: 'Test Bank',
    ledger_transaction_id: ledgerTransactionId || null,
    status: overrides.status || 'CREATED',
    metadata: JSON.stringify({
      currency: overrides.currency || 'INR',
      test: true
    }),
    created_by: 'test'
  });

  return db.knex('settlements')
    .where({ tenant_id: tenantId, settlement_ref: settlementRef })
    .first();
}

describe('Sprint 2B Phase 2 - ledger to settlement reconciliation', () => {
  beforeAll(async () => {
    await db.knex.migrate.latest();
    await ensureAccounts();
  });

  afterAll(async () => {
    await db.knex.destroy();
  });

  test('MATCHED when settlement amounts and linked ledger truth agree', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { grossAmount: '100.00', platformFee: '10.00', netAmount: '90.00' });
    const settlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '90.00'
    });

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('MATCHED');
    expect(Number(result.discrepancy_amount)).toBe(0);
    expect(result.ledger_transaction_id).toBe(ledger.transaction.id);
  });

  test('MISSING_LEDGER_TRANSACTION when settlement has no linked ledger transaction', async () => {
    const tenantId = await createTenant();
    const settlement = await createSettlement(tenantId, null);

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('MISSING_LEDGER_TRANSACTION');
    expect(result.ledger_transaction_id).toBeNull();
    expect(Number(result.discrepancy_amount)).toBe(90);
  });

  test('LEDGER_ENTRIES_MISSING when linked ledger transaction has no entries', async () => {
    const tenantId = await createTenant();
    const [ledgerTransaction] = await db.knex('ledger_transactions').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      transaction_ref: `EMPTY-LEDGER-${uuidv4()}`,
      idempotency_key: `empty-ledger:${uuidv4()}`,
      event_type: 'payment_success',
      source_transaction_id: uuidv4(),
      source_order_id: `ORD-${uuidv4()}`,
      amount: '100.00',
      currency: 'INR',
      description: 'ledger without entries',
      status: 'pending',
      metadata: JSON.stringify({ grossAmount: '100.00', feesAmount: '10.00', netAmount: '90.00' }),
      created_by: 'test'
    }).returning('*');
    const settlement = await createSettlement(tenantId, ledgerTransaction.id);

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('LEDGER_ENTRIES_MISSING');
    expect(Number(result.discrepancy_amount)).toBe(90);
  });

  test('AMOUNT_MISMATCH when settlement gross differs from ledger gross', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { grossAmount: '90.00', platformFee: '10.00', netAmount: '80.00' });
    const settlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '80.00'
    });

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('AMOUNT_MISMATCH');
    expect(Number(result.discrepancy_amount)).toBe(10);
  });

  test('FEE_MISMATCH when settlement fee differs from ledger fee metadata', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { grossAmount: '100.00', platformFee: '5.00', netAmount: '95.00' });
    const settlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '95.00'
    });

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('FEE_MISMATCH');
    expect(Number(result.discrepancy_amount)).toBe(5);
  });

  test('NET_AMOUNT_MISMATCH when settlement net differs from ledger-derived net', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { grossAmount: '100.00', platformFee: '10.00', netAmount: '90.00' });
    const settlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '85.00'
    });

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('NET_AMOUNT_MISMATCH');
    expect(Number(result.discrepancy_amount)).toBe(5);
  });

  test('CURRENCY_MISMATCH when settlement metadata currency differs from ledger currency', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { currency: 'USD', grossAmount: '100.00', platformFee: '10.00', netAmount: '90.00' });
    const settlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '90.00',
      currency: 'INR'
    });

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('CURRENCY_MISMATCH');
  });

  test('TENANT_MISMATCH when settlement tenant differs from linked ledger tenant', async () => {
    const ledgerTenantId = await createTenant('ledger-tenant');
    const settlementTenantId = await createTenant('settlement-tenant');
    const ledger = await postSettlementLedger(ledgerTenantId, { grossAmount: '100.00', platformFee: '10.00', netAmount: '90.00' });
    const settlement = await createSettlement(settlementTenantId, ledger.transaction.id);

    const result = await reconciliationService.reconcileSettlement(settlement);

    expect(result.reconciliation_status).toBe('TENANT_MISMATCH');
  });

  test('DUPLICATE_SETTLEMENT when multiple settlement rows share tenant and settlement_ref', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId);
    const settlementRef = `SETL-DUP-${uuidv4()}`;

    await db.knex.raw('DROP INDEX IF EXISTS uq_settlements_tenant_ref;');

    try {
      const first = await createSettlement(tenantId, ledger.transaction.id, { settlementRef });
      await createSettlement(tenantId, ledger.transaction.id, {
        settlementRef,
        id: uuidv4(),
        netAmount: '90.00'
      });

      const result = await reconciliationService.reconcileSettlement(first);

      expect(result.reconciliation_status).toBe('DUPLICATE_SETTLEMENT');
    } finally {
      const duplicate = await db.knex('settlements')
        .where({ tenant_id: tenantId, settlement_ref: settlementRef })
        .orderBy('created_at', 'desc')
        .first();
      if (duplicate) {
        await db.knex('settlements')
          .where('id', duplicate.id)
          .update({ settlement_ref: `${settlementRef}-REPAIRED` });
      }
      await db.knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_tenant_ref
          ON settlements (tenant_id, settlement_ref);
      `);
    }
  });

  test('MISSING_SETTLEMENT when posted settlement ledger has no settlement record', async () => {
    const tenantId = await createTenant();
    await postSettlementLedger(tenantId, {
      transactionRef: `LEDGER-ONLY-${uuidv4()}`,
      settlementRef: `MISSING-SETL-${uuidv4()}`,
      grossAmount: '100.00',
      platformFee: '10.00',
      netAmount: '90.00',
      idempotencyKey: `missing-settlement:${uuidv4()}`
    });
    await db.knex('ledger_transactions')
      .where('tenant_id', tenantId)
      .update({ event_type: 'settlement' });

    const result = await reconciliationService.reconcileAllSettlements({ tenantId });

    expect(result.by_status.MISSING_SETTLEMENT).toBe(1);
  });

  test('idempotent settlement reconciliation upserts one row', async () => {
    const tenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId);
    const settlement = await createSettlement(tenantId, ledger.transaction.id);

    await reconciliationService.reconcileSettlement(settlement);
    await reconciliationService.reconcileSettlement(settlement);

    const rows = await db.knex('reconciliation_settlements')
      .where({ tenant_id: tenantId, settlement_ref: settlement.settlement_ref });

    expect(rows).toHaveLength(1);
    expect(rows[0].reconciliation_status).toBe('MATCHED');
  });

  test('read-only API filters settlement reconciliation by status and enforces tenant isolation', async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const ledger = await postSettlementLedger(tenantId, { grossAmount: '90.00', platformFee: '10.00', netAmount: '80.00' });
    const mismatchSettlement = await createSettlement(tenantId, ledger.transaction.id, {
      grossAmount: '100.00',
      feesAmount: '10.00',
      netAmount: '80.00'
    });
    const otherLedger = await postSettlementLedger(otherTenantId);
    const otherSettlement = await createSettlement(otherTenantId, otherLedger.transaction.id);

    await reconciliationService.reconcileSettlement(mismatchSettlement);
    await reconciliationService.reconcileSettlement(otherSettlement);

    const securityService = new SecurityService(config);
    const token = securityService.generateJWT({
      userId: 'finance-user',
      tenantId,
      role: 'FINANCE_ADMIN'
    });
    const app = express();
    app.use('/api/reconciliation', createReconciliationRoutes(config));

    const response = await request(app)
      .get(`/api/reconciliation/settlements?tenantId=${tenantId}&status=AMOUNT_MISMATCH`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0]).toMatchObject({
      tenant_id: tenantId,
      settlement_ref: mismatchSettlement.settlement_ref,
      reconciliation_status: 'AMOUNT_MISMATCH'
    });

    await request(app)
      .get(`/api/reconciliation/settlements?tenantId=${otherTenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
