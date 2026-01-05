/**
 * Tests for Retry Handler
 */

const { RetryHandler, RetryConfig } = require('../src/core/retry/retry-handler');
const { NetworkError } = require('../src/core/errors/payment-errors');

describe('RetryHandler', () => {
  describe('RetryConfig', () => {
    test('should use default values', () => {
      const config = new RetryConfig();
      
      expect(config.maxAttempts).toBe(3);
      expect(config.initialDelay).toBe(1000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitterEnabled).toBe(true);
    });

    test('should accept custom values', () => {
      const config = new RetryConfig({
        maxAttempts: 5,
        initialDelay: 500,
        backoffMultiplier: 3,
        jitterEnabled: false
      });
      
      expect(config.maxAttempts).toBe(5);
      expect(config.initialDelay).toBe(500);
      expect(config.backoffMultiplier).toBe(3);
      expect(config.jitterEnabled).toBe(false);
    });

    test('should calculate exponential backoff delay', () => {
      const config = new RetryConfig({
        initialDelay: 1000,
        backoffMultiplier: 2,
        jitterEnabled: false
      });
      
      expect(config.calculateDelay(0)).toBe(1000);
      expect(config.calculateDelay(1)).toBe(2000);
      expect(config.calculateDelay(2)).toBe(4000);
    });

    test('should cap delay at maxDelay', () => {
      const config = new RetryConfig({
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
        jitterEnabled: false
      });
      
      expect(config.calculateDelay(10)).toBe(5000);
    });

    test('should add jitter when enabled', () => {
      const config = new RetryConfig({
        initialDelay: 1000,
        backoffMultiplier: 2,
        jitterEnabled: true
      });
      
      const delay1 = config.calculateDelay(0);
      const delay2 = config.calculateDelay(0);
      
      // With jitter, delays should potentially vary
      expect(delay1).toBeGreaterThan(0);
      expect(delay1).toBeLessThanOrEqual(1000 * 1.15);
    });
  });

  describe('RetryHandler Execution', () => {
    test('should succeed on first attempt', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await handler.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should retry on retryable error', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        initialDelay: 10
      });
      
      let attemptCount = 0;
      const mockFn = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new NetworkError('Network error');
        }
        return 'success';
      });
      
      const result = await handler.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    test('should not retry on non-retryable error', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });
      const error = new Error('Invalid credentials');
      error.retryable = false;
      
      const mockFn = jest.fn().mockRejectedValue(error);
      
      await expect(handler.execute(mockFn)).rejects.toThrow('Invalid credentials');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should exhaust retries and throw last error', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        initialDelay: 10
      });
      
      const mockFn = jest.fn().mockRejectedValue(new NetworkError('Network error'));
      
      await expect(handler.execute(mockFn)).rejects.toThrow('Network error');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    test('should identify retryable errors by default patterns', () => {
      const handler = new RetryHandler();
      
      const retryableErrors = [
        new Error('ECONNREFUSED'),
        new Error('timeout'),
        new Error('429 Too Many Requests')
      ];
      
      retryableErrors.forEach(error => {
        expect(handler.isRetryableError(error)).toBe(true);
      });
    });

    test('should respect retryable property on error', () => {
      const handler = new RetryHandler();
      
      const error = new Error('Some error');
      error.retryable = false;
      
      expect(handler.isRetryableError(error)).toBe(false);
      
      error.retryable = true;
      expect(handler.isRetryableError(error)).toBe(true);
    });

    test('should track metrics', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        initialDelay: 10
      });
      
      // First execution: success on retry
      let attemptCount = 0;
      const mockFn1 = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new NetworkError('Network error');
        }
        return 'success';
      });
      
      await handler.execute(mockFn1);
      
      const metrics = handler.getMetrics();
      expect(metrics.totalAttempts).toBe(2);
      expect(metrics.successfulRetries).toBe(1);
    });

    test('should reset metrics', async () => {
      const handler = new RetryHandler({ maxAttempts: 3 });
      const mockFn = jest.fn().mockResolvedValue('success');
      
      await handler.execute(mockFn);
      expect(handler.getMetrics().totalAttempts).toBe(1);
      
      handler.resetMetrics();
      expect(handler.getMetrics().totalAttempts).toBe(0);
    });
  });

  describe('Custom Retry Patterns', () => {
    test('should use custom retryable error patterns', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: ['CustomError']
      });
      
      let attemptCount = 0;
      const mockFn = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('CustomError occurred');
        }
        return 'success';
      });
      
      const result = await handler.execute(mockFn);
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    test('should support regex patterns', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: [/CUSTOM_\d+/]
      });
      
      let attemptCount = 0;
      const mockFn = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('CUSTOM_123');
        }
        return 'success';
      });
      
      const result = await handler.execute(mockFn);
      expect(result).toBe('success');
    });
  });
});
