/**
 * Payment Error Classification System
 * Provides standardized error handling and categorization
 */

/**
 * Error Categories
 */
const ErrorCategory = {
  NETWORK: 'NETWORK',
  AUTHENTICATION: 'AUTHENTICATION',
  VALIDATION: 'VALIDATION',
  PROCESSING: 'PROCESSING',
  RATE_LIMIT: 'RATE_LIMIT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONFIGURATION: 'CONFIGURATION',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Error Severity Levels
 */
const ErrorSeverity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * Base Payment Error Class
 */
class PaymentError extends Error {
  constructor(message, category, severity, retryable = false, metadata = {}) {
    super(message);
    this.name = 'PaymentError';
    this.category = category;
    this.severity = severity;
    this.retryable = retryable;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to standardized response format
   */
  toResponse() {
    return {
      success: false,
      error: {
        code: this.category,
        message: this.message,
        severity: this.severity,
        retryable: this.retryable,
        timestamp: this.timestamp,
        metadata: this.metadata
      }
    };
  }
}

/**
 * Network Error - Connection issues, timeouts
 */
class NetworkError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.HIGH, true, metadata);
    this.name = 'NetworkError';
  }
}

/**
 * Authentication Error - Invalid credentials, expired tokens
 */
class AuthenticationError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.AUTHENTICATION, ErrorSeverity.HIGH, false, metadata);
    this.name = 'AuthenticationError';
  }
}

/**
 * Validation Error - Invalid input data
 */
class ValidationError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.VALIDATION, ErrorSeverity.MEDIUM, false, metadata);
    this.name = 'ValidationError';
  }
}

/**
 * Processing Error - Transaction processing failures
 */
class ProcessingError extends PaymentError {
  constructor(message, retryable = true, metadata = {}) {
    super(message, ErrorCategory.PROCESSING, ErrorSeverity.HIGH, retryable, metadata);
    this.name = 'ProcessingError';
  }
}

/**
 * Rate Limit Error - Too many requests
 */
class RateLimitError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.RATE_LIMIT, ErrorSeverity.MEDIUM, true, metadata);
    this.name = 'RateLimitError';
  }
}

/**
 * Insufficient Funds Error - Not enough balance
 */
class InsufficientFundsError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.INSUFFICIENT_FUNDS, ErrorSeverity.LOW, false, metadata);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Gateway Error - External gateway failures
 */
class GatewayError extends PaymentError {
  constructor(message, retryable = true, metadata = {}) {
    super(message, ErrorCategory.GATEWAY_ERROR, ErrorSeverity.HIGH, retryable, metadata);
    this.name = 'GatewayError';
  }
}

/**
 * Timeout Error - Request timeout
 */
class TimeoutError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.TIMEOUT, ErrorSeverity.HIGH, true, metadata);
    this.name = 'TimeoutError';
  }
}

/**
 * Configuration Error - Invalid configuration
 */
class ConfigurationError extends PaymentError {
  constructor(message, metadata = {}) {
    super(message, ErrorCategory.CONFIGURATION, ErrorSeverity.CRITICAL, false, metadata);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error Classifier - Converts various errors to payment errors
 */
class ErrorClassifier {
  /**
   * Classify an error based on its characteristics
   * @param {Error} error - Original error
   * @param {string} gatewayName - Gateway that generated the error
   * @returns {PaymentError} Classified error
   */
  static classify(error, gatewayName = 'unknown') {
    const metadata = { gateway: gatewayName, originalError: error.message };

    // Already a PaymentError
    if (error instanceof PaymentError) {
      return error;
    }

    // Network-related errors
    if (this.isNetworkError(error)) {
      return new NetworkError(error.message || 'Network connection failed', metadata);
    }

    // Authentication errors
    if (this.isAuthenticationError(error)) {
      return new AuthenticationError(error.message || 'Authentication failed', metadata);
    }

    // Validation errors
    if (this.isValidationError(error)) {
      return new ValidationError(error.message || 'Validation failed', metadata);
    }

    // Rate limit errors
    if (this.isRateLimitError(error)) {
      return new RateLimitError(error.message || 'Rate limit exceeded', metadata);
    }

    // Timeout errors
    if (this.isTimeoutError(error)) {
      return new TimeoutError(error.message || 'Request timeout', metadata);
    }

    // Insufficient funds
    if (this.isInsufficientFundsError(error)) {
      return new InsufficientFundsError(error.message || 'Insufficient funds', metadata);
    }

    // Default to processing error
    return new ProcessingError(error.message || 'Payment processing failed', true, metadata);
  }

  /**
   * Check if error is network-related
   */
  static isNetworkError(error) {
    const networkPatterns = [
      'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
      'ENETUNREACH', 'EHOSTUNREACH', 'network', 'connection'
    ];
    const errorString = (error.message || error.code || '').toLowerCase();
    return networkPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is authentication-related
   */
  static isAuthenticationError(error) {
    const authPatterns = [
      'unauthorized', 'authentication', 'invalid credentials',
      'invalid key', 'invalid token', '401', 'forbidden', '403'
    ];
    const errorString = (error.message || error.code || '').toLowerCase();
    return authPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is validation-related
   */
  static isValidationError(error) {
    const validationPatterns = [
      'validation', 'invalid', 'required', 'missing', 'format',
      'malformed', '400', 'bad request'
    ];
    const errorString = (error.message || error.code || '').toLowerCase();
    return validationPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is rate limit-related
   */
  static isRateLimitError(error) {
    const rateLimitPatterns = ['rate limit', 'too many requests', '429'];
    const errorString = (error.message || error.code || '').toLowerCase();
    return rateLimitPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is timeout-related
   */
  static isTimeoutError(error) {
    const timeoutPatterns = ['timeout', 'timed out', 'ETIMEDOUT', '408'];
    const errorString = (error.message || error.code || '').toLowerCase();
    return timeoutPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error is insufficient funds-related
   */
  static isInsufficientFundsError(error) {
    const fundsPatterns = [
      'insufficient funds', 'insufficient balance', 'not enough balance',
      'low balance', 'account balance'
    ];
    const errorString = (error.message || '').toLowerCase();
    return fundsPatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }
}

module.exports = {
  ErrorCategory,
  ErrorSeverity,
  PaymentError,
  NetworkError,
  AuthenticationError,
  ValidationError,
  ProcessingError,
  RateLimitError,
  InsufficientFundsError,
  GatewayError,
  TimeoutError,
  ConfigurationError,
  ErrorClassifier
};
