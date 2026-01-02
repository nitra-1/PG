/**
 * EMI (Equated Monthly Installment) Service
 * Handles EMI plan creation and processing
 */

class EMIService {
  constructor(config) {
    this.config = config;
    this.bankPartners = ['hdfc', 'icici', 'sbi', 'axis', 'kotak'];
  }

  /**
   * Calculate EMI
   * @param {Object} emiData - EMI calculation data
   * @returns {Object} EMI details
   */
  calculateEMI(emiData) {
    const { principal, rateOfInterest, tenure } = emiData;

    // Validate inputs
    if (!principal || !rateOfInterest || !tenure) {
      throw new Error('Missing required EMI calculation parameters');
    }

    if (principal <= 0 || rateOfInterest < 0 || tenure <= 0) {
      throw new Error('Invalid EMI calculation parameters');
    }

    // Calculate monthly interest rate
    const monthlyRate = rateOfInterest / 12 / 100;

    // Calculate EMI using formula: P * r * (1+r)^n / ((1+r)^n - 1)
    let emi;
    if (monthlyRate === 0) {
      // Zero interest case
      emi = principal / tenure;
    } else {
      const factor = Math.pow(1 + monthlyRate, tenure);
      emi = (principal * monthlyRate * factor) / (factor - 1);
    }

    // Calculate total payment and interest
    const totalPayment = emi * tenure;
    const totalInterest = totalPayment - principal;

    return {
      emi: parseFloat(emi.toFixed(2)),
      principal: principal,
      rateOfInterest: rateOfInterest,
      tenure: tenure,
      totalPayment: parseFloat(totalPayment.toFixed(2)),
      totalInterest: parseFloat(totalInterest.toFixed(2))
    };
  }

  /**
   * Get available EMI plans
   * @param {Object} queryData - Query parameters
   * @returns {Promise<Array>} Available EMI plans
   */
  async getAvailableEMIPlans(queryData) {
    try {
      const { amount, bank, cardType } = queryData;

      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Define EMI plans based on amount
      const plans = [];

      if (amount >= 2500) {
        plans.push({
          tenure: 3,
          rateOfInterest: 12,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 12,
            tenure: 3
          })
        });
      }

