# PAPG (Payment Aggregator) - Code Trace Document

## Overview
**Payment Type**: Payment Aggregator / Smart Gateway Routing  
**Purpose**: Intelligent routing across multiple payment gateways with automatic failover  
**Entry Point**: PAPG Service API  
**Primary File**: `/src/papg/papg-service.js`

---

## Supported Payment Gateways
1. **Razorpay**
   - Priority: 1
   - Success Rate: 95.5%
   - Avg Response Time: 250ms
   - Cost per Transaction: ₹2.0

2. **PayU**
   - Priority: 2
   - Success Rate: 94.0%
   - Avg Response Time: 300ms
   - Cost per Transaction: ₹1.8

3. **CCAvenue**
   - Priority: 3
   - Success Rate: 93.0%
   - Avg Response Time: 350ms
   - Cost per Transaction: ₹2.2

---

## Key Features
- **Smart Routing**: Algorithm-based gateway selection
- **Automatic Failover**: Retry on different gateway if first fails
- **Load Balancing**: Distribute traffic based on performance
- **Circuit Breaker**: Temporarily disable failing gateways
- **Cost Optimization**: Route to lowest-cost gateway when possible
- **Real-time Metrics**: Update success rates and latency

---

## Execution Flow

### 1. INITIALIZE GATEWAYS
**Function**: `initializeGateways()`  
**Entry Point**: Service startup

#### Flow Steps:
1. **Gateway Configuration**
   - Initialize gateway instances
   - Store in gateways Map
   - Set initial metrics:
     - name, priority
     - successRate (historical)
     - avgResponseTime (ms)
     - costPerTransaction (₹)
     - isActive (true)

2. **Circuit Breaker Setup** (if implemented)
   - **Table**: `circuit_breakers`
   - Initialize circuit state: 'closed'
   - Set thresholds: failure_threshold, timeout

---

### 2. SELECT GATEWAY
**Function**: `selectGateway(transaction)`  
**Entry Point**: For every payment transaction

#### Flow Steps:
1. **Extract Transaction Details**
   - amount, paymentMethod, customerId, currency

2. **Apply Routing Rules** (Priority Order):

   **Rule 1: Amount-Based Routing**
   - If amount > ₹50,000 → Razorpay (highest reliability)
   
   **Rule 2: Payment Method Routing**
   - If paymentMethod = 'upi' → PayU (best UPI success rate)
   
   **Rule 3: Currency-Based Routing**
   - If currency ≠ 'INR' → Razorpay (international support)
   
   **Rule 4: Performance-Based Selection**
   - If no specific rule matches → `selectByPerformance()`

3. **Fallback Logic**
   - If selected gateway is inactive:
     - Select first active gateway from list
     - Default to Razorpay

4. **Response**
   - Returns: Gateway object {name, priority, successRate, avgResponseTime, costPerTransaction, isActive}

---

### 3. SELECT BY PERFORMANCE
**Function**: `selectByPerformance()`  
**Entry Point**: Called by `selectGateway()` for load balancing

#### Flow Steps:
1. **Filter Active Gateways**
   - Get all gateways where isActive = true

2. **Calculate Performance Score**
   - **Formula**: 
     ```
     score = (successRate × 0.5) + 
             ((1000 - avgResponseTime) / 1000 × 30) + 
             ((10 - costPerTransaction) / 10 × 20)
     ```
   - **Weights**:
     - Success Rate: 50%
     - Response Time: 30%
     - Cost: 20%

3. **Sort by Score**
   - Highest score first

4. **Response**
   - Returns: Best performing gateway

**Example Calculation**:
```
Razorpay:
  score = (95.5 × 0.5) + ((1000 - 250) / 1000 × 30) + ((10 - 2.0) / 10 × 20)
  score = 47.75 + 22.5 + 16.0 = 86.25

PayU:
  score = (94.0 × 0.5) + ((1000 - 300) / 1000 × 30) + ((10 - 1.8) / 10 × 20)
  score = 47.0 + 21.0 + 16.4 = 84.4

CCAvenue:
  score = (93.0 × 0.5) + ((1000 - 350) / 1000 × 30) + ((10 - 2.2) / 10 × 20)
  score = 46.5 + 19.5 + 15.6 = 81.6

Winner: Razorpay (86.25)
```

---

### 4. PROCESS PAYMENT WITH FAILOVER
**Function**: `processPayment(transaction)`  
**Entry Point**: Main payment processing entry point

#### Flow Steps:
1. **Initialize Retry Logic**
   - maxRetries = 2
   - attempt = 0
   - triedGateways = Set() (to avoid re-trying same gateway)
   - lastError = null

