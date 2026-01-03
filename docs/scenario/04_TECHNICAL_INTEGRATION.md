# Technical Integration Guide

## Table of Contents
1. [Overview](#overview)
2. [Integration Prerequisites](#integration-prerequisites)
3. [SDK and API Setup](#sdk-and-api-setup)
4. [Code Examples by Merchant](#code-examples-by-merchant)
5. [Testing Procedures](#testing-procedures)
6. [Error Handling](#error-handling)
7. [Best Practices](#best-practices)

## Overview

This guide provides hands-on technical implementation details for integrating the payment gateway into your e-commerce platform. We'll walk through real code examples for each of our 5 merchant scenarios.

### Integration Approaches

```
1. Direct API Integration
   └─ Maximum flexibility
   └─ RESTful APIs with JSON
   └─ Best for custom implementations

2. SDK Integration
   └─ Pre-built libraries
   └─ Available for Node.js, Python, PHP, Java, .NET
   └─ Faster implementation

3. Plugin Integration
   └─ WooCommerce, Shopify, Magento plugins
   └─ No-code/Low-code solution
   └─ Quick setup

4. Hosted Checkout
   └─ Fully hosted payment page
   └─ PCI compliance handled by us
   └─ Easiest integration
```

## Integration Prerequisites

### Technical Requirements

```yaml
Server Requirements:
  - HTTPS/SSL certificate (TLS 1.2+)
  - Server-side programming language
  - Ability to make HTTP requests
  - Webhook endpoint capability
  - Database for order management

Development Environment:
  - Node.js >= 14 (or equivalent runtime)
  - Package manager (npm, yarn, pip, composer)
  - Git for version control
  - Code editor (VS Code, IntelliJ, etc.)

Security Requirements:
  - Secure credential storage
  - Input validation and sanitization
  - CSRF protection
  - XSS prevention
  - Rate limiting implementation
```

### Account Setup

1. **Get API Credentials**
```
Dashboard → Settings → API Credentials

Sandbox Credentials:
├─ API Key: pk_test_MERCHANT_xxxxx
├─ API Secret: sk_test_MERCHANT_xxxxx
└─ Webhook Secret: whsec_test_xxxxx

Production Credentials:
├─ API Key: pk_live_MERCHANT_xxxxx
├─ API Secret: sk_live_MERCHANT_xxxxx
└─ Webhook Secret: whsec_live_xxxxx
```

2. **Configure Webhook URL**
```
Dashboard → Settings → Webhooks
└─ Add Endpoint: https://yourdomain.com/webhook/payment
```

3. **Set IP Whitelist (Optional)**
```
Dashboard → Settings → Security
└─ Allowed IPs: 203.0.113.10, 203.0.113.11
```

## SDK and API Setup

### Node.js Integration

#### Installation

```bash
npm install @paymentgateway/node-sdk
# or
yarn add @paymentgateway/node-sdk
```

#### Basic Configuration

```javascript
// config/payment.js
const PaymentGateway = require('@paymentgateway/node-sdk');

const pgClient = new PaymentGateway({
  apiKey: process.env.PG_API_KEY,
  apiSecret: process.env.PG_API_SECRET,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  webhookSecret: process.env.PG_WEBHOOK_SECRET,
  timeout: 30000, // 30 seconds
  retries: 3
});

module.exports = pgClient;
```

#### Environment Variables

```bash
# .env
PG_API_KEY=pk_test_MERCH_FH_xxxxx
PG_API_SECRET=sk_test_MERCH_FH_xxxxx
PG_WEBHOOK_SECRET=whsec_test_xxxxx
NODE_ENV=development
```

### Python Integration

```bash
pip install paymentgateway-python
```

```python
# config/payment.py
from paymentgateway import PaymentGateway

pg_client = PaymentGateway(
    api_key=os.getenv('PG_API_KEY'),
    api_secret=os.getenv('PG_API_SECRET'),
    environment='sandbox' if os.getenv('ENV') != 'production' else 'production',
    webhook_secret=os.getenv('PG_WEBHOOK_SECRET')
)
```

### PHP Integration

```bash
composer require paymentgateway/php-sdk
```

```php
<?php
// config/payment.php
require 'vendor/autoload.php';

use PaymentGateway\Client;

$pgClient = new Client([
    'api_key' => $_ENV['PG_API_KEY'],
    'api_secret' => $_ENV['PG_API_SECRET'],
    'environment' => $_ENV['APP_ENV'] === 'production' ? 'production' : 'sandbox',
    'webhook_secret' => $_ENV['PG_WEBHOOK_SECRET']
]);
```

## Code Examples by Merchant

### Example 1: FashionHub - Standard Integration

**Scenario**: Fashion e-commerce with UPI, Cards, and Wallets

#### Step 1: Create Order on Checkout

```javascript
// routes/checkout.js
const express = require('express');
const router = express.Router();
const pgClient = require('../config/payment');
const Order = require('../models/Order');

router.post('/create-payment-order', async (req, res) => {
  try {
    const { cartItems, customerId, customerEmail, customerPhone } = req.body;
    
    // Calculate total amount
    const totalAmount = cartItems.reduce((sum, item) => 
      sum + (item.price * item.quantity), 0
    );
    
    // Create order in your database
    const localOrder = await Order.create({
      customerId,
      items: cartItems,
      totalAmount,
      status: 'pending'
    });
    
    // Create payment order via Payment Gateway
    const paymentOrder = await pgClient.orders.create({
      amount: totalAmount,
      currency: 'INR',
      customerId: customerId,
      customerEmail: customerEmail,
      customerPhone: customerPhone,
      description: `FashionHub Order #${localOrder.id}`,
      metadata: {
        orderId: localOrder.id,
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price
        }))
      },
      returnUrl: `${process.env.BASE_URL}/payment/callback`,
      webhookUrl: `${process.env.BASE_URL}/webhook/payment`
    });
    
    // Update local order with payment order ID
    await localOrder.update({
      paymentOrderId: paymentOrder.orderId,
      paymentStatus: 'initiated'
    });
    
    res.json({
      success: true,
      orderId: localOrder.id,
      paymentOrderId: paymentOrder.orderId,
      checkoutUrl: paymentOrder.paymentLinks.hosted,
      amount: totalAmount
    });
    
  } catch (error) {
    console.error('Order creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment order'
    });
  }
});

