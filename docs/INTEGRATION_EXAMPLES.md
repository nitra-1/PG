# Merchant Integration Examples

This guide provides practical integration examples for the new payment features: BNPL with multiple providers, subscription payments, and enhanced QR codes.

## Table of Contents

1. [BNPL Integration Examples](#bnpl-integration-examples)
2. [Subscription Integration Examples](#subscription-integration-examples)
3. [QR Code Integration Examples](#qr-code-integration-examples)
4. [Complete E-commerce Flow](#complete-e-commerce-flow)

## BNPL Integration Examples

### Example 1: E-commerce Checkout with BNPL

```javascript
// Step 1: Display BNPL providers at checkout
async function displayBNPLOptions(cartTotal, customerId) {
  const token = getAuthToken();
  
  // Get available providers
  const providersResponse = await fetch('/api/bnpl/providers', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { providers } = await providersResponse.json();
  
  // Check eligibility for each provider
  const eligibilityPromises = providers.map(provider =>
    fetch('/api/bnpl/eligibility', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerId: customerId,
        customerPhone: '+919876543210',
        customerEmail: 'customer@example.com',
        amount: cartTotal,
        partner: provider
      })
    }).then(res => res.json())
  );
  
  const eligibilities = await Promise.all(eligibilityPromises);
  
  // Display eligible providers
  const eligibleProviders = eligibilities.filter(e => e.isEligible);
  displayProviderOptions(eligibleProviders);
}

// Step 2: Create BNPL order when customer selects provider
async function createBNPLOrder(provider, orderId, amount, customerId) {
  const token = getAuthToken();
  
  const response = await fetch('/api/bnpl/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customerId: customerId,
      customerEmail: 'customer@example.com',
      customerPhone: '+919876543210',
      amount: amount,
      orderId: orderId,
      merchantId: 'MERCHANT_001',
      partner: provider,
      installmentPlan: 'PAY_IN_3'
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    // Display success and installment schedule
    displayInstallmentSchedule(result.installmentSchedule);
    completeOrder(orderId);
  }
  
  return result;
}

// Step 3: Display installment schedule
function displayInstallmentSchedule(schedule) {
  schedule.forEach(installment => {
    console.log(`Installment ${installment.installmentNumber}: ₹${installment.amount}`);
    console.log(`Due Date: ${new Date(installment.dueDate).toLocaleDateString()}`);
  });
}
```

### Example 2: BNPL Provider Comparison Widget

```javascript
// Create a comparison widget for different BNPL providers
class BNPLComparisonWidget {
  constructor(amount, customerId) {
    this.amount = amount;
    this.customerId = customerId;
    this.providers = [];
  }
  
  async loadProviders() {
    const token = getAuthToken();
    
    // Get available providers
    const response = await fetch('/api/bnpl/providers', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const { providers } = await response.json();
    
    // Check eligibility for each
    for (const provider of providers) {
      const eligibility = await this.checkEligibility(provider);
      if (eligibility.isEligible) {
        this.providers.push({
          name: provider,
          ...eligibility
        });
      }
    }
    
    return this.providers;
  }
  
  async checkEligibility(provider) {
    const token = getAuthToken();
    
    const response = await fetch('/api/bnpl/eligibility', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerId: this.customerId,
        customerPhone: '+919876543210',
        customerEmail: 'customer@example.com',
        amount: this.amount,
        partner: provider
      })
    });
    
    return response.json();
  }
  
  render() {
    return `
      <div class="bnpl-comparison">
        <h3>Pay Later Options</h3>
        ${this.providers.map(p => `
          <div class="provider-card">
            <h4>${p.name}</h4>
            <p>Available Limit: ₹${p.availableLimit}</p>
            <p>Plans: ${p.supportedPlans.join(', ')}</p>
            <button onclick="selectProvider('${p.name}')">Select</button>
          </div>
        `).join('')}
      </div>
    `;
  }
}
```

## Subscription Integration Examples

### Example 1: SaaS Platform Subscription Flow

```javascript
// Step 1: Display subscription plans
async function displaySubscriptionPlans() {
  const token = getAuthToken();
  
  const response = await fetch('/api/subscriptions/plans', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const { plans } = await response.json();
  
  // Display plans to user
  plans.forEach(plan => {
    displayPlan(plan);
  });
}

// Step 2: Create subscription when user signs up
async function createSubscription(planId, customerId, paymentMethodId) {
  const token = getAuthToken();
  
  const response = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customerId: customerId,
      customerEmail: 'customer@example.com',
      planId: planId,
      paymentMethod: {
        type: 'card',
        cardId: paymentMethodId
      },
      metadata: {
        userId: customerId,
        source: 'website'
      }
    })
  });
  
  const { subscription } = await response.json();
  
  // Handle trial period
  if (subscription.status === 'TRIALING') {
    displayTrialMessage(subscription.trialEnd);
  }
  
  // Store subscription ID for future use
  localStorage.setItem('subscriptionId', subscription.subscriptionId);
  
  return subscription;
}

// Step 3: Handle subscription management
class SubscriptionManager {
  constructor(subscriptionId) {
    this.subscriptionId = subscriptionId;
    this.token = getAuthToken();
  }
  
  async getDetails() {
    const response = await fetch(`/api/subscriptions/${this.subscriptionId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    
    return response.json();
  }
  
  async pause(reason) {
    const response = await fetch(
      `/api/subscriptions/${this.subscriptionId}/pause`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      }
    );
    
    return response.json();
  }
  
  async resume() {
    const response = await fetch(
      `/api/subscriptions/${this.subscriptionId}/resume`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    return response.json();
  }
  
  async cancel(cancelAtPeriodEnd = true) {
    const response = await fetch(
      `/api/subscriptions/${this.subscriptionId}/cancel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cancelAtPeriodEnd,
          reason: 'CUSTOMER_REQUEST'
        })
      }
    );
    
    return response.json();
  }
  
  async getBillingHistory() {
    const response = await fetch(
      `/api/subscriptions/${this.subscriptionId}/billing-history`,
      {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    return response.json();
  }
}

// Usage
const manager = new SubscriptionManager('SUB_1704456000000');
await manager.pause('Temporary hold');
await manager.resume();
```

### Example 2: Subscription Upgrade/Downgrade Flow

```javascript
async function changePlan(subscriptionId, newPlanId) {
  const token = getAuthToken();
  
  // Get current subscription
  const currentSub = await fetch(`/api/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());
  
  // Cancel current subscription at period end
  await fetch(`/api/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      cancelAtPeriodEnd: true,
      reason: 'PLAN_CHANGE'
    })
  });
  
  // Create new subscription with new plan
  const newSub = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customerId: currentSub.subscription.customerId,
      customerEmail: currentSub.subscription.customerEmail,
      planId: newPlanId,
      paymentMethod: currentSub.subscription.paymentMethod,
      startDate: currentSub.subscription.currentPeriodEnd
    })
  }).then(r => r.json());
  
  return newSub;
}
```

## QR Code Integration Examples

### Example 1: Restaurant Table QR Code System

```javascript
// Generate static QR for each table
async function setupTableQRCodes(restaurantId, tables) {
  const token = getAuthToken();
  const qrCodes = {};
  
  for (const table of tables) {
    const response = await fetch('/api/qr/static', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merchantId: restaurantId,
        merchantName: 'My Restaurant',
        merchantVPA: 'restaurant@upi',
        storeId: table.id,
        storeName: `Table ${table.number}`,
        purpose: 'Table Payment'
      })
    });
    
    const { qrCodeId, qrCodeImage } = await response.json();
    
    qrCodes[table.id] = {
      qrCodeId,
      qrCodeImage,
      tableNumber: table.number
    };
    
    // Print QR code for table
    printQRCode(qrCodeImage, table.number);
  }
  
  return qrCodes;
}

// Monitor payments in real-time
async function monitorTablePayments(qrCodeId) {
  const token = getAuthToken();
  
  // Poll for new transactions
  setInterval(async () => {
    const response = await fetch(`/api/qr/${qrCodeId}/transactions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const { transactions } = await response.json();
    
    // Get latest transaction
    if (transactions.length > 0) {
      const latest = transactions[0];
      if (isNewTransaction(latest)) {
        handleNewPayment(latest);
      }
    }
  }, 5000); // Check every 5 seconds
}
```

### Example 2: E-commerce Order QR Code

```javascript
// Generate dynamic QR for order checkout
async function generateOrderQR(order) {
  const token = getAuthToken();
  
  const response = await fetch('/api/qr/dynamic', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      merchantId: 'MERCHANT_001',
      merchantName: 'My Store',
      merchantVPA: 'store@upi',
      amount: order.total,
      orderId: order.id,
      description: order.description,
      expiryMinutes: 15
    })
  });
  
  const { qrCodeId, qrCodeImage, expiryTime } = await response.json();
  
  // Display QR to customer
  displayQRCode(qrCodeImage);
  
  // Start countdown timer
  startCountdown(expiryTime);
  
  // Poll for payment
  pollForPayment(qrCodeId, order.id);
  
  return { qrCodeId, expiryTime };
}

