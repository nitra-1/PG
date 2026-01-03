# Payment Processing Flow

## Table of Contents
1. [Overview](#overview)
2. [Multi-Merchant Architecture](#multi-merchant-architecture)
3. [Payment Lifecycle](#payment-lifecycle)
4. [Payment Method Flows](#payment-method-flows)
5. [Settlement and Reconciliation](#settlement-and-reconciliation)
6. [Real-World Scenarios](#real-world-scenarios)

## Overview

This document details how payments are processed for multiple merchants using our fintech payment gateway solution, ensuring isolation, security, and efficient routing for each merchant's transactions.

### Key Principles
- **Merchant Isolation**: Each merchant's data is logically separated
- **Real-time Processing**: Instant payment status updates
- **Smart Routing**: Automatic optimization of payment routes
- **High Availability**: 99.99% uptime with failover mechanisms
- **Transparency**: Complete visibility into each transaction

## Multi-Merchant Architecture

### Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Payment Gateway Platform                     │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ FashionHub  │  │ TechGadgets │  │ GroceryQuick│ ... 5 Merchants
│  │ MERCH_FH_001│  │ MERCH_TG_002│  │ MERCH_GQ_003│            │
│  └─────┬───────┘  └──────┬──────┘  └──────┬──────┘            │
│        │                 │                 │                    │
│        └─────────────────┼─────────────────┘                    │
│                          │                                      │
│                ┌─────────▼─────────┐                           │
│                │  API Gateway       │                           │
│                │  - Authentication  │                           │
│                │  - Rate Limiting   │                           │
│                │  - Request Routing │                           │
│                └─────────┬─────────┘                           │
│                          │                                      │
│         ┌────────────────┼────────────────┐                    │
│         │                │                │                    │
│    ┌────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐             │
│    │  Order   │  │  Payment    │  │  Webhook   │             │
│    │ Service  │  │  Service    │  │  Service   │             │
│    └────┬─────┘  └──────┬──────┘  └─────┬──────┘             │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          │                                      │
│                ┌─────────▼─────────┐                           │
│                │ Payment Router     │                           │
│                │ - Smart Routing    │                           │
│                │ - Load Balancing   │                           │
│                │ - Failover         │                           │
│                └─────────┬─────────┘                           │
│                          │                                      │
│         ┌────────────────┼────────────────┐                    │
│         │                │                │                    │
│    ┌────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐             │
│    │ Razorpay │  │   PayU      │  │ CCAvenue   │             │
│    │ Gateway  │  │   Gateway   │  │  Gateway   │             │
│    └────┬─────┘  └──────┬──────┘  └─────┬──────┘             │
│         │                │                │                    │
└─────────┼────────────────┼────────────────┼────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Banks &   │
                    │   Payment   │
                    │  Networks   │
                    └─────────────┘
```

### Data Isolation Strategy

Each merchant has:
```json
{
  "merchantId": "MERCH_FH_001",
  "isolationLevel": "logical",
  "database": {
    "schema": "merchant_fh_001",
    "encryption": "AES-256",
    "accessControl": "role-based"
  },
  "apiKeys": {
    "production": "pk_live_FH_unique_key",
    "sandbox": "pk_test_FH_unique_key"
  },
  "webhookUrl": "https://fashionhub.com/webhook",
  "ipWhitelist": ["203.0.113.10", "203.0.113.11"]
}
```

## Payment Lifecycle

### Complete Payment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: ORDER CREATION                                          │
│                                                                  │
│ Customer → Merchant → Payment Gateway                           │
│ "I want to buy ₹2,500 worth items"                             │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: PAYMENT INITIATION                                      │
│                                                                  │
│ Customer selects payment method (UPI/Card/Wallet)               │
│ Payment Gateway prepares transaction                             │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: PAYMENT AUTHORIZATION                                   │
│                                                                  │
│ Request sent to Payment Provider (Razorpay/PayU)                │
│ Bank processes the transaction                                   │
│ Funds blocked from customer account                              │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 4: PAYMENT CAPTURE                                         │
│                                                                  │
│ Payment Gateway captures the authorized amount                   │
│ Transaction marked as successful                                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 5: NOTIFICATION                                            │
│                                                                  │
│ Webhook sent to merchant                                         │
│ SMS/Email sent to customer                                       │
│ Dashboard updated in real-time                                   │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stage 6: SETTLEMENT                                              │
│                                                                  │
│ Funds transferred to merchant account (T+1)                      │
│ Settlement report generated                                      │
│ Invoice created                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Detailed Step-by-Step Process

#### Step 1: Order Creation

**Merchant API Call:**
```javascript
// FashionHub creates an order
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Generate JWT token
const token = jwt.sign(
  {
    merchantId: 'MERCH_FH_001',
    apiKey: 'pk_live_FH_unique_key',
    timestamp: Date.now()
  },
  'merchant_api_secret',
  { expiresIn: '1h' }
);

// Create order
const response = await axios.post(
  'https://api.paymentgateway.com/v1/api/payin/orders',
  {
    amount: 2500.00,
    currency: 'INR',
    customerId: 'CUST_FH_12345',
    customerEmail: 'customer@example.com',
    customerPhone: '+919876543210',
    description: 'Fashion Items - Order #FH12345',
    metadata: {
      orderId: 'FH12345',
      items: [
        { name: 'T-Shirt', quantity: 2, price: 800 },
        { name: 'Jeans', quantity: 1, price: 900 }
      ]
    }
  },
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }
);

console.log(response.data);
```

**Response:**
```json
{
  "success": true,
  "orderId": "order_FH_1234567890",
  "merchantOrderId": "FH12345",
  "amount": 2500.00,
  "currency": "INR",
  "status": "created",
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2024-01-15T11:30:00Z",
  "paymentLinks": {
    "hosted": "https://checkout.paymentgateway.com/pay/order_FH_1234567890"
  }
}
```

**Database Record Created:**
```sql
INSERT INTO orders (
  order_id,
  merchant_id,
  amount,
  currency,
  status,
  customer_id,
  created_at
) VALUES (
  'order_FH_1234567890',
  'MERCH_FH_001',
  2500.00,
  'INR',
  'created',
  'CUST_FH_12345',
  '2024-01-15 10:30:00'
);
```

---

#### Step 2: Payment Initiation

**Customer Action:**
1. Customer is redirected to checkout page
2. Sees order summary
3. Selects payment method (e.g., UPI)

**Payment Gateway UI:**
```html
┌────────────────────────────────────────┐
│  FashionHub - Order Payment            │
├────────────────────────────────────────┤
│  Order ID: FH12345                     │
│  Amount: ₹2,500.00                     │
│                                        │
│  Select Payment Method:                │
│  ○ UPI                    [Selected]   │
│  ○ Credit/Debit Card                   │
│  ○ Net Banking                         │
│  ○ Wallets                             │
│                                        │
│  Enter UPI ID:                         │
│  [customer@upi           ]             │
│                                        │
│  [Pay Now]                             │
└────────────────────────────────────────┘
```

**Payment Initiation API Call:**
```javascript
// Payment Gateway processes payment
const paymentResponse = await axios.post(
  `https://api.paymentgateway.com/v1/api/payin/orders/${orderId}/pay`,
  {
    paymentMethod: 'upi',
    paymentDetails: {
      vpa: 'customer@upi'
    }
  },
  {
    headers: {
      'Authorization': `Bearer ${customerSessionToken}`,
      'Content-Type': 'application/json'
    }
  }
);
```

**Response:**
```json
{
  "success": true,
  "paymentId": "pay_FH_9876543210",
  "orderId": "order_FH_1234567890",
  "status": "initiated",
  "paymentMethod": "upi",
  "nextAction": {
    "type": "upi_intent",
    "intentUrl": "upi://pay?pa=merchant@bank&pn=FashionHub&am=2500&tr=pay_FH_9876543210"
  }
}
```

---

#### Step 3: Payment Authorization

**Flow to Payment Provider:**

```
Payment Gateway → Smart Router → Razorpay Gateway → UPI Network → Customer Bank
```

**Smart Router Decision:**
```javascript
{
  "routing": {
    "merchant": "MERCH_FH_001",
    "amount": 2500,
    "paymentMethod": "upi",
    "selectedGateway": "razorpay",
    "reason": "best_success_rate",
    "successRate": 98.5,
    "avgResponseTime": "2.3s",
    "cost": 0.0
  }
}
```

**Request to Razorpay:**
```json
{
  "amount": 250000,
  "currency": "INR",
  "method": "upi",
  "vpa": "customer@upi",
  "description": "Payment for order_FH_1234567890",
  "notes": {
    "merchant_id": "MERCH_FH_001",
    "order_id": "order_FH_1234567890"
  }
}
```

**UPI Network Processing:**
1. Request sent to customer's bank via NPCI
2. Customer receives notification on UPI app
3. Customer enters UPI PIN
4. Bank verifies and authorizes

**Status Updates:**
```
10:30:15 - Payment initiated
10:30:20 - Sent to UPI network
10:30:25 - Customer notified
10:30:45 - Customer authenticated
10:30:50 - Payment authorized by bank
```

---

#### Step 4: Payment Capture

**Authorization Received:**
```json
{
  "status": "authorized",
  "paymentId": "pay_FH_9876543210",
  "gatewayTransactionId": "rzp_abc123def456",
  "bankReference": "012345678901",
  "authorizedAt": "2024-01-15T10:30:50Z"
}
```

**Auto-Capture Process:**
```javascript
// Payment Gateway automatically captures
const captureResponse = await capturePayment({
  paymentId: 'pay_FH_9876543210',
  amount: 2500.00,
  currency: 'INR'
});
```

**Database Update:**
```sql
UPDATE orders 
SET 
  status = 'paid',
  payment_id = 'pay_FH_9876543210',
  paid_at = '2024-01-15 10:30:55',
  gateway_transaction_id = 'rzp_abc123def456',
  bank_reference = '012345678901'
WHERE 
  order_id = 'order_FH_1234567890';
```

---

#### Step 5: Notification

**Webhook to Merchant:**
```javascript
// Payment Gateway sends webhook
const webhookPayload = {
  event: 'payment.success',
  timestamp: '2024-01-15T10:31:00Z',
  data: {
    merchantId: 'MERCH_FH_001',
    orderId: 'order_FH_1234567890',
    merchantOrderId: 'FH12345',
    paymentId: 'pay_FH_9876543210',
    amount: 2500.00,
    currency: 'INR',
    status: 'paid',
    paymentMethod: 'upi',
    customerVpa: 'customer@upi',
    paidAt: '2024-01-15T10:30:55Z'
  }
};

// Generate HMAC signature
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(webhookPayload))
  .digest('hex');

// Send webhook
await axios.post(
  'https://fashionhub.com/webhook/payment',
  webhookPayload,
  {
    headers: {
      'X-Webhook-Signature': signature,
      'Content-Type': 'application/json'
    }
  }
);
```

**Merchant Webhook Handler:**
```javascript
// FashionHub receives and verifies webhook
app.post('/webhook/payment', (req, res) => {
  const receivedSignature = req.headers['x-webhook-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (receivedSignature === expectedSignature) {
    const { orderId, status, paymentId } = req.body.data;
    
    // Update order in database
    updateOrderStatus(orderId, status, paymentId);
    
    // Send confirmation email to customer
    sendOrderConfirmation(orderId);
    
    // Update inventory
    updateInventory(orderId);
    
    res.status(200).json({ received: true });
  } else {
    res.status(400).json({ error: 'Invalid signature' });
  }
});
```

**Customer Notifications:**
```javascript
// SMS to customer
const smsMessage = `
Dear Customer,
Your payment of ₹2,500 for Order #FH12345 has been successful.
Payment ID: pay_FH_9876543210
Thank you for shopping at FashionHub!
`;

// Email to customer
const emailContent = {
  to: 'customer@example.com',
  subject: 'Payment Successful - Order #FH12345',
  body: `
    Payment Confirmation
    
    Order ID: FH12345
    Amount: ₹2,500.00
    Payment Method: UPI
    Date: Jan 15, 2024 10:30 AM
    
    Your order is being processed.
    Track your order: https://fashionhub.com/track/FH12345
  `
};
```

---

#### Step 6: Settlement

**Settlement Calculation:**
```javascript
{
  "settlement": {
    "merchantId": "MERCH_FH_001",
    "settlementDate": "2024-01-16", // T+1
    "transactions": [
      {
        "orderId": "order_FH_1234567890",
        "amount": 2500.00,
        "mdr": 45.00, // 1.8% for cards, 0% for UPI
        "gst": 8.10, // 18% on MDR
        "netAmount": 2446.90
      }
    ],
    "totalGrossAmount": 2500.00,
    "totalMDR": 45.00,
    "totalGST": 8.10,
    "netSettlementAmount": 2446.90
  }
}
```

**Settlement Transfer:**
```sql
INSERT INTO settlements (
  settlement_id,
  merchant_id,
  settlement_date,
  gross_amount,
  mdr_amount,
  gst_amount,
  net_amount,
  status,
  bank_reference
) VALUES (
  'settle_FH_20240116',
  'MERCH_FH_001',
  '2024-01-16',
  2500.00,
  45.00,
  8.10,
  2446.90,
  'processed',
  'NEFT20240116789012'
);
```

**Bank Transfer:**
```
Source: Payment Gateway Settlement Account
Destination: FashionHub Account (HDFC0001234, 1234567890)
Amount: ₹2,446.90
Mode: NEFT/IMPS
Reference: settle_FH_20240116
```

## Payment Method Flows

### UPI Payment Flow

```
Customer → Merchant Website → Payment Gateway → UPI Network → Bank
   ↓                                    ↓              ↓         ↓
Selects UPI               Creates collect request   Processes  Debits
Enters VPA               Sends to NPCI             request    account
                         
   ↓                                    ↓              ↓         ↓
Receives            ← Payment status ←  Response   ←  Credits
notification         updates in         received     merchant
on UPI app           real-time                      settlement
```

**UPI Technical Flow:**
```javascript
// 1. Collect Request
{
  "requestType": "collect",
  "payerVPA": "customer@upi",
  "amount": 2500.00,
  "merchantVPA": "fashionhub@bank",
  "transactionNote": "Payment for Order FH12345",
  "expiryTime": 15 // minutes
}

// 2. Customer Approval
{
  "status": "approved",
  "upiTransactionId": "012345678901",
  "rrn": "012345678901"
}

// 3. Payment Completion
{
  "status": "success",
  "amount": 2500.00,
  "timestamp": "2024-01-15T10:30:55Z"
}
```

### Card Payment Flow

```
Customer → Merchant Website → Payment Gateway → Payment Processor → Card Network → Bank
   ↓                                    ↓              ↓                 ↓           ↓
Enters card              Encrypts card details      Routes to         Processes    Verifies
details                  Tokenizes PAN              appropriate       via Visa/    funds
CVV, Expiry              Sends to processor         network          Mastercard   & limits
                         
   ↓                                    ↓              ↓                 ↓           ↓
3D Secure     ←      OTP verification  ←  Requests  ←  Requests      ←  Sends
authentication        via ACS server      3DS auth     auth code        auth code
```

**Card Payment Technical Flow:**
```javascript
// 1. Card Details (Tokenized)
{
  "paymentMethod": "card",
  "cardToken": "tok_abc123def456", // PCI compliant token
  "last4": "1111",
  "cardType": "credit",
  "network": "visa"
}

// 2. 3D Secure Authentication
{
  "threeDSecure": {
    "required": true,
    "version": "2.0",
    "authenticationUrl": "https://bank-acs.com/auth",
    "challengeType": "otp"
  }
}

// 3. Authorization
{
  "status": "authorized",
  "authCode": "123456",
  "rrn": "012345678901",
  "networkTransactionId": "visa_abc123"
}
```

### Net Banking Flow

```
Customer → Merchant Website → Payment Gateway → Bank Gateway → Bank
   ↓                                    ↓              ↓          ↓
Selects bank             Redirects to bank          Opens      Customer
from list                payment page              secure     logs in
                                                   session    
   ↓                                    ↓              ↓          ↓
Completes    ←    Redirect with    ←   Payment    ←   Confirms
payment          status hash          completed      payment
```

**Net Banking Technical Flow:**
```javascript
// 1. Bank Selection
{
  "paymentMethod": "netbanking",
  "bankCode": "HDFC",
  "amount": 2500.00
}

// 2. Redirect to Bank
{
  "redirectUrl": "https://netbanking.hdfc.com/payment",
  "params": {
    "merchantId": "MERCH_PG_001",
    "amount": "2500.00",
    "orderId": "order_FH_1234567890",
    "returnUrl": "https://api.paymentgateway.com/callback"
  }
}

// 3. Callback from Bank
{
  "status": "success",
  "bankTransactionId": "HDFC123456789",
  "orderId": "order_FH_1234567890",
  "checksum": "hash_value"
}
```

## Settlement and Reconciliation

### Settlement Process

**Daily Settlement Schedule:**
```
00:00 - 02:00 AM: Batch processing
  - Identify all successful transactions from T-1 day
  - Calculate MDR and GST
  - Generate settlement reports
  
08:00 - 10:00 AM: Fund transfer
  - NEFT/IMPS transfers to merchant accounts
  - Update settlement status
  
10:00 AM onwards: Merchant notification
  - Email settlement report
  - Update dashboard
  - Generate invoices
```

**Settlement Report Example:**

```
═══════════════════════════════════════════════════════════════
                    SETTLEMENT REPORT
                    
Merchant: FashionHub Pvt Ltd (MERCH_FH_001)
Settlement Period: January 15, 2024
Settlement Date: January 16, 2024 (T+1)
Settlement ID: settle_FH_20240116
═══════════════════════════════════════════════════════════════

TRANSACTION SUMMARY
───────────────────────────────────────────────────────────────
Total Transactions: 156
Successful: 148 (94.87%)
Failed: 8 (5.13%)

Gross Amount: ₹3,68,500.00
═══════════════════════════════════════════════════════════════

PAYMENT METHOD BREAKDOWN
───────────────────────────────────────────────────────────────
UPI:          85 transactions    ₹1,42,500.00    MDR: ₹0.00
Cards:        45 transactions    ₹1,89,000.00    MDR: ₹3,402.00
Wallets:      12 transactions    ₹24,500.00      MDR: ₹367.50
Net Banking:   6 transactions    ₹12,500.00      MDR: ₹225.00
───────────────────────────────────────────────────────────────
Total MDR:                                       ₹3,994.50
GST on MDR (18%):                               ₹718.81
───────────────────────────────────────────────────────────────

NET SETTLEMENT AMOUNT: ₹3,63,786.69
═══════════════════════════════════════════════════════════════

SETTLEMENT DETAILS
───────────────────────────────────────────────────────────────
Bank Account: 1234567890
IFSC Code: HDFC0001234
Account Holder: FashionHub Pvt Ltd
UTR: NEFT20240116789012
Transfer Mode: NEFT
Status: COMPLETED
───────────────────────────────────────────────────────────────

Download detailed transaction report:
https://merchant.paymentgateway.com/settlements/settle_FH_20240116
═══════════════════════════════════════════════════════════════
```

### Reconciliation Process

**Automated Reconciliation:**
```javascript
{
  "reconciliation": {
    "date": "2024-01-16",
    "merchants": [
      {
        "merchantId": "MERCH_FH_001",
        "merchantName": "FashionHub",
        "expectedAmount": 363786.69,
        "settledAmount": 363786.69,
        "status": "matched",
        "variance": 0.00
      },
      {
        "merchantId": "MERCH_TG_002",
        "merchantName": "TechGadgets",
        "expectedAmount": 1245780.00,
        "settledAmount": 1245780.00,
        "status": "matched",
        "variance": 0.00
      }
    ],
    "totalExpected": 3625432.50,
    "totalSettled": 3625432.50,
    "matchRate": "100%"
  }
}
```

## Real-World Scenarios

### Scenario 1: High Volume Day - FashionHub Flash Sale

**Event**: FashionHub running 24-hour flash sale
**Expected Volume**: 5,000 transactions (20x normal)
**Peak Time**: 12:00 PM - 2:00 PM

**Handling Strategy:**

```javascript
{
  "scalingConfig": {
    "autoScaling": true,
    "minInstances": 10,
    "maxInstances": 50,
    "targetCPU": 70,
    "currentInstances": 35
  },
  "routing": {
    "strategy": "load_balanced",
    "gateways": [
      { "name": "razorpay", "weight": 40, "load": 65% },
      { "name": "payu", "weight": 35, "load": 58% },
      { "name": "ccavenue", "weight": 25, "load": 45% }
    ]
  },
  "rateLimit": {
    "merchant": "MERCH_FH_001",
    "increased": true,
    "requestsPerMinute": 5000, // Normally 1000
    "burstLimit": 10000
  }
}
```

**Performance Metrics:**
```
12:00 PM - 2:00 PM Stats:
- Total Transactions: 3,245
- Success Rate: 97.8%
- Average Response Time: 1.8 seconds
- Peak TPS: 45 transactions/second
- Zero downtime
```

### Scenario 2: Multi-Merchant Concurrent Transactions

**Time**: 10:30:00 AM
**Situation**: All 5 merchants have active customers making payments

```javascript
{
  "concurrent_transactions": {
    "timestamp": "2024-01-15T10:30:00Z",
    "active_transactions": [
      {
        "merchantId": "MERCH_FH_001",
        "merchantName": "FashionHub",
        "orderId": "order_FH_1234567890",
        "amount": 2500.00,
        "status": "processing",
        "paymentMethod": "upi",
        "gateway": "razorpay"
      },
      {
        "merchantId": "MERCH_TG_002",
        "merchantName": "TechGadgets",
        "orderId": "order_TG_9876543210",
        "amount": 15000.00,
        "status": "processing",
        "paymentMethod": "emi",
        "gateway": "payu"
      },
      {
        "merchantId": "MERCH_GQ_003",
        "merchantName": "GroceryQuick",
        "orderId": "order_GQ_5555555555",
        "amount": 850.00,
        "status": "processing",
        "paymentMethod": "wallet",
        "gateway": "razorpay"
      },
      {
        "merchantId": "MERCH_BW_004",
        "merchantName": "BookWorld",
        "orderId": "order_BW_1111111111",
        "amount": 450.00,
        "status": "processing",
        "paymentMethod": "upi",
        "gateway": "ccavenue"
      },
      {
        "merchantId": "MERCH_HD_005",
        "merchantName": "HomeDecor",
        "orderId": "order_HD_7777777777",
        "amount": 25000.00,
        "status": "processing",
        "paymentMethod": "card",
        "gateway": "payu"
      }
    ]
  }
}
```

**Isolation Guarantee:**
- Each transaction is processed independently
- Merchant A's failure doesn't affect Merchant B
- Separate database transactions
- Independent webhook notifications
- Individual rate limits

### Scenario 3: Payment Failure and Retry

**Merchant**: TechGadgets  
**Order**: ₹8,000 laptop purchase  
**Issue**: First payment attempt fails

**Timeline:**
```
10:15:00 - Payment initiated (Gateway: Razorpay)
10:15:10 - Gateway timeout
10:15:15 - Automatic failover triggered
10:15:20 - Retry via PayU gateway
10:15:35 - Payment successful
```

**Technical Flow:**
```javascript
// First Attempt
{
  "attempt": 1,
  "gateway": "razorpay",
  "status": "failed",
  "error": "timeout",
  "timestamp": "2024-01-15T10:15:10Z"
}

// Automatic Failover
{
  "failover": {
    "triggered": true,
    "reason": "gateway_timeout",
    "fromGateway": "razorpay",
    "toGateway": "payu",
    "retryDelay": "5s"
  }
}

// Second Attempt (Success)
{
  "attempt": 2,
  "gateway": "payu",
  "status": "success",
  "paymentId": "pay_TG_9876543210",
  "timestamp": "2024-01-15T10:15:35Z"
}
```

### Scenario 4: Refund Processing

**Merchant**: GroceryQuick  
**Reason**: Item out of stock  
**Original Payment**: ₹1,200

**Refund Flow:**
```javascript
// Merchant initiates refund
const refundRequest = await axios.post(
  'https://api.paymentgateway.com/v1/api/payments/refund',
  {
    paymentId: 'pay_GQ_5555555555',
    amount: 1200.00,
    reason: 'out_of_stock',
    merchantRefundId: 'REF_GQ_12345'
  },
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

// Response
{
  "success": true,
  "refundId": "rfnd_GQ_1234567890",
  "paymentId": "pay_GQ_5555555555",
  "amount": 1200.00,
  "status": "processing",
  "estimatedCompletion": "2024-01-20T00:00:00Z" // 5-7 business days
}
```

**Refund Timeline:**
```
Day 0: Refund initiated by merchant
Day 0: Gateway processes refund request
Day 0-1: Payment provider processes
Day 5-7: Amount credited to customer bank account
```

### Scenario 5: Cross-Merchant Analytics

**Platform Level View:**

```javascript
{
  "date": "2024-01-15",
  "platformStats": {
    "totalMerchants": 5,
    "activeMerchants": 5,
    "totalTransactions": 1245,
    "totalVolume": 89456780.00,
    "successRate": 96.8,
    "averageTicketSize": 7185.00
  },
  "merchantBreakdown": [
    {
      "merchantId": "MERCH_HD_005",
      "name": "HomeDecor",
      "transactions": 125,
      "volume": 25678900.00,
      "share": "28.7%"
    },
    {
      "merchantId": "MERCH_TG_002",
      "name": "TechGadgets",
      "transactions": 342,
      "volume": 34567800.00,
      "share": "38.7%"
    },
    {
      "merchantId": "MERCH_FH_001",
      "name": "FashionHub",
      "transactions": 456,
      "volume": 18456200.00,
      "share": "20.6%"
    },
    {
      "merchantId": "MERCH_GQ_003",
      "name": "GroceryQuick",
      "transactions": 245,
      "volume": 8234560.00,
      "share": "9.2%"
    },
    {
      "merchantId": "MERCH_BW_004",
      "name": "BookWorld",
      "transactions": 77,
      "volume": 2519320.00,
      "share": "2.8%"
    }
  ]
}
```

---

**Next Steps**: Proceed to [Data Flow Architecture](03_DATA_FLOW.md) for detailed technical data flow documentation.
