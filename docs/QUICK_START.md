# Quick Start Guide - E-commerce Payment Integration

This is a quick reference guide to help you get started with integrating the Payment Gateway into your e-commerce platform.

## 📖 Documentation Index

### Main Guides
1. **[E-commerce Integration Guide](ECOMMERCE_INTEGRATION.md)** - Your primary resource
   - Complete integration steps
   - Code examples (Node.js, JavaScript)
   - API endpoints reference
   - Testing guidelines
   - Security best practices
   - Troubleshooting

2. **[Payment Flow Diagrams](PAYMENT_FLOW_DIAGRAMS.md)** - Visual reference
   - End-to-end flow diagrams
   - Payment method specific flows (UPI, Card, Net Banking)
   - Webhook flows
   - Error handling flows
   - State diagrams

### Supporting Documentation
- [API Reference](API.md) - Detailed API documentation
- [Security Guidelines](SECURITY.md) - Security and compliance
- [Deployment Guide](DEPLOYMENT.md) - Deployment instructions

## 🚀 5-Minute Integration

### Step 1: Get Credentials
```
Dashboard → Settings → API Credentials
- API Key: your-api-key
- API Secret: your-api-secret
- Webhook Secret: your-webhook-secret
```

### Step 2: Install Dependencies
```bash
npm install express axios jsonwebtoken crypto
```

### Step 3: Create Order
```javascript
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Generate token
const token = jwt.sign(
  { apiKey: 'your-api-key', timestamp: Date.now() },
  'your-api-secret',
  { expiresIn: '1h' }
);

// Create order
const response = await axios.post(
  'https://api.paymentgateway.com/v1/api/payin/orders',
  {
    amount: 999.00,
    currency: 'INR',
    customerId: 'CUST_123',
    customerEmail: 'customer@example.com',
    customerPhone: '+919876543210',
    description: 'Order #12345'
  },
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

console.log('Order ID:', response.data.orderId);
```

### Step 4: Process Payment
```javascript
// Process payment
await axios.post(
  `https://api.paymentgateway.com/v1/api/payin/orders/${orderId}/pay`,
  {
    paymentMethod: 'upi',
    paymentDetails: { vpa: 'customer@upi' }
  },
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);
```

### Step 5: Handle Webhook
```javascript
app.post('/payment/webhook', (req, res) => {
  // Verify signature
  const crypto = require('crypto');
  const signature = req.headers['x-webhook-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', 'your-webhook-secret')
    .update(JSON.stringify(req.body))
    .digest('hex');
  
  if (signature === expectedSignature) {
    // Process webhook
    const { event, orderId, status } = req.body;
    
    if (event === 'payment.success') {
      // Update order, send confirmation email
      console.log('Payment successful for order:', orderId);
    }
    
    res.json({ acknowledged: true });
  } else {
    res.status(401).json({ error: 'Invalid signature' });
  }
});
```

## 💳 Supported Payment Methods

| Method | Integration Complexity | Average Time |
|--------|----------------------|--------------|
| UPI | Easy | 2-3 seconds |
| Cards | Medium (3D Secure) | 30-60 seconds |
| Net Banking | Medium | 60-120 seconds |
| Wallets | Easy | 5-10 seconds |

## 🔑 Key Endpoints

```
POST   /api/payin/orders                    Create payment order
POST   /api/payin/orders/:orderId/pay       Process payment
GET    /api/payin/orders/:orderId/status    Check status
POST   /api/payments/:txnId/refund          Process refund
```

## 📊 Payment Flow Overview

```
Customer Checkout
    ↓
Create Order (Your Server → Gateway API)
    ↓
Show Payment Page (Customer selects method)
    ↓
Process Payment (Your Server → Gateway API)
    ↓
Customer Authenticates (UPI App/Bank)
    ↓
Payment Success/Failure
    ↓
Webhook Notification (Gateway → Your Server)
    ↓
Order Confirmation
```

## ⚠️ Important Notes

### Security
- ✅ Always verify webhook signatures
- ✅ Use HTTPS for all API calls
- ✅ Never expose API secrets in frontend
- ✅ Store credentials in environment variables

### Best Practices
- ✅ Implement payment status polling (fallback for webhooks)
- ✅ Set order expiry time (recommended: 30 minutes)
- ✅ Handle all error scenarios gracefully
- ✅ Log all payment transactions
- ✅ Implement retry logic for network errors

### Testing
- Use staging environment: `https://staging-api.paymentgateway.com/v1`
- Test cards: `4111111111111111` (success), `4000000000000002` (decline)
- Test UPI: `success@upi`, `failure@upi`

## 🐛 Common Issues

### Issue: Webhook not received
**Solution**: Check webhook URL configuration, firewall rules, and ensure endpoint returns 200 OK

### Issue: Payment stuck in PROCESSING
**Solution**: Implement status polling, check after 5-10 minutes

### Issue: Invalid signature error
**Solution**: Verify webhook secret, ensure payload is not modified

## 📞 Support

- **Documentation**: https://docs.paymentgateway.com
- **Email**: support@paymentgateway.com
- **Phone**: +91-80-12345678

## 📚 Next Steps

1. Read [E-commerce Integration Guide](ECOMMERCE_INTEGRATION.md) for detailed instructions
2. Review [Payment Flow Diagrams](PAYMENT_FLOW_DIAGRAMS.md) to understand flows
3. Set up staging environment and test integration
4. Implement webhook handling
5. Test all payment methods
6. Go live!

---

**Need Help?** Open an issue on GitHub or contact support@paymentgateway.com
