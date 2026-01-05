/**
 * Smart Router for Payment Gateways
 * Routes payments to optimal gateway based on health and business rules
 */

const { GatewayHealthTracker } = require('./gateway-health-tracker');

/**
 * Routing Strategy
 */
const RoutingStrategy = {
  HEALTH_BASED: 'HEALTH_BASED',         // Route based on gateway health
  ROUND_ROBIN: 'ROUND_ROBIN',           // Distribute evenly
  COST_OPTIMIZED: 'COST_OPTIMIZED',     // Route to cheapest gateway
  LATENCY_BASED: 'LATENCY_BASED',       // Route to fastest gateway
  PRIORITY: 'PRIORITY'                   // Route based on configured priority
};

/**
 * Smart Router Configuration
 */
class SmartRouterConfig {
  constructor(options = {}) {
    this.strategy = options.strategy || RoutingStrategy.HEALTH_BASED;
    this.fallbackEnabled = options.fallbackEnabled !== false; // Default true
    this.maxFallbackAttempts = options.maxFallbackAttempts || 3;
    this.gatewayPriority = options.gatewayPriority || ['razorpay', 'payu', 'ccavenue'];
    this.gatewayCosts = options.gatewayCosts || {}; // Cost per transaction
    this.healthScoreThreshold = options.healthScoreThreshold || 50;
  }
}

/**
 * Smart Router Implementation
 */
class SmartRouter {
  constructor(config = {}) {
    this.config = new SmartRouterConfig(config);
    this.healthTracker = new GatewayHealthTracker();
    this.roundRobinIndex = 0;
    
    // Register gateways from priority list
    this.config.gatewayPriority.forEach(gateway => {
      this.healthTracker.registerGateway(gateway);
    });
  }

  /**
   * Select optimal gateway for payment
   * @param {Object} paymentData - Payment details for routing decision
   * @param {Array} excludeGateways - Gateways to exclude from selection
   * @returns {string} Selected gateway name
   */
  selectGateway(paymentData = {}, excludeGateways = []) {
    const availableGateways = this.getAvailableGateways(excludeGateways);
    
    if (availableGateways.length === 0) {
      throw new Error('No available gateways for routing');
    }

    switch (this.config.strategy) {
      case RoutingStrategy.HEALTH_BASED:
        return this.selectByHealth(availableGateways);
      
      case RoutingStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(availableGateways);
      
      case RoutingStrategy.COST_OPTIMIZED:
        return this.selectByCost(availableGateways, paymentData);
      
      case RoutingStrategy.LATENCY_BASED:
        return this.selectByLatency(availableGateways);
      
      case RoutingStrategy.PRIORITY:
        return this.selectByPriority(availableGateways);
      
      default:
        return this.selectByHealth(availableGateways);
    }
  }

  /**
   * Get fallback gateway list
   * @param {string} primaryGateway - Primary gateway that failed
   * @param {Array} attemptedGateways - Already attempted gateways
   * @returns {Array} List of fallback gateways
   */
  getFallbackGateways(primaryGateway, attemptedGateways = []) {
    if (!this.config.fallbackEnabled) {
      return [];
    }

    // Exclude already attempted gateways
    const excludeGateways = [primaryGateway, ...attemptedGateways];
    const availableGateways = this.getAvailableGateways(excludeGateways);
    
    // Sort by health score
    const gatewaysByHealth = this.healthTracker.getGatewaysByHealth(excludeGateways);
    
    // Return top N gateways based on maxFallbackAttempts
    return gatewaysByHealth
      .filter(g => g.healthScore >= this.config.healthScoreThreshold)
      .slice(0, this.config.maxFallbackAttempts)
      .map(g => g.name);
  }

  /**
   * Select gateway based on health scores
   */
  selectByHealth(availableGateways) {
    const gatewaysByHealth = this.healthTracker.getGatewaysByHealth();
    
    // Filter to available gateways
    const filtered = gatewaysByHealth.filter(g => availableGateways.includes(g.name));
    
    if (filtered.length === 0) {
      return availableGateways[0];
    }

    // Return healthiest gateway above threshold
    const healthiest = filtered.find(g => g.healthScore >= this.config.healthScoreThreshold);
    return healthiest ? healthiest.name : filtered[0].name;
  }

