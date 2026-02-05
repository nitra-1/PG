# Payment Gateway Smart Routing System Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Routing Strategies](#routing-strategies)
5. [Health Tracking System](#health-tracking-system)
6. [Fallback Mechanism](#fallback-mechanism)
7. [Usage Examples](#usage-examples)
8. [Configuration](#configuration)
9. [Best Practices](#best-practices)

---

## Overview

The Payment Gateway Smart Routing System is a sophisticated routing layer that intelligently directs payment transactions to the optimal payment gateway based on various factors including gateway health, performance metrics, cost, and business rules.

### Key Features
- **Multiple Routing Strategies**: Health-based, round-robin, cost-optimized, latency-based, and priority-based routing
- **Real-time Health Monitoring**: Continuous monitoring of gateway health and performance
- **Automatic Fallback**: Seamless failover to backup gateways when primary gateway fails
- **Performance Metrics**: Tracks success rates, response times, and health scores
- **Flexible Configuration**: Highly configurable to meet diverse business requirements

### Problem Statement
In a multi-gateway payment system, businesses need to:
- Maximize transaction success rates
- Minimize transaction costs
- Reduce latency and improve user experience
- Ensure high availability through redundancy
- Handle gateway failures gracefully

The Smart Routing System addresses these challenges by providing an intelligent routing layer that makes real-time decisions based on gateway health and performance.

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Payment Request                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Smart Router                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Routing Strategy Selection                          │    │
│  │ - Health-based    - Cost-optimized                  │    │
│  │ - Round-robin     - Latency-based                   │    │
│  │ - Priority-based                                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │      Gateway Health Tracker                         │    │
│  │  - Success/Failure Tracking                         │    │
│  │  - Response Time Monitoring                         │    │
│  │  - Health Score Calculation                         │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────┐           ┌─────────────────┐
│   Gateway A     │           │   Gateway B     │
│  (Razorpay)     │           │    (PayU)       │
└─────────────────┘           └─────────────────┘
         │                               │
         │      Transaction Result       │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  Health Metrics Update        │
         │  - Record Success/Failure     │
         │  - Update Response Times      │
         │  - Recalculate Health Score   │
         └───────────────────────────────┘
```

### Data Flow

1. **Request Reception**: Payment request arrives at the Smart Router
2. **Strategy Selection**: Router selects routing strategy based on configuration
3. **Health Check**: Consults Gateway Health Tracker for current gateway status
4. **Gateway Selection**: Applies routing algorithm to select optimal gateway
5. **Transaction Execution**: Routes transaction to selected gateway
6. **Result Recording**: Records transaction outcome and updates health metrics
7. **Fallback (if needed)**: If primary gateway fails, automatically selects fallback gateway

---

## Core Components

### 1. Smart Router (`smart-router.js`)

The Smart Router is the central component that orchestrates the routing process.

#### Key Responsibilities:
- Gateway selection based on configured strategy
- Managing fallback logic
- Recording transaction outcomes
- Maintaining routing statistics

#### Main Methods:
- `selectGateway(paymentData, excludeGateways)`: Selects optimal gateway for transaction
- `getFallbackGateways(primaryGateway, attemptedGateways)`: Returns list of fallback gateways
- `recordSuccess(gatewayName, responseTime)`: Records successful transaction
- `recordFailure(gatewayName, responseTime)`: Records failed transaction
- `getStatistics()`: Returns routing statistics
- `updateConfig(newConfig)`: Updates router configuration

### 2. Gateway Health Tracker (`gateway-health-tracker.js`)

Monitors and tracks the health and performance of all registered payment gateways.

#### Key Responsibilities:
- Track success and failure counts
- Monitor response times
- Calculate health scores
- Determine gateway status (HEALTHY, DEGRADED, UNHEALTHY)

#### Health Metrics:
- **Success Rate**: Ratio of successful to total requests
- **Average Response Time**: Mean response time of recent requests
- **P95 Response Time**: 95th percentile response time
- **Health Score**: Composite score (0-100) based on success rate and response time
- **Status**: Current health status of gateway

#### Health Score Calculation:
```
Health Score = (Success Rate × 70) + (Response Time Score × 30)

Where:
- Success Rate: 0.0 to 1.0 (contributes 70% to total score)
- Response Time Score: 
  - 30 points for < 1 second
  - 0 points for > 5 seconds
  - Linear scale between 1s and 5s
```

#### Health Status Thresholds:
- **HEALTHY**: Success rate ≥ 95% AND Average response time < 2s
- **DEGRADED**: Success rate ≥ 80% AND Average response time < 5s
- **UNHEALTHY**: Success rate < 80% OR Average response time ≥ 5s

---

## Routing Strategies

The Smart Router supports five distinct routing strategies:

### 1. Health-Based Routing (Default)

Routes transactions to the healthiest available gateway.

**Algorithm:**
1. Get all available gateways
2. Sort gateways by health score (descending)
3. Filter gateways above health score threshold
4. Select gateway with highest health score

**Best For:**
- Maximizing transaction success rates
- Production environments with variable gateway performance
- Scenarios where reliability is paramount

**Example:**
```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.HEALTH_BASED,
  healthScoreThreshold: 70,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue']
});
```

### 2. Round-Robin Routing

Distributes transactions evenly across all available gateways.

**Algorithm:**
1. Maintain a counter (roundRobinIndex)
2. Select gateway at current index position
3. Increment counter for next request
4. Wrap around when counter exceeds available gateways

**Best For:**
- Load balancing across gateways
- Distributing gateway processing fees
- Testing and monitoring all gateways equally

**Example:**
```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.ROUND_ROBIN,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue']
});
```

**Behavior:**
```
Request 1 → razorpay
Request 2 → payu
Request 3 → ccavenue
Request 4 → razorpay (cycle repeats)
```

### 3. Cost-Optimized Routing

Routes transactions to the gateway with the lowest processing cost.

**Algorithm:**
1. Calculate cost for each available gateway
2. Cost = Fixed Fee + (Amount × Percentage Fee / 100)
3. Select gateway with minimum total cost

**Best For:**
- High-volume, low-margin businesses
- Cost-sensitive operations
- Optimizing profitability

**Example:**
```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.COST_OPTIMIZED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue'],
  gatewayCosts: {
    razorpay: { fixedFee: 0, percentageFee: 2.0 },
    payu: { fixedFee: 0, percentageFee: 1.5 },
    ccavenue: { fixedFee: 5, percentageFee: 1.8 }
  }
});
```

**Cost Calculation Example:**
```
Transaction Amount: ₹1,000

