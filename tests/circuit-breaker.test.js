/**
 * Tests for Circuit Breaker
 */

const { CircuitBreaker, CircuitState } = require('../src/core/circuit-breaker/circuit-breaker');

describe('CircuitBreaker', () => {
  describe('State Transitions', () => {
    test('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker('test-gateway');
      expect(breaker.state).toBe(CircuitState.CLOSED);
    });

    test('should transition to OPEN after failure threshold', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 3,
        volumeThreshold: 1,
        failureWindow: 60000
      });
      
      // Execute failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Service failure');
          });
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
    });

    test('should transition to HALF_OPEN after timeout', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 2,
        volumeThreshold: 1,
        openTimeout: 100
      });
      
      // Cause circuit to open
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Service failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Next execution should transition to HALF_OPEN
      try {
        await breaker.execute(async () => {
          return 'success';
        });
      } catch (error) {
        // May fail
      }
      
      // Should have transitioned from OPEN
      expect(breaker.state).not.toBe(CircuitState.OPEN);
    });

    test('should transition to CLOSED after success threshold in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 2,
        successThreshold: 2,
        volumeThreshold: 1,
        openTimeout: 50
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Transition to HALF_OPEN and then CLOSED with successes
      for (let i = 0; i < 2; i++) {
        await breaker.execute(async () => {
          return 'success';
        });
      }
      
      expect(breaker.state).toBe(CircuitState.CLOSED);
    });

    test('should return to OPEN on failure in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 2,
        volumeThreshold: 1,
        openTimeout: 50
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Try to execute (will be HALF_OPEN) but fail
      try {
        await breaker.execute(async () => {
          throw new Error('Still failing');
        });
      } catch (error) {
        // Expected
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
    });
  });

  describe('Request Execution', () => {
    test('should execute function successfully in CLOSED state', async () => {
      const breaker = new CircuitBreaker('test-gateway');
      
      const result = await breaker.execute(async () => {
        return 'success';
      });
      
      expect(result).toBe('success');
    });

    test('should reject requests in OPEN state', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 2,
        volumeThreshold: 1
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
      
      // Try to execute
      await expect(breaker.execute(async () => {
        return 'success';
      })).rejects.toThrow('Circuit breaker [test-gateway] is OPEN');
    });

    test('should handle timeout', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        requestTimeout: 100
      });
      
      await expect(breaker.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'success';
      })).rejects.toThrow('Request timeout');
    });
  });

  describe('Metrics Tracking', () => {
    test('should track successful requests', async () => {
      const breaker = new CircuitBreaker('test-gateway');
      
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');
      
      const status = breaker.getStatus();
      expect(status.metrics.totalSuccesses).toBe(2);
      expect(status.metrics.totalRequests).toBe(2);
    });

    test('should track failed requests', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 10 // Prevent circuit from opening
      });
      
      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }
      
      const status = breaker.getStatus();
      expect(status.metrics.totalFailures).toBe(1);
      expect(status.metrics.totalRequests).toBe(1);
    });

    test('should track consecutive successes and failures', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 10
      });
      
      // Successes
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');
      
      expect(breaker.metrics.consecutiveSuccesses).toBe(2);
      
      // Failure resets consecutive successes
      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch (error) {
        // Expected
      }
      
      expect(breaker.metrics.consecutiveSuccesses).toBe(0);
      expect(breaker.metrics.consecutiveFailures).toBe(1);
    });

    test('should clean up old metrics', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureWindow: 100
      });
      
      await breaker.execute(async () => 'success');
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      breaker.cleanupOldMetrics();
      expect(breaker.metrics.successes.length).toBe(0);
    });
  });

  describe('Status and Reset', () => {
    test('should provide status information', async () => {
      const breaker = new CircuitBreaker('test-gateway');
      
      await breaker.execute(async () => 'success');
      
      const status = breaker.getStatus();
      expect(status.name).toBe('test-gateway');
      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.metrics).toBeDefined();
      expect(status.config).toBeDefined();
    });

    test('should reset breaker state', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 2,
        volumeThreshold: 1
      });
      
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      expect(breaker.state).toBe(CircuitState.OPEN);
      
      breaker.reset();
      
      expect(breaker.state).toBe(CircuitState.CLOSED);
      expect(breaker.metrics.totalRequests).toBe(0);
    });
  });

  describe('Volume Threshold', () => {
    test('should not open circuit below volume threshold', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 3,
        volumeThreshold: 10
      });
      
      // Execute 5 failures (below volume threshold)
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      // Should remain closed due to volume threshold
      expect(breaker.state).toBe(CircuitState.CLOSED);
    });

    test('should open circuit above volume threshold', async () => {
      const breaker = new CircuitBreaker('test-gateway', {
        failureThreshold: 5,
        volumeThreshold: 10
      });
      
      // Execute 10 failures (meets volume threshold)
      for (let i = 0; i < 10; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch (error) {
          // Expected
        }
      }
      
      // Should be open
      expect(breaker.state).toBe(CircuitState.OPEN);
    });
  });
});