// Poll for payment completion
async function pollForPayment(qrCodeId, orderId) {
  const token = getAuthToken();
  const maxAttempts = 60; // 5 minutes with 5-second intervals
  let attempts = 0;
  
  const interval = setInterval(async () => {
    attempts++;
    
    const response = await fetch(`/api/qr/${qrCodeId}/transactions`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const { transactions } = await response.json();
    
    // Check if payment received
    const payment = transactions.find(t => t.orderId === orderId && t.status === 'SUCCESS');
    
    if (payment) {
      clearInterval(interval);
      handlePaymentSuccess(payment);
    }
    
    if (attempts >= maxAttempts) {
      clearInterval(interval);
      handlePaymentTimeout();
    }
  }, 5000);
}
```

## Complete E-commerce Flow

### Full Checkout with All Payment Options

```javascript
class CheckoutManager {
  constructor(cart, customer) {
    this.cart = cart;
    this.customer = customer;
    this.token = getAuthToken();
  }
  
  async displayPaymentOptions() {
    const total = this.cart.total;
    
    // Display traditional payment methods
    this.displayTraditionalMethods();
    
    // Check and display BNPL options
    const bnplOptions = await this.getBNPLOptions(total);
    if (bnplOptions.length > 0) {
      this.displayBNPLOptions(bnplOptions);
    }
    
    // Display subscription option if applicable
    if (this.cart.hasSubscriptionItems) {
      await this.displaySubscriptionOption();
    }
    
    // Display QR code option
    this.displayQROption();
  }
  
  async getBNPLOptions(amount) {
    const response = await fetch('/api/bnpl/providers', {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    
    const { providers } = await response.json();
    const eligible = [];
    
    for (const provider of providers) {
      const eligibility = await fetch('/api/bnpl/eligibility', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerId: this.customer.id,
          customerPhone: this.customer.phone,
          customerEmail: this.customer.email,
          amount: amount,
          partner: provider
        })
      }).then(r => r.json());
      
      if (eligibility.isEligible) {
        eligible.push({ provider, ...eligibility });
      }
    }
    
    return eligible;
  }
  
  async processPayment(method, details) {
    const orderId = `ORDER_${Date.now()}`;
    
    switch (method) {
      case 'bnpl':
        return this.processBNPL(orderId, details);
      case 'subscription':
        return this.processSubscription(details);
      case 'qr':
        return this.processQR(orderId);
      default:
        return this.processTraditional(orderId, method, details);
    }
  }
  
  async processBNPL(orderId, { provider, plan }) {
    const response = await fetch('/api/bnpl/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerId: this.customer.id,
        customerEmail: this.customer.email,
        customerPhone: this.customer.phone,
        amount: this.cart.total,
        orderId: orderId,
        merchantId: 'MERCHANT_001',
        partner: provider,
        installmentPlan: plan
      })
    });
    
    return response.json();
  }
  
  async processQR(orderId) {
    // Generate dynamic QR
    const response = await fetch('/api/qr/dynamic', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merchantId: 'MERCHANT_001',
        merchantName: 'My Store',
        merchantVPA: 'store@upi',
        amount: this.cart.total,
        orderId: orderId,
        description: this.cart.description
      })
    });
    
    const { qrCodeId, qrCodeImage } = await response.json();
    
    // Display QR and wait for payment
    return this.waitForQRPayment(qrCodeId, orderId, qrCodeImage);
  }
  
  async waitForQRPayment(qrCodeId, orderId, qrCodeImage) {
    return new Promise((resolve, reject) => {
      displayQRCode(qrCodeImage);
      
      const interval = setInterval(async () => {
        const response = await fetch(`/api/qr/${qrCodeId}/transactions`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        
        const { transactions } = await response.json();
        const payment = transactions.find(t => t.orderId === orderId);
        
        if (payment) {
          clearInterval(interval);
          resolve(payment);
        }
      }, 3000);
      
      // Timeout after 10 minutes
      setTimeout(() => {
        clearInterval(interval);
        reject(new Error('Payment timeout'));
      }, 600000);
    });
  }
}

