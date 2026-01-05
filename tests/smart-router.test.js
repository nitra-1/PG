/**
 * Tests for Gateway Health Tracker and Smart Router
 */

const { GatewayHealthTracker, HealthStatus } = require('../src/core/routing/gateway-health-tracker');
const { SmartRouter, RoutingStrategy } = require('../src/core/routing/smart-router');

describe('GatewayHealthTracker', () => {
  describe('Health Metrics', () => {
    test('should register gateway', () => {
      const tracker = new GatewayHealthTracker();
      tracker.registerGateway('razorpay');
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.gatewayName).toBe('razorpay');
      expect(health.status).toBe(HealthStatus.HEALTHY);
    });

    test('should record success', () => {
      const tracker = new GatewayHealthTracker();
      tracker.recordSuccess('razorpay', 500);
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.successCount).toBe(1);
      expect(health.totalRequests).toBe(1);
      expect(health.averageResponseTime).toBe(500);
    });

    test('should record failure', () => {
      const tracker = new GatewayHealthTracker();
      tracker.recordFailure('razorpay', 1000);
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.failureCount).toBe(1);
      expect(health.totalRequests).toBe(1);
    });

    test('should calculate success rate', () => {
      const tracker = new GatewayHealthTracker();
      
      tracker.recordSuccess('razorpay', 500);
      tracker.recordSuccess('razorpay', 600);
      tracker.recordFailure('razorpay', 1000);
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.successRate).toBeCloseTo(0.666, 2);
    });

    test('should calculate average response time', () => {
      const tracker = new GatewayHealthTracker();
      
      tracker.recordSuccess('razorpay', 500);
      tracker.recordSuccess('razorpay', 700);
      tracker.recordSuccess('razorpay', 600);
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.averageResponseTime).toBe(600);
    });

    test('should update health status based on metrics', () => {
      const tracker = new GatewayHealthTracker();
      
      // Healthy: high success rate, low latency
      for (let i = 0; i < 10; i++) {
        tracker.recordSuccess('razorpay', 500);
      }
      
      let health = tracker.getGatewayHealth('razorpay');
      expect(health.status).toBe(HealthStatus.HEALTHY);
      
      // Degrade with failures
      for (let i = 0; i < 3; i++) {
        tracker.recordFailure('razorpay', 2000);
      }
      
      health = tracker.getGatewayHealth('razorpay');
      expect([HealthStatus.DEGRADED, HealthStatus.UNHEALTHY]).toContain(health.status);
    });

    test('should calculate health score', () => {
      const tracker = new GatewayHealthTracker();
      
      // Perfect score
      for (let i = 0; i < 10; i++) {
        tracker.recordSuccess('razorpay', 500);
      }
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.healthScore).toBeGreaterThan(90);
    });

    test('should get healthiest gateway', () => {
      const tracker = new GatewayHealthTracker();
      
      // Good gateway
      for (let i = 0; i < 10; i++) {
        tracker.recordSuccess('razorpay', 500);
      }
      
      // Poor gateway
      for (let i = 0; i < 10; i++) {
        tracker.recordFailure('payu', 5000);
      }
      
      const healthiest = tracker.getHealthiestGateway();
      expect(healthiest).toBe('razorpay');
    });

    test('should get gateways sorted by health', () => {
      const tracker = new GatewayHealthTracker();
      
      tracker.recordSuccess('razorpay', 500);
      tracker.recordSuccess('payu', 1000);
      tracker.recordSuccess('ccavenue', 2000);
      
      const sorted = tracker.getGatewaysByHealth();
      expect(sorted[0].name).toBe('razorpay');
      expect(sorted[2].name).toBe('ccavenue');
    });

    test('should reset gateway metrics', () => {
      const tracker = new GatewayHealthTracker();
      
      tracker.recordSuccess('razorpay', 500);
      tracker.resetGateway('razorpay');
      
      const health = tracker.getGatewayHealth('razorpay');
      expect(health.totalRequests).toBe(0);
      expect(health.status).toBe(HealthStatus.HEALTHY);
    });
  });
});

