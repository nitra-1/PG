# PayIn (Collections) - Code Trace Document

## Overview
**Payment Type**: PayIn (Collections)  
**Purpose**: Customer payment collection through various payment methods (card, UPI, netbanking, wallet)  
**Entry Point**: PayIn Service API  
**Primary File**: `/src/payin/payin-service.js`

---

## Execution Flow

### 1. CREATE PAYMENT ORDER
**Function**: `createPaymentOrder(orderData)`  
**Entry Point**: Merchant API call to create payment order

#### Flow Steps:
1. **Validation** (`validateOrderData`)
   - Check required fields: amount, customerId, customerEmail
   - Validate amount > 0
   - Validate email format using regex

2. **Order Creation**
   - Generate orderId: `ORD_{timestamp}`
   - Set default currency: INR
   - Set payment methods: ['card', 'upi', 'netbanking', 'wallet']
   - Set expiry: 30 minutes from creation
   - Status: 'CREATED'

3. **Database Operations** (`storeOrder`)
   - **Table**: `payment_orders`
   - **Operation**: INSERT
   - **Fields**:
     - order_id, amount, currency, status
     - customer_id, customer_email, customer_phone
     - payment_method, callback_url
     - metadata (JSON: description, paymentMethods)
     - expires_at (30 min expiry)
   - **Multi-tenancy**: Uses `tenant_id` from config

4. **Response**
   - Returns: orderId, amount, currency, status, paymentMethods, expiryTime

---

### 2. PROCESS PAYMENT
**Function**: `processPayment(paymentData)`  
**Entry Point**: Customer completes payment on checkout page

#### Flow Steps:
1. **Order Retrieval** (`getOrder`)
   - Fetch order from database by orderId
   - Validate order exists
   - Check status is 'CREATED'
   - Verify not expired

2. **Gateway Integration**
   - **Interface Point**: `paymentGateway.processPayment()`
   - **External System**: Payment Gateway (Razorpay/PayU/CCAvenue)
   - **Data Sent**: amount, currency, customerId, orderId, paymentMethod, paymentDetails
   - **Response**: transactionId, status

3. **Order Status Update** (`updateOrderStatus`)
   - **Table**: `payment_orders`
   - **Operation**: UPDATE
   - **Fields Updated**:
     - status: 'PROCESSING'
     - gateway_order_id: transactionId
     - updated_at: current timestamp
   - **Query**: Find by order_id, update by id with tenant_id

4. **Response**
   - Returns: orderId, transactionId, status ('PROCESSING'), timestamp

---

### 3. HANDLE CALLBACK/WEBHOOK
**Function**: `handleCallback(callbackData)`  
**Entry Point**: Payment gateway webhook call

#### Flow Steps:
1. **Signature Verification** (`verifyCallback`)
   - **Security**: HMAC signature verification
   - Validates callback is from trusted gateway

2. **Order Status Update**
   - **Table**: `payment_orders`
   - **Operation**: UPDATE
   - **Status Values**: Based on callback (SUCCESS/FAILED)

3. **Merchant Notification** (`triggerMerchantCallback`)
   - **Interface Point**: Merchant webhook URL
   - **Data Sent**: orderId, status, transactionId

4. **Response**
   - Acknowledge webhook: { success: true, acknowledged: true }

---

### 4. GET PAYMENT STATUS
**Function**: `getPaymentStatus(orderId)`  
**Entry Point**: Merchant/Customer polling for status

#### Flow Steps:
1. **Order Retrieval** (`getOrder`)
   - **Table**: `payment_orders`
   - **Operation**: SELECT
   - **Query**: WHERE order_id = ? AND tenant_id = ?

2. **Response**
   - Returns: orderId, status, amount, currency, transactionId, timestamp

---

### 5. GENERATE PAYMENT LINK
**Function**: `generatePaymentLink(linkData)`  
**Entry Point**: Merchant request for payment link

#### Flow Steps:
1. **Order Creation**
   - Calls `createPaymentOrder()` internally
   - Creates order with provided details

2. **Link Generation**
   - Format: `{paymentPageUrl}?orderId={orderId}`
   - Uses config.paymentPageUrl

3. **Response**
   - Returns: orderId, paymentLink, expiryTime

---

## External System Interfaces

### 1. Payment Gateways
**Integration**: `this.paymentGateway.processPayment()`  
**Gateways Supported**:
- **Razorpay**: 95.5% success rate, ₹2.0/txn
- **PayU**: 94% success rate, ₹1.8/txn
- **CCAvenue**: 93% success rate, ₹2.2/txn

**Smart Routing**: Via PAPG Service (Payment Aggregator)
- Amount-based routing (>₹50,000 → Razorpay)
- Payment method routing (UPI → PayU)
- Performance-based selection (success rate + latency + cost)

**Data Sent**:
```json
{
  "amount": 1000,
  "currency": "INR",
  "customerId": "CUST_001",
  "orderId": "ORD_123456",
  "paymentMethod": "card",
  "paymentDetails": { ... }
}
```

**Response Expected**:
```json
{
  "transactionId": "TXN_RAZORPAY_123",
  "status": "SUCCESS/FAILED/PENDING"
}
```

---

## Database Tables & Operations

### 1. payment_orders
**Purpose**: Store payment order information