2. **Attempt Loop** (while attempt < maxRetries):

   **Step 1: Select Gateway**
   - Call `selectGateway(transaction)`
   - If gateway already tried:
     - Mark as inactive temporarily
     - Select another gateway
     - Increment attempt
     - Continue loop

   **Step 2: Record Attempt**
   - Add gateway.name to triedGateways Set

   **Step 3: Process via Gateway** (`processViaGateway`)
   - **Interface Point**: Gateway API
   - Record startTime
   - Call gateway payment API
   - **External System**: Razorpay/PayU/CCAvenue API
   - Simulate processing (wait avgResponseTime ms)
   - Simulate success/failure based on successRate
   
   **Success**:
   - Calculate responseTime = Date.now() - startTime
   - Update gateway metrics (`updateGatewayMetrics`)
   - Return: {transactionId, status: 'SUCCESS', responseTime}
   
   **Failure**:
   - Throw error
   - Catch error in loop
   - Update gateway metrics (failure)
   - Log failure
   - Increment attempt
   - Continue to next gateway

3. **Response**
   - **Success**: Returns {success: true, transactionId, gateway: gatewayName, amount, status, timestamp}
   - **Failure** (after max retries): Throw error "Payment failed after 2 attempts: {lastError}"

---

### 5. PROCESS VIA GATEWAY
**Function**: `processViaGateway(gateway, transaction)`  
**Entry Point**: Called by `processPayment()` for each attempt

#### Flow Steps:
1. **Record Start Time**
   - startTime = Date.now()

2. **Gateway API Call**
   - **Interface Point**: Gateway-specific API
   
   **Razorpay**:
   ```javascript
   POST https://api.razorpay.com/v1/payments
   {
     "amount": 100000, // in paise
     "currency": "INR",
     "order_id": "ORD_123",
     "customer": {...},
     "method": "card"
   }
   Response:
   {
     "id": "pay_razorpay_123",
     "status": "captured",
     "amount": 100000
   }
   ```
   
   **PayU**:
   ```javascript
   POST https://secure.payu.in/_payment
   {
     "key": "<merchant_key>",
     "txnid": "TXN_123",
     "amount": "1000.00",
     "productinfo": "Product",
     "firstname": "John",
     "email": "john@example.com"
   }
   Response:
   {
     "status": "success",
     "txnid": "TXN_123",
     "payuid": "payu_456"
   }
   ```
   
   **CCAvenue**:
   ```javascript
   POST https://secure.ccavenue.com/transaction/transaction.do
   {
     "merchant_id": "123",
     "order_id": "ORD_123",
     "amount": "1000.00",
     "currency": "INR",
     "redirect_url": "https://..."
   }
   Response:
   {
     "order_status": "Success",
     "tracking_id": "ccav_789"
   }
   ```

3. **Simulate Processing** (Mock)
   - Wait for gateway.avgResponseTime ms
   - Random success based on gateway.successRate
   - If random < successRate: Return success
   - Else: Throw error

4. **Response**
   - **Success**: {transactionId: `TXN_{gateway_name}_{timestamp}`, status: 'SUCCESS', responseTime}
   - **Failure**: Throw error "Gateway processing failed"

---

### 6. UPDATE GATEWAY METRICS
**Function**: `updateGatewayMetrics(gatewayName, success, responseTime)`  
**Entry Point**: After each payment attempt

#### Flow Steps:
1. **Retrieve Gateway**
   - Fetch gateway from gateways Map

2. **Update Success Rate** (Moving Average)
   - weight = 0.1 (10% weight to new data)
   - If success:
     - newSuccessRate = (gateway.successRate × 0.9) + (100 × 0.1)
   - Else:
     - newSuccessRate = (gateway.successRate × 0.9) + (0 × 0.1)
   - gateway.successRate = newSuccessRate

3. **Update Response Time** (Moving Average)
   - If success and responseTime > 0:
     - newAvgTime = (gateway.avgResponseTime × 0.9) + (responseTime × 0.1)
     - gateway.avgResponseTime = newAvgTime

4. **Update Failure Count** (for Circuit Breaker)
   - If failure:
     - gateway.consecutiveFailures++
     - If consecutiveFailures > threshold (e.g., 5):
       - gateway.isActive = false
       - Open circuit breaker
   - If success:
     - gateway.consecutiveFailures = 0

5. **Database Update** (if implemented)
   - **Table**: `gateway_metrics`
   - **Operation**: INSERT or UPDATE
   - Store: gatewayName, successRate, avgResponseTime, timestamp

