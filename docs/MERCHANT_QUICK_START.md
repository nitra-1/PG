# Merchant Quick Start Guide

## 🚀 Get Started in 5 Minutes

This guide will help you integrate the Payment Gateway into your application as a merchant.

## Step 1: Register Your Merchant Account

### Using API

```bash
curl -X POST http://localhost:3000/api/merchants \
  -H "Content-Type: application/json" \
  -d '{
    "merchantName": "My Online Store",
    "merchantCode": "MY_STORE",
    "email": "tech@mystore.com",
    "phone": "+919876543210",
    "businessType": "E-commerce",
    "websiteUrl": "https://mystore.com",
    "callbackUrl": "https://mystore.com/payment/callback"
  }'
```

### Response

You'll receive your merchant credentials:

```json
{
  "success": true,
  "data": {
    "merchant": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "merchant_code": "MY_STORE",
      "status": "active"
    },
    "apiKey": {
      "apiKey": "pk_1234567890abcdef...",
      "apiSecret": "sk_1234567890abcdef...",
      "message": "Store the API secret securely. It will not be shown again."
    }
  }
}
```

**⚠️ IMPORTANT**: Save your API secret immediately! It won't be shown again.

## Step 2: Access Your Dashboard

Open your browser and navigate to:

```
http://localhost:3000/merchant-dashboard.html?merchantId=YOUR_MERCHANT_ID
```

From the dashboard you can:
- View usage statistics
- Generate additional API keys
- Configure webhooks
- Set rate limits
- Manage IP whitelist

## Step 3: Make Your First Payment

### Node.js Example

```javascript
const axios = require('axios');

const processPayment = async () => {
  try {
    const response = await axios.post(
      'http://localhost:3000/api/payments/process',
      {
        amount: 1000,
        currency: 'INR',
        customerId: 'CUST_001',
        paymentMethod: 'upi',
        vpa: 'customer@bank'
      },
      {
        headers: {
          'X-API-Key': 'pk_your_api_key_here',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Payment successful:', response.data);
  } catch (error) {
    console.error('Payment failed:', error.response?.data || error.message);
  }
};

processPayment();
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/payments/process \
  -H "X-API-Key: pk_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "INR",
    "customerId": "CUST_001",
    "paymentMethod": "upi",
    "vpa": "customer@bank"
  }'
```

## Step 4: Configure Webhooks (Optional)

Webhooks notify your system about payment events in real-time.

### Via Dashboard
1. Go to "Webhooks" tab
2. Click "Configure Webhook"
3. Enter your webhook URL
4. Select events to subscribe to

### Via API

```bash
curl -X POST http://localhost:3000/api/merchants/YOUR_MERCHANT_ID/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://mystore.com/webhook",
    "events": [
      "payment.success",
      "payment.failed",
      "refund.processed"
    ]
  }'
```

### Handling Webhooks in Your Application

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  // Verify webhook signature
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  const webhookSecret = 'your_webhook_secret';
  
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook event
  const event = req.body;
  console.log('Received event:', event.type);
  
  switch(event.type) {
    case 'payment.success':
      // Update order status in your database
      console.log('Payment successful:', event.data);
      break;
    case 'payment.failed':
      // Handle payment failure
      console.log('Payment failed:', event.data);
      break;
    case 'refund.processed':
      // Handle refund
      console.log('Refund processed:', event.data);
      break;
  }
  
  res.sendStatus(200);
});

app.listen(3001, () => {
  console.log('Webhook server running on port 3001');
});
```

## Step 5: Set Up Rate Limits (Optional)

Protect your integration with rate limiting:

```bash
curl -X POST http://localhost:3000/api/merchants/YOUR_MERCHANT_ID/rate-limits \
  -H "Content-Type: application/json" \
  -d '{
    "endpointPattern": "/api/payments/*",
    "maxRequests": 100,
    "windowMs": 60000
  }'
```

This allows 100 requests per minute for payment endpoints.

## Step 6: Configure IP Whitelist (Optional)

For production security, whitelist your server IPs:

```bash
curl -X POST http://localhost:3000/api/merchants/YOUR_MERCHANT_ID/ip-whitelist \
  -H "Content-Type: application/json" \
  -d '{
    "ipAddress": "203.0.113.10",
    "description": "Production server"
  }'
```

## Common Integration Patterns

### E-commerce Checkout Flow

```javascript
// 1. Create payment order when user clicks "Pay"
const createOrder = async (cartTotal) => {
  const response = await axios.post(
    'http://localhost:3000/api/payin/orders',
    {
      amount: cartTotal,
      currency: 'INR',
      customerId: 'CUST_001',
      customerEmail: 'customer@email.com',
      callbackUrl: 'https://mystore.com/payment/callback'
    },
    { headers: { 'X-API-Key': apiKey } }
  );
  
  return response.data;
};