Razorpay:  0 + (1000 × 2.0 / 100) = ₹20.00
PayU:      0 + (1000 × 1.5 / 100) = ₹15.00  ← Selected
CCAvenue:  5 + (1000 × 1.8 / 100) = ₹23.00
```

### 4. Latency-Based Routing

Routes transactions to the gateway with the lowest average response time.

**Algorithm:**
1. Get average response time for each available gateway
2. Select gateway with minimum average response time

**Best For:**
- User experience optimization
- Time-sensitive transactions
- Low-latency requirements

**Example:**
```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.LATENCY_BASED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue']
});
```

### 5. Priority-Based Routing

Routes transactions to gateways in a predefined priority order.

**Algorithm:**
1. Iterate through gateways in priority order
2. Check if gateway health score meets threshold
3. Select first gateway that meets health criteria
4. If no gateway meets threshold, fall back to health-based selection

**Best For:**
- Business relationships (preferred partners)
- Contract obligations
- Strategic gateway preferences

**Example:**
```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.PRIORITY,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue'], // Priority order
  healthScoreThreshold: 50
});
```

---

## Health Tracking System

### How Health Tracking Works

The Gateway Health Tracker maintains a continuous record of each gateway's performance:

1. **Request Recording**: Every transaction outcome is recorded
   - Success: `recordSuccess(gatewayName, responseTime)`
   - Failure: `recordFailure(gatewayName, responseTime)`

2. **Metrics Storage**: Maintains rolling window of recent metrics
   - Last 100 response times
   - Total success/failure counts
   - Timestamps of last request, success, and failure

3. **Score Calculation**: Continuously updates health score
   - Weighted combination of success rate (70%) and response time (30%)
   - Real-time status updates (HEALTHY, DEGRADED, UNHEALTHY)

4. **Status Updates**: Automatic status transitions based on metrics
   - Immediate response to performance changes
   - Prevents routing to unhealthy gateways

### Health Score Components

#### Success Rate Component (70% weight)
```
Success Rate = Success Count / Total Requests
Score Contribution = Success Rate × 70

