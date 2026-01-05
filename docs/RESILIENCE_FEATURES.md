# Payment Gateway Resilience Features

## Overview

This document describes the resilience features implemented in the Payment Gateway system, including error handling, retry logic, circuit breaker pattern, smart routing, and fallback mechanisms.

## Table of Contents

- [Error Handling & Classification](#error-handling--classification)
- [Retry Logic](#retry-logic)
- [Circuit Breaker](#circuit-breaker)
- [Smart Routing](#smart-routing)
- [Fallback Mechanism](#fallback-mechanism)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)

## Error Handling & Classification

### Overview

The system implements a unified error classification system that categorizes errors into specific types, making it easier to handle different failure scenarios appropriately.

### Error Categories

| Category | Description | Retryable | Severity |
|----------|-------------|-----------|----------|
| `NETWORK` | Network connection issues, timeouts | Yes | HIGH |
| `AUTHENTICATION` | Invalid credentials, expired tokens | No | HIGH |
| `VALIDATION` | Invalid input data | No | MEDIUM |
| `PROCESSING` | Transaction processing failures | Yes | HIGH |
| `RATE_LIMIT` | Too many requests | Yes | MEDIUM |
| `INSUFFICIENT_FUNDS` | Not enough balance | No | LOW |
| `GATEWAY_ERROR` | External gateway failures | Yes | HIGH |
| `TIMEOUT` | Request timeout | Yes | HIGH |
| `CONFIGURATION` | Invalid configuration | No | CRITICAL |

### Error Classes

```javascript
const { 
  NetworkError,
  AuthenticationError,
  ValidationError,
  ProcessingError,
  RateLimitError,
  InsufficientFundsError,
  GatewayError,
  TimeoutError,
  ConfigurationError 
} = require('./src/core/errors/payment-errors');

// Creating errors
throw new NetworkError('Connection failed', { gateway: 'razorpay' });
throw new ValidationError('Invalid amount');
```

### Error Response Format

All errors are converted to a standardized response format:

```json
{
  "success": false,
  "error": {
    "code": "NETWORK",
    "message": "Connection failed",
    "severity": "HIGH",
    "retryable": true,
    "timestamp": "2024-01-05T10:30:00.000Z",
    "metadata": {
      "gateway": "razorpay"
    }
  }
}
```

### Automatic Error Classification

The `ErrorClassifier` automatically categorizes errors based on error messages and codes:

```javascript
const { ErrorClassifier } = require('./src/core/errors/payment-errors');

try {
  // Some operation that might fail
} catch (error) {
  const classifiedError = ErrorClassifier.classify(error, 'razorpay');
  console.log(classifiedError.category); // e.g., "NETWORK"
  console.log(classifiedError.retryable); // true/false
}
```

## Retry Logic

### Overview

The retry mechanism implements exponential backoff with jitter to handle transient failures gracefully.

### Features

- **Exponential Backoff**: Delay increases exponentially between retries
- **Jitter**: Randomization to prevent thundering herd problem
- **Configurable Attempts**: Set maximum retry attempts
- **Smart Retry Detection**: Only retries appropriate errors
- **Metrics Tracking**: Track retry statistics

### Configuration

```javascript
// In config.js or environment variables
retry: {
  maxAttempts: 3,              // Maximum retry attempts
  initialDelay: 1000,          // Initial delay in ms
  maxDelay: 30000,             // Maximum delay in ms
  backoffMultiplier: 2,        // Multiplier for exponential backoff
  jitterEnabled: true          // Enable jitter
}
```

Environment variables:
- `RETRY_MAX_ATTEMPTS` (default: 3)
- `RETRY_INITIAL_DELAY` (default: 1000)
- `RETRY_MAX_DELAY` (default: 30000)
- `RETRY_BACKOFF_MULTIPLIER` (default: 2)
- `RETRY_JITTER_ENABLED` (default: true)

### How It Works

1. **Attempt 1**: Immediate execution
2. **Attempt 2**: Wait 1s (with jitter)
3. **Attempt 3**: Wait 2s (with jitter)
4. **Attempt 4**: Wait 4s (with jitter)

### Retry Decisions

The retry handler automatically determines if an error should be retried:

- Errors with `retryable: true` property are retried
- Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
- Rate limit errors (429)
- Server errors (502, 503, 504)
- Gateway timeout errors

Errors that are NOT retried:
- Authentication errors (invalid credentials)
- Validation errors (bad input)
- Insufficient funds
- Errors with `retryable: false`

## Circuit Breaker

### Overview

The circuit breaker pattern prevents cascading failures by stopping requests to a failing service temporarily.

### States

1. **CLOSED** (Normal Operation)
   - All requests are allowed
   - Failures are tracked
   - Opens when failure threshold is exceeded

2. **OPEN** (Blocking Requests)
   - All requests are immediately rejected
   - No calls to the failing service
   - Transitions to HALF_OPEN after timeout

3. **HALF_OPEN** (Testing Recovery)
   - Limited requests allowed to test service
   - Closes on success threshold
   - Opens again on any failure

### Configuration

```javascript
circuitBreaker: {
  failureThreshold: 5,         // Failures needed to open circuit
  successThreshold: 2,         // Successes needed to close circuit
  openTimeout: 60000,          // Time in OPEN state (ms)
  requestTimeout: 30000,       // Individual request timeout (ms)
  volumeThreshold: 10          // Minimum requests before opening
}
```

Environment variables:
- `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (default: 5)
- `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` (default: 2)
- `CIRCUIT_BREAKER_OPEN_TIMEOUT` (default: 60000)
- `CIRCUIT_BREAKER_REQUEST_TIMEOUT` (default: 30000)
- `CIRCUIT_BREAKER_VOLUME_THRESHOLD` (default: 10)

### State Transitions

```
CLOSED --[failures >= threshold]--> OPEN
OPEN --[timeout elapsed]--> HALF_OPEN
HALF_OPEN --[success >= threshold]--> CLOSED
HALF_OPEN --[any failure]--> OPEN
```

### Benefits

- **Prevents Cascade Failures**: Stops overwhelming a failing service
- **Fast Failure**: Immediate rejection instead of waiting for timeout
- **Automatic Recovery**: Tests service recovery automatically
- **Resource Protection**: Saves resources by not calling failing services

## Smart Routing

### Overview

Smart routing intelligently selects the optimal payment gateway based on various factors including health, latency, cost, and priority.

### Routing Strategies

#### 1. Health-Based Routing (Default)

Routes to the healthiest gateway based on success rate and response time.

```javascript
routingStrategy: 'HEALTH_BASED'
```

#### 2. Round-Robin Routing

Distributes requests evenly across all gateways.

```javascript
routingStrategy: 'ROUND_ROBIN'
```

#### 3. Latency-Based Routing

Routes to the gateway with lowest average response time.

```javascript
routingStrategy: 'LATENCY_BASED'
```

#### 4. Cost-Optimized Routing

Routes to the gateway with lowest transaction cost.

```javascript
routingStrategy: 'COST_OPTIMIZED',
gatewayCosts: {
  razorpay: { fixedFee: 0, percentageFee: 2.0 },
  payu: { fixedFee: 0, percentageFee: 1.5 },
  ccavenue: { fixedFee: 5, percentageFee: 1.8 }
}
```

#### 5. Priority-Based Routing

Routes based on configured priority order, with health checks.

```javascript
routingStrategy: 'PRIORITY',
gatewayPriority: ['razorpay', 'payu', 'ccavenue']
```

### Health Tracking

The system continuously tracks gateway health metrics:

- **Success Rate**: Percentage of successful transactions
- **Response Time**: Average and percentile response times
- **Health Score**: 0-100 score based on performance
- **Status**: HEALTHY, DEGRADED, or UNHEALTHY

### Health Scoring

Health score calculation:
- **70%** based on success rate
- **30%** based on response time

Example:
- Success rate: 98% → 68.6 points
- Response time: 800ms → 24 points
- **Total Health Score**: 92.6/100

## Fallback Mechanism

### Overview

When a primary gateway fails, the system automatically attempts alternative gateways.

### Configuration

```javascript
fallbackEnabled: true,           // Enable fallback mechanism
maxFallbackAttempts: 2,         // Maximum fallback attempts
healthScoreThreshold: 50        // Minimum health score for fallback
```

Environment variables:
- `FALLBACK_ENABLED` (default: true)
- `MAX_FALLBACK_ATTEMPTS` (default: 2)
- `HEALTH_SCORE_THRESHOLD` (default: 50)

### How It Works

1. **Primary Gateway**: Attempt transaction with selected gateway
2. **Primary Failure**: If primary fails, check fallback configuration
3. **Select Fallbacks**: Choose up to N healthy alternative gateways
4. **Sequential Attempts**: Try each fallback gateway in order
5. **Success or Final Failure**: Return result or final error

### Fallback Selection Criteria

Fallback gateways are selected based on:
- Health score above threshold
- Not previously attempted
- Sorted by health score (best first)
- Limited to `maxFallbackAttempts`

### Example Flow

```
Transaction Request
  ↓
Primary: Razorpay → FAILED
  ↓
Fallback 1: PayU → FAILED
  ↓
Fallback 2: CCAvenue → SUCCESS ✓
```

## Configuration

### Complete Configuration Example

```javascript
// config.js
module.exports = {
  // Gateway Priority
  gatewayPriority: ['razorpay', 'payu', 'ccavenue'],
  
  // Routing Strategy
  routingStrategy: 'HEALTH_BASED',
  
  // Fallback Configuration
  fallbackEnabled: true,
  maxFallbackAttempts: 2,
  healthScoreThreshold: 50,
  
  // Retry Configuration
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitterEnabled: true
  },
  
  // Circuit Breaker Configuration
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    openTimeout: 60000,
    requestTimeout: 30000,
    volumeThreshold: 10
  },
  
  // Gateway Costs (for cost-optimized routing)
  gatewayCosts: {
    razorpay: { fixedFee: 0, percentageFee: 2.0 },
    payu: { fixedFee: 0, percentageFee: 1.5 },
    ccavenue: { fixedFee: 5, percentageFee: 1.8 }
  }
};
```

### Environment Variables

Create a `.env` file:

```bash
# Routing Configuration
ROUTING_STRATEGY=HEALTH_BASED
GATEWAY_PRIORITY=razorpay,payu,ccavenue
FALLBACK_ENABLED=true
MAX_FALLBACK_ATTEMPTS=2
HEALTH_SCORE_THRESHOLD=50

# Retry Configuration
RETRY_MAX_ATTEMPTS=3
RETRY_INITIAL_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_BACKOFF_MULTIPLIER=2
RETRY_JITTER_ENABLED=true

# Circuit Breaker Configuration
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_SUCCESS_THRESHOLD=2
CIRCUIT_BREAKER_OPEN_TIMEOUT=60000
CIRCUIT_BREAKER_REQUEST_TIMEOUT=30000
CIRCUIT_BREAKER_VOLUME_THRESHOLD=10

# Gateway Costs
RAZORPAY_PERCENTAGE_FEE=2.0
PAYU_PERCENTAGE_FEE=1.5
CCAVENUE_FIXED_FEE=5
CCAVENUE_PERCENTAGE_FEE=1.8
```

## Usage Examples

### Basic Payment Processing

```javascript
const PaymentGateway = require('./src/core/payment-gateway');
const config = require('./src/config/config');

const gateway = new PaymentGateway(config);

// Process payment with automatic retry, fallback, and circuit breaker
try {
  const result = await gateway.processPayment({
    amount: 1000,
    currency: 'INR',
    customerId: 'CUST123',
    paymentMethod: 'card'
  });
  
  console.log('Payment successful:', result);
  // Output:
  // {
  //   success: true,
  //   transactionId: 'RZP_123456',
  //   status: 'success',
  //   gateway: 'razorpay',
  //   timestamp: '2024-01-05T10:30:00.000Z',
  //   responseTime: 1234
  // }
} catch (error) {
  console.error('Payment failed:', error.toResponse());
  // Output (standardized error):
  // {
  //   success: false,
  //   error: {
  //     code: 'NETWORK',
  //     message: 'Connection failed',
  //     retryable: true,
  //     severity: 'HIGH',
  //     timestamp: '2024-01-05T10:30:00.000Z'
  //   }
  // }
}
```

### Monitoring Gateway Health

```javascript
// Get statistics
const stats = gateway.getStatistics();

console.log('Gateway Health:', stats.routing.gatewayHealth);
// Output:
// {
//   razorpay: {
//     status: 'HEALTHY',
//     healthScore: 95,
//     successRate: 0.98,
//     averageResponseTime: 850,
//     totalRequests: 1000
//   },
//   payu: { ... },
//   ccavenue: { ... }
// }

console.log('Circuit Breakers:', stats.circuitBreakers);
// Output:
// {
//   razorpay: { state: 'CLOSED', metrics: { ... } },
//   payu: { state: 'OPEN', nextAttemptTime: '...' },
//   ccavenue: { state: 'CLOSED', metrics: { ... } }
// }

console.log('Retry Metrics:', stats.retry);
// Output:
// {
//   totalAttempts: 150,
//   successfulRetries: 45,
//   failedRetries: 5
// }
```

### Custom Error Handling

```javascript
const { ErrorClassifier, NetworkError } = require('./src/core/errors/payment-errors');

try {
  // Your code
} catch (error) {
  const classified = ErrorClassifier.classify(error, 'razorpay');
  
  if (classified.retryable) {
    console.log('This error can be retried');
  }
  
  if (classified.category === 'AUTHENTICATION') {
    // Handle authentication errors specially
    console.error('Check your API credentials');
  }
  
  // Send to monitoring/alerting
  if (classified.severity === 'CRITICAL') {
    sendAlert(classified);
  }
}
```

### Dynamic Configuration Updates

```javascript
// Update routing strategy at runtime
gateway.smartRouter.updateConfig({
  strategy: 'LATENCY_BASED',
  healthScoreThreshold: 70
});

// Reset circuit breaker
gateway.circuitBreakers.get('razorpay').reset();

// Reset health metrics
gateway.smartRouter.reset();
```

## Best Practices

### 1. Choose the Right Routing Strategy

- **High Volume**: Use `HEALTH_BASED` or `LATENCY_BASED`
- **Cost Sensitive**: Use `COST_OPTIMIZED`
- **Simple Distribution**: Use `ROUND_ROBIN`
- **Vendor Preference**: Use `PRIORITY`

### 2. Configure Appropriate Thresholds

- Set `failureThreshold` based on your traffic volume
- Use shorter `openTimeout` for high-traffic scenarios
- Adjust `healthScoreThreshold` based on SLA requirements

### 3. Monitor Gateway Health

- Regularly check gateway statistics
- Set up alerts for circuit breaker state changes
- Monitor retry metrics for optimization opportunities

### 4. Handle Errors Gracefully

- Always catch and handle payment errors
- Use error categories for appropriate user messaging
- Log errors with full context for debugging

### 5. Test Fallback Scenarios

- Simulate gateway failures in testing
- Verify fallback behavior
- Ensure proper error propagation

## Troubleshooting

### Circuit Breaker Stuck Open

**Symptoms**: Circuit breaker remains open even though service is healthy

**Solutions**:
- Check if `openTimeout` is too long
- Verify service is actually healthy
- Manually reset circuit breaker: `gateway.circuitBreakers.get('gateway-name').reset()`

### Too Many Retries

**Symptoms**: High retry counts, increased latency

**Solutions**:
- Reduce `maxAttempts`
- Increase `initialDelay` to space out retries
- Check if errors are actually retryable

### Fallback Not Working

**Symptoms**: Payment fails without trying fallback gateways

**Solutions**:
- Verify `fallbackEnabled: true`
- Check if fallback gateways meet `healthScoreThreshold`
- Ensure multiple gateways are configured

### Poor Gateway Selection

**Symptoms**: Requests going to slow/unhealthy gateways

**Solutions**:
- Switch to `HEALTH_BASED` strategy
- Lower `healthScoreThreshold`
- Check gateway health metrics

## Performance Impact

### Memory Usage

- Minimal: ~50-100 KB per gateway for health metrics
- Scales linearly with number of gateways

### CPU Usage

- Negligible: < 1% overhead for routing decisions
- Retry delays are non-blocking (async)

### Latency

- Circuit breaker: < 1ms overhead
- Retry logic: Only on failures (adds configured delay)
- Smart routing: < 1ms overhead
- Fallback: Adds latency only on primary failure

## Security Considerations

### Error Information

- Error messages don't expose sensitive data
- Gateway-specific details in metadata only
- Logs can be filtered for sensitive information

### Retry Attacks

- Exponential backoff prevents rapid retries
- Jitter prevents coordinated attacks
- Circuit breaker limits total retry attempts

### Gateway Credentials

- Store in environment variables
- Never log credentials
- Rotate regularly

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Gateway Health Scores**: Alert if below threshold
2. **Circuit Breaker States**: Alert on state transitions
3. **Retry Rates**: High retry rate indicates problems
4. **Fallback Usage**: High fallback rate indicates primary gateway issues
5. **Error Rates by Category**: Track error trends

### Recommended Alerts

- Circuit breaker transitions to OPEN
- Health score drops below 60
- Retry rate exceeds 20%
- All gateways marked UNHEALTHY
- Fallback rate exceeds 10%

## Migration Guide

### Existing Code

If you have existing payment processing code:

```javascript
// Old code
const result = await razorpayGateway.process(paymentData);
```

### Updated Code

```javascript
// New code - no changes required!
// The PaymentGateway class now handles:
// - Automatic retry on failures
// - Circuit breaker protection
// - Smart routing
// - Fallback to alternative gateways
const result = await gateway.processPayment(paymentData);
```

All existing code continues to work, with added resilience features automatically applied.

## Support

For issues or questions:
- Check troubleshooting section above
- Review configuration settings
- Check logs for detailed error information
- Contact support with transaction IDs and error details
