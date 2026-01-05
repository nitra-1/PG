/**
 * Tests for Subscription Service
 */

const SubscriptionService = require('../src/subscription/subscription-service');

describe('Subscription Service', () => {
  let subscriptionService;
  const mockConfig = {};

  beforeEach(() => {
    subscriptionService = new SubscriptionService(mockConfig);
  });

  describe('Subscription Plans', () => {
    test('should have default plans initialized', () => {
      const result = subscriptionService.listPlans();
      
      expect(result.success).toBe(true);
      expect(result.plans.length).toBeGreaterThan(0);
      expect(result.plans[0]).toHaveProperty('planId');
      expect(result.plans[0]).toHaveProperty('name');
      expect(result.plans[0]).toHaveProperty('amount');
    });

    test('should create custom subscription plan', () => {
      const planData = {
        name: 'Premium Plan',
        amount: 4999,
        currency: 'INR',
        interval: 'MONTHLY',
        intervalCount: 1,
        trialDays: 30,
        features: ['Feature 1', 'Feature 2']
      };

      const result = subscriptionService.createPlan(planData);

      expect(result.success).toBe(true);
      expect(result.plan.name).toBe('Premium Plan');
      expect(result.plan.amount).toBe(4999);
      expect(result.plan.status).toBe('ACTIVE');
    });

    test('should fail to create plan with missing required fields', () => {
      const planData = {
        name: 'Incomplete Plan'
      };

      expect(() => subscriptionService.createPlan(planData))
        .toThrow('Missing required plan details');
    });

    test('should fail to create plan with invalid interval', () => {
      const planData = {
        name: 'Invalid Plan',
        amount: 999,
        interval: 'INVALID'
      };

      expect(() => subscriptionService.createPlan(planData))
        .toThrow('Invalid interval');
    });

    test('should fail to create plan with zero amount', () => {
      const planData = {
        name: 'Zero Amount Plan',
        amount: 0,
        interval: 'MONTHLY'
      };

      expect(() => subscriptionService.createPlan(planData))
        .toThrow('Amount must be greater than 0');
    });

    test('should get plan by ID', () => {
      const plan = subscriptionService.getPlan('BASIC_MONTHLY');
      
      expect(plan.planId).toBe('BASIC_MONTHLY');
      expect(plan.name).toBe('Basic Monthly');
    });

    test('should throw error for non-existent plan', () => {
      expect(() => subscriptionService.getPlan('NON_EXISTENT'))
        .toThrow('Plan not found');
    });

    test('should filter plans by status', () => {
      const result = subscriptionService.listPlans({ status: 'ACTIVE' });
      
      expect(result.plans.every(p => p.status === 'ACTIVE')).toBe(true);
    });

    test('should filter plans by interval', () => {
      const result = subscriptionService.listPlans({ interval: 'MONTHLY' });
      
      expect(result.plans.every(p => p.interval === 'MONTHLY')).toBe(true);
    });
  });

  describe('Subscription Creation', () => {
    test('should create subscription with trial', async () => {
      const subscriptionData = {
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'BASIC_MONTHLY',
        paymentMethod: {
          type: 'card',
          cardId: 'CARD_001'
        }
      };

      const result = await subscriptionService.createSubscription(subscriptionData);

      expect(result.success).toBe(true);
      expect(result.subscription.customerId).toBe('CUST_001');
      expect(result.subscription.status).toBe('TRIALING');
      expect(result.subscription.trialEnd).toBeDefined();
    });

    test('should create subscription without trial', async () => {
      // Create plan with no trial
      const nTrialPlan = subscriptionService.createPlan({
        name: 'No Trial Plan',
        amount: 999,
        interval: 'MONTHLY',
        trialDays: 0
      });

      const subscriptionData = {
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: nTrialPlan.plan.planId,
        paymentMethod: {
          type: 'card',
          cardId: 'CARD_001'
        }
      };

      const result = await subscriptionService.createSubscription(subscriptionData);

      expect(result.success).toBe(true);
      expect(result.subscription.status).toBe('ACTIVE');
      expect(result.subscription.trialEnd).toBeNull();
    });

    test('should fail to create subscription with missing fields', async () => {
      const subscriptionData = {
        customerId: 'CUST_001'
      };

      await expect(subscriptionService.createSubscription(subscriptionData))
        .rejects.toThrow('Missing required subscription details');
    });

    test('should fail to create subscription with invalid plan', async () => {
      const subscriptionData = {
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'INVALID_PLAN',
        paymentMethod: { type: 'card' }
      };

      await expect(subscriptionService.createSubscription(subscriptionData))
        .rejects.toThrow('Plan not found');
    });
  });

  describe('Next Billing Date Calculation', () => {
    test('should calculate daily billing date', () => {
      const currentDate = new Date('2024-01-01');
      const nextDate = subscriptionService.calculateNextBillingDate(
        currentDate,
        'DAILY',
        1
      );

      expect(nextDate.getDate()).toBe(2);
    });

    test('should calculate weekly billing date', () => {
      const currentDate = new Date('2024-01-01');
      const nextDate = subscriptionService.calculateNextBillingDate(
        currentDate,
        'WEEKLY',
        1
      );

      expect(nextDate.getDate()).toBe(8);
    });

    test('should calculate monthly billing date', () => {
      const currentDate = new Date('2024-01-01');
      const nextDate = subscriptionService.calculateNextBillingDate(
        currentDate,
        'MONTHLY',
        1
      );

      expect(nextDate.getMonth()).toBe(1); // February
    });

    test('should calculate yearly billing date', () => {
      const currentDate = new Date('2024-01-01');
      const nextDate = subscriptionService.calculateNextBillingDate(
        currentDate,
        'YEARLY',
        1
      );

      expect(nextDate.getFullYear()).toBe(2025);
    });
  });

  describe('Recurring Payment Processing', () => {
    test('should process recurring payment successfully', async () => {
      // Create subscription first
      const subscription = await subscriptionService.createSubscription({
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'BASIC_MONTHLY',
        paymentMethod: { type: 'card', cardId: 'CARD_001' }
      });

      // Mark as active
      subscription.subscription.status = 'ACTIVE';

      const result = await subscriptionService.processRecurringPayment(
        subscription.subscription.subscriptionId
      );

      expect(result.success).toBe(true);
      expect(result.payment).toBeDefined();
      expect(result.payment.status).toBe('SUCCESS');
      expect(result.subscription.nextBillingDate).toBeDefined();
    });

    test('should fail to process payment for non-active subscription', async () => {
      const subscription = await subscriptionService.createSubscription({
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'BASIC_MONTHLY',
        paymentMethod: { type: 'card', cardId: 'CARD_001' }
      });

      // Pause subscription
      subscriptionService.pauseSubscription(
        subscription.subscription.subscriptionId
      );

      await expect(
        subscriptionService.processRecurringPayment(
          subscription.subscription.subscriptionId
        )
      ).rejects.toThrow('Cannot process payment for subscription with status: PAUSED');
    });

    test('should fail to process payment for non-existent subscription', async () => {
      await expect(
        subscriptionService.processRecurringPayment('NON_EXISTENT')
      ).rejects.toThrow('Subscription not found');
    });
  });

  describe('Subscription Management', () => {
    let subscriptionId;

    beforeEach(async () => {
      const result = await subscriptionService.createSubscription({
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'BASIC_MONTHLY',
        paymentMethod: { type: 'card', cardId: 'CARD_001' }
      });
      subscriptionId = result.subscription.subscriptionId;
      
      // Mark as active
      result.subscription.status = 'ACTIVE';
    });

    test('should get subscription details', () => {
      const result = subscriptionService.getSubscription(subscriptionId);
      
      expect(result.success).toBe(true);
      expect(result.subscription.subscriptionId).toBe(subscriptionId);
    });

    test('should update subscription', () => {
      const result = subscriptionService.updateSubscription(subscriptionId, {
        paymentMethod: { type: 'upi', vpa: 'customer@upi' },
        metadata: { updated: true }
      });

      expect(result.success).toBe(true);
      expect(result.subscription.paymentMethod.type).toBe('upi');
    });

    test('should pause active subscription', () => {
      const result = subscriptionService.pauseSubscription(subscriptionId, {
        reason: 'CUSTOMER_REQUEST'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('PAUSED');
      expect(result.pausedAt).toBeDefined();
    });

    test('should fail to pause non-active subscription', () => {
      subscriptionService.pauseSubscription(subscriptionId);
      
      expect(() => subscriptionService.pauseSubscription(subscriptionId))
        .toThrow('Can only pause active subscriptions');
    });

    test('should resume paused subscription', () => {
      subscriptionService.pauseSubscription(subscriptionId);
      const result = subscriptionService.resumeSubscription(subscriptionId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.resumedAt).toBeDefined();
    });

    test('should fail to resume non-paused subscription', () => {
      expect(() => subscriptionService.resumeSubscription(subscriptionId))
        .toThrow('Can only resume paused subscriptions');
    });

    test('should cancel subscription immediately', () => {
      const result = subscriptionService.cancelSubscription(subscriptionId, {
        cancelAtPeriodEnd: false,
        reason: 'CUSTOMER_REQUEST'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('CANCELLED');
      expect(result.cancelledAt).toBeDefined();
    });

    test('should cancel subscription at period end', () => {
      const result = subscriptionService.cancelSubscription(subscriptionId, {
        cancelAtPeriodEnd: true,
        reason: 'CUSTOMER_REQUEST'
      });

      expect(result.success).toBe(true);
      expect(result.cancelAt).toBeDefined();
    });

    test('should fail to cancel already cancelled subscription', () => {
      subscriptionService.cancelSubscription(subscriptionId, {
        cancelAtPeriodEnd: false
      });

      expect(() => subscriptionService.cancelSubscription(subscriptionId))
        .toThrow('Subscription already cancelled');
    });

    test('should get billing history', () => {
      const result = subscriptionService.getSubscriptionBillingHistory(
        subscriptionId
      );

      expect(result.success).toBe(true);
      expect(result.billingHistory).toBeDefined();
      expect(result.upcomingInvoice).toBeDefined();
    });
  });

  describe('Customer Subscriptions', () => {
    beforeEach(async () => {
      // Create multiple subscriptions for customer
      await subscriptionService.createSubscription({
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'BASIC_MONTHLY',
        paymentMethod: { type: 'card', cardId: 'CARD_001' }
      });

      await subscriptionService.createSubscription({
        customerId: 'CUST_001',
        customerEmail: 'test@example.com',
        planId: 'PRO_MONTHLY',
        paymentMethod: { type: 'card', cardId: 'CARD_001' }
      });
    });

    test('should list all customer subscriptions', () => {
      const result = subscriptionService.listCustomerSubscriptions('CUST_001');
      
      expect(result.success).toBe(true);
      expect(result.subscriptions.length).toBe(2);
    });

    test('should filter customer subscriptions by status', () => {
      const result = subscriptionService.listCustomerSubscriptions(
        'CUST_001',
        { status: 'TRIALING' }
      );
      
      expect(result.subscriptions.every(s => s.status === 'TRIALING')).toBe(true);
    });
  });
});