module.exports = router;
```

#### Step 2: Frontend Checkout Page

```javascript
// public/js/checkout.js
async function initiatePayment() {
  const cartItems = getCartItems();
  const customerInfo = getCustomerInfo();
  
  try {
    // Show loading
    showLoader();
    
    // Create payment order
    const response = await fetch('/checkout/create-payment-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cartItems,
        customerId: customerInfo.id,
        customerEmail: customerInfo.email,
        customerPhone: customerInfo.phone
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Redirect to hosted checkout page
      window.location.href = data.checkoutUrl;
      
      // OR use embedded checkout (SDK required)
      // await embedCheckout(data.paymentOrderId);
    } else {
      showError('Failed to initiate payment');
    }
    
  } catch (error) {
    console.error('Payment initiation failed:', error);
    showError('Something went wrong');
  } finally {
    hideLoader();
  }
}

// Embedded checkout option
async function embedCheckout(orderId) {
  const checkout = new PaymentGatewayCheckout({
    orderId: orderId,
    container: '#checkout-container',
    onSuccess: (response) => {
      window.location.href = `/payment/success?orderId=${response.orderId}`;
    },
    onFailure: (error) => {
      showError('Payment failed: ' + error.message);
    }
  });
  
  checkout.render();
}
```

#### Step 3: Handle Webhook

```javascript
// routes/webhook.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pgClient = require('../config/payment');
const Order = require('../models/Order');
const emailService = require('../services/email');
const inventoryService = require('../services/inventory');

router.post('/payment', async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-webhook-signature'];
    const payload = JSON.stringify(req.body);
    
    const expectedSignature = crypto
      .createHmac('sha256', process.env.PG_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const { event, data } = req.body;
    
    // Handle different event types
    switch (event) {
      case 'payment.success':
        await handlePaymentSuccess(data);
        break;
        
      case 'payment.failed':
        await handlePaymentFailed(data);
        break;
        
      case 'refund.processed':
        await handleRefundProcessed(data);
        break;
        
      default:
        console.log('Unhandled event type:', event);
    }
    
    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ received: true });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still respond with 200 to prevent retries for processing errors
    res.status(200).json({ received: true, error: error.message });
  }
});

async function handlePaymentSuccess(data) {
  const { orderId, paymentId, amount, paymentMethod } = data;
  
  // Update order status in database
  const order = await Order.findOne({ paymentOrderId: orderId });
  if (!order) {
    console.error('Order not found:', orderId);
    return;
  }
  
  await order.update({
    paymentStatus: 'paid',
    paymentId: paymentId,
    paymentMethod: paymentMethod,
    paidAt: new Date()
  });
  
  // Update inventory
  await inventoryService.updateInventory(order.items);
  
  // Send confirmation email
  await emailService.sendOrderConfirmation({
    email: order.customerEmail,
    orderId: order.id,
    amount: amount,
    paymentMethod: paymentMethod
  });
  
  // Trigger fulfillment
  await fulfillmentService.createShipment(order);
  
  console.log(`Payment successful for order ${order.id}`);
}