Examples:
- 100% success rate = 70 points
- 95% success rate = 66.5 points
- 80% success rate = 56 points
```

#### Response Time Component (30% weight)
```
For response time < 1000ms: 30 points
For response time > 5000ms: 0 points
For response time between: Linear interpolation

Formula:
Score = max(0, 30 - ((responseTime - 1000) / 4000) × 30)

Examples:
- 500ms response time = 30 points
- 1000ms response time = 30 points
- 3000ms response time = 15 points
- 5000ms response time = 0 points
```

### Monitoring and Observability

The health tracking system provides rich metrics for monitoring:

```javascript
// Get health for specific gateway
const health = tracker.getGatewayHealth('razorpay');
console.log(health);
// {
//   gatewayName: 'razorpay',
//   status: 'HEALTHY',
//   healthScore: 92,
//   successRate: 0.97,
//   totalRequests: 1000,
//   successCount: 970,
//   failureCount: 30,
//   averageResponseTime: 650,
//   p95ResponseTime: 1200,
//   lastRequestTime: 1620000000000,
//   lastSuccessTime: 1620000000000,
//   lastFailureTime: 1619999000000
// }

// Get all gateways sorted by health
const gateways = tracker.getGatewaysByHealth();
// [
//   { name: 'razorpay', healthScore: 92, status: 'HEALTHY', ... },
//   { name: 'payu', healthScore: 85, status: 'HEALTHY', ... },
//   { name: 'ccavenue', healthScore: 45, status: 'UNHEALTHY', ... }
// ]
```

---

## Fallback Mechanism

The fallback mechanism ensures high availability by automatically routing failed transactions to alternative gateways.

### How Fallback Works

```
┌─────────────────┐
│ Select Primary  │
│    Gateway      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      Success     ┌─────────────┐
│  Process with   │─────────────────▶│   Complete  │
│ Primary Gateway │                   └─────────────┘
└────────┬────────┘
         │ Failure
         ▼
┌─────────────────┐
│  Get Fallback   │
│    Gateways     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Exclude:       │
│  - Primary      │
│  - Already      │
│    Attempted    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Sort by Health │
│  Filter > Threshold │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      Success     ┌─────────────┐
│  Retry with     │─────────────────▶│   Complete  │
│ Fallback #1     │                   └─────────────┘
└────────┬────────┘
         │ Failure
         ▼
┌─────────────────┐
│  Retry with     │
│ Fallback #2     │
└────────┬────────┘
         │
         ▼
   (Continue up to maxFallbackAttempts)
