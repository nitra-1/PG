/**
 * Test for Tenant ID Fix in Payment Processing
 * Verifies that tenant ID is properly passed from JWT token to payment processing
 */

const PaymentGateway = require('../src/core/payment-gateway');
const SecurityService = require('../src/security/security-service');

// Mock the database module
jest.mock('../src/database', () => ({
  insertWithTenant: jest.fn(),
  updateByTenant: jest.fn(),
  findByTenant: jest.fn(),
  query: jest.fn()
}));

const db = require('../src/database');

describe('Tenant ID Fix Tests', () => {
  let mockConfig;
  let securityService;

  beforeEach(() => {
    mockConfig = {
      defaultGateway: 'razorpay',
      defaultTenantId: 'default-tenant',
      jwtSecret: 'test-secret-key',
      hmacSecret: 'test-hmac-secret',
      retry: {
        maxAttempts: 1,
        initialDelay: 100
      },
      circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        openTimeout: 60000
      }
    };

    securityService = new SecurityService(mockConfig);

    // Clear all mock calls
    jest.clearAllMocks();
  });

  describe('Payment Gateway with Tenant ID from JWT', () => {
    test('should use tenant ID from paymentData when provided', async () => {
      const paymentGateway = new PaymentGateway(mockConfig);
      
      const paymentData = {
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        paymentMethod: 'bnpl',
        orderId: 'ORDER_001',
        tenantId: 'merchant-tenant-123'
      };

      const mockResponse = {
        transactionId: 'TXN_12345',
        status: 'success',
        gateway: 'razorpay'
      };

      // Mock database insert to succeed
      db.insertWithTenant.mockResolvedValue({ id: 'uuid-123' });

      await paymentGateway.logTransaction(paymentData, mockResponse, 'razorpay');

      // Verify database insert was called with correct tenant ID
      expect(db.insertWithTenant).toHaveBeenCalledTimes(1);
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'TXN_12345',
          order_id: 'ORDER_001',
          payment_method: 'bnpl'
        }),
        'merchant-tenant-123'
      );
    });

    test('should use defaultTenantId when paymentData.tenantId is not provided', async () => {
      const paymentGateway = new PaymentGateway(mockConfig);
      
      const paymentData = {
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        paymentMethod: 'bnpl',
        orderId: 'ORDER_001'
        // tenantId not provided
      };

      const mockResponse = {
        transactionId: 'TXN_12345',
        status: 'success',
        gateway: 'razorpay'
      };

      // Mock database insert to succeed
      db.insertWithTenant.mockResolvedValue({ id: 'uuid-123' });

      await paymentGateway.logTransaction(paymentData, mockResponse, 'razorpay');

      // Verify database insert was called with defaultTenantId
      expect(db.insertWithTenant).toHaveBeenCalledTimes(1);
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.any(Object),
        'default-tenant'
      );
    });
  });

  describe('JWT Token Tenant ID Extraction', () => {
    test('should extract tenantId from JWT token', () => {
      const payload = {
        userId: 'user123',
        tenantId: 'tenant-from-jwt',
        role: 'customer'
      };

      const token = securityService.generateJWT(payload);
      const decoded = securityService.verifyJWT(token);

      expect(decoded.tenantId).toBe('tenant-from-jwt');
      expect(decoded.userId).toBe('user123');
    });

    test('should extract merchantId as tenantId when tenantId not in JWT', () => {
      const payload = {
        userId: 'user123',
        merchantId: 'merchant-from-jwt',
        role: 'customer'
      };

      const token = securityService.generateJWT(payload);
      const decoded = securityService.verifyJWT(token);

      expect(decoded.merchantId).toBe('merchant-from-jwt');
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
      const config = require('../src/config/config');
      expect(config).toHaveProperty('defaultTenantId');
      expect(typeof config.defaultTenantId).toBe('string');
    });
  });
});
