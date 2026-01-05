/**
 * Retry Logic Module with Exponential Backoff
 * Provides configurable retry mechanisms for transient failures
 */

/**
 * Retry Configuration
 */
class RetryConfig {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 3;
    this.initialDelay = options.initialDelay || 1000; // ms
    this.maxDelay = options.maxDelay || 30000; // ms
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterEnabled = options.jitterEnabled !== false; // Default true
    this.retryableErrors = options.retryableErrors || [];
  }

  /**
   * Calculate delay for given attempt with exponential backoff
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt) {
    // Exponential backoff: delay = initialDelay * (multiplier ^ attempt)
    let delay = this.initialDelay * Math.pow(this.backoffMultiplier, attempt);
    
    // Cap at max delay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter to prevent thundering herd
    // Jitter range: +/- 15% of delay
    if (this.jitterEnabled) {
      delay = delay + (Math.random() - 0.5) * 0.3 * delay;
    }
    
    return Math.floor(delay);
  }
}

/**
 * Retry Handler
 */
class RetryHandler {
  constructor(config = {}) {
    this.config = new RetryConfig(config);
    this.metrics = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0
    };
  }

  /**
   * Execute function with retry logic
   * @param {Function} fn - Async function to execute
   * @param {Object} context - Context for logging/tracking
   * @returns {Promise<any>} Result of successful execution
   */
  async execute(fn, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        this.metrics.totalAttempts++;
        
        // Execute the function
        const result = await fn();
        
        // Track successful retry
        if (attempt > 0) {
          this.metrics.successfulRetries++;
          this.logRetrySuccess(attempt, context);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          this.logNonRetryableError(error, context);
          throw error;
        }
        
        // Check if we've exhausted attempts
        if (attempt === this.config.maxAttempts - 1) {
          this.metrics.failedRetries++;
          this.logRetryExhausted(attempt + 1, error, context);
          throw error;
        }
        
        // Calculate delay and wait before next attempt
        const delay = this.config.calculateDelay(attempt);
        this.logRetryAttempt(attempt + 1, delay, error, context);
        
        await this.sleep(delay);
      }
    }
    
    // Should never reach here, but just in case
    throw lastError;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} Whether error is retryable
   */
  isRetryableError(error) {
    // Check if error has retryable property
    if (typeof error.retryable === 'boolean') {
      return error.retryable;
    }
    
    // Check against configured retryable errors
    if (this.config.retryableErrors.length > 0) {
      return this.config.retryableErrors.some(pattern => {
        if (typeof pattern === 'string') {
          return error.message?.includes(pattern) || error.code?.includes(pattern);
        }
        if (pattern instanceof RegExp) {
          return pattern.test(error.message || error.code || '');
        }
        return false;
      });
    }
    
    // Default retryable patterns
    const retryablePatterns = [
      'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
      'timeout', 'network', 'rate limit', '429', '502', '503', '504'
    ];
    
    const errorString = (error.message || error.code || '').toLowerCase();
    return retryablePatterns.some(pattern => 
      errorString.includes(pattern.toLowerCase())
    );
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log retry attempt
   */
  logRetryAttempt(attempt, delay, error, context) {
    console.log(`[Retry] Attempt ${attempt}/${this.config.maxAttempts} failed. ` +
      `Retrying in ${delay}ms. Error: ${error.message}`, {
      attempt,
      delay,
      error: error.message,
      context
    });
  }

  /**
   * Log successful retry
   */
  logRetrySuccess(attempt, context) {
    console.log(`[Retry] Success after ${attempt} retry attempts`, {
      attempt,
      context
    });
  }

  /**
   * Log retry exhausted
   */
  logRetryExhausted(totalAttempts, error, context) {
    console.error(`[Retry] All ${totalAttempts} attempts exhausted. Error: ${error.message}`, {
      totalAttempts,
      error: error.message,
      context
    });
  }

  /**
   * Log non-retryable error
   */
  logNonRetryableError(error, context) {
    console.log(`[Retry] Non-retryable error encountered: ${error.message}`, {
      error: error.message,
      context
    });
  }

  /**
   * Get retry metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0
    };
  }
}

module.exports = {
  RetryConfig,
  RetryHandler
};