```

### Configuration

```javascript
const router = new SmartRouter({
  fallbackEnabled: true,           // Enable automatic fallback
  maxFallbackAttempts: 3,          // Maximum number of fallback attempts
  healthScoreThreshold: 50,        // Minimum health score for fallback gateways
  gatewayPriority: ['razorpay', 'payu', 'ccavenue', 'stripe']
});
```

### Usage Example

```javascript
// Attempt payment with automatic fallback
async function processPaymentWithFallback(paymentData) {
  const attemptedGateways = [];
  let lastError = null;

  // Try primary gateway
  const primaryGateway = router.selectGateway(paymentData);
  try {
    const result = await processPayment(primaryGateway, paymentData);
    router.recordSuccess(primaryGateway, result.responseTime);
    return result;
  } catch (error) {
    router.recordFailure(primaryGateway);
    attemptedGateways.push(primaryGateway);
    lastError = error;
  }

  // Try fallback gateways
  const fallbackGateways = router.getFallbackGateways(primaryGateway, attemptedGateways);
  
  for (const gateway of fallbackGateways) {
    try {
      const result = await processPayment(gateway, paymentData);
      router.recordSuccess(gateway, result.responseTime);
      return result;
    } catch (error) {
      router.recordFailure(gateway);
      attemptedGateways.push(gateway);
      lastError = error;
    }
  }

  // All gateways failed
  throw new Error(`Payment failed on all gateways: ${lastError.message}`);
}
```

### Fallback Gateway Selection

Fallback gateways are selected based on:
1. **Health Score**: Only gateways above `healthScoreThreshold` are considered
2. **Exclusions**: Primary and already-attempted gateways are excluded
3. **Ordering**: Sorted by health score (descending)
4. **Limit**: Limited to `maxFallbackAttempts` gateways

**Example:**
```javascript
// Scenario:
// - Primary gateway: razorpay (failed)
// - Already attempted: payu (failed)
// - Available: ccavenue (health: 85), stripe (health: 75), paypal (health: 45)
// - Health threshold: 50
// - Max attempts: 2

const fallbacks = router.getFallbackGateways('razorpay', ['payu']);
// Returns: ['ccavenue', 'stripe']
// Note: paypal excluded due to low health score (45 < 50)
```

---

## Usage Examples

### Basic Usage

```javascript
const { SmartRouter, RoutingStrategy } = require('./smart-router');

// Initialize router
const router = new SmartRouter({
  strategy: RoutingStrategy.HEALTH_BASED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue']
});

// Select gateway for payment
const gateway = router.selectGateway({
  amount: 1000,
  currency: 'INR',
  method: 'card'
});

console.log(`Selected gateway: ${gateway}`);
```

### Processing Payment with Health Recording

```javascript
async function processPayment(paymentData) {
  const startTime = Date.now();
  
  // Select optimal gateway
  const gateway = router.selectGateway(paymentData);
  
  try {
    // Process payment
    const result = await gatewayClient[gateway].processPayment(paymentData);
    
    // Record success
    const responseTime = Date.now() - startTime;
    router.recordSuccess(gateway, responseTime);
    
    return { success: true, gateway, result };
  } catch (error) {
    // Record failure
    const responseTime = Date.now() - startTime;
    router.recordFailure(gateway, responseTime);
    
    throw error;
  }
}
```

### Switching Strategies Dynamically

```javascript
// Start with health-based routing
router.updateConfig({ strategy: RoutingStrategy.HEALTH_BASED });

// During peak hours, switch to round-robin for load distribution
router.updateConfig({ strategy: RoutingStrategy.ROUND_ROBIN });

// For high-value transactions, switch to latency-based
if (paymentData.amount > 10000) {
  router.updateConfig({ strategy: RoutingStrategy.LATENCY_BASED });
}

const gateway = router.selectGateway(paymentData);
```

### Monitoring Gateway Health

```javascript
// Get real-time statistics
const stats = router.getStatistics();
console.log('Current Strategy:', stats.strategy);
console.log('Fallback Enabled:', stats.fallbackEnabled);

// Monitor specific gateway
const razorpayHealth = stats.gatewayHealth.razorpay;
console.log(`Razorpay Health Score: ${razorpayHealth.healthScore}`);
console.log(`Success Rate: ${(razorpayHealth.successRate * 100).toFixed(2)}%`);
console.log(`Avg Response Time: ${razorpayHealth.averageResponseTime}ms`);

