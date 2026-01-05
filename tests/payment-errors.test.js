/**
 * Tests for Payment Error Classification System
 */

const {
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
} = require('../src/core/errors/payment-errors');

describe('Payment Errors', () => {
  describe('Error Classes', () => {
    test('NetworkError should be retryable', () => {
      const error = new NetworkError('Connection failed');
      expect(error.retryable).toBe(true);
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
    });

    test('AuthenticationError should not be retryable', () => {
      const error = new AuthenticationError('Invalid credentials');
      expect(error.retryable).toBe(false);
      expect(error.category).toBe(ErrorCategory.AUTHENTICATION);
    });

    test('ValidationError should not be retryable', () => {
      const error = new ValidationError('Invalid amount');
      expect(error.retryable).toBe(false);
      expect(error.category).toBe(ErrorCategory.VALIDATION);
    });

    test('RateLimitError should be retryable', () => {
      const error = new RateLimitError('Rate limit exceeded');
      expect(error.retryable).toBe(true);
      expect(error.category).toBe(ErrorCategory.RATE_LIMIT);
    });

    test('TimeoutError should be retryable', () => {
      const error = new TimeoutError('Request timeout');
      expect(error.retryable).toBe(true);
      expect(error.category).toBe(ErrorCategory.TIMEOUT);
    });

    test('InsufficientFundsError should not be retryable', () => {
      const error = new InsufficientFundsError('Insufficient balance');
      expect(error.retryable).toBe(false);
      expect(error.category).toBe(ErrorCategory.INSUFFICIENT_FUNDS);
    });

    test('Error should include metadata', () => {
      const metadata = { gateway: 'razorpay', amount: 100 };
      const error = new NetworkError('Connection failed', metadata);
      expect(error.metadata).toEqual(metadata);
    });

    test('Error toResponse should return standardized format', () => {
      const error = new NetworkError('Connection failed');
      const response = error.toResponse();
      
      expect(response.success).toBe(false);
      expect(response.error.code).toBe(ErrorCategory.NETWORK);
      expect(response.error.message).toBe('Connection failed');
      expect(response.error.retryable).toBe(true);
      expect(response.error.timestamp).toBeDefined();
    });
  });

  describe('ErrorClassifier', () => {
    test('should classify network errors', () => {
      const error = new Error('ECONNREFUSED');
      const classified = ErrorClassifier.classify(error, 'razorpay');
      
      expect(classified).toBeInstanceOf(NetworkError);
      expect(classified.retryable).toBe(true);
      expect(classified.metadata.gateway).toBe('razorpay');
    });

    test('should classify authentication errors', () => {
      const error = new Error('Unauthorized: Invalid API key');
      const classified = ErrorClassifier.classify(error, 'payu');
      
      expect(classified).toBeInstanceOf(AuthenticationError);
      expect(classified.retryable).toBe(false);
    });

    test('should classify validation errors', () => {
      const error = new Error('Validation failed: Missing required field');
      const classified = ErrorClassifier.classify(error, 'ccavenue');
      
      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.retryable).toBe(false);
    });

    test('should classify rate limit errors', () => {
      const error = new Error('429 Too Many Requests');
      const classified = ErrorClassifier.classify(error, 'razorpay');
      
      expect(classified).toBeInstanceOf(RateLimitError);
      expect(classified.retryable).toBe(true);
    });

    test('should classify timeout errors', () => {
      const error = new Error('Request timed out');
      const classified = ErrorClassifier.classify(error, 'payu');
      
      expect(classified).toBeInstanceOf(TimeoutError);
      expect(classified.retryable).toBe(true);
    });

    test('should classify insufficient funds errors', () => {
      const error = new Error('Insufficient funds in account');
      const classified = ErrorClassifier.classify(error, 'razorpay');
      
      expect(classified).toBeInstanceOf(InsufficientFundsError);
      expect(classified.retryable).toBe(false);
    });

    test('should return PaymentError if already classified', () => {
      const originalError = new NetworkError('Original error');
      const classified = ErrorClassifier.classify(originalError, 'razorpay');
      
      expect(classified).toBe(originalError);
    });

    test('should default to ProcessingError for unknown errors', () => {
      const error = new Error('Unknown error occurred');
      const classified = ErrorClassifier.classify(error, 'razorpay');
      
      expect(classified).toBeInstanceOf(ProcessingError);
      expect(classified.retryable).toBe(true);
    });
  });

  describe('Error Patterns', () => {
    test('should identify network error patterns', () => {
      const patterns = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'network error'];
      
      patterns.forEach(pattern => {
        const error = new Error(pattern);
        expect(ErrorClassifier.isNetworkError(error)).toBe(true);
      });
    });

    test('should identify authentication error patterns', () => {
      const patterns = ['Unauthorized', 'Invalid credentials', '401', '403'];
      
      patterns.forEach(pattern => {
        const error = new Error(pattern);
        expect(ErrorClassifier.isAuthenticationError(error)).toBe(true);
      });
    });

    test('should identify validation error patterns', () => {
      const patterns = ['Validation failed', 'Invalid format', 'Required field', '400'];
      
      patterns.forEach(pattern => {
        const error = new Error(pattern);
        expect(ErrorClassifier.isValidationError(error)).toBe(true);
      });
    });
  });
});