      if (amount >= 5000) {
        plans.push({
          tenure: 6,
          rateOfInterest: 13,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 13,
            tenure: 6
          })
        });
      }

      if (amount >= 10000) {
        plans.push({
          tenure: 9,
          rateOfInterest: 14,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 14,
            tenure: 9
          })
        });

        plans.push({
          tenure: 12,
          rateOfInterest: 15,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 15,
            tenure: 12
          })
        });
      }

      if (amount >= 20000) {
        plans.push({
          tenure: 18,
          rateOfInterest: 16,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 16,
            tenure: 18
          })
        });

        plans.push({
          tenure: 24,
          rateOfInterest: 17,
          bank: bank || 'hdfc',
          ...this.calculateEMI({
            principal: amount,
            rateOfInterest: 17,
            tenure: 24
          })
        });
      }

      return plans;
    } catch (error) {
      throw new Error(`EMI plans retrieval failed: ${error.message}`);
    }
  }

  /**
   * Create EMI transaction
   * @param {Object} emiData - EMI transaction data
   * @returns {Promise<Object>} EMI transaction response
   */
  async createEMITransaction(emiData) {
    try {
      const {
        customerId,
        orderId,
        amount,
        cardNumber,
        cardType,
        bank,
        tenure,
        rateOfInterest
      } = emiData;

      // Validate EMI data
      this.validateEMIData(emiData);

      // Check EMI eligibility with bank
      const isEligible = await this.checkEMIEligibility({
        cardNumber,
        amount,
        tenure,
        bank
      });

      if (!isEligible) {
        throw new Error('Card not eligible for EMI');
      }

      // Calculate EMI details
      const emiCalculation = this.calculateEMI({
        principal: amount,
        rateOfInterest: rateOfInterest,
        tenure: tenure
      });

      // Create EMI transaction
      const emiTransaction = {
        emiTransactionId: `EMI_${Date.now()}`,
        orderId: orderId,
        customerId: customerId,
        amount: amount,
        cardNumber: cardNumber.slice(-4), // Store only last 4 digits
        cardType: cardType,
        bank: bank,
        tenure: tenure,
        rateOfInterest: rateOfInterest,
        monthlyEMI: emiCalculation.emi,
        totalPayment: emiCalculation.totalPayment,
        totalInterest: emiCalculation.totalInterest,
        status: 'APPROVED',
        startDate: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Generate repayment schedule
      const schedule = this.generateRepaymentSchedule(emiTransaction);
      emiTransaction.repaymentSchedule = schedule;

      return {
        success: true,
        emiTransactionId: emiTransaction.emiTransactionId,
        orderId: orderId,
        monthlyEMI: emiTransaction.monthlyEMI,
        tenure: tenure,
        totalPayment: emiTransaction.totalPayment,
        totalInterest: emiTransaction.totalInterest,
        repaymentSchedule: schedule,
        status: 'APPROVED',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`EMI transaction creation failed: ${error.message}`);
    }
  }

  /**
   * Validate EMI data
   * @param {Object} data - EMI data
   */
  validateEMIData(data) {
    const required = ['customerId', 'orderId', 'amount', 'cardNumber', 'bank', 'tenure'];
    
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (data.amount < 2500) {
      throw new Error('Minimum EMI amount is 2500');
    }

    if (!this.bankPartners.includes(data.bank.toLowerCase())) {
      throw new Error('Bank not supported for EMI');
    }
  }

  /**
   * Check EMI eligibility
   * @param {Object} eligibilityData - Eligibility check data
   * @returns {Promise<boolean>}
   */
  async checkEMIEligibility(eligibilityData) {
    // Integration with bank API for EMI eligibility
    // Mock implementation
    return true;
  }

  /**
   * Generate repayment schedule
   * @param {Object} emiTransaction - EMI transaction details
   * @returns {Array} Repayment schedule
   */
  generateRepaymentSchedule(emiTransaction) {
    const { tenure, monthlyEMI, startDate } = emiTransaction;
    const schedule = [];

    for (let i = 0; i < tenure; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i + 1);

      schedule.push({
        installmentNumber: i + 1,
        amount: monthlyEMI,
        dueDate: dueDate.toISOString(),
        status: 'PENDING',
        paidAmount: 0,
        paidDate: null
      });
    }

    return schedule;
  }

  /**
   * Process EMI installment
   * @param {Object} paymentData - Installment payment data
   * @returns {Promise<Object>} Payment response
   */
  async processEMIInstallment(paymentData) {
    try {
      const {
        emiTransactionId,
        installmentNumber,
        amount,
        paymentMethod
      } = paymentData;

      // Validate payment
      if (!emiTransactionId || !installmentNumber || !amount) {
        throw new Error('Missing required payment details');
      }

      // Process payment
      const payment = {
        paymentId: `EMI_PAY_${Date.now()}`,
        emiTransactionId: emiTransactionId,
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
      throw new Error(`EMI installment payment failed: ${error.message}`);
    }
  }

  /**
   * Get EMI transaction details
   * @param {string} emiTransactionId - EMI transaction ID
   * @returns {Promise<Object>} EMI details
   */
  async getEMITransaction(emiTransactionId) {
    try {
      // Query from database
      // Mock implementation
      
      return {
        emiTransactionId: emiTransactionId,
        amount: 30000,
        monthlyEMI: 2650,
        tenure: 12,
        status: 'ACTIVE',
        paidInstallments: 3,
        pendingInstallments: 9,
        nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      throw new Error(`EMI transaction retrieval failed: ${error.message}`);
    }
  }

  /**
   * Foreclose EMI
   * @param {Object} foreClosureData - Foreclosure data
   * @returns {Promise<Object>} Foreclosure response
   */
  async foreCloseEMI(foreClosureData) {
    try {
      const { emiTransactionId, customerId } = foreClosureData;

      // Get EMI details
      const emiTransaction = await this.getEMITransaction(emiTransactionId);

      // Calculate foreclosure amount
      const foreClosureCharges = emiTransaction.monthlyEMI * 0.05; // 5% of monthly EMI
      const remainingAmount = emiTransaction.monthlyEMI * emiTransaction.pendingInstallments;
      const totalForeclosureAmount = remainingAmount + foreClosureCharges;

      return {
        success: true,
        emiTransactionId: emiTransactionId,
        foreClosureAmount: totalForeclosureAmount,
        foreClosureCharges: foreClosureCharges,
        remainingAmount: remainingAmount,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`EMI foreclosure failed: ${error.message}`);
    }
  }

  /**
   * Get customer EMI summary
   * @param {string} customerId - Customer ID
   * @returns {Promise<Object>} EMI summary
   */
  async getCustomerEMISummary(customerId) {
    try {
      // Query customer's EMI transactions
      // Mock implementation
      
      return {
        customerId: customerId,
        totalEMIs: 3,
        activeEMIs: 2,
        totalOutstanding: 45000,
        monthlyDue: 5300,
        nextDueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
      };
    } catch (error) {
      throw new Error(`EMI summary retrieval failed: ${error.message}`);
    }
  }
}

module.exports = EMIService;
