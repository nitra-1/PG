# Merchant Onboarding and Configuration API Documentation

## Overview

The Merchant API provides comprehensive functionality for merchant onboarding, configuration, and management. It includes features for:

- Merchant registration and management
- API key generation and revocation
- Webhook configuration
- Rate limiting per merchant
- IP whitelisting
- Usage tracking and statistics

## Base URL

```
http://localhost:3000/api/merchants
```

## Authentication

Most endpoints require authentication. The merchant API supports two authentication methods:

1. **JWT Token** (for admin operations): Include in `Authorization` header as `Bearer <token>`
2. **API Key** (for merchant operations): Include in `X-API-Key` header

## Endpoints

### 1. Register Merchant

Register a new merchant and generate initial API credentials.

**Endpoint:** `POST /api/merchants`

**Request Body:**
```json
{
  "merchantName": "Test Merchant",
  "merchantCode": "TEST_MERCH_001",
  "email": "merchant@example.com",
  "phone": "+919876543210",
  "businessType": "E-commerce",
  "websiteUrl": "https://example.com",
  "callbackUrl": "https://example.com/callback",
  "address": {
    "street": "123 Business Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "country": "India",
    "zipCode": "400001"
  },
  "businessDetails": {
    "registrationNumber": "REG123456",
    "taxId": "TAX123456"
  },
  "dailyLimit": 500000,
  "monthlyLimit": 5000000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Merchant registered successfully",
  "data": {
    "merchant": {
      "id": "uuid",
      "merchant_code": "TEST_MERCH_001",
      "merchant_name": "Test Merchant",
      "email": "merchant@example.com",
      "status": "active",
      "created_at": "2024-01-04T09:00:00.000Z"
    },
    "apiKey": {
      "keyId": "uuid",
      "apiKey": "pk_...",
      "apiSecret": "sk_...",
      "keyName": "Primary Key",
      "expiresAt": "2025-01-04T09:00:00.000Z",
      "message": "Store the API secret securely. It will not be shown again."
    }
  }
}
```

### 2. Get Merchant Details

Retrieve merchant details including all configurations.

