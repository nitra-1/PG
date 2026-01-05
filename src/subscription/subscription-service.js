/**
 * Subscription Payment Service
 * Handles recurring payment subscriptions for SaaS and other subscription models
 */

class SubscriptionService {
  constructor(config) {
    this.config = config;
    this.subscriptions = new Map();
    this.plans = new Map();
    
    // Initialize default plans
    this.initializeDefaultPlans();
  }

  /**
   * Initialize default subscription plans
   */
  initializeDefaultPlans() {
    const defaultPlans = [
      {
        planId: 'BASIC_MONTHLY',
        name: 'Basic Monthly',
        amount: 999,
        currency: 'INR',
        interval: 'MONTHLY',
        intervalCount: 1,
        trialDays: 7,
        features: ['Feature 1', 'Feature 2']
      },
      {
        planId: 'PRO_MONTHLY',
        name: 'Pro Monthly',
        amount: 2999,
        currency: 'INR',
        interval: 'MONTHLY',
        intervalCount: 1,
        trialDays: 14,
        features: ['All Basic features', 'Feature 3', 'Feature 4']
      },
      {
        planId: 'BASIC_YEARLY',
        name: 'Basic Yearly',
        amount: 9999,
        currency: 'INR',
        interval: 'YEARLY',
        intervalCount: 1,
        trialDays: 14,
        features: ['Feature 1', 'Feature 2']
      }
    ];

    defaultPlans.forEach(plan => this.plans.set(plan.planId, plan));
  }

