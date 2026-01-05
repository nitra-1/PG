/**
 * Gateway Health Tracker
 * Monitors gateway health and performance metrics
 */

/**
 * Gateway Health Status
 */
const HealthStatus = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY'
};

/**
 * Gateway Health Metrics
 */
class GatewayHealthMetrics {
  constructor(gatewayName) {
    this.gatewayName = gatewayName;
    this.successCount = 0;
    this.failureCount = 0;
    this.totalRequests = 0;
    this.responseTimes = []; // Store last N response times
    this.maxResponseTimes = 100;
    this.lastRequestTime = null;
    this.lastSuccessTime = null;
    this.lastFailureTime = null;
    this.status = HealthStatus.HEALTHY;
  }

  /**
   * Record successful request
   */
  recordSuccess(responseTime) {
    this.successCount++;
    this.totalRequests++;
    this.lastRequestTime = Date.now();
    this.lastSuccessTime = Date.now();
    this.addResponseTime(responseTime);
    this.updateStatus();
  }

  /**
   * Record failed request
   */
  recordFailure(responseTime = 0) {
    this.failureCount++;
    this.totalRequests++;
    this.lastRequestTime = Date.now();
    this.lastFailureTime = Date.now();
    if (responseTime > 0) {
      this.addResponseTime(responseTime);
    }
    this.updateStatus();
  }

  /**
   * Add response time to tracking
   */
  addResponseTime(time) {
    this.responseTimes.push(time);
    if (this.responseTimes.length > this.maxResponseTimes) {
      this.responseTimes.shift();
    }
  }

  /**
   * Calculate success rate
   */
  getSuccessRate() {
    if (this.totalRequests === 0) return 1.0;
    return this.successCount / this.totalRequests;
  }

  /**
   * Get average response time
   */
  getAverageResponseTime() {
    if (this.responseTimes.length === 0) return 0;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    return sum / this.responseTimes.length;
  }

  /**
   * Get percentile response time
   */
  getPercentileResponseTime(percentile = 95) {
    if (this.responseTimes.length === 0) return 0;
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  /**
   * Update health status based on metrics
   */
  updateStatus() {
    const successRate = this.getSuccessRate();
    const avgResponseTime = this.getAverageResponseTime();
    
    // Determine status
    if (successRate >= 0.95 && avgResponseTime < 2000) {
      this.status = HealthStatus.HEALTHY;
    } else if (successRate >= 0.80 && avgResponseTime < 5000) {
      this.status = HealthStatus.DEGRADED;
    } else {
      this.status = HealthStatus.UNHEALTHY;
    }
  }

  /**
   * Calculate health score (0-100)
   */
  getHealthScore() {
    const successRate = this.getSuccessRate();
    const avgResponseTime = this.getAverageResponseTime();
    
    // Success rate contributes 70% to score
    const successScore = successRate * 70;
    
    // Response time contributes 30% to score
    // Good response time (< 1s) = 30, poor (> 5s) = 0
    let responseScore = 30;
    if (avgResponseTime > 1000) {
      responseScore = Math.max(0, 30 - ((avgResponseTime - 1000) / 4000) * 30);
    }
    
    return Math.round(successScore + responseScore);
  }

  /**
   * Reset metrics
   */
  reset() {
    this.successCount = 0;
    this.failureCount = 0;
    this.totalRequests = 0;
    this.responseTimes = [];
    this.status = HealthStatus.HEALTHY;
  }

  /**
   * Get metrics summary
   */
  getSummary() {
    return {
      gatewayName: this.gatewayName,
      status: this.status,
      healthScore: this.getHealthScore(),
      successRate: this.getSuccessRate(),
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      failureCount: this.failureCount,
      averageResponseTime: this.getAverageResponseTime(),
      p95ResponseTime: this.getPercentileResponseTime(95),
      lastRequestTime: this.lastRequestTime,
      lastSuccessTime: this.lastSuccessTime,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Gateway Health Tracker
 */
class GatewayHealthTracker {
  constructor() {
    this.gateways = new Map();
  }

  /**
   * Register gateway for tracking
   */
  registerGateway(gatewayName) {
    if (!this.gateways.has(gatewayName)) {
      this.gateways.set(gatewayName, new GatewayHealthMetrics(gatewayName));
    }
  }

  /**
   * Record successful request
   */
  recordSuccess(gatewayName, responseTime) {
    this.ensureGatewayRegistered(gatewayName);
    this.gateways.get(gatewayName).recordSuccess(responseTime);
  }

  /**
   * Record failed request
   */
  recordFailure(gatewayName, responseTime = 0) {
    this.ensureGatewayRegistered(gatewayName);
    this.gateways.get(gatewayName).recordFailure(responseTime);
  }

  /**
   * Get health metrics for gateway
   */
  getGatewayHealth(gatewayName) {
    this.ensureGatewayRegistered(gatewayName);
    return this.gateways.get(gatewayName).getSummary();
  }

  /**
   * Get health metrics for all gateways
   */
  getAllGatewayHealth() {
    const health = {};
    for (const [name, metrics] of this.gateways) {
      health[name] = metrics.getSummary();
    }
    return health;
  }

  /**
   * Get healthiest gateway
   */
  getHealthiestGateway(excludeGateways = []) {
    let bestGateway = null;
    let bestScore = -1;

    for (const [name, metrics] of this.gateways) {
      if (excludeGateways.includes(name)) continue;
      
      const score = metrics.getHealthScore();
      if (score > bestScore) {
        bestScore = score;
        bestGateway = name;
      }
    }

    return bestGateway;
  }

  /**
   * Get gateways sorted by health
   */
  getGatewaysByHealth(excludeGateways = []) {
    const gateways = [];
    
    for (const [name, metrics] of this.gateways) {
      if (excludeGateways.includes(name)) continue;
      
      gateways.push({
        name,
        healthScore: metrics.getHealthScore(),
        status: metrics.status,
        successRate: metrics.getSuccessRate(),
        avgResponseTime: metrics.getAverageResponseTime()
      });
    }

    // Sort by health score descending
    return gateways.sort((a, b) => b.healthScore - a.healthScore);
  }

  /**
   * Ensure gateway is registered
   */
  ensureGatewayRegistered(gatewayName) {
    if (!this.gateways.has(gatewayName)) {
      this.registerGateway(gatewayName);
    }
  }

  /**
   * Reset metrics for gateway
   */
  resetGateway(gatewayName) {
    if (this.gateways.has(gatewayName)) {
      this.gateways.get(gatewayName).reset();
    }
  }

  /**
   * Reset all metrics
   */
  resetAll() {
    for (const metrics of this.gateways.values()) {
      metrics.reset();
    }
  }
}

module.exports = {
  HealthStatus,
  GatewayHealthMetrics,
  GatewayHealthTracker
};