// Usage
const checkout = new CheckoutManager(cart, customer);
await checkout.displayPaymentOptions();
const result = await checkout.processPayment('bnpl', {
  provider: 'klarna',
  plan: 'PAY_IN_3'
});
```

## Webhook Handler Examples

### Unified Webhook Handler

```javascript
const express = require('express');
const app = express();

app.post('/webhooks/payment-gateway', async (req, res) => {
  const { event, data } = req.body;
  
  try {
    switch (event) {
      // BNPL events
      case 'bnpl.order.status_updated':
        await handleBNPLStatusUpdate(data);
        break;
      case 'bnpl.installment.paid':
        await handleBNPLInstallmentPaid(data);
        break;
      case 'bnpl.installment.late':
        await handleBNPLLatePayment(data);
        break;
      
      // Subscription events
      case 'subscription.created':
        await handleSubscriptionCreated(data);
        break;
      case 'subscription.payment_succeeded':
        await handleSubscriptionPayment(data);
        break;
      case 'subscription.payment_failed':
        await handleSubscriptionPaymentFailed(data);
        break;
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(data);
        break;
      
      // QR Code events
      case 'qr.payment.success':
        await handleQRPaymentSuccess(data);
        break;
      case 'qr.payment.failed':
        await handleQRPaymentFailed(data);
        break;
      
      default:
        console.log(`Unhandled event: ${event}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function handleBNPLStatusUpdate(data) {
  // Update order status in database
  await updateOrderStatus(data.bnplOrderId, data.status);
  
  // Send notification to customer
  await sendNotification(data.customerId, `BNPL order ${data.status}`);
}

async function handleSubscriptionPayment(data) {
  // Extend subscription access
  await extendAccess(data.subscriptionId, data.subscription.nextBillingDate);
  
  // Send invoice to customer
  await sendInvoice(data.paymentId);
}

async function handleQRPaymentSuccess(data) {
  // Update order status
  await updateOrderStatus(data.orderId, 'PAID');
  
  // Send confirmation
  await sendPaymentConfirmation(data.transactionId);
  
  // Trigger fulfillment
  await triggerFulfillment(data.orderId);
}
```

## Support

For integration assistance:
- Email: integration-support@paymentgateway.com
- Documentation: https://docs.paymentgateway.com
- GitHub Issues: https://github.com/nitra-1/PG/issues