// Alert on unhealthy gateways
Object.values(stats.gatewayHealth).forEach(health => {
  if (health.status === 'UNHEALTHY') {
    console.error(`⚠️  Gateway ${health.gatewayName} is UNHEALTHY!`);
    // Trigger alert to operations team
  }
});
```

### Custom Cost Optimization

```javascript
const router = new SmartRouter({
  strategy: RoutingStrategy.COST_OPTIMIZED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue'],
  gatewayCosts: {
    razorpay: {
      fixedFee: 0,
      percentageFee: 2.0
    },
    payu: {
      fixedFee: 0,
      percentageFee: 1.8
    },
    ccavenue: {
      fixedFee: 10,
      percentageFee: 1.5
    }
  }
});

// For small transactions, PayU will likely be selected (lower %)
const gateway1 = router.selectGateway({ amount: 100 });

// For large transactions, CCAvenue might be selected despite fixed fee
const gateway2 = router.selectGateway({ amount: 10000 });
```

---

## Configuration

### Complete Configuration Reference

```javascript
const router = new SmartRouter({
  // Routing Strategy
  strategy: RoutingStrategy.HEALTH_BASED,
  // Options: HEALTH_BASED, ROUND_ROBIN, COST_OPTIMIZED, 
  //          LATENCY_BASED, PRIORITY

  // Gateway Configuration
  gatewayPriority: ['razorpay', 'payu', 'ccavenue'],
  // Ordered list of available gateways

  // Fallback Configuration
  fallbackEnabled: true,
  // Enable/disable automatic fallback (default: true)
  
  maxFallbackAttempts: 3,
  // Maximum number of fallback attempts (default: 3)

  // Health Configuration
  healthScoreThreshold: 50,
  // Minimum health score for gateway selection (default: 50)
  // Range: 0-100

  // Cost Configuration (for COST_OPTIMIZED strategy)
  gatewayCosts: {
    razorpay: {
      fixedFee: 0,        // Fixed fee per transaction
      percentageFee: 2.0  // Percentage of transaction amount
    },
    payu: {
      fixedFee: 0,
      percentageFee: 1.5
    }
  }
});
```

### Environment-Specific Configurations

#### Development Environment
```javascript
const devConfig = {
  strategy: RoutingStrategy.ROUND_ROBIN,
  gatewayPriority: ['sandbox-razorpay', 'sandbox-payu'],
  fallbackEnabled: true,
  maxFallbackAttempts: 2,
  healthScoreThreshold: 30  // Lower threshold for testing
};
```

#### Production Environment
```javascript
const prodConfig = {
  strategy: RoutingStrategy.HEALTH_BASED,
  gatewayPriority: ['razorpay', 'payu', 'ccavenue', 'stripe'],
  fallbackEnabled: true,
  maxFallbackAttempts: 3,
  healthScoreThreshold: 70  // Higher threshold for reliability
};
```

#### High-Volume Production
```javascript
const highVolumeConfig = {
  strategy: RoutingStrategy.COST_OPTIMIZED,
  gatewayPriority: ['payu', 'razorpay', 'ccavenue'],
  fallbackEnabled: true,
  maxFallbackAttempts: 4,
  healthScoreThreshold: 50,
  gatewayCosts: {
    payu: { fixedFee: 0, percentageFee: 1.5 },
    razorpay: { fixedFee: 0, percentageFee: 2.0 },
    ccavenue: { fixedFee: 10, percentageFee: 1.3 }
  }
};
```

---

## Best Practices

### 1. Strategy Selection

**Choose the right strategy for your use case:**

- **HEALTH_BASED**: Default choice for most production scenarios
  - Maximizes reliability and success rates
  - Automatically avoids problematic gateways
  - Recommended for general-purpose payment processing

- **ROUND_ROBIN**: Use when you need even distribution
  - Load balancing across gateways
  - Testing and comparison
  - Meeting contractual obligations for minimum volume

- **COST_OPTIMIZED**: Use for cost-sensitive operations
  - High-volume, low-margin businesses
  - Significant cost differences between gateways
  - Profitability optimization

- **LATENCY_BASED**: Use when speed is critical
  - Real-time user experience requirements
  - Time-sensitive transactions
  - Mobile or API integrations

- **PRIORITY**: Use for business relationships
  - Preferred partner gateways
  - Contractual obligations
  - Strategic gateway preferences

### 2. Health Score Thresholds

**Set appropriate thresholds based on requirements:**

- **70-100**: Strict reliability requirements
  - Financial services
  - High-value transactions
  - Production environments

- **50-70**: Balanced approach
  - Standard e-commerce
  - Most production scenarios
  - Default recommendation

- **30-50**: Permissive thresholds
  - Development/testing
  - High-availability requirements
  - Fallback scenarios

### 3. Fallback Configuration

**Configure fallback appropriately:**

```javascript
// Recommended production settings
{
  fallbackEnabled: true,           // Always enable in production
  maxFallbackAttempts: 2-3,        // Balance between reliability and latency
  healthScoreThreshold: 50-70      // Only use healthy fallbacks
}

