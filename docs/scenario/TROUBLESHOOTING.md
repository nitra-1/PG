# Troubleshooting Guide

## Table of Contents
1. [Common Integration Issues](#common-integration-issues)
2. [Payment Failures](#payment-failures)
3. [Webhook Issues](#webhook-issues)
4. [API Errors](#api-errors)
5. [Settlement Issues](#settlement-issues)
6. [Dashboard Access Issues](#dashboard-access-issues)

## Common Integration Issues

### Issue 1: Authentication Failed - Invalid API Key

**Symptoms:**
```json
{
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Invalid API key"
  }
}
```

**Possible Causes:**
- Using wrong API key (test vs production)
- API key typo or copy-paste error
- API key not activated
- Merchant account suspended

**Solutions:**
1. Verify you're using the correct environment:
   - Sandbox: `pk_test_*`
   - Production: `pk_live_*`

2. Check API key in dashboard:
   ```
   Dashboard → Settings → API Credentials
   ```

3. Regenerate API key if needed:
   ```javascript
   // Correct usage
   const token = jwt.sign(
     { apiKey: 'pk_live_MERCH_correct_key', timestamp: Date.now() },
     'your_api_secret',
     { expiresIn: '1h' }
   );
   ```

4. Ensure API key is active (not revoked)

---

### Issue 2: CORS Error on Frontend

**Symptoms:**
```
Access to XMLHttpRequest at 'https://api.paymentgateway.com' from origin 
'https://yoursite.com' has been blocked by CORS policy
```

**Cause:**
Direct API calls from browser (client-side) are blocked for security reasons.

**Solution:**
Always make API calls from your backend server, never from browser:

```javascript
// ❌ Wrong - Direct call from browser
fetch('https://api.paymentgateway.com/api/orders', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token' // Exposed to browser!
  }
});

// ✅ Correct - Call through your backend
fetch('https://yoursite.com/api/create-order', {
  method: 'POST',
  body: JSON.stringify(orderData)
});

// Your backend then calls payment gateway
app.post('/api/create-order', async (req, res) => {
  const order = await pgClient.orders.create(req.body);
  res.json(order);
});
```

---

### Issue 3: SSL/HTTPS Certificate Error

**Symptoms:**
```
Error: unable to verify the first certificate
```

**Cause:**
Missing or invalid SSL certificate on your server.

**Solutions:**
1. Ensure your website has valid HTTPS:
   ```bash
   # Check SSL certificate
   curl -I https://yoursite.com
   ```

2. Install SSL certificate:
   ```bash
   # Using Let's Encrypt (free)
   sudo certbot --nginx -d yoursite.com
   ```

3. In Node.js, don't disable SSL verification:
   ```javascript
   // ❌ Never do this in production
   process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
   
   // ✅ Fix your SSL instead
   ```

---

### Issue 4: Request Timeout

**Symptoms:**
```json
{
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Request timed out after 30 seconds"
  }
}
```

**Possible Causes:**
- Network connectivity issues
- Server overload
- Large request payload
- Firewall blocking requests

**Solutions:**
1. Increase timeout in your HTTP client:
   ```javascript
   const axios = require('axios');
   
   const response = await axios.post(url, data, {
     timeout: 60000 // 60 seconds
   });
   ```

2. Implement retry logic:
   ```javascript
   async function retryRequest(fn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await sleep(1000 * Math.pow(2, i)); // Exponential backoff
       }
     }
   }
   ```

3. Check firewall rules:
   ```bash
   # Whitelist our IPs
   203.0.113.0/24
   198.51.100.0/24
   ```

## Payment Failures

### Issue 5: Payment Fails with "Insufficient Funds"

**Customer Sees:**
```
Payment failed: Insufficient funds in account
```

**Cause:**
Customer doesn't have enough balance.

**Solutions:**
1. Ask customer to:
   - Check account balance
   - Try different payment method
   - Use different account

2. Offer alternative payment methods:
   ```javascript
   // Show multiple payment options
   {
     "paymentMethods": ["upi", "card", "wallet", "bnpl"],
     "bnpl": {
       "available": true,
       "message": "Pay in 15 days at no extra cost"
     }
   }
   ```

---

### Issue 6: UPI Payment Stuck in Pending

**Symptoms:**
Payment shows "pending" for more than 5 minutes.

**Cause:**
- Customer didn't complete UPI authentication
- UPI app timeout
- Network issues

**Solutions:**
1. Check payment status via API:
   ```javascript
   const status = await pgClient.payments.get(paymentId);
   console.log(status.status); // 'pending', 'paid', 'failed'
   ```

2. Auto-expire pending payments after timeout:
   ```javascript
   // After 15 minutes, mark as failed
   setTimeout(async () => {
     const status = await checkPaymentStatus(paymentId);
     if (status === 'pending') {
       await cancelPayment(paymentId);
       notifyCustomer('Payment timeout. Please try again.');
     }
   }, 15 * 60 * 1000);
   ```

3. Implement payment status polling:
   ```javascript
   async function pollPaymentStatus(paymentId, maxAttempts = 10) {
     for (let i = 0; i < maxAttempts; i++) {
       const status = await pgClient.payments.get(paymentId);
       
       if (status.status === 'paid') {
         return 'success';
       } else if (status.status === 'failed') {
         return 'failed';
       }
       
       await sleep(5000); // Wait 5 seconds
     }
     return 'timeout';
   }
   ```

---

### Issue 7: Card Payment Fails with 3D Secure Error

**Symptoms:**
```
Payment failed: 3D Secure authentication failed
```

**Possible Causes:**
- Customer entered wrong OTP
- OTP expired
- 3DS timeout
- Bank system down

**Solutions:**
1. Allow retry with better error message:
   ```javascript
   if (error.code === '3DS_AUTHENTICATION_FAILED') {
     showMessage('Please verify the OTP sent to your registered mobile number');
     allowRetry();
   }
   ```

2. Implement fallback to non-3DS:
   ```javascript
   // If 3DS fails, try without 3DS (lower liability)
   const payment = await pgClient.payments.create({
     orderId: orderId,
     paymentMethod: 'card',
     cardToken: cardToken,
     threeDSecure: false // Disable 3DS
   });
   ```

3. Contact bank if repeated failures:
   ```
   Customer should contact their bank to:
   - Enable online transactions
   - Enable international transactions
   - Increase transaction limit
   ```

## Webhook Issues

### Issue 8: Webhooks Not Received

**Symptoms:**
- Payment successful but order status not updated
- No webhook events in logs

**Checklist:**
```yaml
1. Webhook URL Configuration:
   - Check Dashboard → Settings → Webhooks
   - URL must be HTTPS
   - URL must be publicly accessible
   - Correct endpoint path

2. Server Accessibility:
   - Server is running
   - No firewall blocking
   - Port 443 open
   - Valid SSL certificate

3. Webhook Handler:
   - Route exists
   - Handler function implemented
   - Returns 200 OK
   - Processes within 10 seconds
```

**Test Webhook Endpoint:**
```bash
# Test if your endpoint is accessible
curl -X POST https://yoursite.com/webhook/payment \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Should return 200 OK
```

**Debug Webhook Issues:**
```javascript
// Add logging
app.post('/webhook/payment', async (req, res) => {
  console.log('Webhook received:', {
    timestamp: new Date(),
    headers: req.headers,
    body: req.body
  });
  
  try {
    // Process webhook
    await handleWebhook(req.body);
    
    // MUST return 200
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    
    // Still return 200 to acknowledge receipt
    res.status(200).json({ received: true, error: error.message });
  }
});
```

**Check Webhook Logs:**
```
Dashboard → Developers → Webhooks → Delivery Logs

Look for:
- Status code (should be 200)
- Response time (should be < 10s)
- Error messages
- Retry attempts
```

---

### Issue 9: Webhook Signature Verification Failed

**Symptoms:**
```javascript
Error: Invalid webhook signature
```

**Cause:**
Signature mismatch due to:
- Wrong webhook secret
- Incorrect signature calculation
- Modified payload

**Solution:**
```javascript
// Correct signature verification
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  // payload must be raw body string, not parsed JSON
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

// Express middleware
app.use('/webhook/payment', express.raw({ type: 'application/json' }));

app.post('/webhook/payment', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body.toString('utf8'); // Raw body string
  
  if (verifyWebhookSignature(payload, signature, webhookSecret)) {
    const data = JSON.parse(payload);
    // Process webhook
  } else {
    return res.status(400).json({ error: 'Invalid signature' });
  }
});
```

## API Errors

### Issue 10: 400 Bad Request - Validation Error

**Symptoms:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "amount",
        "message": "Amount must be greater than 0"
      }
    ]
  }
}
```

**Solution:**
Validate input before sending:
```javascript
function validateOrder(data) {
  const errors = [];
  
  if (!data.amount || data.amount <= 0) {
    errors.push({ field: 'amount', message: 'Amount must be greater than 0' });
  }
  
  if (!data.currency || !['INR', 'USD'].includes(data.currency)) {
    errors.push({ field: 'currency', message: 'Invalid currency' });
  }
  
  if (!data.customerEmail || !isValidEmail(data.customerEmail)) {
    errors.push({ field: 'customerEmail', message: 'Invalid email' });
  }
  
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}
```

---

### Issue 11: 429 Too Many Requests - Rate Limit Exceeded

**Symptoms:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

**Cause:**
Exceeded API rate limits:
- 1000 requests per minute per merchant
- 100 requests per minute per IP

**Solutions:**
1. Implement rate limiting on your end:
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   const limiter = rateLimit({
     windowMs: 60 * 1000, // 1 minute
     max: 50, // 50 requests per minute
     message: 'Too many requests'
   });
   
   app.use('/api/', limiter);
   ```

2. Implement retry with backoff:
   ```javascript
   async function apiCallWithRetry(fn) {
     try {
       return await fn();
     } catch (error) {
       if (error.code === 'RATE_LIMIT_EXCEEDED') {
         const retryAfter = error.retryAfter || 60;
         await sleep(retryAfter * 1000);
         return await fn(); // Retry once
       }
       throw error;
     }
   }
   ```

3. Cache frequently accessed data:
   ```javascript
   const cache = new NodeCache({ stdTTL: 300 });
   
   async function getOrder(orderId) {
     let order = cache.get(orderId);
     if (!order) {
       order = await pgClient.orders.get(orderId);
       cache.set(orderId, order);
     }
     return order;
   }
   ```

## Settlement Issues

### Issue 12: Settlement Amount Doesn't Match Expected

**Symptoms:**
Expected ₹10,000 but received ₹9,650.

**Common Causes:**
```
Gross Amount:        ₹10,000.00
- MDR (1.8%):        -₹180.00
- GST on MDR (18%):  -₹32.40
- Refunds:           -₹100.00
- Adjustments:       -₹37.60
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Net Settlement:      ₹9,650.00
```

**How to Verify:**
1. Download settlement report from dashboard
2. Check for:
   - Refunds processed
   - Chargebacks
   - Adjustments
   - MDR and GST calculations

3. Formula:
   ```
   Net Settlement = Gross Amount - MDR - GST - Refunds - Chargebacks - Adjustments
   ```

4. Contact support if discrepancy remains:
   ```
   Email: settlements@paymentgateway.com
   Include:
   - Settlement ID
   - Expected amount
   - Actual amount
   - Screenshot of calculation
   ```

---

### Issue 13: Settlement Delayed

**Symptoms:**
Settlement not received on T+1 day.

**Possible Causes:**
- Bank holiday
- Incorrect bank details
- Account verification pending
- Settlement on hold

**Solutions:**
1. Check settlement status:
   ```
   Dashboard → Settlements → Settlement History
   ```

2. Verify bank details:
   ```
   Dashboard → Settings → Bank Account
   - Account number
   - IFSC code
   - Account holder name (must match registration)
   ```

3. Check for holds:
   ```
   Dashboard → Notifications
   Look for messages about settlement holds
   ```

4. Contact support:
   ```
   Settlement delays are rare. Contact us immediately:
   Phone: +91-80-1234-5678
   Email: settlements@paymentgateway.com
   ```

## Dashboard Access Issues

### Issue 14: Cannot Login to Merchant Dashboard

**Symptoms:**
"Invalid email or password" error.

**Solutions:**
1. Reset password:
   ```
   merchant.paymentgateway.com → Forgot Password
   ```

2. Check email for login link

3. Clear browser cache and cookies

4. Try different browser

5. Contact support if account locked:
   ```
   Accounts are locked after 5 failed login attempts.
   Contact: support@paymentgateway.com
   ```

---

### Issue 15: Dashboard Shows No Data

**Symptoms:**
Dashboard loads but shows no transactions/data.

**Possible Causes:**
- No transactions yet
- Date filter applied
- User doesn't have permissions
- Data sync issue

**Solutions:**
1. Check date range filter:
   ```
   Dashboard → Date Range → Select "All Time"
   ```

2. Verify you have transactions:
   ```
   Dashboard → Transactions → Check sandbox vs production
   ```

3. Check user permissions:
   ```
   Dashboard → Settings → Users → Check role permissions
   ```

4. Refresh data:
   ```
   Dashboard → Click refresh icon
   Clear cache: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   ```

## Getting Help

### When to Contact Support

Contact us immediately for:
- Payment processing stopped
- Settlement issues
- Security concerns
- Account suspended
- Critical production bugs

### How to Contact Support

```yaml
Email: support@paymentgateway.com
  Response Time: < 1 hour
  Include: Detailed description, screenshots, logs

Phone: +91-80-1234-5678
  Available: 24/7
  For: Urgent issues

Chat: merchant.paymentgateway.com
  Available: 24/7
  For: Quick questions

Developer Forum: community.paymentgateway.com
  For: Technical discussions, integration questions
```

### Information to Provide

When contacting support, include:
- Merchant ID
- Environment (sandbox/production)
- Order ID / Payment ID
- Timestamp of issue
- Error messages
- Screenshots
- Code snippets (remove sensitive data)
- Steps to reproduce

### Response Times

```yaml
Critical (Payment down): < 15 minutes
High (Major functionality impaired): < 1 hour
Medium (Minor issue): < 4 hours
Low (General questions): < 24 hours
```

---

**Last Updated**: January 2026  
**Version**: 1.0

Still having issues? Contact us at support@paymentgateway.com
