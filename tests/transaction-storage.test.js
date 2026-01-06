/**
 * Tests for Transaction Storage in Database
 * Verifies that all payment services properly store transactions
 */

const PaymentGateway = require('../src/core/payment-gateway');
const PayInService = require('../src/payin/payin-service');
const UPIService = require('../src/upi/upi-service');
const WalletService = require('../src/wallet/wallet-service');
const PayoutService = require('../src/payout/payout-service');
const BNPLService = require('../src/bnpl/bnpl-service');
const EMIService = require('../src/emi/emi-service');
const QRService = require('../src/qr/qr-service');

// Mock the database module
jest.mock('../src/database', () => ({
  insertWithTenant: jest.fn(),
  updateByTenant: jest.fn(),
  findByTenant: jest.fn(),
  query: jest.fn()
}));

const db = require('../src/database');

describe('Transaction Storage Tests', () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      defaultGateway: 'razorpay',
      tenantId: 'test-tenant-123',
      defaultTenantId: 'default-tenant',
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

    // Clear all mock calls
    jest.clearAllMocks();
  });

  describe('PaymentGateway Transaction Storage', () => {
    test('should store transaction in database after successful payment', async () => {
      const paymentGateway = new PaymentGateway(mockConfig);
      
      const paymentData = {
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        customerPhone: '9876543210',
        paymentMethod: 'card',
        orderId: 'ORDER_001',
        tenantId: 'test-tenant-123'
      };

      const mockResponse = {
        transactionId: 'TXN_12345',
        status: 'success',
        gateway: 'razorpay'
      };

      // Mock database insert to succeed
      db.insertWithTenant.mockResolvedValue({ id: 'uuid-123' });

      await paymentGateway.logTransaction(paymentData, mockResponse, 'razorpay');

      // Verify database insert was called
      expect(db.insertWithTenant).toHaveBeenCalledTimes(1);
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'TXN_12345',
          order_id: 'ORDER_001',
          payment_method: 'card',
          gateway: 'razorpay',
          amount: 1000,
          currency: 'INR',
          status: 'success',
          customer_email: 'test@example.com'
        }),
        'test-tenant-123'
      );
    });

    test('should not throw error if database insert fails', async () => {
      const paymentGateway = new PaymentGateway(mockConfig);
      
      const paymentData = {
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        paymentMethod: 'card',
        tenantId: 'test-tenant-123'
      };

      const mockResponse = {
        transactionId: 'TXN_12345',
        status: 'success'
      };

      // Mock database insert to fail
      db.insertWithTenant.mockRejectedValue(new Error('Database connection failed'));

      // Should not throw
      await expect(
        paymentGateway.logTransaction(paymentData, mockResponse, 'razorpay')
      ).resolves.not.toThrow();
    });
  });

  describe('PayInService Transaction Storage', () => {
    test('should store payment order in database', async () => {
      const payInService = new PayInService(mockConfig);
      
      const order = {
        orderId: 'ORD_001',
        amount: 5000,
        currency: 'INR',
        customerId: 'CUST_001',
        customerEmail: 'customer@example.com',
        customerPhone: '9876543210',
        status: 'CREATED',
        paymentMethods: ['card', 'upi'],
        callbackUrl: 'https://example.com/callback',
        expiryTime: new Date(Date.now() + 30 * 60000).toISOString(),
        description: 'Test order'
      };

      db.insertWithTenant.mockResolvedValue({ id: 'uuid-456' });

      await payInService.storeOrder(order);

      expect(db.insertWithTenant).toHaveBeenCalledTimes(1);
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'payment_orders',
        expect.objectContaining({
          order_id: 'ORD_001',
          amount: 5000,
          status: 'created',
          customer_email: 'customer@example.com'
        }),
        expect.any(String)
      );
    });

    test('should update order status in database', async () => {
      const payInService = new PayInService(mockConfig);
      
      db.findByTenant.mockResolvedValue([
        { id: 'uuid-order-123', order_id: 'ORD_001', tenant_id: 'test-tenant-123' }
      ]);
      db.updateByTenant.mockResolvedValue({ id: 'uuid-order-123' });

      await payInService.updateOrderStatus('ORD_001', 'PROCESSING', 'TXN_98765');

      expect(db.findByTenant).toHaveBeenCalledWith(
        'payment_orders',
        expect.any(String),
        { order_id: 'ORD_001' }
      );
      expect(db.updateByTenant).toHaveBeenCalledWith(
        'payment_orders',
        'uuid-order-123',
        expect.objectContaining({
          status: 'pending',
          gateway_order_id: 'TXN_98765'
        }),
        'test-tenant-123'
      );
    });
  });

  describe('UPIService Transaction Storage', () => {
    test('should update existing UPI transaction in database', async () => {
      const upiService = new UPIService(mockConfig);
      
      db.query.mockResolvedValue({
        rows: [{ id: 'txn-uuid-123', tenant_id: 'test-tenant-123' }]
      });
      db.updateByTenant.mockResolvedValue({ id: 'txn-uuid-123' });

      await upiService.updateTransactionStatus('TXN_UPI_001', 'SUCCESS', 'UTR123456');

      expect(db.query).toHaveBeenCalled();
      expect(db.updateByTenant).toHaveBeenCalledWith(
        'transactions',
        'txn-uuid-123',
        expect.objectContaining({
          status: 'success',
          gateway_response_message: 'UTR: UTR123456'
        }),
        'test-tenant-123'
      );
    });

    test('should create new UPI transaction if not found', async () => {
      const upiService = new UPIService(mockConfig);
      
      db.query.mockResolvedValue({ rows: [] });
      db.insertWithTenant.mockResolvedValue({ id: 'new-txn-uuid' });

      await upiService.updateTransactionStatus('TXN_UPI_NEW', 'SUCCESS', 'UTR789012');

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'TXN_UPI_NEW',
          payment_method: 'upi',
          status: 'success',
          gateway_response_message: 'UTR: UTR789012'
        }),
        expect.any(String)
      );
    });
  });

  describe('WalletService Transaction Storage', () => {
    test('should store wallet transaction on callback', async () => {
      const walletService = new WalletService(mockConfig);
      
      db.query.mockResolvedValue({ rows: [] });
      db.insertWithTenant.mockResolvedValue({ id: 'wallet-txn-uuid' });

      const callbackData = {
        paymentId: 'WALLET_PAY_001',
        status: 'SUCCESS',
        walletTransactionId: 'WALLET_TXN_123',
        amount: 2500,
        orderId: 'ORD_WALLET_001'
      };

      await walletService.handleCallback(callbackData);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'WALLET_PAY_001',
          payment_method: 'wallet',
          amount: 2500,
          status: 'success'
        }),
        expect.any(String)
      );
    });
  });

  describe('PayoutService Transaction Storage', () => {
    test('should store payout transaction', async () => {
      const payoutService = new PayoutService(mockConfig);
      
      db.insertWithTenant.mockResolvedValue({ id: 'payout-txn-uuid' });

      const payout = {
        payoutId: 'PAYOUT_001',
        beneficiaryId: 'BEN_001',
        amount: 10000,
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'Vendor payment'
      };

      const beneficiary = {
        beneficiaryName: 'John Doe',
        accountNumber: '1234567890',
        ifscCode: 'SBIN0001234'
      };

      await payoutService.processPayout(payout, beneficiary);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'PAYOUT_001',
          payment_method: 'payout',
          gateway: 'IMPS',
          amount: 10000,
          status: 'processing'
        }),
        expect.any(String)
      );
    });
  });

  describe('BNPLService Transaction Storage', () => {
    test('should store BNPL installment payment transaction', async () => {
      const bnplService = new BNPLService(mockConfig);
      
      db.insertWithTenant.mockResolvedValue({ id: 'bnpl-txn-uuid' });

      const paymentData = {
        bnplOrderId: 'BNPL_ORD_001',
        installmentNumber: 1,
        amount: 5000,
        paymentMethod: 'card'
      };

      await bnplService.processInstallment(paymentData);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          order_id: 'BNPL_ORD_001',
          payment_method: 'bnpl',
          amount: 5000,
          status: 'success',
          metadata: expect.stringContaining('installmentNumber')
        }),
        expect.any(String)
      );
    });
  });

  describe('EMIService Transaction Storage', () => {
    test('should store EMI installment payment transaction', async () => {
      const emiService = new EMIService(mockConfig);
      
      db.insertWithTenant.mockResolvedValue({ id: 'emi-txn-uuid' });

      const paymentData = {
        emiTransactionId: 'EMI_TXN_001',
        installmentNumber: 2,
        amount: 2500,
        paymentMethod: 'auto_debit'
      };

      await emiService.processEMIInstallment(paymentData);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          order_id: 'EMI_TXN_001',
          payment_method: 'emi',
          amount: 2500,
          status: 'success',
          metadata: expect.stringContaining('installmentNumber')
        }),
        expect.any(String)
      );
    });
  });

  describe('QRService Transaction Storage', () => {
    test('should store QR payment transaction in database', async () => {
      const qrService = new QRService(mockConfig);
      
      // First generate a QR code
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 150,
        orderId: 'QR_ORD_001',
        description: 'Coffee purchase'
      };

      db.insertWithTenant.mockResolvedValue({ id: 'qr-txn-uuid' });

      const qrResult = await qrService.generateDynamicQR(qrData);
      
      // Process payment for the QR code
      const paymentData = {
        amount: 150,
        customerVPA: 'customer@bank',
        customerName: 'Customer Name'
      };

      await qrService.processQRPayment(qrResult.qrCodeId, paymentData);

      // Verify database insert was called
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          payment_method: 'qr',
          gateway: 'qr',
          amount: 150,
          status: 'success',
          metadata: expect.stringContaining('qrCodeId')
        }),
        expect.any(String)
      );
    });
  });

  describe('Status Mapping', () => {
    test('PaymentGateway should map status correctly', () => {
      const paymentGateway = new PaymentGateway(mockConfig);
      
      expect(paymentGateway.mapStatusToDBStatus('success')).toBe('success');
      expect(paymentGateway.mapStatusToDBStatus('completed')).toBe('success');
      expect(paymentGateway.mapStatusToDBStatus('failed')).toBe('failed');
      expect(paymentGateway.mapStatusToDBStatus('pending')).toBe('pending');
      expect(paymentGateway.mapStatusToDBStatus('processing')).toBe('processing');
      expect(paymentGateway.mapStatusToDBStatus('refunded')).toBe('refunded');
      expect(paymentGateway.mapStatusToDBStatus('unknown')).toBe('pending');
    });

    test('PayInService should map status correctly', () => {
      const payInService = new PayInService(mockConfig);
      
      expect(payInService.mapStatusToDBStatus('CREATED')).toBe('created');
      expect(payInService.mapStatusToDBStatus('PENDING')).toBe('pending');
      expect(payInService.mapStatusToDBStatus('PROCESSING')).toBe('pending');
      expect(payInService.mapStatusToDBStatus('FAILED')).toBe('failed');
      expect(payInService.mapStatusToDBStatus('CANCELLED')).toBe('cancelled');
    });

    test('UPIService should map status correctly', () => {
      const upiService = new UPIService(mockConfig);
      
      expect(upiService.mapStatusToDBStatus('SUCCESS')).toBe('success');
      expect(upiService.mapStatusToDBStatus('FAILED')).toBe('failed');
      expect(upiService.mapStatusToDBStatus('PENDING')).toBe('pending');
      expect(upiService.mapStatusToDBStatus('PROCESSING')).toBe('processing');
    });
  });
});
