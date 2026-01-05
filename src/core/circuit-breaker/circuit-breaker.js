/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by stopping calls to failing services
 */

/**
 * Circuit Breaker States
 */
const CircuitState = {
  CLOSED: 'CLOSED',      // Normal operation
  OPEN: 'OPEN',          // Blocking all requests
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * Circuit Breaker Configuration
 */
class CircuitBreakerConfig {
  constructor(options = {}) {
    // Failure threshold to open circuit
    this.failureThreshold = options.failureThreshold || 5;
    
    // Success threshold to close circuit from half-open
    this.successThreshold = options.successThreshold || 2;
    
    // Time window for counting failures (ms)
    this.failureWindow = options.failureWindow || 60000; // 1 minute
    
    // Time to wait before attempting recovery (ms)
    this.openTimeout = options.openTimeout || 60000; // 1 minute
    
    // Timeout for individual requests (ms)
    this.requestTimeout = options.requestTimeout || 30000; // 30 seconds
    
    // Volume threshold - minimum requests before circuit can open
    this.volumeThreshold = options.volumeThreshold || 10;
  }
}

/**
 * Circuit Breaker Implementation
 */
class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.config = new CircuitBreakerConfig(config);
    this.state = CircuitState.CLOSED;
    
    // Metrics tracking
    this.metrics = {
      failures: [],
      successes: [],
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null
    };
    
    // State transition tracking
    this.stateHistory = [];
    this.nextAttemptTime = null;
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of execution
   */
  async execute(fn) {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      // Check if enough time has passed to try again
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        const error = new Error(`Circuit breaker [${this.name}] is OPEN`);
        error.circuitBreakerOpen = true;
        throw error;
      }
    }

    this.metrics.totalRequests++;

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  async executeWithTimeout(fn) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), this.config.requestTimeout)
      )
    ]);
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.metrics.lastSuccessTime = Date.now();
    this.metrics.totalSuccesses++;
    this.metrics.consecutiveSuccesses++;
    this.metrics.consecutiveFailures = 0;
    
    // Add to successes tracking
    this.metrics.successes.push(Date.now());
    this.cleanupOldMetrics();

    // State transitions
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.metrics.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }

    this.logSuccess();
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.metrics.lastFailureTime = Date.now();
    this.metrics.totalFailures++;
    this.metrics.consecutiveFailures++;
    this.metrics.consecutiveSuccesses = 0;
    
    // Add to failures tracking
    this.metrics.failures.push(Date.now());
    this.cleanupOldMetrics();

    // State transitions
    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately open on any failure in half-open state
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.shouldOpenCircuit()) {
        this.transitionTo(CircuitState.OPEN);
      }
    }

    this.logFailure(error);
  }

  /**
   * Check if circuit should be opened
   */
  shouldOpenCircuit() {
    const recentFailures = this.getRecentFailures();
    const recentRequests = this.getRecentRequests();
    
    // Need minimum volume of requests
    if (recentRequests < this.config.volumeThreshold) {
      return false;
    }
    
    // Check failure threshold
    const failureRate = recentFailures / recentRequests;
    const failurePercentage = failureRate * 100;
    
    return recentFailures >= this.config.failureThreshold ||
           (recentRequests >= this.config.volumeThreshold && failurePercentage > 50);
  }

  /**
   * Get number of recent failures within time window
   */
  getRecentFailures() {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;
    return this.metrics.failures.filter(time => time >= windowStart).length;
  }

  /**
   * Get number of recent requests within time window
   */
  getRecentRequests() {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;
    const recentFailures = this.metrics.failures.filter(time => time >= windowStart).length;
    const recentSuccesses = this.metrics.successes.filter(time => time >= windowStart).length;
    return recentFailures + recentSuccesses;
  }

  /**
   * Transition to new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    
    // Track state history
    this.stateHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now()
    });
    
    // Keep only last 100 transitions
    if (this.stateHistory.length > 100) {
      this.stateHistory.shift();
    }

    // Set next attempt time for OPEN state
    if (newState === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.config.openTimeout;
    }

    // Reset consecutive successes when transitioning to CLOSED
    if (newState === CircuitState.CLOSED) {
      this.metrics.consecutiveSuccesses = 0;
      this.metrics.consecutiveFailures = 0;
    }

    this.logStateTransition(oldState, newState);
  }

  /**
   * Clean up old metrics outside time window
   */
  cleanupOldMetrics() {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;
    
    this.metrics.failures = this.metrics.failures.filter(time => time >= windowStart);
    this.metrics.successes = this.metrics.successes.filter(time => time >= windowStart);
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      metrics: {
        totalRequests: this.metrics.totalRequests,
        totalSuccesses: this.metrics.totalSuccesses,
        totalFailures: this.metrics.totalFailures,
        consecutiveSuccesses: this.metrics.consecutiveSuccesses,
        consecutiveFailures: this.metrics.consecutiveFailures,
        recentFailures: this.getRecentFailures(),
        recentRequests: this.getRecentRequests(),
        lastFailureTime: this.metrics.lastFailureTime,
        lastSuccessTime: this.metrics.lastSuccessTime
      },
      config: {
        failureThreshold: this.config.failureThreshold,
        successThreshold: this.config.successThreshold,
        openTimeout: this.config.openTimeout
      },
      nextAttemptTime: this.nextAttemptTime
    };
  }

  /**
   * Reset circuit breaker
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.metrics = {
      failures: [],
      successes: [],
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null
    };
    this.nextAttemptTime = null;
    console.log(`[Circuit Breaker] ${this.name} has been reset`);
  }

  /**
   * Logging methods
   */
  logSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      console.log(`[Circuit Breaker] ${this.name} - Success in HALF_OPEN state ` +
        `(${this.metrics.consecutiveSuccesses}/${this.config.successThreshold})`);
    }
  }

  logFailure(error) {
    console.error(`[Circuit Breaker] ${this.name} - Failure recorded: ${error.message}`, {
      state: this.state,
      consecutiveFailures: this.metrics.consecutiveFailures,
      recentFailures: this.getRecentFailures()
    });
  }

  logStateTransition(oldState, newState) {
    console.log(`[Circuit Breaker] ${this.name} - State transition: ${oldState} -> ${newState}`, {
      metrics: this.metrics,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null
    });
  }
}

module.exports = {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreaker
};
