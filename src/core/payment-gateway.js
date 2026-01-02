/**
 * Payment Gateway Core Module
 * Handles payment gateway operations with multi-gateway support
 */

class PaymentGateway {
  constructor(config) {
    this.config = config;
    this.gateways = new Map();
    this.initializeGateways();
  }

  /**
   * Initialize configured payment gateways
   */
  initializeGateways() {
    // Register supported gateways
    this.registerGateway('razorpay', require('./gateways/razorpay'));
    this.registerGateway('payu', require('./gateways/payu'));
    this.registerGateway('ccavenue', require('./gateways/ccavenue'));
  }

  /**
   * Register a payment gateway
   * @param {string} name - Gateway name
   * @param {Object} gateway - Gateway implementation
   */
  registerGateway(name, gateway) {
    this.gateways.set(name, gateway);
  }

  /**
   * Process payment through selected gateway
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async processPayment(paymentData) {
    try {
      // Validate payment data
      this.validatePaymentData(paymentData);

      // Select gateway based on routing rules
      const gateway = this.selectGateway(paymentData);

      // Encrypt sensitive data
      const encryptedData = this.encryptSensitiveData(paymentData);

      // Process payment
      const response = await gateway.process(encryptedData);

      // Log transaction
      await this.logTransaction(paymentData, response);

      return {
        success: true,
        transactionId: response.transactionId,
        status: response.status,
        gateway: gateway.name,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      await this.handlePaymentError(error, paymentData);
      throw error;
    }
  }

  /**
   * Validate payment data
   * @param {Object} paymentData - Payment details
   */
  validatePaymentData(paymentData) {
    const required = ['amount', 'currency', 'customerId', 'paymentMethod'];
    
    for (const field of required) {
      if (!paymentData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate amount
    if (paymentData.amount <= 0) {
      throw new Error('Invalid amount');
    }

    // Validate currency
    const supportedCurrencies = ['INR', 'USD', 'EUR', 'GBP'];
    if (!supportedCurrencies.includes(paymentData.currency)) {
      throw new Error('Unsupported currency');
    }
  }

  /**
   * Select appropriate gateway based on routing rules
   * @param {Object} paymentData - Payment details
   * @returns {Object} Selected gateway
   */
  selectGateway(paymentData) {
    // Implement smart routing logic
    // Consider factors: amount, currency, customer location, success rate, cost
    
    const gatewayName = this.config.defaultGateway || 'razorpay';
    const gateway = this.gateways.get(gatewayName);
    
    if (!gateway) {
      throw new Error(`Gateway not found: ${gatewayName}`);
    }
    
    return gateway;
  }

  /**
   * Encrypt sensitive payment data
   * @param {Object} data - Payment data
   * @returns {Object} Encrypted data
   */
  encryptSensitiveData(data) {
    // Implement AES-256 encryption for sensitive fields
    const sensitiveFields = ['cardNumber', 'cvv', 'pin'];
    const encrypted = { ...data };
    
    // In production, use proper encryption library
    // This is a placeholder for demonstration
    return encrypted;
  }

  /**
   * Log transaction details
   * @param {Object} paymentData - Payment details
   * @param {Object} response - Gateway response
   */
  async logTransaction(paymentData, response) {
    // Log to audit trail
    const logEntry = {
      timestamp: new Date().toISOString(),
      transactionId: response.transactionId,
      customerId: paymentData.customerId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      status: response.status,
      gateway: response.gateway
    };
    
    // Store in database and logging system
    console.log('Transaction logged:', logEntry);
  }

  /**
   * Handle payment errors
   * @param {Error} error - Error object
   * @param {Object} paymentData - Payment details
   */
  async handlePaymentError(error, paymentData) {
    // Log error
    console.error('Payment error:', error.message, paymentData);
    
    // Implement retry logic if applicable
    // Send notifications
    // Update metrics
  }

  /**
   * Get transaction status
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(transactionId) {
    // Query transaction status from database
    return {
      transactionId,
      status: 'success',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Refund transaction
   * @param {string} transactionId - Transaction ID
   * @param {number} amount - Refund amount
   * @returns {Promise<Object>} Refund response
   */
  async refundTransaction(transactionId, amount) {
    try {
      // Validate refund request
      // Process refund through gateway
      // Update transaction status
      
      return {
        success: true,
        refundId: `REF_${Date.now()}`,
        amount,
        status: 'processed',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Refund failed: ${error.message}`);
    }
  }
}

module.exports = PaymentGateway;