  /**
   * Select gateway using round-robin
   */
  selectRoundRobin(availableGateways) {
    const gateway = availableGateways[this.roundRobinIndex % availableGateways.length];
    this.roundRobinIndex++;
    return gateway;
  }

  /**
   * Select gateway based on cost
   */
  selectByCost(availableGateways, paymentData) {
    let cheapestGateway = null;
    let lowestCost = Infinity;

    for (const gateway of availableGateways) {
      const cost = this.calculateGatewayCost(gateway, paymentData);
      if (cost < lowestCost) {
        lowestCost = cost;
        cheapestGateway = gateway;
      }
    }

    return cheapestGateway || availableGateways[0];
  }

  /**
   * Calculate cost for gateway
   */
  calculateGatewayCost(gatewayName, paymentData) {
    const costConfig = this.config.gatewayCosts[gatewayName] || {};
    const amount = paymentData.amount || 0;
    
    // Calculate cost: fixed fee + percentage
    const fixedFee = costConfig.fixedFee || 0;
    const percentageFee = costConfig.percentageFee || 0;
    
    return fixedFee + (amount * percentageFee / 100);
  }

  /**
   * Select gateway based on latency
   */
  selectByLatency(availableGateways) {
    let fastestGateway = null;
    let lowestLatency = Infinity;

    for (const gateway of availableGateways) {
      const health = this.healthTracker.getGatewayHealth(gateway);
      const latency = health.averageResponseTime;
      
      if (latency < lowestLatency) {
        lowestLatency = latency;
        fastestGateway = gateway;
      }
    }

    return fastestGateway || availableGateways[0];
  }

  /**
   * Select gateway based on priority
   */
  selectByPriority(availableGateways) {
    // Return first available gateway in priority order
    for (const gateway of this.config.gatewayPriority) {
      if (availableGateways.includes(gateway)) {
        const health = this.healthTracker.getGatewayHealth(gateway);
        // Only use if health score is acceptable
        if (health.healthScore >= this.config.healthScoreThreshold) {
          return gateway;
        }
      }
    }

    // If no priority gateway meets threshold, use health-based selection
    return this.selectByHealth(availableGateways);
  }

  /**
   * Get available gateways (excluding specified ones)
   */
  getAvailableGateways(excludeGateways = []) {
    return this.config.gatewayPriority.filter(g => !excludeGateways.includes(g));
  }

  /**
   * Record gateway success
   */
  recordSuccess(gatewayName, responseTime) {
    this.healthTracker.recordSuccess(gatewayName, responseTime);
  }

  /**
   * Record gateway failure
   */
  recordFailure(gatewayName, responseTime = 0) {
    this.healthTracker.recordFailure(gatewayName, responseTime);
  }

  /**
   * Get routing statistics
   */
  getStatistics() {
    return {
      strategy: this.config.strategy,
      fallbackEnabled: this.config.fallbackEnabled,
      gatewayHealth: this.healthTracker.getAllGatewayHealth(),
      gatewayPriority: this.config.gatewayPriority
    };
  }

  /**
   * Update router configuration
   */
  updateConfig(newConfig) {
    // Properly merge configuration
    const mergedConfig = {
      strategy: newConfig.strategy !== undefined ? newConfig.strategy : this.config.strategy,
      fallbackEnabled: newConfig.fallbackEnabled !== undefined ? newConfig.fallbackEnabled : this.config.fallbackEnabled,
      maxFallbackAttempts: newConfig.maxFallbackAttempts !== undefined ? newConfig.maxFallbackAttempts : this.config.maxFallbackAttempts,
      gatewayPriority: newConfig.gatewayPriority || this.config.gatewayPriority,
      gatewayCosts: newConfig.gatewayCosts || this.config.gatewayCosts,
      healthScoreThreshold: newConfig.healthScoreThreshold !== undefined ? newConfig.healthScoreThreshold : this.config.healthScoreThreshold
    };
    this.config = new SmartRouterConfig(mergedConfig);
  }

  /**
   * Reset router state
   */
  reset() {
    this.healthTracker.resetAll();
    this.roundRobinIndex = 0;
  }
}

module.exports = {
  RoutingStrategy,
  SmartRouterConfig,
  SmartRouter
};