  /**
   * Create subscription plan
   * @param {Object} planData - Plan details
   * @returns {Object} Created plan
   */
  createPlan(planData) {
    try {
      const {
        name,
        amount,
        currency = 'INR',
        interval,
        intervalCount = 1,
        trialDays = 0,
        features = []
      } = planData;

      // Validate required fields
      if (!name || !amount || !interval) {
        throw new Error('Missing required plan details');
      }

      // Validate interval
      const validIntervals = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
      if (!validIntervals.includes(interval)) {
        throw new Error('Invalid interval. Must be DAILY, WEEKLY, MONTHLY, or YEARLY');
      }

      // Validate amount
      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      const planId = `PLAN_${Date.now()}`;
      const plan = {
        planId,
        name,
        amount,
        currency,
        interval,
        intervalCount,
        trialDays,
        features,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      this.plans.set(planId, plan);

      return {
        success: true,
        plan: plan
      };
    } catch (error) {
      throw new Error(`Plan creation failed: ${error.message}`);
    }
  }

  /**
   * Get subscription plan
   * @param {string} planId - Plan ID
   * @returns {Object} Plan details
   */
  getPlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }
    return plan;
  }

  /**
   * List all subscription plans
   * @param {Object} filters - Filter options
   * @returns {Array} List of plans
   */
  listPlans(filters = {}) {
    let plans = Array.from(this.plans.values());

    if (filters.status) {
      plans = plans.filter(plan => plan.status === filters.status);
    }

    if (filters.interval) {
      plans = plans.filter(plan => plan.interval === filters.interval);
    }

    return {
      success: true,
      plans: plans,
      total: plans.length
    };
  }

  /**
   * Create subscription
   * @param {Object} subscriptionData - Subscription details
   * @returns {Promise<Object>} Subscription response
   */
  async createSubscription(subscriptionData) {
    try {
      const {
        customerId,
        customerEmail,
        planId,
        paymentMethod,
        startDate,
        metadata = {}
      } = subscriptionData;

      // Validate required fields
      if (!customerId || !planId || !paymentMethod) {
        throw new Error('Missing required subscription details');
      }

      // Get plan details
      const plan = this.getPlan(planId);

      // Calculate billing dates
      const start = startDate ? new Date(startDate) : new Date();
      const trialEnd = plan.trialDays > 0 
        ? new Date(start.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
        : null;

      const firstBillingDate = trialEnd || start;
      const nextBillingDate = this.calculateNextBillingDate(firstBillingDate, plan.interval, plan.intervalCount);

      const subscriptionId = `SUB_${Date.now()}`;
      const subscription = {
        subscriptionId,
        customerId,
        customerEmail,
        planId,
        plan: {
          name: plan.name,
          amount: plan.amount,
          currency: plan.currency,
          interval: plan.interval,
          intervalCount: plan.intervalCount
        },
        status: trialEnd ? 'TRIALING' : 'ACTIVE',
        paymentMethod,
        startDate: start.toISOString(),
        trialEnd: trialEnd ? trialEnd.toISOString() : null,
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: nextBillingDate.toISOString(),
        nextBillingDate: nextBillingDate.toISOString(),
        billingCycleAnchor: start.toISOString(),
        metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.subscriptions.set(subscriptionId, subscription);

      return {
        success: true,
        subscription: subscription
      };
    } catch (error) {
      throw new Error(`Subscription creation failed: ${error.message}`);
    }
  }

  /**
   * Calculate next billing date
   * @param {Date} currentDate - Current billing date
   * @param {string} interval - Billing interval
   * @param {number} intervalCount - Number of intervals
   * @returns {Date} Next billing date
   */
  calculateNextBillingDate(currentDate, interval, intervalCount) {
    const date = new Date(currentDate);

    switch (interval) {
      case 'DAILY':
        date.setDate(date.getDate() + intervalCount);
        break;
      case 'WEEKLY':
        date.setDate(date.getDate() + (intervalCount * 7));
        break;
      case 'MONTHLY':
        date.setMonth(date.getMonth() + intervalCount);
        break;
      case 'YEARLY':
        date.setFullYear(date.getFullYear() + intervalCount);
        break;
      default:
        throw new Error('Invalid interval');
    }

    return date;
  }

  /**
   * Process recurring payment
   * @param {string} subscriptionId - Subscription ID
   * @returns {Promise<Object>} Payment response
   */
  async processRecurringPayment(subscriptionId) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'ACTIVE') {
        throw new Error(`Cannot process payment for subscription with status: ${subscription.status}`);
      }

      // Process payment
      const paymentId = `PAY_${Date.now()}`;
      const payment = {
        paymentId,
        subscriptionId,
        customerId: subscription.customerId,
        amount: subscription.plan.amount,
        currency: subscription.plan.currency,
        status: 'SUCCESS',
        billingPeriodStart: subscription.currentPeriodStart,
        billingPeriodEnd: subscription.currentPeriodEnd,
        processedAt: new Date().toISOString()
      };

      // Update subscription billing dates
      const nextBillingDate = this.calculateNextBillingDate(
        new Date(subscription.nextBillingDate),
        subscription.plan.interval,
        subscription.plan.intervalCount
      );

      subscription.currentPeriodStart = subscription.currentPeriodEnd;
      subscription.currentPeriodEnd = nextBillingDate.toISOString();
      subscription.nextBillingDate = nextBillingDate.toISOString();
      subscription.lastPaymentDate = payment.processedAt;
      subscription.updatedAt = new Date().toISOString();

      return {
        success: true,
        payment: payment,
        subscription: {
          subscriptionId: subscription.subscriptionId,
          nextBillingDate: subscription.nextBillingDate,
          status: subscription.status
        }
      };
    } catch (error) {
      throw new Error(`Recurring payment processing failed: ${error.message}`);
    }
  }

  /**
   * Get subscription details
   * @param {string} subscriptionId - Subscription ID
   * @returns {Object} Subscription details
   */
  getSubscription(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    return {
      success: true,
      subscription: subscription
    };
  }

  /**
   * Update subscription
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} updateData - Update data
   * @returns {Object} Updated subscription
   */
  updateSubscription(subscriptionId, updateData) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      // Update allowed fields
      if (updateData.paymentMethod) {
        subscription.paymentMethod = updateData.paymentMethod;
      }

      if (updateData.metadata) {
        subscription.metadata = { ...subscription.metadata, ...updateData.metadata };
      }

      subscription.updatedAt = new Date().toISOString();

      return {
        success: true,
        subscription: subscription
      };
    } catch (error) {
      throw new Error(`Subscription update failed: ${error.message}`);
    }
  }

  /**
   * Cancel subscription
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} options - Cancellation options
   * @returns {Object} Cancellation response
   */
  cancelSubscription(subscriptionId, options = {}) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status === 'CANCELLED') {
        throw new Error('Subscription already cancelled');
      }

      const cancelAtPeriodEnd = options.cancelAtPeriodEnd || false;

      if (cancelAtPeriodEnd) {
        subscription.cancelAtPeriodEnd = true;
        subscription.cancelAt = subscription.currentPeriodEnd;
      } else {
        subscription.status = 'CANCELLED';
        subscription.cancelledAt = new Date().toISOString();
      }

      subscription.cancellationReason = options.reason || 'CUSTOMER_REQUEST';
      subscription.updatedAt = new Date().toISOString();

      return {
        success: true,
        subscriptionId: subscriptionId,
        status: subscription.status,
        cancelledAt: subscription.cancelledAt,
        cancelAt: subscription.cancelAt
      };
    } catch (error) {
      throw new Error(`Subscription cancellation failed: ${error.message}`);
    }
  }

  /**
   * Pause subscription
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} options - Pause options
   * @returns {Object} Pause response
   */
  pauseSubscription(subscriptionId, options = {}) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'ACTIVE') {
        throw new Error('Can only pause active subscriptions');
      }

      subscription.status = 'PAUSED';
      subscription.pausedAt = new Date().toISOString();
      subscription.pauseReason = options.reason || 'CUSTOMER_REQUEST';
      subscription.updatedAt = new Date().toISOString();

      return {
        success: true,
        subscriptionId: subscriptionId,
        status: subscription.status,
        pausedAt: subscription.pausedAt
      };
    } catch (error) {
      throw new Error(`Subscription pause failed: ${error.message}`);
    }
  }

  /**
   * Resume subscription
   * @param {string} subscriptionId - Subscription ID
   * @returns {Object} Resume response
   */
  resumeSubscription(subscriptionId) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'PAUSED') {
        throw new Error('Can only resume paused subscriptions');
      }

      subscription.status = 'ACTIVE';
      subscription.resumedAt = new Date().toISOString();
      subscription.updatedAt = new Date().toISOString();

      return {
        success: true,
        subscriptionId: subscriptionId,
        status: subscription.status,
        resumedAt: subscription.resumedAt
      };
    } catch (error) {
      throw new Error(`Subscription resume failed: ${error.message}`);
    }
  }

  /**
   * List customer subscriptions
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Filter options
   * @returns {Array} List of subscriptions
   */
  listCustomerSubscriptions(customerId, filters = {}) {
    let subscriptions = Array.from(this.subscriptions.values())
      .filter(sub => sub.customerId === customerId);

    if (filters.status) {
      subscriptions = subscriptions.filter(sub => sub.status === filters.status);
    }

    return {
      success: true,
      subscriptions: subscriptions,
      total: subscriptions.length
    };
  }

  /**
   * Get subscription usage and billing history
   * @param {string} subscriptionId - Subscription ID
   * @returns {Object} Usage and billing data
   */
  getSubscriptionBillingHistory(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Mock billing history
    return {
      success: true,
      subscriptionId: subscriptionId,
      billingHistory: [
        {
          date: subscription.createdAt,
          amount: subscription.plan.amount,
          status: 'PAID',
          invoiceUrl: `https://api.example.com/invoices/INV_001`
        }
      ],
      upcomingInvoice: {
        date: subscription.nextBillingDate,
        amount: subscription.plan.amount,
        status: 'UPCOMING'
      }
    };
  }
}

module.exports = SubscriptionService;