describe('SmartRouter', () => {
  describe('Gateway Selection', () => {
    test('should select gateway based on health', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.HEALTH_BASED,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      // Make razorpay healthy
      for (let i = 0; i < 10; i++) {
        router.recordSuccess('razorpay', 500);
      }
      
      // Make payu unhealthy
      for (let i = 0; i < 10; i++) {
        router.recordFailure('payu', 5000);
      }
      
      const selected = router.selectGateway();
      expect(selected).toBe('razorpay');
    });

    test('should select gateway using round robin', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.ROUND_ROBIN,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      const selections = [];
      for (let i = 0; i < 6; i++) {
        selections.push(router.selectGateway());
      }
      
      // Should cycle through gateways
      expect(selections[0]).toBe('razorpay');
      expect(selections[1]).toBe('payu');
      expect(selections[2]).toBe('ccavenue');
      expect(selections[3]).toBe('razorpay');
    });

    test('should select gateway based on latency', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.LATENCY_BASED,
        gatewayPriority: ['razorpay', 'payu']
      });
      
      router.recordSuccess('razorpay', 1000);
      router.recordSuccess('payu', 500);
      
      const selected = router.selectGateway();
      expect(selected).toBe('payu');
    });

    test('should select gateway based on priority', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.PRIORITY,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue'],
        healthScoreThreshold: 50
      });
      
      // Make all gateways healthy
      router.recordSuccess('razorpay', 500);
      router.recordSuccess('payu', 500);
      router.recordSuccess('ccavenue', 500);
      
      const selected = router.selectGateway();
      expect(selected).toBe('razorpay'); // First in priority
    });

    test('should select gateway based on cost', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.COST_OPTIMIZED,
        gatewayPriority: ['razorpay', 'payu'],
        gatewayCosts: {
          razorpay: { fixedFee: 0, percentageFee: 2.0 },
          payu: { fixedFee: 0, percentageFee: 1.5 }
        }
      });
      
      const selected = router.selectGateway({ amount: 1000 });
      expect(selected).toBe('payu'); // Lower cost
    });

    test('should exclude specified gateways', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.PRIORITY,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      const selected = router.selectGateway({}, ['razorpay']);
      expect(selected).not.toBe('razorpay');
    });
  });

  describe('Fallback Mechanism', () => {
    test('should provide fallback gateways', () => {
      const router = new SmartRouter({
        fallbackEnabled: true,
        maxFallbackAttempts: 2,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      // Make gateways healthy
      router.recordSuccess('payu', 500);
      router.recordSuccess('ccavenue', 500);
      
      const fallbacks = router.getFallbackGateways('razorpay');
      expect(fallbacks.length).toBeLessThanOrEqual(2);
      expect(fallbacks).not.toContain('razorpay');
    });

    test('should return empty array when fallback disabled', () => {
      const router = new SmartRouter({
        fallbackEnabled: false,
        gatewayPriority: ['razorpay', 'payu']
      });
      
      const fallbacks = router.getFallbackGateways('razorpay');
      expect(fallbacks).toEqual([]);
    });

    test('should exclude already attempted gateways', () => {
      const router = new SmartRouter({
        fallbackEnabled: true,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      router.recordSuccess('payu', 500);
      router.recordSuccess('ccavenue', 500);
      
      const fallbacks = router.getFallbackGateways('razorpay', ['payu']);
      expect(fallbacks).not.toContain('razorpay');
      expect(fallbacks).not.toContain('payu');
    });

    test('should only return healthy fallback gateways', () => {
      const router = new SmartRouter({
        fallbackEnabled: true,
        healthScoreThreshold: 70,
        gatewayPriority: ['razorpay', 'payu', 'ccavenue']
      });
      
      // Make payu very healthy
      for (let i = 0; i < 10; i++) {
        router.recordSuccess('payu', 500);
      }
      
      // Make ccavenue unhealthy
      for (let i = 0; i < 10; i++) {
        router.recordFailure('ccavenue', 5000);
      }
      
      const fallbacks = router.getFallbackGateways('razorpay');
      expect(fallbacks).toContain('payu');
      expect(fallbacks).not.toContain('ccavenue');
    });
  });

  describe('Statistics and Configuration', () => {
    test('should provide routing statistics', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.HEALTH_BASED,
        gatewayPriority: ['razorpay', 'payu']
      });
      
      router.recordSuccess('razorpay', 500);
      
      const stats = router.getStatistics();
      expect(stats.strategy).toBe(RoutingStrategy.HEALTH_BASED);
      expect(stats.gatewayHealth).toBeDefined();
      expect(stats.gatewayPriority).toEqual(['razorpay', 'payu']);
    });

    test('should update configuration', () => {
      const router = new SmartRouter({
        strategy: RoutingStrategy.ROUND_ROBIN
      });
      
      router.updateConfig({ strategy: RoutingStrategy.HEALTH_BASED });
      expect(router.config.strategy).toBe(RoutingStrategy.HEALTH_BASED);
    });

    test('should reset router state', () => {
      const router = new SmartRouter({
        gatewayPriority: ['razorpay', 'payu']
      });
      
      router.recordSuccess('razorpay', 500);
      router.reset();
      
      const stats = router.getStatistics();
      const razorpayHealth = stats.gatewayHealth.razorpay;
      expect(razorpayHealth.totalRequests).toBe(0);
    });
  });
});
