/**
 * Buy Now Pay Later (BNPL) Service
 * Handles BNPL transactions and credit management
 */

class BNPLService {
  constructor(config) {
    this.config = config;
    this.partners = ['simpl', 'lazypay', 'zestmoney', 'flexmoney', 'payl8r'];
  }

  /**
   * Check customer eligibility for BNPL
   * @param {Object} customerData - Customer details
   * @returns {Promise<Object>} Eligibility response
   */
  async checkEligibility(customerData) {
    try {
      const {
        customerId,
        customerPhone,
        customerEmail,
        amount,
        partner
      } = customerData;

      // Validate customer data
      if (!customerId || !customerPhone || !amount) {
        throw new Error('Missing required customer details');
      }

      // Perform credit assessment
      const creditScore = await this.assessCreditScore(customerId);
      
      // Determine eligibility
      const isEligible = creditScore >= 650 && amount <= 50000;
      
      // Calculate available limit
      const availableLimit = this.calculateAvailableLimit(creditScore);

      return {
        success: true,
        isEligible: isEligible,
        creditScore: creditScore,
        availableLimit: availableLimit,
        maxAmount: Math.min(amount, availableLimit),
        partner: partner || 'simpl',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Eligibility check failed: ${error.message}`);
    }
  }

  /**
   * Assess customer credit score
   * @param {string} customerId - Customer ID
   * @returns {Promise<number>} Credit score
   */
  async assessCreditScore(customerId) {
    // Integration with credit bureau APIs (CIBIL, Experian, etc.)
    // Mock implementation
    
    // Factors: Payment history, credit utilization, credit age, etc.
    return 720; // Mock credit score
  }

  /**
   * Calculate available BNPL limit
   * @param {number} creditScore - Credit score
   * @returns {number} Available limit
   */
  calculateAvailableLimit(creditScore) {
    if (creditScore >= 750) return 50000;
    if (creditScore >= 700) return 30000;
    if (creditScore >= 650) return 15000;
    return 0;
  }

  /**
   * Create BNPL order
   * @param {Object} orderData - Order details
   * @returns {Promise<Object>} Order response
   */
  async createBNPLOrder(orderData) {
    try {
      const {
        customerId,
        amount,
        orderId,
        merchantId,
        partner,
        installmentPlan
      } = orderData;

      // Check eligibility
      const eligibility = await this.checkEligibility({ customerId, amount, partner });
      
      if (!eligibility.isEligible) {
        throw new Error('Customer not eligible for BNPL');
      }

      if (amount > eligibility.availableLimit) {
        throw new Error('Amount exceeds available limit');
      }

      // Create BNPL order
      const bnplOrder = {
        bnplOrderId: `BNPL_${Date.now()}`,
        orderId: orderId,
        customerId: customerId,
        merchantId: merchantId,
        amount: amount,
        partner: partner || 'simpl',
        installmentPlan: installmentPlan || 'PAY_IN_3',
        status: 'APPROVED',
        approvedLimit: amount,
        createdAt: new Date().toISOString()
      };

      // Generate installment schedule
      const schedule = this.generateInstallmentSchedule(
        amount,
        installmentPlan || 'PAY_IN_3'
      );

      bnplOrder.installmentSchedule = schedule;

      return {
        success: true,
        bnplOrderId: bnplOrder.bnplOrderId,
        orderId: orderId,
        amount: amount,
        partner: bnplOrder.partner,
        installmentPlan: installmentPlan,
        installmentSchedule: schedule,
        status: 'APPROVED',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`BNPL order creation failed: ${error.message}`);
    }
  }

  /**
   * Generate installment schedule
   * @param {number} amount - Total amount
   * @param {string} plan - Installment plan
   * @returns {Array} Installment schedule
   */
  generateInstallmentSchedule(amount, plan) {
    const schedules = {
      'PAY_IN_3': 3,
      'PAY_IN_6': 6,
      'PAY_IN_12': 12
    };

    const installments = schedules[plan] || 3;
    const installmentAmount = (amount / installments).toFixed(2);
    
    const schedule = [];
    for (let i = 0; i < installments; i++) {
      schedule.push({
        installmentNumber: i + 1,
        amount: parseFloat(installmentAmount),
        dueDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'PENDING'
      });
    }

    return schedule;
  }

  /**
   * Process installment payment
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async processInstallment(paymentData) {
    try {
      const {
        bnplOrderId,
        installmentNumber,
        amount,
        paymentMethod
      } = paymentData;

      // Validate payment data
      if (!bnplOrderId || !installmentNumber || !amount) {
        throw new Error('Missing required payment details');
      }

      // Process payment
      const payment = {
        paymentId: `BNPL_PAY_${Date.now()}`,
        bnplOrderId: bnplOrderId,
        installmentNumber: installmentNumber,
        amount: amount,
        paymentMethod: paymentMethod,
        status: 'SUCCESS',
        processedAt: new Date().toISOString()
      };

      return {
        success: true,
        paymentId: payment.paymentId,
        installmentNumber: installmentNumber,
        amount: amount,
        status: payment.status,
        timestamp: payment.processedAt
      };
    } catch (error) {
      throw new Error(`Installment payment failed: ${error.message}`);
    }
  }

  /**
   * Get BNPL order details
   * @param {string} bnplOrderId - BNPL order ID
   * @returns {Promise<Object>} Order details
   */
  async getBNPLOrder(bnplOrderId) {
    try {
      // Query from database
      // Mock implementation
      
      return {
        bnplOrderId: bnplOrderId,
        amount: 15000,
        installmentPlan: 'PAY_IN_3',
        status: 'ACTIVE',
        paidInstallments: 1,
        pendingInstallments: 2,
        nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      throw new Error(`Order retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get customer BNPL summary
   * @param {string} customerId - Customer ID
   * @returns {Promise<Object>} BNPL summary
   */
  async getCustomerBNPLSummary(customerId) {
    try {
      // Query customer's BNPL orders
      // Mock implementation
      
      return {
        customerId: customerId,
        totalOrders: 5,
        activeOrders: 2,
        totalOutstanding: 25000,
        totalLimit: 50000,
        availableLimit: 25000,
        creditScore: 720,
        paymentHistory: {
          onTime: 12,
          late: 1,
          missed: 0
        }
      };
    } catch (error) {
      throw new Error(`Summary retrieval failed: ${error.message}`);
    }
  }

  /**
   * Send payment reminder
   * @param {string} bnplOrderId - BNPL order ID
   * @param {number} installmentNumber - Installment number
   * @returns {Promise<Object>} Reminder response
   */
  async sendPaymentReminder(bnplOrderId, installmentNumber) {
    try {
      // Send SMS/Email reminder
      console.log(`Payment reminder sent for ${bnplOrderId}, installment ${installmentNumber}`);

      return {
        success: true,
        reminderSent: true,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Reminder sending failed: ${error.message}`);
    }
  }

  /**
   * Handle late payment
   * @param {Object} latePaymentData - Late payment details
   * @returns {Promise<Object>} Late payment response
   */
  async handleLatePayment(latePaymentData) {
    try {
      const { bnplOrderId, installmentNumber, daysLate } = latePaymentData;

      // Calculate late fee
      const lateFee = this.calculateLateFee(daysLate);

      // Update credit score impact
      await this.updateCreditScore(bnplOrderId, -10); // Negative impact

      return {
        success: true,
        lateFee: lateFee,
        creditScoreImpact: -10,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Late payment handling failed: ${error.message}`);
    }
  }

  /**
   * Calculate late fee
   * @param {number} daysLate - Number of days late
   * @returns {number} Late fee amount
   */
  calculateLateFee(daysLate) {
    if (daysLate <= 0) return 0;
    if (daysLate <= 7) return 100;
    if (daysLate <= 15) return 250;
    return 500;
  }

  /**
   * Update credit score
   * @param {string} bnplOrderId - BNPL order ID
   * @param {number} impact - Score impact
   */
  async updateCreditScore(bnplOrderId, impact) {
    console.log(`Credit score updated by ${impact} for order ${bnplOrderId}`);
  }
}

module.exports = BNPLService;
