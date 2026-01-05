/**
 * Payment Gateway Core Module
 * Handles payment gateway operations with multi-gateway support
 * Enhanced with retry logic, circuit breaker, and smart routing
 */

const { ErrorClassifier } = require('./errors/payment-errors');
const { RetryHandler } = require('./retry/retry-handler');
const { CircuitBreaker } = require('./circuit-breaker/circuit-breaker');
const { SmartRouter, RoutingStrategy } = require('./routing/smart-router');

class PaymentGateway {
  constructor(config) {
    this.config = config;
    this.gateways = new Map();
    this.circuitBreakers = new Map();
    
    // Initialize components
    this.initializeGateways();
    this.initializeRetryHandler();
    this.initializeSmartRouter();
    this.initializeCircuitBreakers();
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
   * Initialize retry handler
   */
  initializeRetryHandler() {
    this.retryHandler = new RetryHandler({
      maxAttempts: this.config.retry?.maxAttempts || 3,
      initialDelay: this.config.retry?.initialDelay || 1000,
      maxDelay: this.config.retry?.maxDelay || 30000,
      backoffMultiplier: this.config.retry?.backoffMultiplier || 2,
      jitterEnabled: this.config.retry?.jitterEnabled !== false
    });
  }

  /**
   * Initialize smart router
   */
  initializeSmartRouter() {
    const gatewayPriority = this.config.gatewayPriority || 
      [this.config.defaultGateway || 'razorpay', 'payu', 'ccavenue'];
    
    this.smartRouter = new SmartRouter({
      strategy: this.config.routingStrategy || RoutingStrategy.HEALTH_BASED,
      fallbackEnabled: this.config.fallbackEnabled !== false,
      maxFallbackAttempts: this.config.maxFallbackAttempts || 2,
      gatewayPriority,
      gatewayCosts: this.config.gatewayCosts || {},
      healthScoreThreshold: this.config.healthScoreThreshold || 50
    });
  }

  /**
   * Initialize circuit breakers for each gateway
   */
  initializeCircuitBreakers() {
    const gatewayNames = Array.from(this.gateways.keys());
    
    for (const gatewayName of gatewayNames) {
      this.circuitBreakers.set(gatewayName, new CircuitBreaker(gatewayName, {
        failureThreshold: this.config.circuitBreaker?.failureThreshold || 5,
        successThreshold: this.config.circuitBreaker?.successThreshold || 2,
        openTimeout: this.config.circuitBreaker?.openTimeout || 60000,
        requestTimeout: this.config.circuitBreaker?.requestTimeout || 30000
      }));
    }
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
    const attemptedGateways = [];
    let lastError = null;

    try {
      // Validate payment data
      this.validatePaymentData(paymentData);

      // Select primary gateway using smart router
      const primaryGateway = this.smartRouter.selectGateway(paymentData);
      attemptedGateways.push(primaryGateway);

      // Try primary gateway
      try {
        const result = await this.processWithGateway(primaryGateway, paymentData);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`Primary gateway ${primaryGateway} failed:`, error.message);

        // Try fallback gateways if enabled
        if (this.smartRouter.config.fallbackEnabled) {
          const fallbackGateways = this.smartRouter.getFallbackGateways(primaryGateway, attemptedGateways);
          
          for (const fallbackGateway of fallbackGateways) {
            attemptedGateways.push(fallbackGateway);
            
            try {
              console.log(`Attempting fallback gateway: ${fallbackGateway}`);
              const result = await this.processWithGateway(fallbackGateway, paymentData);
              
              // Log successful fallback
              console.log(`Payment successful with fallback gateway: ${fallbackGateway}`);
              return result;
            } catch (fallbackError) {
              lastError = fallbackError;
              console.error(`Fallback gateway ${fallbackGateway} failed:`, fallbackError.message);
            }
          }
        }
      }

      // All gateways failed
      throw lastError || new Error('Payment processing failed with all gateways');
    } catch (error) {
      // Classify and handle error
      const classifiedError = ErrorClassifier.classify(error, attemptedGateways.join(','));
      await this.handlePaymentError(classifiedError, paymentData);
      throw classifiedError;
    }
  }

  /**
   * Process payment with specific gateway
   * @param {string} gatewayName - Gateway name
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async processWithGateway(gatewayName, paymentData) {
    const gateway = this.gateways.get(gatewayName);
    const circuitBreaker = this.circuitBreakers.get(gatewayName);
    
    if (!gateway) {
      throw new Error(`Gateway not found: ${gatewayName}`);
    }

    const startTime = Date.now();

    try {
      // Encrypt sensitive data
      const encryptedData = this.encryptSensitiveData(paymentData);

      // Execute with circuit breaker and retry logic
      const response = await this.retryHandler.execute(async () => {
        return await circuitBreaker.execute(async () => {
          return await gateway.process(encryptedData);
        });
      }, { gateway: gatewayName, paymentData });

      const responseTime = Date.now() - startTime;

      // Record success
      this.smartRouter.recordSuccess(gatewayName, responseTime);

      // Log transaction
      await this.logTransaction(paymentData, response, gatewayName);

      return {
        success: true,
        transactionId: response.transactionId,
        status: response.status,
        gateway: gatewayName,
        timestamp: new Date().toISOString(),
        responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Record failure
      this.smartRouter.recordFailure(gatewayName, responseTime);

      // Classify error
      const classifiedError = ErrorClassifier.classify(error, gatewayName);
      throw classifiedError;
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
   * @deprecated Use smartRouter.selectGateway instead
   */
  selectGateway(paymentData) {
    // Deprecation warning
    console.warn('[DEPRECATED] PaymentGateway.selectGateway() is deprecated. Smart routing is now handled automatically.');
    
    // Use smart router for gateway selection
    const gatewayName = this.smartRouter.selectGateway(paymentData);
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
   * @param {string} gatewayName - Gateway used
   */
  async logTransaction(paymentData, response, gatewayName) {
    // Log to audit trail
    const logEntry = {
      timestamp: new Date().toISOString(),
      transactionId: response.transactionId,
      customerId: paymentData.customerId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      status: response.status,
      gateway: gatewayName || response.gateway
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
    // Log error with details
    console.error('Payment error:', {
      message: error.message,
      category: error.category,
      severity: error.severity,
      retryable: error.retryable,
      paymentData: {
        customerId: paymentData.customerId,
        amount: paymentData.amount,
        currency: paymentData.currency
      }
    });
    
    // Store error for analytics and monitoring
    // Send notifications if critical
    // Update metrics
  }

  /**
   * Get payment gateway statistics
   * @returns {Object} Statistics including health and routing info
   */
  getStatistics() {
    const routingStats = this.smartRouter.getStatistics();
    const circuitBreakerStats = {};
    
    for (const [name, breaker] of this.circuitBreakers) {
      circuitBreakerStats[name] = breaker.getStatus();
    }

    return {
      routing: routingStats,
      circuitBreakers: circuitBreakerStats,
      retry: this.retryHandler.getMetrics()
    };
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