---

## Smart Routing Algorithm

### Decision Tree:
```
Transaction → Check Amount
              ├─ > ₹50,000 → Razorpay (reliability)
              ├─ ≤ ₹50,000 → Check Payment Method
                             ├─ UPI → PayU (UPI optimized)
                             ├─ Other → Check Currency
                                        ├─ Foreign → Razorpay (intl support)
                                        ├─ INR → Performance-Based Selection
                                                  ├─ Calculate scores
                                                  ├─ Select highest score
                                                  └─ Return gateway
```

---

## Circuit Breaker Pattern

### States:
1. **CLOSED** (Normal operation)
   - All requests pass through
   - Track failure rate

2. **OPEN** (Gateway failing)
   - Block all requests to this gateway
   - Return error immediately
   - After timeout (e.g., 60 seconds), transition to HALF_OPEN

3. **HALF_OPEN** (Testing recovery)
   - Allow limited requests through (e.g., 1)
   - If success: Transition to CLOSED
   - If failure: Transition back to OPEN

### Implementation:
```javascript
if (gateway.state === 'OPEN') {
  if (Date.now() > gateway.openUntil) {
    gateway.state = 'HALF_OPEN';
  } else {
    throw new Error('Circuit breaker open');
  }
}

if (gateway.state === 'HALF_OPEN') {
  try {
    result = await processPayment();
    gateway.state = 'CLOSED';
    gateway.failureCount = 0;
  } catch (error) {
    gateway.state = 'OPEN';
    gateway.openUntil = Date.now() + 60000; // 60 seconds
  }
}
```

---

## External System Interfaces

### 1. Razorpay API
**Base URL**: `https://api.razorpay.com/v1/`  
**Auth**: Basic Auth (key_id:key_secret)

**Create Order**:
```json
POST /orders
{
  "amount": 100000,
  "currency": "INR",
  "receipt": "ORD_123"
}
```

**Capture Payment**:
```json
POST /payments/{paymentId}/capture
{
  "amount": 100000
}
```

---

### 2. PayU API
**Base URL**: `https://secure.payu.in/`  
**Auth**: Merchant Key + Hash

**Initiate Payment**:
```
POST /_payment
key={merchant_key}
txnid={transaction_id}
amount={amount}
productinfo={product}
firstname={name}
email={email}
phone={phone}
surl={success_url}
furl={failure_url}
hash={calculated_hash}
```

**Hash Calculation**:
```
hash = sha512(key|txnid|amount|productinfo|firstname|email|||||||||||salt)
```

---

### 3. CCAvenue API
**Base URL**: `https://secure.ccavenue.com/transaction/`  
**Auth**: Merchant ID + Working Key (encryption)

**Initiate Payment**:
```
POST transaction.do
merchant_id={merchant_id}
order_id={order_id}
amount={amount}
currency=INR
redirect_url={redirect_url}
cancel_url={cancel_url}
language=EN
billing_name={name}
billing_email={email}
```

**Encryption**: AES-128-CBC with merchant working key

---

## Database Tables & Operations

### 1. circuit_breakers
**Purpose**: Track gateway circuit breaker state

**Schema**:
```sql
- id (UUID)
- gateway_name (VARCHAR, unique)
- state (ENUM: closed, open, half_open)
- failure_count (INT)
- failure_threshold (INT) - Default: 5
- timeout_seconds (INT) - Default: 60
- last_failure_at (TIMESTAMP)
- last_success_at (TIMESTAMP)
- created_at, updated_at (TIMESTAMP)
```

**Operations**:
- **SELECT**: Check circuit state before routing
- **UPDATE**: Update state after payment attempt

---

### 2. gateway_metrics
**Purpose**: Historical gateway performance data

**Schema**:
```sql
- id (UUID)
- gateway_name (VARCHAR, indexed)
- success_rate (DECIMAL) - Percentage
- avg_response_time (INT) - Milliseconds
- total_transactions (BIGINT)
- successful_transactions (BIGINT)
- failed_transactions (BIGINT)
- total_amount (DECIMAL)
- date (DATE, indexed)
- created_at, updated_at (TIMESTAMP)

INDEX: (gateway_name, date)
```

**Operations**:
- **INSERT**: Daily aggregated metrics
- **SELECT**: Historical performance analysis

---

### 3. gateway_routing_logs
**Purpose**: Audit log of routing decisions