// High-availability scenario
{
  fallbackEnabled: true,
  maxFallbackAttempts: 4-5,        // More attempts for critical operations
  healthScoreThreshold: 30         // Lower threshold to maximize options
}
```

### 4. Monitoring and Alerting

**Implement comprehensive monitoring:**

```javascript
// Regular health checks
setInterval(() => {
  const stats = router.getStatistics();
  
  Object.entries(stats.gatewayHealth).forEach(([name, health]) => {
    // Alert on unhealthy gateways
    if (health.status === 'UNHEALTHY') {
      alertOps(`Gateway ${name} is UNHEALTHY`, health);
    }
    
    // Warn on degraded performance
    if (health.status === 'DEGRADED') {
      warnOps(`Gateway ${name} is DEGRADED`, health);
    }
    
    // Log metrics for analysis
    logMetrics(name, health);
  });
}, 60000); // Check every minute
```

### 5. Gradual Rollout

**When deploying new gateways:**

1. Add gateway to priority list with low priority
2. Monitor performance for 24-48 hours
3. Gradually increase priority based on performance
4. Adjust cost configuration as needed

```javascript
// Initial deployment
gatewayPriority: ['razorpay', 'payu', 'new-gateway']

// After monitoring (if performing well)
gatewayPriority: ['razorpay', 'new-gateway', 'payu']
```

### 6. Testing Strategies

**Test routing thoroughly:**

```javascript
// Test all strategies
const strategies = [
  RoutingStrategy.HEALTH_BASED,
  RoutingStrategy.ROUND_ROBIN,
  RoutingStrategy.COST_OPTIMIZED,
  RoutingStrategy.LATENCY_BASED,
  RoutingStrategy.PRIORITY
];

strategies.forEach(strategy => {
  router.updateConfig({ strategy });
  const gateway = router.selectGateway(testPayment);
  console.log(`${strategy}: Selected ${gateway}`);
});