**Endpoint:** `GET /api/merchants/:id`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "merchant_code": "TEST_MERCH_001",
    "merchant_name": "Test Merchant",
    "email": "merchant@example.com",
    "status": "active",
    "daily_limit": "500000.00",
    "monthly_limit": "5000000.00",
    "apiKeys": [
      {
        "id": "uuid",
        "key_name": "Primary Key",
        "api_key": "pk_...",
        "status": "active",
        "expires_at": "2025-01-04T09:00:00.000Z",
        "created_at": "2024-01-04T09:00:00.000Z"
      }
    ],
    "webhooks": [],
    "rateLimits": [],
    "ipWhitelist": []
  }
}
```

### 3. Update Merchant Settings

Update merchant configuration and settings.

**Endpoint:** `PUT /api/merchants/:id`

**Request Body:**
```json
{
  "merchant_name": "Updated Merchant Name",
  "email": "newemail@example.com",
  "phone": "+919876543210",
  "businessType": "Retail",
  "websiteUrl": "https://newdomain.com",
  "callbackUrl": "https://newdomain.com/callback",
  "status": "active",
  "daily_limit": 1000000,
  "monthly_limit": 10000000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Merchant updated successfully",
  "data": {
    "id": "uuid",
    "merchant_name": "Updated Merchant Name",
    "email": "newemail@example.com",
    "updated_at": "2024-01-04T10:00:00.000Z"
  }
}
```

### 4. Delete Merchant

Soft delete a merchant (sets status to inactive).

**Endpoint:** `DELETE /api/merchants/:id`

**Response:**
```json
{
  "success": true,
  "message": "Merchant deleted successfully"
}
```

### 5. Generate API Key

Generate a new API key for the merchant.

**Endpoint:** `POST /api/merchants/:id/api-keys`

**Request Body:**
```json
{
  "keyName": "Production Key",
  "permissions": ["all"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "API key generated successfully",
  "data": {
    "keyId": "uuid",
    "apiKey": "pk_...",
    "apiSecret": "sk_...",
    "keyName": "Production Key",
    "expiresAt": "2025-01-04T09:00:00.000Z",
    "message": "Store the API secret securely. It will not be shown again."
  }
}
```

**Note:** The API secret is only returned once during generation. Store it securely.

### 6. Revoke API Key

Revoke an existing API key.

**Endpoint:** `DELETE /api/merchants/:id/api-keys/:keyId`

**Response:**
```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

### 7. Configure Webhook

Configure webhook URL and events for the merchant.

**Endpoint:** `POST /api/merchants/:id/webhooks`

**Request Body:**
```json
{
  "webhookUrl": "https://example.com/webhook",
  "events": [
    "payment.success",
    "payment.failed",
    "refund.processed"
  ],
  "retryAttempts": 3,
  "retryDelay": 5000,
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook configured successfully",
  "data": {
    "webhookId": "uuid",
    "webhookUrl": "https://example.com/webhook",
    "webhookSecret": "wh_secret_...",
    "events": ["payment.success", "payment.failed", "refund.processed"],
    "message": "Webhook configured successfully. Store the secret securely."
  }
}
```

### 8. Update Webhook

Update webhook configuration.

**Endpoint:** `PUT /api/merchants/:id/webhooks/:webhookId`

**Request Body:**
```json
{
  "webhookUrl": "https://example.com/new-webhook",
  "status": "active",
  "events": ["payment.success", "payment.failed"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook updated successfully",
  "data": {
    "id": "uuid",
    "webhook_url": "https://example.com/new-webhook",
    "status": "active"
  }
}
```

### 9. Configure Rate Limit

Set rate limiting rules for the merchant.

**Endpoint:** `POST /api/merchants/:id/rate-limits`

**Request Body:**
```json
{
  "endpointPattern": "/api/payments/*",
  "maxRequests": 100,
  "windowMs": 60000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Rate limit configured successfully",
  "data": {
    "id": "uuid",
    "endpoint_pattern": "/api/payments/*",
    "max_requests": 100,
    "window_ms": 60000,
    "status": "active"
  }
}
```

**Note:** 
- `endpointPattern` supports wildcards (e.g., `/api/*`, `/api/payments/*`)
- `windowMs` is in milliseconds (60000 = 1 minute)

### 10. Add IP to Whitelist

Add an IP address to the merchant's whitelist.

**Endpoint:** `POST /api/merchants/:id/ip-whitelist`

**Request Body:**
```json
{
  "ipAddress": "192.168.1.100",
  "description": "Office network"
}
```

**Response:**
```json
{
  "success": true,
  "message": "IP added to whitelist successfully",
  "data": {
    "id": "uuid",
    "ip_address": "192.168.1.100",
    "description": "Office network",
    "status": "active"
  }
}
```

**Note:** Supports both IPv4 and IPv6 addresses.

### 11. Remove IP from Whitelist

Remove an IP address from the whitelist.

**Endpoint:** `DELETE /api/merchants/:id/ip-whitelist/:ipId`

**Response:**
```json
{
  "success": true,
  "message": "IP removed from whitelist"
}
```

### 12. Get Usage Statistics

Retrieve usage statistics for the merchant.

**Endpoint:** `GET /api/merchants/:id/usage`

**Query Parameters:**
- `startDate` (optional): Start date in ISO format (e.g., 2024-01-01)
- `endDate` (optional): End date in ISO format (e.g., 2024-01-31)

**Response:**
```json
{
  "success": true,
  "data": {
    "statistics": [
      {
        "date": "2024-01-04",
        "endpoint": "/api/payments/process",
        "total_requests": 150,
        "successful_requests": 145,
        "failed_requests": 5,
        "total_amount": "125000.00",
        "total_transactions": 145
      }
    ],
    "summary": {
      "totalRequests": 150,
      "successfulRequests": 145,
      "failedRequests": 5,
      "totalAmount": 125000.00,
      "totalTransactions": 145
    }
  }
}
```

## Middleware

### Merchant Authentication

To use merchant-specific authentication with API keys:

```javascript
const { authenticateMerchant } = require('./src/merchant/merchant-middleware');
const config = require('./src/config/config');

// Apply to routes
app.use('/api/protected-endpoint', authenticateMerchant(config), (req, res) => {
  // req.merchant contains merchant details
  res.json({ merchantId: req.merchant.merchantId });
});
```

### IP Whitelisting

To enable IP whitelisting check:

```javascript
const { checkIPWhitelist } = require('./src/merchant/merchant-middleware');

// Apply after authentication
app.use(authenticateMerchant(config));
app.use(checkIPWhitelist);
```

### Rate Limiting

To apply per-merchant rate limiting:

```javascript
const { merchantRateLimit } = require('./src/merchant/merchant-middleware');
const redis = require('./redis-client'); // Your Redis client

// Apply after authentication
app.use(authenticateMerchant(config));
app.use(merchantRateLimit(redis));
```

### Usage Tracking

To track API usage:

```javascript
const { trackMerchantUsage } = require('./src/merchant/merchant-middleware');

// Apply after authentication
app.use(authenticateMerchant(config));
app.use(trackMerchantUsage(config));
```

## Security Features

### 1. API Key Encryption

- API secrets are encrypted using AES-256-GCM before storage
- Only hashed versions are stored for verification
- Secrets are only shown once during generation

### 2. Rate Limiting

- Configurable per merchant and endpoint
- Supports Redis for distributed rate limiting
- Falls back to in-memory storage if Redis unavailable

### 3. IP Whitelisting

- Optional per-merchant IP restrictions
- Supports both IPv4 and IPv6
- If configured, only whitelisted IPs can access APIs

### 4. Webhook Security

- Unique webhook secret per merchant
- Use HMAC signature verification for webhook payloads
- Automatic retry mechanism with configurable attempts

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing API key)
- `403` - Forbidden (IP not whitelisted)
- `404` - Not Found
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Merchant Dashboard

