/**
 * Tests for QR Code Webhook Functionality
 * Tests transaction storage when users pay via UPI apps after scanning QR codes
 */

const QRService = require('../src/qr/qr-service');

// Mock the database module
jest.mock('../src/database', () => ({
  insertWithTenant: jest.fn(),
  updateByTenant: jest.fn(),
  findByTenant: jest.fn(),
  query: jest.fn()
}));

const db = require('../src/database');

describe('QR Code Webhook Tests', () => {
  let qrService;
  const mockConfig = {
    tenantId: 'test-tenant-123',
    defaultTenantId: 'default-tenant'
  };

  beforeEach(() => {
    qrService = new QRService(mockConfig);
    jest.clearAllMocks();
  });

  describe('Webhook Callback Handler', () => {
    test('should process webhook for dynamic QR payment', async () => {
      // First generate a dynamic QR code
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_123',
        description: 'Coffee purchase'
      };

      const qrResult = await qrService.generateDynamicQR(qrData);
      
      // Mock database insert
      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid-123' });

      // Simulate webhook callback from UPI provider
      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_123456',
        merchantId: 'MERCHANT_001',
        amount: 250,
        orderId: 'ORDER_123',
        customerVPA: 'customer@paytm',
        customerName: 'John Doe',
        utr: 'UTR123456789',
        status: 'SUCCESS',
        timestamp: new Date().toISOString()
      };

      const result = await qrService.handleCallback(callbackData);

      // Verify webhook processing
      expect(result.success).toBe(true);
      expect(result.acknowledged).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.status).toBe('success');

      // Verify database insert was called
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'UPI_TXN_123456',
          order_id: 'ORDER_123',
          payment_method: 'qr',
          gateway: 'qr',
          amount: 250,
          status: 'success',
          customer_name: 'John Doe'
        }),
        expect.any(String)
      );

      // Verify transaction was linked to QR code
      const qrDetails = qrService.getQRCode(qrResult.qrCodeId);
      expect(qrDetails.totalTransactions).toBe(1);
      expect(qrDetails.totalAmount).toBe(250);
      expect(qrDetails.status).toBe('USED'); // Single-use dynamic QR
    });

    test('should process webhook for static QR payment', async () => {
      // Generate a static QR code
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      };

      const qrResult = await qrService.generateStaticQR(qrData);
      
      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid-456' });

      // Simulate webhook for first payment
      const callbackData1 = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_001',
        amount: 150,
        customerVPA: 'customer1@gpay',
        customerName: 'Customer One',
        utr: 'UTR111',
        status: 'SUCCESS',
        timestamp: new Date().toISOString()
      };

      await qrService.handleCallback(callbackData1);

      // Static QR should remain active
      let qrDetails = qrService.getQRCode(qrResult.qrCodeId);
      expect(qrDetails.status).toBe('ACTIVE');
      expect(qrDetails.totalTransactions).toBe(1);

      // Simulate webhook for second payment on same static QR
      const callbackData2 = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_002',
        amount: 200,
        customerVPA: 'customer2@amazonpay',
        customerName: 'Customer Two',
        utr: 'UTR222',
        status: 'SUCCESS',
        timestamp: new Date().toISOString()
      };

      await qrService.handleCallback(callbackData2);

      // Verify multiple transactions on static QR
      qrDetails = qrService.getQRCode(qrResult.qrCodeId);
      expect(qrDetails.status).toBe('ACTIVE'); // Still active
      expect(qrDetails.totalTransactions).toBe(2);
      expect(qrDetails.totalAmount).toBe(350); // 150 + 200
    });

    test('should handle webhook with missing QR code gracefully', async () => {
      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid-789' });

      // Webhook for QR code that doesn't exist in memory (e.g., old/expired QR)
      const callbackData = {
        qrCodeId: 'NON_EXISTENT_QR',
        transactionId: 'UPI_TXN_999',
        merchantId: 'MERCHANT_001',
        amount: 300,
        orderId: 'ORDER_999',
        customerVPA: 'customer@phonepe',
        customerName: 'Unknown Customer',
        utr: 'UTR999',
        status: 'SUCCESS',
        timestamp: new Date().toISOString()
      };

      // Mock console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await qrService.handleCallback(callbackData);

      // Should still process and store transaction
      expect(result.success).toBe(true);
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          transaction_ref: 'UPI_TXN_999',
          amount: 300,
          status: 'success'
        }),
        expect.any(String)
      );

      // Should log warning
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    test('should handle webhook without qrCodeId but with orderId', async () => {
      // Generate dynamic QR with order ID
      const qrResult = await qrService.generateDynamicQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 500,
        orderId: 'ORDER_FIND_ME'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      // Webhook with orderId but no qrCodeId (some PSPs might send this way)
      const callbackData = {
        orderId: 'ORDER_FIND_ME',
        transactionId: 'UPI_TXN_ORDERID',
        amount: 500,
        customerVPA: 'customer@upi',
        customerName: 'Order Customer',
        status: 'SUCCESS'
      };

      const result = await qrService.handleCallback(callbackData);

      // Should find QR by orderId and process
      expect(result.success).toBe(true);
      
      // Verify QR was updated
      const qrDetails = qrService.getQRCode(qrResult.qrCodeId);
      expect(qrDetails.totalTransactions).toBe(1);
    });

    test('should handle failed payment webhook', async () => {
      const qrResult = await qrService.generateDynamicQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 100,
        orderId: 'ORDER_FAIL'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_FAIL',
        amount: 100,
        customerVPA: 'customer@upi',
        status: 'FAILED',
        timestamp: new Date().toISOString()
      };

      const result = await qrService.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(result.status).toBe('failed');

      // Verify failed status stored in database
      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          status: 'failed',
          completed_at: null // Failed transactions shouldn't have completed_at
        }),
        expect.any(String)
      );
    });

    test('should handle pending payment webhook', async () => {
      const qrResult = await qrService.generateDynamicQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 150,
        orderId: 'ORDER_PENDING'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_PENDING',
        amount: 150,
        status: 'PENDING'
      };

      const result = await qrService.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(result.status).toBe('pending');
    });

    test('should reject webhook with invalid signature', async () => {
      // Mock signature verification to fail
      qrService.verifyCallbackSignature = jest.fn().mockResolvedValue(false);

      const callbackData = {
        qrCodeId: 'SOME_QR',
        amount: 100,
        status: 'SUCCESS'
      };

      await expect(qrService.handleCallback(callbackData))
        .rejects.toThrow('Invalid callback signature');

      // Should not store transaction
      expect(db.insertWithTenant).not.toHaveBeenCalled();
    });

    test('should reject webhook with missing required fields', async () => {
      const callbackData = {
        qrCodeId: 'SOME_QR',
        // Missing amount and status
        customerVPA: 'customer@upi'
      };

      await expect(qrService.handleCallback(callbackData))
        .rejects.toThrow('Missing required callback fields');

      expect(db.insertWithTenant).not.toHaveBeenCalled();
    });

    test('should generate transaction ID if not provided', async () => {
      const qrResult = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        // No transactionId provided
        amount: 200,
        customerVPA: 'customer@upi',
        status: 'SUCCESS'
      };

      const result = await qrService.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.transactionId).toMatch(/^TXN_QR_/);
    });

    test('should continue processing even if database insert fails', async () => {
      const qrResult = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      // Mock database failure
      db.insertWithTenant.mockRejectedValue(new Error('Database connection failed'));

      // Mock console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_DB_FAIL',
        amount: 250,
        customerVPA: 'customer@upi',
        status: 'SUCCESS'
      };

      // Should not throw error
      const result = await qrService.handleCallback(callbackData);

      expect(result.success).toBe(true);
      
      // Transaction should still be in memory
      const qrDetails = qrService.getQRCode(qrResult.qrCodeId);
      expect(qrDetails.totalTransactions).toBe(1);

      consoleErrorSpy.mockRestore();
    });

    test('should store UTR in transaction metadata', async () => {
      const qrResult = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_UTR',
        amount: 300,
        customerVPA: 'customer@upi',
        utr: 'UTR999888777',
        status: 'SUCCESS'
      };

      await qrService.handleCallback(callbackData);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          gateway_response_message: 'UTR: UTR999888777',
          metadata: expect.stringContaining('UTR999888777')
        }),
        expect.any(String)
      );
    });

    test('should include webhookReceived flag in metadata', async () => {
      const qrResult = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      db.insertWithTenant.mockResolvedValue({ id: 'txn-uuid' });

      const callbackData = {
        qrCodeId: qrResult.qrCodeId,
        transactionId: 'UPI_TXN_FLAG',
        amount: 100,
        status: 'SUCCESS'
      };

      await qrService.handleCallback(callbackData);

      expect(db.insertWithTenant).toHaveBeenCalledWith(
        'transactions',
        expect.objectContaining({
          metadata: expect.stringContaining('webhookReceived')
        }),
        expect.any(String)
      );
    });
  });

  describe('Status Mapping', () => {
    test('should map SUCCESS to success', async () => {
      expect(qrService.mapStatusToDBStatus('SUCCESS')).toBe('success');
      expect(qrService.mapStatusToDBStatus('COMPLETED')).toBe('success');
    });

    test('should map FAILED to failed', async () => {
      expect(qrService.mapStatusToDBStatus('FAILED')).toBe('failed');
      expect(qrService.mapStatusToDBStatus('FAILURE')).toBe('failed');
    });

    test('should map PENDING to pending', async () => {
      expect(qrService.mapStatusToDBStatus('PENDING')).toBe('pending');
    });

    test('should map PROCESSING to processing', async () => {
      expect(qrService.mapStatusToDBStatus('PROCESSING')).toBe('processing');
    });

    test('should handle case insensitivity', async () => {
      expect(qrService.mapStatusToDBStatus('success')).toBe('success');
      expect(qrService.mapStatusToDBStatus('Success')).toBe('success');
      expect(qrService.mapStatusToDBStatus('SuCcEsS')).toBe('success');
    });

    test('should default to pending for unknown status', async () => {
      expect(qrService.mapStatusToDBStatus('UNKNOWN')).toBe('pending');
      expect(qrService.mapStatusToDBStatus('')).toBe('pending');
    });
  });
});
