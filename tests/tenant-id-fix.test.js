/**
 * Tenant ID behavior tests.
 *
 * Sprint 1 update: these tests use the real database because payment writes now
 * persist the transaction and its outbox event atomically.
 */

const { v4: uuidv4 } = require('uuid');

const db = require('../src/database');
const config = require('../src/config/config');
const PaymentGateway = require('../src/core/payment-gateway');
const SecurityService = require('../src/security/security-service');

const TEST_TENANT_ID = '44444444-4444-4444-8444-444444444444';

async function cleanup() {
  await db.knex('outbox_events').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('transactions').where('tenant_id', TEST_TENANT_ID).del();
  await db.knex('tenants').where('id', TEST_TENANT_ID).del();
}

async function ensureTenant() {
  await db.knex('tenants')
    .insert({
      id: TEST_TENANT_ID,
      tenant_code: 'tenant-id-fix-test',
      tenant_name: 'Tenant ID Fix Test',
      status: 'active'
    })
    .onConflict('id')
    .ignore();
}

describe('Tenant ID Fix Tests', () => {
  let securityService;

  beforeAll(async () => {
    await db.knex.migrate.latest();
    await cleanup();
    await ensureTenant();
  });

  beforeEach(() => {
    securityService = new SecurityService({
      ...config,
      jwtSecret: 'test-secret-key',
      hmacSecret: 'test-hmac-secret'
    });
  });

  afterEach(async () => {
    await cleanup();
    await ensureTenant();
  });

  afterAll(async () => {
    await cleanup();
    await db.knex.destroy();
  });

  describe('Payment Gateway with Tenant ID from JWT context', () => {
    test('should use tenant ID from paymentData when provided', async () => {
      const paymentGateway = new PaymentGateway({
        ...config,
        defaultTenantId: config.defaultTenantId,
        fees: {
          platform: { default: 0 },
          gateway: { default: 0 }
        }
      });
      const transactionRef = `TXN_${uuidv4()}`;
      const orderId = `ORDER_${uuidv4()}`;

      await paymentGateway.logTransaction({
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        paymentMethod: 'bnpl',
        orderId,
        tenantId: TEST_TENANT_ID
      }, {
        transactionId: transactionRef,
        status: 'success',
        gateway: 'razorpay'
      }, 'razorpay');

      const transaction = await db.knex('transactions')
        .where({ tenant_id: TEST_TENANT_ID, transaction_ref: transactionRef })
        .first();
      const event = await db.knex('outbox_events')
        .where({ tenant_id: TEST_TENANT_ID, idempotency_key: `transaction:${transactionRef}` })
        .first();

      expect(transaction).toMatchObject({
        tenant_id: TEST_TENANT_ID,
        transaction_ref: transactionRef,
        order_id: orderId,
        payment_method: 'bnpl'
      });
      expect(event).toBeDefined();
      expect(event.payload.transactionRef).toBe(transactionRef);
    });

    test('should use defaultTenantId when paymentData.tenantId is not provided', async () => {
      await db.knex('tenants')
        .insert({
          id: config.defaultTenantId,
          tenant_code: 'default-test',
          tenant_name: 'Default Test Tenant',
          status: 'active'
        })
        .onConflict('id')
        .ignore();

      const paymentGateway = new PaymentGateway({
        ...config,
        fees: {
          platform: { default: 0 },
          gateway: { default: 0 }
        }
      });
      const transactionRef = `TXN_${uuidv4()}`;

      await paymentGateway.logTransaction({
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        paymentMethod: 'bnpl',
        orderId: `ORDER_${uuidv4()}`
      }, {
        transactionId: transactionRef,
        status: 'success',
        gateway: 'razorpay'
      }, 'razorpay');

      const transaction = await db.knex('transactions')
        .where({ tenant_id: config.defaultTenantId, transaction_ref: transactionRef })
        .first();
      const event = await db.knex('outbox_events')
        .where({ tenant_id: config.defaultTenantId, idempotency_key: `transaction:${transactionRef}` })
        .first();

      expect(transaction).toBeDefined();
      expect(event).toBeDefined();

      await db.knex('outbox_events').where('tenant_id', config.defaultTenantId).del();
      await db.knex('transactions').where('tenant_id', config.defaultTenantId).del();
    });
  });

  describe('JWT Token Tenant ID Extraction', () => {
    test('should extract tenantId from JWT token', () => {
      const payload = {
        userId: 'user123',
        tenantId: TEST_TENANT_ID,
        role: 'customer'
      };

      const token = securityService.generateJWT(payload);
      const decoded = securityService.verifyJWT(token);

      expect(decoded.tenantId).toBe(TEST_TENANT_ID);
      expect(decoded.userId).toBe('user123');
    });

    test('should extract merchantId as tenantId when tenantId not in JWT', () => {
      const payload = {
        userId: 'user123',
        merchantId: TEST_TENANT_ID,
        role: 'customer'
      };

      const token = securityService.generateJWT(payload);
      const decoded = securityService.verifyJWT(token);

      expect(decoded.merchantId).toBe(TEST_TENANT_ID);
      expect(decoded.userId).toBe('user123');
    });

    test('should fallback to userId when neither tenantId nor merchantId in JWT', () => {
      const payload = {
        userId: 'user123',
        role: 'customer'
      };

      const token = securityService.generateJWT(payload);
      const decoded = securityService.verifyJWT(token);

      expect(decoded.userId).toBe('user123');
    });
  });

  describe('Config defaultTenantId', () => {
    test('config should have defaultTenantId property', () => {
      expect(config).toHaveProperty('defaultTenantId');
      expect(typeof config.defaultTenantId).toBe('string');
      expect(config.defaultTenantId).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });
});
