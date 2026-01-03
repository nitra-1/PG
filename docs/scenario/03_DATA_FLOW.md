# Data Flow Architecture

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [API Request/Response Flows](#api-requestresponse-flows)
5. [Database Architecture](#database-architecture)
6. [Security in Data Flow](#security-in-data-flow)
7. [Real-time Data Synchronization](#real-time-data-synchronization)

## Overview

This document provides detailed technical documentation of how data flows through the payment gateway system when serving multiple merchants. It covers the complete journey of data from merchant systems through our gateway to payment providers and back.

### Data Flow Principles
- **Encryption at Rest and in Transit**: All sensitive data encrypted
- **Data Minimization**: Only necessary data is collected and stored
- **Audit Trail**: Complete logging of all data movements
- **Compliance**: PCI-DSS, GDPR, and local regulations
- **Real-time Processing**: Minimal latency in data propagation

## System Architecture

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                         MERCHANT LAYER                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐│
│  │FashionHub│  │TechGadget│  │GroceryQuk│  │BookWorld │  │HomeDecor││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘│
│       │             │              │             │              │     │
│       └─────────────┴──────────────┴─────────────┴──────────────┘     │
│                                    │                                   │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ HTTPS/TLS 1.3
                                     │ JWT Authentication
                                     ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    PAYMENT GATEWAY PLATFORM                            │
│                                                                        │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                    API GATEWAY LAYER                         │   │
│   │  • Load Balancer (HAProxy/NGINX)                            │   │
│   │  • Rate Limiting (Redis-based)                              │   │
│   │  • Authentication & Authorization (JWT)                     │   │
│   │  • Request Validation & Sanitization                        │   │
│   │  • Request/Response Logging                                 │   │
│   └────────────────────────┬────────────────────────────────────┘   │
│                             │                                         │
│   ┌────────────────────────┴────────────────────────────────────┐   │
│   │                   MICROSERVICES LAYER                        │   │
│   │                                                              │   │
│   │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│   │  │   Order     │  │   Payment    │  │   Webhook    │      │   │
│   │  │  Service    │  │   Service    │  │   Service    │      │   │
│   │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘      │   │
│   │         │                 │                  │              │   │
│   │  ┌──────┴──────┐  ┌──────┴───────┐  ┌──────┴───────┐      │   │
│   │  │  Merchant   │  │   Routing    │  │  Settlement  │      │   │
│   │  │   Service   │  │   Service    │  │   Service    │      │   │
│   │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘      │   │
│   │         │                 │                  │              │   │
│   └─────────┼─────────────────┼──────────────────┼──────────────┘   │
│             │                 │                  │                   │
│   ┌─────────┴─────────────────┴──────────────────┴──────────────┐   │
│   │                      DATA LAYER                              │   │
│   │                                                              │   │
│   │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│   │  │ PostgreSQL  │  │    Redis     │  │  Elasticsearch│      │   │
│   │  │  (Primary)  │  │   (Cache)    │  │   (Search)   │      │   │
│   │  └─────────────┘  └──────────────┘  └──────────────┘      │   │
│   │                                                              │   │
│   │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │   │
│   │  │   MongoDB   │  │   RabbitMQ   │  │   AWS S3     │      │   │
│   │  │   (Logs)    │  │   (Queue)    │  │  (Storage)   │      │   │
│   │  └─────────────┘  └──────────────┘  └──────────────┘      │   │
│   └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                        │
└──────────────────────────────┼────────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────────┐
│                   PAYMENT PROVIDER LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │  Razorpay   │  │    PayU     │  │  CCAvenue   │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
└─────────┼────────────────┼────────────────┼──────────────────────────┘
          │                │                │
          └────────────────┴────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     BANKING NETWORK LAYER                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │  NPCI   │  │  Visa   │  │Mastercard│ │  Banks  │                │
│  │  (UPI)  │  │ Network │  │ Network  │ │         │                │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘                │
└───────────────────────────────────────────────────────────────────────┘
```

### Microservices Architecture

```javascript
{
  "services": {
    "apiGateway": {
      "port": 3000,
      "instances": 10,
      "responsibility": "Entry point, authentication, routing"
    },
    "orderService": {
      "port": 3001,
      "instances": 8,
      "responsibility": "Order creation, management, status tracking"
    },
    "paymentService": {
      "port": 3002,
      "instances": 12,
      "responsibility": "Payment processing, capture, refund"
    },
    "merchantService": {
      "port": 3003,
      "instances": 4,
      "responsibility": "Merchant management, configuration"
    },
    "routingService": {
      "port": 3004,
      "instances": 6,
      "responsibility": "Smart routing, load balancing, failover"
    },
    "webhookService": {
      "port": 3005,
      "instances": 8,
      "responsibility": "Webhook delivery, retry logic"
    },
    "settlementService": {
      "port": 3006,
      "instances": 4,
      "responsibility": "Settlement calculation, transfer"
    }
  }
}
```

## Data Flow Diagrams

### Complete Transaction Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. ORDER CREATION DATA FLOW                                          │
└──────────────────────────────────────────────────────────────────────┘

Merchant (FashionHub)                                    Payment Gateway
       │                                                         │
       │  POST /api/payin/orders                                │
       │  {                                                      │
       │    "amount": 2500,                                      │
       │    "customerId": "CUST_FH_12345",                      │
       │    "customerEmail": "customer@example.com"              │
       │  }                                                      │
       │─────────────────────────────────────────────────────────>│
       │                                                         │
       │                    ┌────────────────────────────────┐  │
       │                    │ 1. Validate JWT Token          │  │
       │                    │ 2. Extract merchantId          │  │
       │                    │ 3. Check merchant status       │  │
       │                    │ 4. Validate request data       │  │
       │                    │ 5. Check rate limits           │  │
       │                    └────────────────────────────────┘  │
       │                                                         │
       │                    ┌────────────────────────────────┐  │
       │                    │ Database Write                  │  │
       │                    │ ─────────────────              │  │
       │                    │ INSERT INTO orders             │  │
       │                    │ (order_id, merchant_id,        │  │
       │                    │  amount, currency, status,     │  │
       │                    │  customer_id, created_at)      │  │
       │                    │ VALUES (...)                   │  │
       │                    │                                │  │
       │                    │ INSERT INTO audit_logs         │  │
       │                    │ (event, data, timestamp)       │  │
       │                    └────────────────────────────────┘  │
       │                                                         │
       │                    ┌────────────────────────────────┐  │
       │                    │ Cache Write (Redis)            │  │
       │                    │ ─────────────────              │  │
       │                    │ SET order:order_FH_123 {...}   │  │
       │                    │ EXPIRE 3600                    │  │
       │                    └────────────────────────────────┘  │
       │                                                         │
       │  Response: 201 Created                                 │
       │  {                                                      │
       │    "orderId": "order_FH_1234567890",                   │
       │    "status": "created",                                │
       │    "amount": 2500,                                     │
       │    "expiresAt": "2024-01-15T11:30:00Z"                │
       │  }                                                      │
       │<─────────────────────────────────────────────────────────│
       │                                                         │

┌──────────────────────────────────────────────────────────────────────┐
│ 2. PAYMENT INITIATION DATA FLOW                                      │
└──────────────────────────────────────────────────────────────────────┘

Customer Browser                Gateway              Routing Service
       │                           │                        │
       │  POST /orders/:id/pay     │                        │
       │  {                        │                        │
       │    "paymentMethod": "upi",│                        │
       │    "vpa": "customer@upi"  │                        │
       │  }                        │                        │
       │───────────────────────────>│                        │
       │                           │                        │
       │                           │  Get optimal gateway   │
       │                           │────────────────────────>│
       │                           │                        │
       │                           │  {                     │
       │                           │    "gateway": "razorpay",
       │                           │    "successRate": 98.5,│
       │                           │    "avgTime": "2.3s"   │
       │                           │  }                     │
       │                           │<────────────────────────│
       │                           │                        │
       │                           │                        │
       │                     ┌─────▼──────┐                │
       │                     │  Database  │                │
       │                     │  ─────────  │                │
       │                     │  UPDATE     │                │
       │                     │  orders     │                │
       │                     │  SET status │                │
       │                     │  = 'init'   │                │
       │                     └────────────┘                │
       │                           │                        │
       │                           │                        │
       │  Response with intent     │                        │
       │<───────────────────────────│                        │
       │                           │                        │

┌──────────────────────────────────────────────────────────────────────┐
│ 3. PAYMENT PROVIDER COMMUNICATION                                    │
└──────────────────────────────────────────────────────────────────────┘

Gateway                          Razorpay                    NPCI/Bank
   │                                │                            │
   │  POST /v1/payments             │                            │
   │  {                             │                            │
   │    "amount": 250000,           │                            │
   │    "method": "upi",            │                            │
   │    "vpa": "customer@upi",      │                            │
   │    "notes": {                  │                            │
   │      "order_id": "order_FH_*"  │                            │
   │    }                           │                            │
   │  }                             │                            │
   │────────────────────────────────>│                            │
   │                                │  UPI Collect Request       │
   │                                │────────────────────────────>│
   │                                │                            │
   │                                │  Customer Bank Notified    │
   │                                │<────────────────────────────│
   │  Response: Payment Initiated   │                            │
   │<────────────────────────────────│                            │
   │                                │                            │
   │  Webhook: Payment Status       │  Customer Approves         │
   │<────────────────────────────────│<────────────────────────────│
   │                                │                            │

┌──────────────────────────────────────────────────────────────────────┐
│ 4. WEBHOOK DELIVERY DATA FLOW                                        │
└──────────────────────────────────────────────────────────────────────┘

Gateway                     RabbitMQ Queue              Merchant Server
   │                             │                            │
   │  Publish webhook event      │                            │
   │─────────────────────────────>│                            │
   │  {                          │                            │
   │    "event": "payment.success",                           │
   │    "orderId": "order_FH_*", │                            │
   │    "attempt": 1,            │                            │
   │    "maxRetries": 5          │                            │
   │  }                          │                            │
   │                             │                            │
   │                             │  Dequeue event             │
   │                             │                            │
   │                             │  POST /webhook/payment     │
   │                             │  X-Webhook-Signature: hash │
   │                             │  {                         │
   │                             │    "event": "payment.*",   │
   │                             │    "data": {...}           │
   │                             │  }                         │
   │                             │────────────────────────────>│
   │                             │                            │
   │                             │  200 OK                    │
   │                             │<────────────────────────────│
   │                             │                            │
   │  Update delivery status     │                            │
   │<─────────────────────────────│                            │
   │                             │                            │

┌──────────────────────────────────────────────────────────────────────┐
│ 5. SETTLEMENT DATA FLOW                                              │
└──────────────────────────────────────────────────────────────────────┘

Settlement Service           Database              Bank API
       │                        │                      │
       │  SELECT * FROM orders  │                      │
       │  WHERE date = T-1      │                      │
       │  AND status = 'paid'   │                      │
       │────────────────────────>│                      │
       │                        │                      │
       │  Transaction records   │                      │
       │<────────────────────────│                      │
       │                        │                      │
       │  Calculate settlement  │                      │
       │  ─────────────────     │                      │
       │  Gross: ₹368,500       │                      │
       │  MDR: ₹3,994.50        │                      │
       │  GST: ₹718.81          │                      │
       │  Net: ₹363,786.69      │                      │
       │                        │                      │
       │  INSERT INTO           │                      │
       │  settlements (...)     │                      │
       │────────────────────────>│                      │
       │                        │                      │
       │                        │  Initiate NEFT       │
       │                        │  transfer            │
       │────────────────────────────────────────────────>│
       │                        │                      │
       │                        │  Transfer successful │
       │                        │  UTR: NEFT2024...    │
       │<────────────────────────────────────────────────│
       │                        │                      │
       │  UPDATE settlement     │                      │
       │  SET status = 'done'   │                      │
       │────────────────────────>│                      │
       │                        │                      │
```

## API Request/Response Flows

### Order Creation - Complete Data Journey

**Step 1: Merchant Request**

```http
POST /api/payin/orders HTTP/1.1
Host: api.paymentgateway.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json
X-Request-ID: req_FH_12345
X-Merchant-ID: MERCH_FH_001

{
  "amount": 2500.00,
  "currency": "INR",
  "customerId": "CUST_FH_12345",
  "customerEmail": "customer@example.com",
  "customerPhone": "+919876543210",
  "description": "Fashion Items - Order #FH12345",
  "metadata": {
    "orderId": "FH12345",
    "items": [
      {"name": "T-Shirt", "quantity": 2, "price": 800},
      {"name": "Jeans", "quantity": 1, "price": 900}
    ]
  },
  "returnUrl": "https://fashionhub.com/payment/callback",
  "webhookUrl": "https://fashionhub.com/webhook/payment"
}
```

**Step 2: API Gateway Processing**

```javascript
// 1. Extract and validate JWT
const decoded = jwt.verify(token, secretKey);
// Output: { merchantId: 'MERCH_FH_001', apiKey: 'pk_live_FH_*', ... }

// 2. Check rate limiting (Redis)
const currentCount = await redis.incr(`ratelimit:MERCH_FH_001:${minute}`);
if (currentCount > 1000) {
  throw new Error('Rate limit exceeded');
}
await redis.expire(`ratelimit:MERCH_FH_001:${minute}`, 60);

// 3. Validate merchant status (Cache check first)
let merchant = await redis.get(`merchant:MERCH_FH_001`);
if (!merchant) {
  merchant = await db.query('SELECT * FROM merchants WHERE id = $1', ['MERCH_FH_001']);
  await redis.setex(`merchant:MERCH_FH_001`, 300, JSON.stringify(merchant));
}

// 4. Validate request schema
const validatedData = orderSchema.validate(requestBody);

// 5. Generate unique order ID
const orderId = `order_FH_${Date.now()}${randomString(6)}`;
```

**Step 3: Order Service Processing**

```javascript
// Database transaction
await db.transaction(async (trx) => {
  // Insert order
  await trx('orders').insert({
    order_id: orderId,
    merchant_id: 'MERCH_FH_001',
    amount: 2500.00,
    currency: 'INR',
    status: 'created',
    customer_id: 'CUST_FH_12345',
    customer_email: 'customer@example.com',
    customer_phone: '+919876543210',
    description: 'Fashion Items - Order #FH12345',
    metadata: JSON.stringify(metadata),
    return_url: 'https://fashionhub.com/payment/callback',
    webhook_url: 'https://fashionhub.com/webhook/payment',
    created_at: new Date(),
    updated_at: new Date(),
    expires_at: new Date(Date.now() + 3600000) // 1 hour
  });

  // Insert audit log
  await trx('audit_logs').insert({
    event_type: 'order.created',
    merchant_id: 'MERCH_FH_001',
    order_id: orderId,
    data: JSON.stringify({
      amount: 2500.00,
      customerId: 'CUST_FH_12345'
    }),
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
    timestamp: new Date()
  });
});

// Cache the order
await redis.setex(
  `order:${orderId}`,
  3600,
  JSON.stringify(orderData)
);

// Index in Elasticsearch for search
await elasticsearch.index({
  index: 'orders',
  id: orderId,
  body: {
    merchantId: 'MERCH_FH_001',
    amount: 2500.00,
    status: 'created',
    createdAt: new Date(),
    customerId: 'CUST_FH_12345'
  }
});
```

**Step 4: Response to Merchant**

```http
HTTP/1.1 201 Created
Content-Type: application/json
X-Request-ID: req_FH_12345
X-Response-Time: 145ms

{
  "success": true,
  "orderId": "order_FH_1234567890",
  "merchantOrderId": "FH12345",
  "amount": 2500.00,
  "currency": "INR",
  "status": "created",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "expiresAt": "2024-01-15T11:30:00.000Z",
  "customerId": "CUST_FH_12345",
  "paymentLinks": {
    "hosted": "https://checkout.paymentgateway.com/pay/order_FH_1234567890",
    "qrCode": "https://api.paymentgateway.com/v1/qr/order_FH_1234567890"
  }
}
```

### Payment Processing - Data Transformation

**Input from Customer:**
```json
{
  "paymentMethod": "upi",
  "vpa": "customer@upi"
}
```

**Transformed for Razorpay:**
```json
{
  "amount": 250000,
  "currency": "INR",
  "method": "upi",
  "vpa": "customer@upi",
  "order_id": "order_rzp_internal_123",
  "description": "Payment for order_FH_1234567890",
  "notes": {
    "merchant_id": "MERCH_FH_001",
    "order_id": "order_FH_1234567890",
    "customer_id": "CUST_FH_12345"
  },
  "callback_url": "https://api.paymentgateway.com/v1/callback/razorpay",
  "callback_method": "get"
}
```

**Received from Razorpay (Webhook):**
```json
{
  "entity": "event",
  "account_id": "acc_razorpay_123",
  "event": "payment.captured",
  "created_at": 1705317050,
  "payload": {
    "payment": {
      "id": "pay_rzp_abc123",
      "amount": 250000,
      "currency": "INR",
      "status": "captured",
      "method": "upi",
      "vpa": "customer@upi",
      "order_id": "order_rzp_internal_123",
      "notes": {
        "order_id": "order_FH_1234567890"
      }
    }
  }
}
```

**Transformed for Merchant Webhook:**
```json
{
  "event": "payment.success",
  "timestamp": "2024-01-15T10:30:55.000Z",
  "data": {
    "merchantId": "MERCH_FH_001",
    "orderId": "order_FH_1234567890",
    "merchantOrderId": "FH12345",
    "paymentId": "pay_FH_9876543210",
    "amount": 2500.00,
    "currency": "INR",
    "status": "paid",
    "paymentMethod": "upi",
    "paymentDetails": {
      "vpa": "customer@upi",
      "bankReference": "012345678901"
    },
    "paidAt": "2024-01-15T10:30:55.000Z",
    "gatewayResponse": {
      "gateway": "razorpay",
      "transactionId": "pay_rzp_abc123"
    }
  }
}
```

## Database Architecture

### Schema Design for Multi-Merchant

```sql
-- Merchants Table
CREATE TABLE merchants (
  merchant_id VARCHAR(50) PRIMARY KEY,
  merchant_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  tier VARCHAR(20) NOT NULL,
  api_key_live VARCHAR(100) UNIQUE NOT NULL,
  api_key_test VARCHAR(100) UNIQUE NOT NULL,
  webhook_url VARCHAR(500),
  webhook_secret VARCHAR(100),
  settlement_account JSONB,
  pricing_config JSONB,
  ip_whitelist JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_merchant_status (status),
  INDEX idx_merchant_tier (tier)
);

-- Orders Table (Partitioned by merchant_id)
CREATE TABLE orders (
  order_id VARCHAR(50) PRIMARY KEY,
  merchant_id VARCHAR(50) NOT NULL REFERENCES merchants(merchant_id),
  merchant_order_id VARCHAR(100),
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL,
  customer_id VARCHAR(50),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  description TEXT,
  metadata JSONB,
  return_url VARCHAR(500),
  webhook_url VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  paid_at TIMESTAMP,
  INDEX idx_order_merchant (merchant_id, created_at DESC),
  INDEX idx_order_status (status),
  INDEX idx_order_customer (customer_id),
  INDEX idx_order_created (created_at DESC)
) PARTITION BY HASH (merchant_id);

-- Create partitions for each merchant (or range of merchants)
CREATE TABLE orders_part_0 PARTITION OF orders FOR VALUES WITH (MODULUS 10, REMAINDER 0);
CREATE TABLE orders_part_1 PARTITION OF orders FOR VALUES WITH (MODULUS 10, REMAINDER 1);
-- ... up to 10 partitions

-- Payments Table
CREATE TABLE payments (
  payment_id VARCHAR(50) PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL REFERENCES orders(order_id),
  merchant_id VARCHAR(50) NOT NULL REFERENCES merchants(merchant_id),
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  payment_details JSONB,
  gateway VARCHAR(50) NOT NULL,
  gateway_transaction_id VARCHAR(100),
  gateway_response JSONB,
  bank_reference VARCHAR(100),
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  authorized_at TIMESTAMP,
  captured_at TIMESTAMP,
  failed_at TIMESTAMP,
  INDEX idx_payment_order (order_id),
  INDEX idx_payment_merchant (merchant_id, created_at DESC),
  INDEX idx_payment_status (status),
  INDEX idx_payment_gateway (gateway, created_at DESC)
);

-- Settlements Table
CREATE TABLE settlements (
  settlement_id VARCHAR(50) PRIMARY KEY,
  merchant_id VARCHAR(50) NOT NULL REFERENCES merchants(merchant_id),
  settlement_date DATE NOT NULL,
  transaction_count INT NOT NULL,
  gross_amount DECIMAL(12, 2) NOT NULL,
  mdr_amount DECIMAL(12, 2) NOT NULL,
  gst_amount DECIMAL(12, 2) NOT NULL,
  adjustments DECIMAL(12, 2) DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  bank_reference VARCHAR(100),
  transferred_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_settlement_merchant (merchant_id, settlement_date DESC),
  INDEX idx_settlement_date (settlement_date DESC),
  INDEX idx_settlement_status (status)
);

-- Audit Logs (For compliance and debugging)
CREATE TABLE audit_logs (
  log_id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  merchant_id VARCHAR(50),
  order_id VARCHAR(50),
  payment_id VARCHAR(50),
  user_id VARCHAR(50),
  ip_address VARCHAR(45),
  user_agent TEXT,
  data JSONB,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_audit_merchant (merchant_id, timestamp DESC),
  INDEX idx_audit_event (event_type, timestamp DESC),
  INDEX idx_audit_timestamp (timestamp DESC)
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for audit logs
CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs 
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE audit_logs_2024_02 PARTITION OF audit_logs 
  FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
-- ... continue for each month

-- Webhook Events Table
CREATE TABLE webhook_events (
  event_id VARCHAR(50) PRIMARY KEY,
  merchant_id VARCHAR(50) NOT NULL REFERENCES merchants(merchant_id),
  order_id VARCHAR(50),
  payment_id VARCHAR(50),
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  webhook_url VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_webhook_merchant (merchant_id, created_at DESC),
  INDEX idx_webhook_status (status, next_retry_at),
  INDEX idx_webhook_pending (status, attempts, next_retry_at)
);
```

### Data Isolation Techniques

**1. Logical Separation:**
```sql
-- All queries include merchant_id filter
SELECT * FROM orders 
WHERE merchant_id = 'MERCH_FH_001' 
  AND status = 'paid'
  AND created_at >= '2024-01-15';

-- Row-Level Security (PostgreSQL)
CREATE POLICY merchant_isolation ON orders
  USING (merchant_id = current_setting('app.current_merchant_id'));
```

**2. Encryption at Rest:**
```javascript
// Sensitive data encryption before storage
const encryptedData = encrypt(
  JSON.stringify({
    cardNumber: '4111111111111111',
    cvv: '123',
    expiry: '12/25'
  }),
  process.env.ENCRYPTION_KEY
);

await db.query(
  'INSERT INTO payment_methods (customer_id, encrypted_data) VALUES ($1, $2)',
  [customerId, encryptedData]
);
```

**3. Connection Pooling per Merchant:**
```javascript
const pools = {};

function getPool(merchantId) {
  if (!pools[merchantId]) {
    pools[merchantId] = new Pool({
      host: 'db.payment-gateway.com',
      database: 'payments',
      user: merchantId,
      password: merchantConfigs[merchantId].dbPassword,
      max: 20,
      idleTimeoutMillis: 30000
    });
  }
  return pools[merchantId];
}
```

## Security in Data Flow

### Encryption Strategy

**1. Data in Transit:**
```
Merchant → Payment Gateway: TLS 1.3
Payment Gateway → Payment Provider: TLS 1.3
Payment Gateway → Bank APIs: TLS 1.3 + mTLS

Encryption: AES-256-GCM
Key Exchange: ECDHE
Certificate: Let's Encrypt (Auto-renewed)
```

**2. Data at Rest:**
```javascript
// Database encryption
{
  "PostgreSQL": {
    "encryption": "AES-256",
    "keyManagement": "AWS KMS",
    "encryptedColumns": [
      "customer_email",
      "customer_phone",
      "payment_details",
      "bank_account_details"
    ]
  },
  "Redis": {
    "encryption": "AES-256",
    "keyRotation": "every 90 days"
  }
}
```

**3. API Key Security:**
```javascript
// API key hashing
const hashedApiKey = crypto
  .createHash('sha256')
  .update(apiKey)
  .digest('hex');

// Store only hash in database
await db.query(
  'UPDATE merchants SET api_key_hash = $1 WHERE merchant_id = $2',
  [hashedApiKey, merchantId]
);

// Verification
const providedKeyHash = crypto
  .createHash('sha256')
  .update(providedApiKey)
  .digest('hex');

const isValid = providedKeyHash === storedHash;
```

### Data Masking and Sanitization

```javascript
// Before logging or sending to analytics
function maskSensitiveData(data) {
  return {
    ...data,
    customerEmail: maskEmail(data.customerEmail),
    customerPhone: maskPhone(data.customerPhone),
    cardNumber: maskCard(data.cardNumber),
    cvv: '***',
    vpa: maskUPI(data.vpa)
  };
}

function maskEmail(email) {
  const [name, domain] = email.split('@');
  return `${name[0]}***@${domain}`;
}

function maskPhone(phone) {
  return phone.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2');
}

function maskCard(card) {
  return `****-****-****-${card.slice(-4)}`;
}

// Example output
{
  "customerEmail": "c***@example.com",
  "customerPhone": "+91******10",
  "cardNumber": "****-****-****-1111",
  "vpa": "c***@upi"
}
```

## Real-time Data Synchronization

### Redis Cache Strategy

```javascript
// Cache layers
const cacheStrategy = {
  // L1: Application memory (Node.js)
  "L1": {
    "ttl": "5 minutes",
    "size": "100MB",
    "usage": "Frequently accessed merchant configs"
  },
  
  // L2: Redis (Shared)
  "L2": {
    "ttl": "1 hour",
    "size": "10GB",
    "usage": "Order status, merchant data, session data"
  },
  
  // L3: Database
  "L3": {
    "persistent": true,
    "usage": "Source of truth"
  }
};

// Implementation
async function getOrder(orderId) {
  // Try L1 cache
  let order = memoryCache.get(`order:${orderId}`);
  if (order) return order;
  
  // Try L2 cache (Redis)
  order = await redis.get(`order:${orderId}`);
  if (order) {
    memoryCache.set(`order:${orderId}`, order, 300);
    return JSON.parse(order);
  }
  
  // Fetch from database
  order = await db.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
  
  // Update caches
  await redis.setex(`order:${orderId}`, 3600, JSON.stringify(order));
  memoryCache.set(`order:${orderId}`, order, 300);
  
  return order;
}
```

### WebSocket for Real-time Updates

```javascript
// Merchant dashboard real-time updates
const io = require('socket.io')(server);

// Authenticate merchant connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = jwt.verify(token, secretKey);
  socket.merchantId = decoded.merchantId;
  next();
});

// Join merchant-specific room
io.on('connection', (socket) => {
  socket.join(`merchant:${socket.merchantId}`);
  
  console.log(`Merchant ${socket.merchantId} connected to dashboard`);
});

// Broadcast payment updates
function broadcastPaymentUpdate(merchantId, data) {
  io.to(`merchant:${merchantId}`).emit('payment:update', data);
}

// Usage
broadcastPaymentUpdate('MERCH_FH_001', {
  orderId: 'order_FH_1234567890',
  status: 'paid',
  amount: 2500.00,
  timestamp: new Date()
});
```

### Event Streaming with RabbitMQ

```javascript
// Publisher (Payment Service)
const channel = await connection.createChannel();
await channel.assertExchange('payments', 'topic', { durable: true });

channel.publish(
  'payments',
  'payment.captured',
  Buffer.from(JSON.stringify({
    merchantId: 'MERCH_FH_001',
    orderId: 'order_FH_1234567890',
    paymentId: 'pay_FH_9876543210',
    amount: 2500.00,
    status: 'paid'
  }))
);

// Subscriber (Webhook Service)
await channel.assertQueue('webhooks', { durable: true });
await channel.bindQueue('webhooks', 'payments', 'payment.*');

channel.consume('webhooks', async (msg) => {
  const event = JSON.parse(msg.content.toString());
  await deliverWebhook(event);
  channel.ack(msg);
});

// Subscriber (Settlement Service)
await channel.assertQueue('settlements', { durable: true });
await channel.bindQueue('settlements', 'payments', 'payment.captured');

channel.consume('settlements', async (msg) => {
  const event = JSON.parse(msg.content.toString());
  await updateSettlementCalculation(event);
  channel.ack(msg);
});
```

---

**Next Steps**: Proceed to [Technical Integration Guide](04_TECHNICAL_INTEGRATION.md) for hands-on implementation details.