Access the merchant dashboard at:

```
http://localhost:3000/merchant-dashboard.html?merchantId=<your-merchant-id>
```

The dashboard provides:
- Overview of merchant statistics
- Settings management
- API key generation and management
- Webhook configuration
- Rate limit configuration
- IP whitelist management
- Usage statistics visualization

## Rate Limit Headers

When rate limiting is active, responses include headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-04T10:00:00.000Z
```

## Example Integration

### Node.js Example

```javascript
const axios = require('axios');

// Register merchant
const registerMerchant = async () => {
  const response = await axios.post('http://localhost:3000/api/merchants', {
    merchantName: 'My Store',
    merchantCode: 'MY_STORE_001',
    email: 'store@example.com',
    phone: '+919876543210',
    businessType: 'E-commerce'
  });
  
  const { apiKey, apiSecret } = response.data.data.apiKey;
  console.log('API Key:', apiKey);
  console.log('API Secret:', apiSecret);
  
  return { apiKey, apiSecret };
};

// Make authenticated request
const makePayment = async (apiKey) => {
  const response = await axios.post(
    'http://localhost:3000/api/payments/process',
    {
      amount: 1000,
      currency: 'INR',
      paymentMethod: 'upi'
    },
    {
      headers: {
        'X-API-Key': apiKey
      }
    }
  );
  
  return response.data;
};
```

### cURL Examples

```bash
# Register merchant
curl -X POST http://localhost:3000/api/merchants \
  -H "Content-Type: application/json" \
  -d '{
    "merchantName": "Test Merchant",
    "merchantCode": "TEST_001",
    "email": "test@example.com",
    "phone": "+919876543210"
  }'

# Get merchant details
curl -X GET http://localhost:3000/api/merchants/{merchant-id}

# Generate API key
curl -X POST http://localhost:3000/api/merchants/{merchant-id}/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "keyName": "Production Key",
    "permissions": ["all"]
  }'

# Configure webhook
curl -X POST http://localhost:3000/api/merchants/{merchant-id}/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "webhookUrl": "https://example.com/webhook",
    "events": ["payment.success", "payment.failed"]
  }'

# Make authenticated request
curl -X POST http://localhost:3000/api/payments/process \
  -H "X-API-Key: pk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "currency": "INR",
    "paymentMethod": "upi"
  }'
```

## Best Practices

1. **API Key Security**
   - Store API secrets securely (never in code)
   - Use environment variables
   - Rotate keys regularly
   - Revoke unused keys

2. **Rate Limiting**
   - Start with conservative limits
   - Monitor usage patterns
   - Adjust limits based on actual needs

3. **IP Whitelisting**
   - Use for production environments
   - Whitelist only necessary IPs
   - Update list when infrastructure changes

4. **Webhooks**
   - Always verify webhook signatures
   - Implement idempotency
   - Handle retries gracefully
   - Log all webhook deliveries

5. **Usage Monitoring**
   - Regularly review usage statistics
   - Set up alerts for unusual patterns
   - Monitor success/failure rates
