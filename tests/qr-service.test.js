/**
 * Tests for Enhanced QR Service with Real-time Transaction Linking
 */

const QRService = require('../src/qr/qr-service');

describe('QR Service', () => {
  let qrService;
  const mockConfig = {};

  beforeEach(() => {
    qrService = new QRService(mockConfig);
  });

  describe('Static QR Code Generation', () => {
    test('should generate static QR code', async () => {
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        storeId: 'STORE_001',
        storeName: 'Downtown Branch'
      };

      const result = await qrService.generateStaticQR(qrData);

      expect(result.success).toBe(true);
      expect(result.qrCodeId).toBeDefined();
      expect(result.type).toBe('STATIC');
      expect(result.qrCodeImage).toBeDefined();
      expect(result.qrCodeData).toContain('upi://pay');
    });

    test('should fail to generate static QR without merchant ID', async () => {
      const qrData = {
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      };

      await expect(qrService.generateStaticQR(qrData))
        .rejects.toThrow('Missing required merchant details');
    });

    test('should fail to generate static QR without merchant VPA', async () => {
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop'
      };

      await expect(qrService.generateStaticQR(qrData))
        .rejects.toThrow('Missing required merchant details');
    });
  });

  describe('Dynamic QR Code Generation', () => {
    test('should generate dynamic QR code', async () => {
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_123',
        description: 'Coffee and Sandwich'
      };

      const result = await qrService.generateDynamicQR(qrData);

      expect(result.success).toBe(true);
      expect(result.qrCodeId).toBeDefined();
      expect(result.type).toBe('DYNAMIC');
      expect(result.amount).toBe(250);
      expect(result.orderId).toBe('ORDER_123');
      expect(result.expiryTime).toBeDefined();
    });

    test('should generate dynamic QR with custom expiry', async () => {
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_123',
        expiryMinutes: 60
      };

      const result = await qrService.generateDynamicQR(qrData);

      expect(result.success).toBe(true);
      
      const expiryTime = new Date(result.expiryTime);
      const now = new Date();
      const diffMinutes = (expiryTime - now) / (1000 * 60);
      
      expect(diffMinutes).toBeGreaterThan(59);
      expect(diffMinutes).toBeLessThan(61);
    });

    test('should fail to generate dynamic QR without amount', async () => {
      const qrData = {
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        orderId: 'ORDER_123'
      };

      await expect(qrService.generateDynamicQR(qrData))
        .rejects.toThrow('Missing required fields for dynamic QR');
    });
  });

  describe('QR Payment Processing with Real-time Linking', () => {
    let staticQRId;
    let dynamicQRId;

    beforeEach(async () => {
      // Generate static QR
      const staticResult = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });
      staticQRId = staticResult.qrCodeId;

      // Generate dynamic QR
      const dynamicResult = await qrService.generateDynamicQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_123'
      });
      dynamicQRId = dynamicResult.qrCodeId;
    });

    test('should process static QR payment with transaction linking', async () => {
      const paymentData = {
        amount: 300,
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      const result = await qrService.processQRPayment(staticQRId, paymentData);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.transaction.customerVPA).toBe('customer@upi');
      expect(result.transaction.qrType).toBe('STATIC');
    });

    test('should process dynamic QR payment with transaction linking', async () => {
      const paymentData = {
        amount: 250,
        orderId: 'ORDER_123',
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      const result = await qrService.processQRPayment(dynamicQRId, paymentData);

      expect(result.success).toBe(true);
      expect(result.transaction.orderId).toBe('ORDER_123');
      expect(result.transaction.qrType).toBe('DYNAMIC');
    });

    test('should update QR statistics after payment', async () => {
      const paymentData = {
        amount: 300,
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      await qrService.processQRPayment(staticQRId, paymentData);

      const qrDetails = qrService.getQRCode(staticQRId);

      expect(qrDetails.totalTransactions).toBe(1);
      expect(qrDetails.totalAmount).toBe(300);
      expect(qrDetails.lastPaymentAt).toBeDefined();
    });

    test('should link multiple transactions to same QR', async () => {
      // Process multiple payments
      await qrService.processQRPayment(staticQRId, {
        amount: 100,
        customerVPA: 'customer1@upi',
        customerName: 'Customer 1'
      });

      await qrService.processQRPayment(staticQRId, {
        amount: 200,
        customerVPA: 'customer2@upi',
        customerName: 'Customer 2'
      });

      await qrService.processQRPayment(staticQRId, {
        amount: 300,
        customerVPA: 'customer3@upi',
        customerName: 'Customer 3'
      });

      const qrDetails = qrService.getQRCode(staticQRId);

      expect(qrDetails.totalTransactions).toBe(3);
      expect(qrDetails.totalAmount).toBe(600);
      expect(qrDetails.transactions).toHaveLength(3);
    });

    test('should mark single-use dynamic QR as used after payment', async () => {
      const paymentData = {
        amount: 250,
        orderId: 'ORDER_123',
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      await qrService.processQRPayment(dynamicQRId, paymentData);

      const qrDetails = qrService.getQRCode(dynamicQRId);

      expect(qrDetails.status).toBe('USED');
    });

    test('should fail payment on used single-use QR', async () => {
      const paymentData = {
        amount: 250,
        orderId: 'ORDER_123',
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      // First payment
      await qrService.processQRPayment(dynamicQRId, paymentData);

      // Second payment should fail
      await expect(qrService.processQRPayment(dynamicQRId, paymentData))
        .rejects.toThrow('QR code already used');
    });

    test('should fail payment with amount mismatch on dynamic QR', async () => {
      const paymentData = {
        amount: 500, // Different from QR amount (250)
        orderId: 'ORDER_123',
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      await expect(qrService.processQRPayment(dynamicQRId, paymentData))
        .rejects.toThrow('Amount mismatch');
    });

    test('should fail payment on non-existent QR', async () => {
      const paymentData = {
        amount: 250,
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      await expect(qrService.processQRPayment('NON_EXISTENT', paymentData))
        .rejects.toThrow('QR code not found');
    });

    test('should fail payment on inactive QR', async () => {
      // Deactivate QR
      qrService.deactivateQRCode(staticQRId);

      const paymentData = {
        amount: 250,
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      };

      await expect(qrService.processQRPayment(staticQRId, paymentData))
        .rejects.toThrow('QR code is not active');
    });
  });

  describe('QR Transaction Retrieval', () => {
    let qrCodeId;

    beforeEach(async () => {
      // Generate QR and process payments
      const result = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });
      qrCodeId = result.qrCodeId;

      // Process multiple payments
      for (let i = 0; i < 5; i++) {
        await qrService.processQRPayment(qrCodeId, {
          amount: (i + 1) * 100,
          customerVPA: `customer${i}@upi`,
          customerName: `Customer ${i}`
        });
      }
    });

    test('should get all transactions for QR code', () => {
      const result = qrService.getQRTransactions(qrCodeId);

      expect(result.success).toBe(true);
      expect(result.transactions).toHaveLength(5);
      expect(result.total).toBe(5);
      expect(result.totalAmount).toBe(1500); // 100+200+300+400+500
    });

    test('should filter transactions by status', () => {
      const result = qrService.getQRTransactions(qrCodeId, {
        status: 'SUCCESS'
      });

      expect(result.transactions.every(t => t.status === 'SUCCESS')).toBe(true);
    });

    test('should filter transactions by date range', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const result = qrService.getQRTransactions(qrCodeId, {
        fromDate: yesterday.toISOString(),
        toDate: tomorrow.toISOString()
      });

      expect(result.transactions.length).toBe(5);
    });

    test('should return empty array for QR with no transactions', async () => {
      const newQR = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_002',
        merchantName: 'New Shop',
        merchantVPA: 'newshop@upi'
      });

      const result = qrService.getQRTransactions(newQR.qrCodeId);

      expect(result.transactions).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalAmount).toBe(0);
    });

    test('should throw error for non-existent QR', () => {
      expect(() => qrService.getQRTransactions('NON_EXISTENT'))
        .toThrow('QR code not found');
    });
  });

  describe('QR Code Details', () => {
    test('should get QR code details with transaction stats', async () => {
      const result = await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      // Process a payment
      await qrService.processQRPayment(result.qrCodeId, {
        amount: 500,
        customerVPA: 'customer@upi',
        customerName: 'John Doe'
      });

      const qrDetails = qrService.getQRCode(result.qrCodeId);

      expect(qrDetails.qrCodeId).toBe(result.qrCodeId);
      expect(qrDetails.type).toBe('STATIC');
      expect(qrDetails.status).toBe('ACTIVE');
      expect(qrDetails.totalTransactions).toBe(1);
      expect(qrDetails.totalAmount).toBe(500);
    });

    test('should throw error for non-existent QR', () => {
      expect(() => qrService.getQRCode('NON_EXISTENT'))
        .toThrow('QR code not found');
    });
  });

  describe('QR Analytics', () => {
    beforeEach(async () => {
      // Create multiple QR codes for merchant
      await qrService.generateStaticQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi'
      });

      await qrService.generateDynamicQR({
        merchantId: 'MERCHANT_001',
        merchantName: 'Coffee Shop',
        merchantVPA: 'coffeeshop@upi',
        amount: 250,
        orderId: 'ORDER_123'
      });
    });

    test('should get merchant QR analytics', () => {
      const analytics = qrService.getQRAnalytics('MERCHANT_001', {});

      expect(analytics.totalQRCodes).toBeGreaterThanOrEqual(2);
      expect(analytics.staticQRCodes).toBeGreaterThanOrEqual(1);
      expect(analytics.dynamicQRCodes).toBeGreaterThanOrEqual(1);
    });
  });
});