async function handlePaymentFailed(data) {
  const { orderId, failureReason } = data;
  
  const order = await Order.findOne({ paymentOrderId: orderId });
  if (order) {
    await order.update({
      paymentStatus: 'failed',
      failureReason: failureReason
    });
    
    // Send failure notification
    await emailService.sendPaymentFailureNotification({
      email: order.customerEmail,
      orderId: order.id,
      reason: failureReason
    });
  }
}

module.exports = router;
```

### Example 2: TechGadgets - EMI Integration

**Scenario**: Electronics store with EMI and high-value transactions

#### EMI Option Display

```javascript
// services/emi.js
const pgClient = require('../config/payment');

async function getEMIOptions(amount) {
  try {
    const emiPlans = await pgClient.emi.calculatePlans({
      amount: amount,
      currency: 'INR'
    });
    
    return emiPlans;
    
  } catch (error) {
    console.error('Failed to fetch EMI options:', error);
    return [];
  }
}

// Example response
/*
[
  {
    tenure: 3,
    monthlyInstallment: 2716.67,
    interestRate: 13,
    totalAmount: 8150.00,
    processingFee: 0
  },
  {
    tenure: 6,
    monthlyInstallment: 1391.67,
    interestRate: 13,
    totalAmount: 8350.00,
    processingFee: 200
  },
  {
    tenure: 12,
    monthlyInstallment: 729.17,
    interestRate: 15,
    totalAmount: 8750.00,
    processingFee: 500
  }
]
*/