**Schema**:
```sql
- id (UUID)
- transaction_id (VARCHAR)
- selected_gateway (VARCHAR)
- routing_reason (VARCHAR) - amount_based, method_based, performance_based
- attempted_gateways (JSONB) - Array of tried gateways
- success (BOOLEAN)
- response_time (INT)
- created_at (TIMESTAMP)

INDEX: (transaction_id)
INDEX: (created_at)
```

**Operations**:
- **INSERT**: Log every routing decision
- **SELECT**: Analyze routing effectiveness

---

## Gateway Selection Rules

### Priority Matrix:

| Condition | Selected Gateway | Reason |
|-----------|-----------------|---------|
| Amount > ₹50,000 | Razorpay | Highest reliability for large amounts |
| Payment Method = UPI | PayU | Best UPI success rate |
| Currency ≠ INR | Razorpay | International payment support |
| High Traffic | Performance-Based | Load balancing |
| Gateway Down | Next Active | Automatic failover |

---

## Error Handling

### Common Errors:
1. **All gateways down**: All gateways inactive or circuit open
2. **Payment failed after retries**: All attempted gateways failed
3. **Gateway timeout**: Response time > threshold
4. **Invalid gateway configuration**: Missing API keys

### Retry Logic:
- **Max Retries**: 2 attempts
- **Retry on Different Gateway**: Yes (automatic failover)
- **Backoff**: None (immediate retry on different gateway)
- **Circuit Breaker**: Auto-disable failing gateways

---

## Monitoring & Analytics

### Key Metrics:
- **Gateway Success Rates**: Track per gateway
- **Average Response Times**: Per gateway latency
- **Cost per Gateway**: Total transaction costs
- **Failover Rate**: % of transactions requiring failover
- **Circuit Breaker Events**: Frequency of circuit opens
- **Transaction Distribution**: % of traffic per gateway

### Real-time Dashboard:
- Gateway health status (green/yellow/red)
- Success rate trend (last 24 hours)
- Average latency trend
- Cost comparison
- Active circuit breakers

### Logs:
- Gateway selected: `transactionId, gateway, reason`
- Payment attempt: `transactionId, gateway, success, responseTime`
- Failover: `transactionId, fromGateway, toGateway`
- Circuit breaker event: `gateway, state, timestamp`

---

## Configuration Requirements

```javascript
{
  gateways: {
    razorpay: {
      keyId: '<razorpay_key_id>',
      keySecret: '<razorpay_key_secret>',
      webhookSecret: '<razorpay_webhook_secret>',
      baseUrl: 'https://api.razorpay.com/v1/'
    },
    payu: {
      merchantKey: '<payu_merchant_key>',
      salt: '<payu_salt>',
      baseUrl: 'https://secure.payu.in/'
    },
    ccavenue: {
      merchantId: '<ccavenue_merchant_id>',
      workingKey: '<ccavenue_working_key>',
      accessCode: '<ccavenue_access_code>',
      baseUrl: 'https://secure.ccavenue.com/transaction/'
    }
  },
  routing: {
    largeAmountThreshold: 50000,
    preferredUPIGateway: 'payu',
    preferredInternationalGateway: 'razorpay'
  },
  circuitBreaker: {
    failureThreshold: 5,
    timeout: 60, // seconds
    halfOpenRequests: 1
  },
  maxRetries: 2
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - Uses PAPG for gateway selection

2. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Records gateway fees

3. **Monitoring Service**
   - Real-time gateway health monitoring

---

## API Endpoints (Internal - Not Exposed)

PAPG is an internal service used by other payment services. No direct API endpoints.

**Usage Example**:
```javascript
const papgService = new PAPGService(config);
const result = await papgService.processPayment({
  amount: 1000,
  paymentMethod: 'upi',
  orderId: 'ORD_123',
  customerId: 'CUST_001'
});
// Returns: { success: true, transactionId, gateway: 'payu', ... }
```

---

## Benefits of Payment Aggregation

1. **High Availability**: Automatic failover ensures 99.9% uptime
2. **Cost Optimization**: Route to lowest-cost gateway
3. **Performance**: Select fastest gateway for each transaction
4. **Risk Mitigation**: Diversify across multiple gateways
5. **Vendor Independence**: Easy to add/remove gateways
6. **A/B Testing**: Test new gateways with percentage of traffic

---

## Future Enhancements

1. **Machine Learning**: Predictive gateway selection based on historical data
2. **Geographic Routing**: Select gateway based on customer location
3. **Time-based Routing**: Route based on time of day (gateway performance patterns)
4. **Merchant-specific Rules**: Custom routing per merchant
5. **Dynamic Cost Adjustment**: Real-time cost negotiation with gateways
