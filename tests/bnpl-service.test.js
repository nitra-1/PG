/**
 * Tests for BNPL Service with Provider Support
 */

const BNPLService = require('../src/bnpl/bnpl-service');
const AfterpayProvider = require('../src/bnpl/providers/afterpay-provider');
const KlarnaProvider = require('../src/bnpl/providers/klarna-provider');

describe('BNPL Service', () => {
  let bnplService;
  const mockConfig = {
    afterpay: {
      apiUrl: 'https://api.afterpay.com/v2',
      merchantId: 'test_merchant',
      secretKey: 'test_secret'
    },
    klarna: {
      apiUrl: 'https://api.klarna.com/v1',
      merchantId: 'test_merchant',
      secretKey: 'test_secret'
    }
  };

  beforeEach(() => {
    bnplService = new BNPLService(mockConfig);
  });

  describe('Provider Support', () => {
    test('should support multiple BNPL providers', () => {
      expect(bnplService.partners).toContain('afterpay');
      expect(bnplService.partners).toContain('klarna');
      expect(bnplService.partners).toContain('simpl');
    });

    test('should get Afterpay provider instance', () => {
      const provider = bnplService.getProvider('afterpay');
      expect(provider).toBeInstanceOf(AfterpayProvider);
    });

    test('should get Klarna provider instance', () => {
      const provider = bnplService.getProvider('klarna');
      expect(provider).toBeInstanceOf(KlarnaProvider);
    });

    test('should return null for non-external provider', () => {
      const provider = bnplService.getProvider('simpl');
      expect(provider).toBeNull();
    });
  });

  describe('Eligibility Check', () => {
    test('should check eligibility with Afterpay provider', async () => {
      const customerData = {
        customerId: 'CUST_001',
        customerPhone: '+919876543210',
        customerEmail: 'test@example.com',
        amount: 10000,
        partner: 'afterpay'
      };

      const result = await bnplService.checkEligibility(customerData);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('afterpay');
      expect(result.isEligible).toBe(true);
    });

    test('should check eligibility with Klarna provider', async () => {
      const customerData = {
        customerId: 'CUST_001',
        customerPhone: '+919876543210',
        customerEmail: 'test@example.com',
        amount: 15000,
        partner: 'klarna'
      };

      const result = await bnplService.checkEligibility(customerData);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('klarna');
      expect(result.isEligible).toBe(true);
    });

    test('should fail eligibility check with invalid amount', async () => {
      const customerData = {
        customerId: 'CUST_001',
        customerPhone: '+919876543210',
        customerEmail: 'test@example.com',
        amount: 0,
        partner: 'afterpay'
      };

      await expect(bnplService.checkEligibility(customerData))
        .rejects.toThrow('Amount must be greater than 0');
    });

    test('should fail eligibility check with missing required fields', async () => {
      const customerData = {
        customerId: 'CUST_001',
        amount: 10000
      };

      await expect(bnplService.checkEligibility(customerData))
        .rejects.toThrow('Missing required customer details');
    });
  });

  describe('BNPL Order Creation', () => {
    test('should create BNPL order with Afterpay', async () => {
      const orderData = {
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        customerPhone: '+919876543210',
        amount: 10000,
        orderId: 'ORDER_123',
        merchantId: 'MERCHANT_001',
        partner: 'afterpay',
        installmentPlan: 'PAY_IN_4'
      };

      const result = await bnplService.createBNPLOrder(orderData);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('afterpay');
      expect(result.status).toBe('APPROVED');
      expect(result.orderId).toBe('ORDER_123');
    });

    test('should create BNPL order with Klarna', async () => {
      const orderData = {
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        customerPhone: '+919876543210',
        amount: 15000,
        orderId: 'ORDER_123',
        merchantId: 'MERCHANT_001',
        partner: 'klarna',
        installmentPlan: 'PAY_IN_3'
      };

      const result = await bnplService.createBNPLOrder(orderData);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('klarna');
      expect(result.status).toBe('APPROVED');
    });

    test('should fail order creation with missing required fields', async () => {
      const orderData = {
        customerId: 'CUST_001',
        amount: 10000
      };

      await expect(bnplService.createBNPLOrder(orderData))
        .rejects.toThrow('Missing required order details');
    });
  });

  describe('Installment Schedule', () => {
    test('should generate PAY_IN_3 schedule', () => {
      const schedule = bnplService.generateInstallmentSchedule(3000, 'PAY_IN_3');
      
      expect(schedule).toHaveLength(3);
      expect(schedule[0].installmentNumber).toBe(1);
      expect(schedule[0].amount).toBe(1000);
      expect(schedule[0].status).toBe('PENDING');
    });

    test('should generate PAY_IN_6 schedule', () => {
      const schedule = bnplService.generateInstallmentSchedule(6000, 'PAY_IN_6');
      
      expect(schedule).toHaveLength(6);
      expect(schedule[0].amount).toBe(1000);
    });
  });
});

describe('Afterpay Provider', () => {
  let afterpayProvider;
  const mockConfig = {
    afterpay: {
      apiUrl: 'https://api.afterpay.com/v2',
      merchantId: 'test_merchant',
      secretKey: 'test_secret'
    }
  };

  beforeEach(() => {
    afterpayProvider = new AfterpayProvider(mockConfig);
  });

  test('should check eligibility within limits', async () => {
    const result = await afterpayProvider.checkEligibility({
      customerId: 'CUST_001',
      amount: 25000
    });

    expect(result.isEligible).toBe(true);
    expect(result.minAmount).toBe(100);
    expect(result.maxAmount).toBe(25000);
  });

  test('should reject amount below minimum', async () => {
    const result = await afterpayProvider.checkEligibility({
      customerId: 'CUST_001',
      amount: 50
    });

    expect(result.isEligible).toBe(false);
  });

  test('should create order within limits', async () => {
    const result = await afterpayProvider.createOrder({
      customerId: 'CUST_001',
      amount: 10000,
      orderId: 'ORDER_123',
      merchantId: 'MERCHANT_001'
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('afterpay');
  });

  test('should fail to create order outside limits', async () => {
    await expect(afterpayProvider.createOrder({
      customerId: 'CUST_001',
      amount: 60000,
      orderId: 'ORDER_123',
      merchantId: 'MERCHANT_001'
    })).rejects.toThrow('Amount must be between 100 and 50000');
  });
});

describe('Klarna Provider', () => {
  let klarnaProvider;
  const mockConfig = {
    klarna: {
      apiUrl: 'https://api.klarna.com/v1',
      merchantId: 'test_merchant',
      secretKey: 'test_secret'
    }
  };

  beforeEach(() => {
    klarnaProvider = new KlarnaProvider(mockConfig);
  });

  test('should check eligibility within limits', async () => {
    const result = await klarnaProvider.checkEligibility({
      customerId: 'CUST_001',
      amount: 50000
    });

    expect(result.isEligible).toBe(true);
    expect(result.minAmount).toBe(50);
    expect(result.maxAmount).toBe(50000);
  });

  test('should create session within limits', async () => {
    const result = await klarnaProvider.createOrder({
      customerId: 'CUST_001',
      amount: 30000,
      orderId: 'ORDER_123',
      merchantId: 'MERCHANT_001'
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('klarna');
    expect(result.clientToken).toBeDefined();
  });

  test('should fail to create order outside limits', async () => {
    await expect(klarnaProvider.createOrder({
      customerId: 'CUST_001',
      amount: 150000,
      orderId: 'ORDER_123',
      merchantId: 'MERCHANT_001'
    })).rejects.toThrow('Amount must be between 50 and 100000');
  });
});
