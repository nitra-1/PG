/**
 * Example: Using Payment Gateway Resilience Features
 * 
 * This example demonstrates how to use the new resilience features:
 * - Smart routing
 * - Automatic fallback
 * - Retry logic
 * - Circuit breaker
 * - Error handling
 */

const PaymentGateway = require('../src/core/payment-gateway');
const config = require('../src/config/config');

async function examplePaymentProcessing() {
  // Initialize payment gateway with configuration
  const gateway = new PaymentGateway(config);

  // Example 1: Basic payment with automatic resilience
  console.log('\n=== Example 1: Basic Payment Processing ===');
  try {
    const paymentData = {
      amount: 1000,
      currency: 'INR',
      customerId: 'CUST123',
      paymentMethod: 'card',
      cardDetails: {
        number: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '2025',
        cvv: '123'
      }
    };

    const result = await gateway.processPayment(paymentData);
    console.log('✅ Payment Successful:', {
      transactionId: result.transactionId,
      gateway: result.gateway,
      responseTime: result.responseTime,
      status: result.status
    });
  } catch (error) {
    console.error('❌ Payment Failed:', error.toResponse());
  }

  // Example 2: Check gateway statistics
  console.log('\n=== Example 2: Gateway Statistics ===');
  const stats = gateway.getStatistics();
  
  console.log('\nGateway Health:');
  Object.entries(stats.routing.gatewayHealth).forEach(([name, health]) => {
    console.log(`  ${name}:`, {
      status: health.status,
      healthScore: health.healthScore,
      successRate: `${(health.successRate * 100).toFixed(2)}%`,
      avgResponseTime: `${health.averageResponseTime}ms`,
      totalRequests: health.totalRequests
    });
  });

  console.log('\nCircuit Breaker Status:');
  Object.entries(stats.circuitBreakers).forEach(([name, status]) => {
    console.log(`  ${name}:`, {
      state: status.state,
      totalRequests: status.metrics.totalRequests,
      successRate: status.metrics.totalRequests > 0 
        ? `${(status.metrics.totalSuccesses / status.metrics.totalRequests * 100).toFixed(2)}%`
        : 'N/A'
    });
  });

  console.log('\nRetry Metrics:', {
    totalAttempts: stats.retry.totalAttempts,
    successfulRetries: stats.retry.successfulRetries,
    failedRetries: stats.retry.failedRetries
  });

  // Example 3: Multiple payments to demonstrate routing
  console.log('\n=== Example 3: Multiple Payments (Smart Routing) ===');
  for (let i = 1; i <= 5; i++) {
    try {
      const result = await gateway.processPayment({
        amount: 500 * i,
        currency: 'INR',
        customerId: `CUST${i}`,
        paymentMethod: 'upi',
        upiId: `customer${i}@upi`
      });
      console.log(`  Payment ${i}: Gateway=${result.gateway}, Time=${result.responseTime}ms`);
    } catch (error) {
      console.error(`  Payment ${i}: Failed -`, error.message);
    }
  }
}

async function demonstrateErrorHandling() {
  console.log('\n=== Example 4: Error Handling ===');
  
  const { ErrorClassifier, NetworkError, ValidationError } = require('../src/core/errors/payment-errors');
  
  // Example: Network Error (retryable)
  const networkError = new NetworkError('Connection timeout', { gateway: 'razorpay' });
  console.log('\nNetwork Error:', {
    category: networkError.category,
    retryable: networkError.retryable,
    severity: networkError.severity
  });
  console.log('Response format:', networkError.toResponse());
  
  // Example: Validation Error (not retryable)
  const validationError = new ValidationError('Invalid card number');
  console.log('\nValidation Error:', {
    category: validationError.category,
    retryable: validationError.retryable,
    severity: validationError.severity
  });
  
  // Example: Error Classification
  const unknownError = new Error('ECONNREFUSED: Connection refused');
  const classified = ErrorClassifier.classify(unknownError, 'payu');
  console.log('\nClassified Error:', {
    name: classified.name,
    category: classified.category,
    retryable: classified.retryable
  });
}

async function demonstrateCircuitBreaker() {
  console.log('\n=== Example 5: Circuit Breaker Demo ===');
  
  const { CircuitBreaker, CircuitState } = require('../src/core/circuit-breaker/circuit-breaker');
  
  // Create a test circuit breaker
  const breaker = new CircuitBreaker('demo-service', {
    failureThreshold: 3,
    successThreshold: 2,
    openTimeout: 5000,
    volumeThreshold: 1
  });
  
  console.log('Initial state:', breaker.state);
  
  // Simulate failures
  console.log('\nSimulating failures...');
  for (let i = 1; i <= 3; i++) {
    try {
      await breaker.execute(async () => {
        throw new Error('Service unavailable');
      });
    } catch (error) {
      console.log(`  Attempt ${i}: ${error.message}`);
    }
  }
  
  console.log('State after failures:', breaker.state);
  
  // Try to execute when circuit is open
  console.log('\nTrying to execute when circuit is OPEN...');
  try {
    await breaker.execute(async () => 'success');
  } catch (error) {
    console.log('  Blocked:', error.message);
  }
  
  console.log('\nCircuit breaker metrics:');
  const status = breaker.getStatus();
  console.log('  Total requests:', status.metrics.totalRequests);
  console.log('  Total failures:', status.metrics.totalFailures);
  console.log('  State:', status.state);
}

async function demonstrateSmartRouting() {
  console.log('\n=== Example 6: Smart Routing Demo ===');
  
  const { SmartRouter, RoutingStrategy } = require('../src/core/routing/smart-router');
  
  // Health-based routing
  const router = new SmartRouter({
    strategy: RoutingStrategy.HEALTH_BASED,
    gatewayPriority: ['razorpay', 'payu', 'ccavenue']
  });
  
  // Simulate some traffic
  console.log('\nSimulating traffic...');
  router.recordSuccess('razorpay', 500);
  router.recordSuccess('razorpay', 600);
  router.recordSuccess('payu', 1200);
  router.recordFailure('ccavenue', 3000);
  
  // Get statistics
  const stats = router.getStatistics();
  console.log('\nRouting Strategy:', stats.strategy);
  console.log('Gateway Health:');
  Object.entries(stats.gatewayHealth).forEach(([name, health]) => {
    console.log(`  ${name}:`, {
      healthScore: health.healthScore,
      successRate: health.successRate,
      avgResponseTime: health.averageResponseTime
    });
  });
  
  // Select gateway
  const selected = router.selectGateway();
  console.log('\nSelected gateway (health-based):', selected);
  
  // Get fallback gateways
  const fallbacks = router.getFallbackGateways(selected);
  console.log('Fallback gateways:', fallbacks);
}

async function runExamples() {
  console.log('='.repeat(60));
  console.log('Payment Gateway Resilience Features - Examples');
  console.log('='.repeat(60));
  
  try {
    // Run examples
    await demonstrateErrorHandling();
    await demonstrateCircuitBreaker();
    await demonstrateSmartRouting();
    
    // Uncomment to run actual payment processing examples
    // Note: Requires proper gateway configuration
    // await examplePaymentProcessing();
    
    console.log('\n' + '='.repeat(60));
    console.log('Examples completed successfully!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\nExample execution error:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  examplePaymentProcessing,
  demonstrateErrorHandling,
  demonstrateCircuitBreaker,
  demonstrateSmartRouting
};
