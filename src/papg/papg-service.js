/**
 * Payment Aggregator Payment Gateway (PAPG) Service
 * Aggregates multiple payment gateways with smart routing
 */

class PAPGService {
  constructor(config) {
    this.config = config;
    this.gateways = new Map();
    this.routingRules = [];
    this.initializeGateways();
  }

  /**
   * Initialize payment gateways
   */
  initializeGateways() {
    // Initialize multiple gateways
    this.gateways.set('razorpay', {
      name: 'razorpay',
      priority: 1,
      successRate: 95.5,
      avgResponseTime: 250,
      costPerTransaction: 2.0,
      isActive: true
    });

    this.gateways.set('payu', {
      name: 'payu',
      priority: 2,
      successRate: 94.0,
      avgResponseTime: 300,
      costPerTransaction: 1.8,
      isActive: true
    });

    this.gateways.set('ccavenue', {
      name: 'ccavenue',
      priority: 3,
      successRate: 93.0,
      avgResponseTime: 350,
      costPerTransaction: 2.2,
      isActive: true
    });
  }

  /**
   * Select optimal gateway based on routing rules
   * @param {Object} transaction - Transaction details
   * @returns {Object} Selected gateway
   */
  selectGateway(transaction) {
    const { amount, paymentMethod, customerId, currency } = transaction;

    // Apply routing rules
    let selectedGateway = null;

    // Rule 1: Amount-based routing
    if (amount > 50000) {
      selectedGateway = this.gateways.get('razorpay');
    }

    // Rule 2: Payment method specific
    if (paymentMethod === 'upi' && !selectedGateway) {
      selectedGateway = this.gateways.get('payu');
    }

    // Rule 3: Currency-based routing
    if (currency !== 'INR' && !selectedGateway) {
      selectedGateway = this.gateways.get('razorpay');
    }

    // Rule 4: Load balancing - select based on success rate and cost
    if (!selectedGateway) {
      selectedGateway = this.selectByPerformance();
    }

    // Fallback to primary gateway
    if (!selectedGateway || !selectedGateway.isActive) {
      selectedGateway = Array.from(this.gateways.values())
        .find(g => g.isActive) || this.gateways.get('razorpay');
    }

    return selectedGateway;
  }

  /**
   * Select gateway by performance metrics
   * @returns {Object} Best performing gateway
   */
  selectByPerformance() {
    const activeGateways = Array.from(this.gateways.values())
      .filter(g => g.isActive);

    // Score based on success rate, response time, and cost
    activeGateways.forEach(gateway => {
      gateway.score = (gateway.successRate * 0.5) + 
                     ((1000 - gateway.avgResponseTime) / 1000 * 30) + 
                     ((10 - gateway.costPerTransaction) / 10 * 20);
    });

    // Sort by score
    activeGateways.sort((a, b) => b.score - a.score);

    return activeGateways[0];
  }

  /**
   * Process payment with automatic failover
   * @param {Object} transaction - Transaction details
   * @returns {Promise<Object>} Payment response
   */
  async processPayment(transaction) {
    const maxRetries = 2;
    let attempt = 0;
    let lastError = null;
    const triedGateways = new Set();

    while (attempt < maxRetries) {
      try {
        // Select gateway
        const gateway = this.selectGateway(transaction);
        
        // Skip if already tried
        if (triedGateways.has(gateway.name)) {
          // Mark as inactive temporarily and select another
          gateway.isActive = false;
          attempt++;
          continue;
        }

        triedGateways.add(gateway.name);

        // Process through selected gateway
        const result = await this.processViaGateway(gateway, transaction);

        // Update gateway metrics
        await this.updateGatewayMetrics(gateway.name, true, result.responseTime);

        return {
          success: true,
          transactionId: result.transactionId,
          gateway: gateway.name,
          amount: transaction.amount,
          status: result.status,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        attempt++;

        // Update gateway metrics
        const gateway = Array.from(triedGateways).pop();
        await this.updateGatewayMetrics(gateway, false, 0);

        // Log failure
        console.error(`Payment failed on gateway ${gateway}, attempt ${attempt}:`, error.message);
      }
    }

    throw new Error(`Payment failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Process payment via specific gateway
   * @param {Object} gateway - Gateway details
   * @param {Object} transaction - Transaction details
   * @returns {Promise<Object>}
   */
  async processViaGateway(gateway, transaction) {
    const startTime = Date.now();

    // Simulate gateway processing
    // In production, call actual gateway API
    await new Promise(resolve => setTimeout(resolve, gateway.avgResponseTime));

    // Simulate success/failure based on success rate
    if (Math.random() * 100 < gateway.successRate) {
      return {
        transactionId: `TXN_${gateway.name.toUpperCase()}_${Date.now()}`,
        status: 'SUCCESS',
        responseTime: Date.now() - startTime
      };
    } else {
      throw new Error('Gateway processing failed');
    }
  }

  /**
   * Update gateway metrics
   * @param {string} gatewayName - Gateway name
   * @param {boolean} success - Transaction success
   * @param {number} responseTime - Response time in ms
   */
  async updateGatewayMetrics(gatewayName, success, responseTime) {
    const gateway = this.gateways.get(gatewayName);
    if (!gateway) return;

    // Update success rate (moving average)
    const weight = 0.1; // Weight for new data
    if (success) {
      gateway.successRate = gateway.successRate * (1 - weight) + 100 * weight;
    } else {
      gateway.successRate = gateway.successRate * (1 - weight);
    }

    // Update average response time
    if (responseTime > 0) {
      gateway.avgResponseTime = gateway.avgResponseTime * (1 - weight) + responseTime * weight;
    }

    console.log(`Gateway ${gatewayName} metrics updated:`, {
      successRate: gateway.successRate.toFixed(2),
      avgResponseTime: gateway.avgResponseTime.toFixed(0)
    });
  }

  /**
   * Get gateway statistics
   * @returns {Object} Gateway statistics
   */
  getGatewayStatistics() {
    const stats = [];
    
    for (const [name, gateway] of this.gateways) {
      stats.push({
        name: name,
        isActive: gateway.isActive,
        successRate: gateway.successRate.toFixed(2),
        avgResponseTime: gateway.avgResponseTime.toFixed(0),
        costPerTransaction: gateway.costPerTransaction,
        priority: gateway.priority
      });
    }

    return {
      gateways: stats,
      totalGateways: this.gateways.size,
      activeGateways: stats.filter(g => g.isActive).length
    };
  }

  /**
   * Add custom routing rule
   * @param {Object} rule - Routing rule
   */
  addRoutingRule(rule) {
    this.routingRules.push(rule);
  }

  /**
   * Enable/disable gateway
   * @param {string} gatewayName - Gateway name
   * @param {boolean} isActive - Active status
   */
  setGatewayStatus(gatewayName, isActive) {
    const gateway = this.gateways.get(gatewayName);
    if (gateway) {
      gateway.isActive = isActive;
      console.log(`Gateway ${gatewayName} ${isActive ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get cost optimization report
   * @param {Object} filters - Date range and other filters
   * @returns {Object} Cost report
   */
  getCostOptimizationReport(filters) {
    // Analyze transaction costs across gateways
    // Provide recommendations for cost optimization
    
    return {
      totalTransactions: 10000,
      totalCost: 20000,
      averageCost: 2.0,
      recommendations: [
        'Route low-value transactions through PayU for lower costs',
        'Use Razorpay for high-value transactions for better success rates'
      ]
    };
  }
}

module.exports = PAPGService;