module.exports = { getEMIOptions };
```

#### Process EMI Payment

```javascript
// routes/payment.js
router.post('/process-emi-payment', async (req, res) => {
  try {
    const { orderId, cardToken, emiTenure } = req.body;
    
    const order = await Order.findById(orderId);
    
    const payment = await pgClient.payments.create({
      orderId: order.paymentOrderId,
      paymentMethod: 'emi',
      paymentDetails: {
        cardToken: cardToken,
        emiTenure: emiTenure,
        cardType: 'credit' // EMI only available on credit cards
      }
    });
    
    res.json({
      success: true,
      paymentId: payment.paymentId,
      status: payment.status,
      emiDetails: payment.emiDetails
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### Example 3: GroceryQuick - BNPL Integration

**Scenario**: Grocery delivery with Buy Now Pay Later option

#### Check BNPL Eligibility

```javascript
// services/bnpl.js
async function checkBNPLEligibility(customerId, amount) {
  try {
    const eligibility = await pgClient.bnpl.checkEligibility({
      customerId: customerId,
      amount: amount,
      currency: 'INR'
    });
    
    return eligibility;
    
  } catch (error) {
    console.error('BNPL eligibility check failed:', error);
    return { eligible: false };
  }
}

// Example response
/*
{
  eligible: true,
  maxAmount: 5000,
  availableCredit: 4200,
  plans: [
    {
      id: 'bnpl_15days',
      name: 'Pay in 15 days',
      dueDate: '2024-01-30',
      interestRate: 0,
      totalAmount: 1200
    },
    {
      id: 'bnpl_2installments',
      name: 'Pay in 2 installments',
      installments: [
        { dueDate: '2024-01-22', amount: 600 },
        { dueDate: '2024-02-05', amount: 600 }
      ],
      interestRate: 0,
      totalAmount: 1200
    }
  ]
}
*/
```

#### Process BNPL Payment

```javascript
router.post('/process-bnpl-payment', async (req, res) => {
  try {
    const { orderId, bnplPlanId, customerConsent } = req.body;
    
    if (!customerConsent) {
      return res.status(400).json({
        success: false,
        error: 'Customer consent required for BNPL'
      });
    }
    
    const order = await Order.findById(orderId);
    
    const payment = await pgClient.payments.create({
      orderId: order.paymentOrderId,
      paymentMethod: 'bnpl',
      paymentDetails: {
        bnplPlanId: bnplPlanId,
        customerConsent: true
      }
    });
    
    res.json({
      success: true,
      paymentId: payment.paymentId,
      status: payment.status,
      bnplDetails: payment.bnplDetails
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### Example 4: BookWorld - Subscription Integration

**Scenario**: Book subscription service with recurring payments

#### Create Subscription

```javascript
// services/subscription.js
async function createSubscription(customerId, planId, paymentMethodId) {
  try {
    const subscription = await pgClient.subscriptions.create({
      customerId: customerId,
      planId: planId,
      paymentMethodId: paymentMethodId,
      startDate: new Date(),
      billingCycle: 'monthly',
      autoRenewal: true
    });
    
    return subscription;
    
  } catch (error) {
    console.error('Subscription creation failed:', error);
    throw error;
  }
}

// Handle subscription payment webhook
async function handleSubscriptionPayment(data) {
  const { subscriptionId, paymentId, status, nextBillingDate } = data;
  
  const subscription = await Subscription.findOne({ 
    pgSubscriptionId: subscriptionId 
  });
  
  if (status === 'success') {
    await subscription.update({
      status: 'active',
      lastPaymentDate: new Date(),
      nextBillingDate: nextBillingDate,
      lastPaymentId: paymentId
    });
    
    // Extend subscription period
    await subscriptionService.extendPeriod(subscription);
    
  } else if (status === 'failed') {
    await subscription.update({
      status: 'payment_failed',
      retryAttempts: subscription.retryAttempts + 1
    });
    
    // Send payment failure notification
    await notifySubscriptionPaymentFailure(subscription);
  }
}
```

### Example 5: HomeDecor - Split Payment

**Scenario**: High-value furniture with split payment options

#### Split Payment Implementation

```javascript
// routes/split-payment.js
router.post('/create-split-payment', async (req, res) => {
  try {
    const { orderId, splitConfig } = req.body;
    
    // Example splitConfig:
    // {
    //   method1: { type: 'card', amount: 10000 },
    //   method2: { type: 'emi', amount: 15000, tenure: 6 }
    // }
    
    const order = await Order.findById(orderId);
    const totalSplit = Object.values(splitConfig)
      .reduce((sum, config) => sum + config.amount, 0);
    
    if (totalSplit !== order.totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Split amounts do not match order total'
      });
    }
    
    const splitPaymentOrder = await pgClient.payments.createSplit({
      orderId: order.paymentOrderId,
      splits: [
        {
          paymentMethod: splitConfig.method1.type,
          amount: splitConfig.method1.amount,
          paymentDetails: splitConfig.method1.details
        },
        {
          paymentMethod: splitConfig.method2.type,
          amount: splitConfig.method2.amount,
          paymentDetails: splitConfig.method2.details
        }
      ]
    });
    
    res.json({
      success: true,
      splitPaymentId: splitPaymentOrder.id,
      payments: splitPaymentOrder.payments
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

## Testing Procedures

### Unit Testing

```javascript
// tests/payment.test.js
const { expect } = require('chai');
const sinon = require('sinon');
const paymentService = require('../services/payment');
const pgClient = require('../config/payment');

describe('Payment Service', () => {
  let pgClientStub;
  
  beforeEach(() => {
    pgClientStub = sinon.stub(pgClient.orders, 'create');
  });
  
  afterEach(() => {
    pgClientStub.restore();
  });
  
  it('should create payment order successfully', async () => {
    const mockOrder = {
      orderId: 'order_test_123',
      amount: 1000,
      currency: 'INR',
      status: 'created'
    };
    
    pgClientStub.resolves(mockOrder);
    
    const result = await paymentService.createOrder({
      amount: 1000,
      customerId: 'CUST_001'
    });
    
    expect(result).to.have.property('orderId');
    expect(result.amount).to.equal(1000);
  });
  
  it('should handle payment order creation failure', async () => {
    pgClientStub.rejects(new Error('API Error'));
    
    try {
      await paymentService.createOrder({
        amount: 1000,
        customerId: 'CUST_001'
      });
    } catch (error) {
      expect(error.message).to.equal('API Error');
    }
  });
});
```

### Integration Testing

```javascript
// tests/integration/payment.integration.test.js
const request = require('supertest');
const app = require('../app');

describe('Payment Integration Tests', () => {
  it('should create order and return checkout URL', async () => {
    const response = await request(app)
      .post('/checkout/create-payment-order')
      .send({
        cartItems: [
          { id: 1, name: 'Test Item', price: 100, quantity: 1 }
        ],
        customerId: 'CUST_TEST_001',
        customerEmail: 'test@example.com',
        customerPhone: '+919876543210'
      })
      .expect(200);
    
    expect(response.body).to.have.property('success', true);
    expect(response.body).to.have.property('checkoutUrl');
    expect(response.body).to.have.property('paymentOrderId');
  });
  
  it('should handle webhook correctly', async () => {
    const webhookPayload = {
      event: 'payment.success',
      data: {
        orderId: 'order_test_123',
        paymentId: 'pay_test_456',
        amount: 100,
        status: 'paid'
      }
    };
    
    const signature = generateWebhookSignature(webhookPayload);
    
    const response = await request(app)
      .post('/webhook/payment')
      .set('X-Webhook-Signature', signature)
      .send(webhookPayload)
      .expect(200);
    
    expect(response.body).to.have.property('received', true);
  });
});
```

### Test Data

```javascript
// Test cards for sandbox
const TEST_CARDS = {
  success: {
    number: '4111111111111111',
    cvv: '123',
    expiry: '12/25',
    name: 'Test User'
  },
  failure: {
    number: '4000000000000002',
    cvv: '123',
    expiry: '12/25',
    name: 'Test User'
  },
  insufficientFunds: {
    number: '4000000000000341',
    cvv: '123',
    expiry: '12/25',
    name: 'Test User'
  }
};

// Test UPI IDs
const TEST_UPI = {
  success: 'success@pgtestupi',
  failure: 'failure@pgtestupi',
  pending: 'pending@pgtestupi'
};
```

## Error Handling

### Error Types and Handling

```javascript
// middleware/errorHandler.js
class PaymentError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  
  if (err instanceof PaymentError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code
      }
    });
  }
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: err.errors
      }
    });
  }
  
  // Generic error
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error'
    }
  });
}

module.exports = { PaymentError, errorHandler };
```

### Retry Logic

```javascript
// utils/retry.js
async function retryWithExponentialBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry attempt ${i + 1} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const order = await retryWithExponentialBackoff(
  () => pgClient.orders.create(orderData),
  3,
  1000
);
```

## Best Practices

### Security Best Practices

```javascript
// 1. Never log sensitive data
function sanitizeForLogging(data) {
  const sanitized = { ...data };
  
  // Remove sensitive fields
  delete sanitized.cardNumber;
  delete sanitized.cvv;
  delete sanitized.apiSecret;
  
  // Mask email and phone
  if (sanitized.email) {
    sanitized.email = maskEmail(sanitized.email);
  }
  if (sanitized.phone) {
    sanitized.phone = maskPhone(sanitized.phone);
  }
  
  return sanitized;
}

// 2. Use environment variables for secrets
// ❌ Bad
const apiKey = 'pk_live_abc123';

// ✅ Good
const apiKey = process.env.PG_API_KEY;

// 3. Implement rate limiting
const rateLimit = require('express-rate-limit');

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later'
});

app.use('/api/payments', paymentLimiter);

// 4. Validate all inputs
const { body, validationResult } = require('express-validator');

const validatePaymentOrder = [
  body('amount').isNumeric().isFloat({ min: 1 }),
  body('currency').isIn(['INR', 'USD', 'EUR']),
  body('customerEmail').isEmail(),
  body('customerPhone').matches(/^\+?[1-9]\d{1,14}$/)
];

router.post('/create-order', validatePaymentOrder, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // Process order...
});
```

### Performance Optimization

```javascript
// 1. Use connection pooling
const pgClient = new PaymentGateway({
  apiKey: process.env.PG_API_KEY,
  apiSecret: process.env.PG_API_SECRET,
  poolSize: 20,
  keepAlive: true
});

// 2. Implement caching
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

async function getMerchantConfig(merchantId) {
  const cacheKey = `merchant:${merchantId}`;
  let config = cache.get(cacheKey);
  
  if (!config) {
    config = await pgClient.merchants.get(merchantId);
    cache.set(cacheKey, config);
  }
  
  return config;
}

// 3. Use async/await properly
// ❌ Bad - Sequential execution
const order = await createOrder();
const payment = await processPayment();
const notification = await sendNotification();

// ✅ Good - Parallel execution (when possible)
const [order, customerInfo] = await Promise.all([
  createOrder(),
  getCustomerInfo()
]);
```

### Monitoring and Logging

```javascript
// utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Log payment events
function logPaymentEvent(event, data) {
  logger.info('Payment Event', {
    event: event,
    orderId: data.orderId,
    amount: data.amount,
    status: data.status,
    timestamp: new Date()
  });
}

// Usage
logPaymentEvent('order.created', {
  orderId: 'order_123',
  amount: 1000,
  status: 'created'
});
```

---

**Next Steps**: Review [Security and Compliance](05_SECURITY_COMPLIANCE.md) for security best practices and compliance requirements.