// Simulate failures
router.recordFailure('razorpay', 3000);
router.recordFailure('razorpay', 3500);
const fallbacks = router.getFallbackGateways('razorpay');
console.log('Fallback gateways:', fallbacks);
```

### 7. Performance Optimization

**Optimize for performance:**

- Reset metrics periodically to prevent memory growth:
  ```javascript
  // Reset daily to clear old metrics
  setInterval(() => {
    router.reset();
  }, 24 * 60 * 60 * 1000);
  ```

- Use gateway exclusion to avoid known issues:
  ```javascript
  // Exclude gateway during maintenance
  const gateway = router.selectGateway(paymentData, ['razorpay-maintenance']);
  ```

- Cache routing decisions for similar transactions:
  ```javascript
  const routingCache = new Map();
  const cacheKey = `${amount}_${currency}_${method}`;
  
  let gateway = routingCache.get(cacheKey);
  if (!gateway) {
    gateway = router.selectGateway(paymentData);
    routingCache.set(cacheKey, gateway);
    setTimeout(() => routingCache.delete(cacheKey), 5000); // Cache for 5s
  }
  ```

### 8. Security Considerations

**Ensure secure routing:**

- Validate payment data before routing
- Log routing decisions for audit trail
- Implement rate limiting per gateway
- Monitor for unusual patterns
- Secure configuration storage
- Use environment variables for sensitive data

### 9. Error Handling

**Robust error handling:**

```javascript
async function robustPaymentProcessing(paymentData) {
  try {
    const gateway = router.selectGateway(paymentData);
    
    if (!gateway) {
      throw new Error('No available gateway for routing');
    }
    
    const result = await processWithTimeout(gateway, paymentData, 30000);
    router.recordSuccess(gateway, result.responseTime);
    return result;
    
  } catch (error) {
    // Log error with context
    logger.error('Payment routing failed', {
      error: error.message,
      paymentData: sanitize(paymentData),
      routerStats: router.getStatistics()
    });
    
    // Attempt recovery if possible
    if (error.code === 'TIMEOUT') {
      // Try with different gateway
      return await retryWithFallback(paymentData);
    }
    
    throw error;
  }
}
```

### 10. Documentation and Team Training

**Maintain clear documentation:**

- Document routing decisions and rationale
- Train team on strategy selection
- Maintain runbooks for common issues
- Regular reviews of routing performance
- Share insights from routing analytics

---

## Troubleshooting Guide

### Issue: All gateways showing as UNHEALTHY

**Possible Causes:**
- Network connectivity issues
- Incorrect gateway credentials
- Gateway API endpoints down
- Health score threshold too high

**Solutions:**
1. Check network connectivity
2. Verify gateway credentials and API endpoints
3. Lower `healthScoreThreshold` temporarily
4. Check gateway status pages
5. Review recent failure logs

### Issue: Routing always selects same gateway

**Possible Causes:**
- Not using ROUND_ROBIN strategy
- Other gateways have low health scores
- Incorrect priority configuration

**Solutions:**
1. Switch to ROUND_ROBIN if even distribution desired
2. Check health scores of all gateways
3. Reset router to clear old metrics
4. Verify gatewayPriority configuration

### Issue: Excessive fallback attempts

**Possible Causes:**
- Primary gateways frequently failing
- Health scores below threshold
- Network instability

**Solutions:**
1. Investigate why primary gateways are failing
2. Review and adjust health score calculation
3. Lower `healthScoreThreshold` if too restrictive
4. Reduce `maxFallbackAttempts` to limit cascading failures

### Issue: High latency in routing decisions

**Possible Causes:**
- Complex routing strategy
- Large number of gateways
- Inefficient health tracking

**Solutions:**
1. Use simpler strategy (ROUND_ROBIN or PRIORITY)
2. Reduce number of tracked gateways
3. Limit response time history size
4. Implement caching for similar transactions

---

## Conclusion

The Payment Gateway Smart Routing System provides a robust, flexible, and intelligent solution for managing multiple payment gateways. By leveraging real-time health monitoring, multiple routing strategies, and automatic fallback mechanisms, it ensures high availability, optimal performance, and cost efficiency.

Key takeaways:
- Choose routing strategy based on business requirements
- Monitor gateway health continuously
- Configure appropriate thresholds and fallback settings
- Test thoroughly in staging before production deployment
- Maintain comprehensive logging and monitoring

For questions or support, please contact the development team or refer to the source code in `/src/core/routing/`.

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-05  
**Maintained By:** Payment Gateway Team