// 2. Redirect user to payment page
const redirectToPayment = (orderId) => {
  window.location.href = `http://localhost:3000/checkout.html?orderId=${orderId}`;
};

// 3. Handle callback after payment
app.get('/payment/callback', async (req, res) => {
  const { orderId, status } = req.query;
  
  // Verify payment status
  const response = await axios.get(
    `http://localhost:3000/api/payin/orders/${orderId}/status`,
    { headers: { 'X-API-Key': apiKey } }
  );
  
  if (response.data.status === 'success') {
    // Update order in your database
    await updateOrderStatus(orderId, 'paid');
    res.redirect('/order/success');
  } else {
    res.redirect('/order/failed');
  }
});
```

### Subscription Payments

```javascript
// Setup recurring payment
const setupSubscription = async (customerId, plan) => {
  const response = await axios.post(
    'http://localhost:3000/api/bnpl/orders',
    {
      customerId: customerId,
      amount: plan.amount,
      tenure: plan.billingCycle, // monthly, quarterly, yearly
      autoRenew: true
    },
    { headers: { 'X-API-Key': apiKey } }
  );
  
  return response.data;
};
```

### Bulk Payouts

```javascript
// Process bulk payouts to sellers/vendors
const processBulkPayouts = async (payouts) => {
  const response = await axios.post(
    'http://localhost:3000/api/payout/payouts/bulk',
    {
      payouts: payouts.map(p => ({
        beneficiaryId: p.vendorId,
        amount: p.amount,
        narration: p.description
      }))
    },
    { headers: { 'X-API-Key': apiKey } }
  );
  
  return response.data;
};
```

## Monitoring & Analytics

### Check Usage Statistics

```bash
curl -X GET "http://localhost:3000/api/merchants/YOUR_MERCHANT_ID/usage?startDate=2024-01-01&endDate=2024-01-31"
```

### Dashboard Metrics

Access your dashboard to view:
- Total requests
- Success/failure rates
- Transaction volumes
- Revenue metrics
- API performance

## Security Best Practices

### ✅ DO:
1. **Store API keys securely** - Use environment variables, never commit to code
2. **Use HTTPS** - Always use secure connections in production
3. **Verify webhooks** - Always validate webhook signatures
4. **Implement rate limiting** - Protect your integration from abuse
5. **Whitelist IPs** - Use IP restrictions for production
6. **Rotate keys** - Regularly generate new API keys
7. **Monitor usage** - Set up alerts for unusual activity
8. **Handle errors** - Implement proper error handling and retries

### ❌ DON'T:
1. **Don't expose API keys** - Never include in client-side code
2. **Don't skip validation** - Always validate responses
3. **Don't hardcode secrets** - Use configuration management
4. **Don't ignore webhooks** - Process all webhook events
5. **Don't skip testing** - Test in sandbox before production

## Testing

Use the included checkout page for testing:

```
http://localhost:3000/checkout.html
```

The page supports all payment methods:
- UPI
- Cards
- Net Banking
- Wallets
- QR Codes
- BNPL
- EMI
- Biometric

## Support

- **Documentation**: `/docs/MERCHANT_API.md`
- **Architecture**: `/docs/MERCHANT_ARCHITECTURE.md`
- **Test Script**: `node test-merchant-api.js`
- **Dashboard**: `http://localhost:3000/merchant-dashboard.html`

## Next Steps

1. **Production Setup**
   - Get production credentials
   - Configure SSL/TLS
   - Set up monitoring
   - Configure backup strategy

2. **Advanced Features**
   - Implement webhook handlers
   - Set up rate limiting
   - Configure IP whitelist
   - Enable advanced analytics

3. **Compliance**
   - Review PCI-DSS requirements
   - Implement KYC if required
   - Configure data retention policies
   - Set up audit logging

## Quick Reference

### Environment Variables

```bash
# Add to your .env file
PAYMENT_GATEWAY_API_KEY=pk_your_api_key
PAYMENT_GATEWAY_API_SECRET=sk_your_secret
PAYMENT_GATEWAY_BASE_URL=http://localhost:3000
WEBHOOK_SECRET=your_webhook_secret
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (IP not whitelisted)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-04T10:00:00.000Z
```

---

**Need help?** Check the complete API documentation at `/docs/MERCHANT_API.md`