**Schema**:
```sql
- id (UUID, primary key)
- tenant_id (UUID, indexed) - Multi-tenancy support
- order_id (VARCHAR, unique) - Merchant order reference
- amount (DECIMAL 15,2)
- currency (VARCHAR, default 'INR')
- status (ENUM: created, pending, authorized, captured, failed, cancelled)
- customer_id (VARCHAR, indexed)
- customer_email (VARCHAR)
- customer_phone (VARCHAR)
- customer_details (JSONB)
- payment_method (VARCHAR)
- gateway (VARCHAR)
- gateway_order_id (VARCHAR) - Gateway transaction ID
- callback_url (VARCHAR)
- metadata (JSONB) - description, paymentMethods array
- expires_at (TIMESTAMP) - 30 minutes from creation
- created_at, updated_at (TIMESTAMP)
```

**Operations**:
- **INSERT**: `storeOrder()` - Create new payment order
- **SELECT**: `getOrder()` - Retrieve order by order_id
- **UPDATE**: `updateOrderStatus()` - Update status and gateway_order_id

**Indexes**:
- tenant_id, status
- tenant_id, customer_id
- tenant_id, order_id
- created_at

---

### 2. transactions
**Purpose**: Track payment transaction details (used in conjunction with payment_orders)

**Schema**:
```sql
- id (UUID, primary key)
- tenant_id (UUID, indexed)
- order_id (VARCHAR, indexed)
- transaction_ref (VARCHAR, unique)
- payment_method (VARCHAR) - 'card', 'upi', 'netbanking', 'wallet'
- gateway (VARCHAR) - Gateway used
- amount (DECIMAL 15,2)
- currency (VARCHAR, default 'INR')
- status (ENUM: pending, processing, success, failed, refunded)
- customer_email, customer_phone, customer_name (VARCHAR)
- metadata (JSONB)
- gateway_transaction_id (VARCHAR)
- gateway_response_code, gateway_response_message (VARCHAR/TEXT)
- initiated_at, completed_at (TIMESTAMP)
- created_at, updated_at (TIMESTAMP)
```

**Operations**:
- **INSERT**: When payment is processed through gateway
- **UPDATE**: When payment status changes via callback

**Indexes**:
- tenant_id, status
- tenant_id, order_id
- gateway_transaction_id
- created_at

---

### 3. audit_logs
**Purpose**: Audit trail for all payment operations

**Schema**:
```sql
- id (UUID)
- tenant_id (UUID)
- entity_type (VARCHAR) - 'payment_order'
- entity_id (UUID) - order id
- action (ENUM: create, read, update, delete, payment)
- user_id, user_email (VARCHAR)
- ip_address (VARCHAR)
- changes_before, changes_after (JSONB)
- metadata (JSONB)
- created_at (TIMESTAMP)
```

**Operations**:
- **INSERT**: Auto-logged on all CRUD operations

---

## Security & Compliance

### 1. Callback Verification
- **Method**: HMAC-SHA256 signature verification
- **Function**: `verifyCallback(data)`
- **Validates**: Webhook authenticity from gateway

### 2. Data Encryption
- **PII Storage**: Customer email, phone stored in token_vault (PCI-DSS compliance)
- **Card Data**: Never stored directly, tokenized via gateway

### 3. Multi-Tenancy
- All database operations use `tenant_id` filtering
- Ensures data isolation between merchants

---

## Error Handling

### Common Errors:
1. **Order creation failed**: Missing required fields (amount, customerId, customerEmail)
2. **Invalid amount**: Amount <= 0
3. **Invalid email**: Fails regex validation
4. **Order not found**: Invalid orderId in processPayment
5. **Order expired**: Current time > expiryTime
6. **Order already processed**: Status not 'CREATED'
7. **Gateway processing failed**: Gateway returns error response
8. **Invalid callback signature**: Webhook verification fails

### Retry Logic:
- Gateway failures: Automatic retry via PAPG smart routing
- Max 2 retries with different gateways
- Exponential backoff between retries

---

## Configuration Requirements

```javascript
{
  paymentGateway: <gateway_instance>,
  paymentPageUrl: 'https://checkout.example.com',
  tenantId: '<merchant_tenant_id>',
  defaultTenantId: '<fallback_tenant_id>'
}
```

---

## Related Services

1. **PAPG Service** (`/src/papg/papg-service.js`)
   - Smart gateway routing
   - Automatic failover
   
2. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Double-entry bookkeeping
   - Fee calculation
   - Settlement tracking

3. **Audit Service** (`/src/security/audit-trail-service.js`)
   - Compliance logging
   - PCI-DSS audit trail

---

## Monitoring & Analytics

### Key Metrics:
- Order creation rate
- Payment success rate by gateway
- Average processing time
- Order expiry rate
- Callback processing time

### Logs:
- Order stored: `order.orderId`
- Order updated: `orderId, status, transactionId`
- Callback processed: `orderId, status`

---

## API Endpoints (Typical Integration)

```
POST /api/payments/orders - Create payment order
GET  /api/payments/orders/:orderId - Get order status
POST /api/payments/process - Process payment
POST /api/payments/callback - Gateway webhook (internal)
POST /api/payments/links - Generate payment link
```
