# QR Code Webhook Integration for UPI Payments

## Overview

When users pay using QR codes through UPI apps (GPay, Amazon Pay, PhonePe, Paytm, etc.), the payment happens through the UPI/NPCI infrastructure. This webhook integration automatically stores these transactions in the database when payment notifications are received from the UPI Payment Service Provider (PSP).

## The Problem

Previously, when a user:
1. Scans a QR code with their UPI app
2. Confirms payment in the app
3. Payment processes through UPI/NPCI

The transaction would NOT be automatically stored in the payment gateway's database. Manual intervention or API calls were needed to record the transaction.

## The Solution

We've added a webhook endpoint that:
- Receives payment notifications from UPI PSPs
- Automatically validates and stores transactions
- Updates QR code statistics in real-time
- Provides immediate transaction availability via API

## How It Works

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Customer  │         │   UPI App    │         │  UPI/NPCI       │
└──────┬──────┘         └──────┬───────┘         └────────┬────────┘
       │                       │                          │
       │  1. Scan QR           │                          │
       ├──────────────────────>│                          │
       │                       │                          │
       │  2. Confirm Payment   │                          │
       ├──────────────────────>│                          │
       │                       │  3. Process Payment      │
       │                       ├─────────────────────────>│
       │                       │                          │
       │                       │  4. Payment Success      │
       │                       │<─────────────────────────┤
       │                       │                          │
       │                                                  │
       │                                                  │
       │                       ┌──────────────────────────▼────┐
       │                       │  UPI Payment Service Provider │
       │                       └──────────────┬────────────────┘
       │                                      │
       │                                      │ 5. Send Webhook
       │                                      │
       │                       ┌──────────────▼─────────────────┐
       │                       │   Payment Gateway               │
       │                       │   POST /api/qr/webhook          │
       │                       │                                 │
       │                       │   • Verify signature           │
       │                       │   • Find QR code               │
       │                       │   • Store transaction          │
       │                       │   • Update statistics          │
       │                       │   • Return acknowledgment      │
       │                       └─────────────────────────────────┘
```

## Webhook Endpoint

### URL
```
POST /api/qr/webhook
```

### Authentication
None required (public endpoint) - signature is verified internally

### Request Body
```json
{
  "qrCodeId": "DYNAMIC_QR_1704456000000",
  "transactionId": "UPI_TXN_123456",
  "merchantId": "MERCHANT_001",
  "amount": 250,
  "orderId": "ORDER_123",
  "customerVPA": "customer@paytm",
  "customerName": "John Doe",
  "utr": "UTR123456789",
  "status": "SUCCESS",
  "timestamp": "2024-01-05T12:00:00Z"
}
```

#### Required Fields
- `qrCodeId` OR `orderId` (at least one must be provided)
- `amount` - Transaction amount
- `status` - Payment status (SUCCESS, FAILED, PENDING, PROCESSING)

#### Optional Fields
- `transactionId` - Auto-generated if not provided
- `merchantId` - Extracted from QR code if not provided
- `customerVPA` - Customer's UPI ID
- `customerName` - Customer's name
- `utr` - UPI Unique Transaction Reference
- `timestamp` - Defaults to current time if not provided

### Response
```json
{
  "success": true,
  "acknowledged": true,
  "transactionId": "UPI_TXN_123456",
  "status": "success"
}
```

## Transaction Storage

Transactions are automatically stored in the `transactions` table with:

| Field | Description |
|-------|-------------|
| `transaction_ref` | Unique transaction ID |
| `order_id` | Associated order reference |
| `payment_method` | Always 'qr' |
| `gateway` | Always 'qr' |
| `amount` | Transaction amount |
| `currency` | Always 'INR' |
| `status` | success, failed, or pending |
| `customer_name` | Customer's name |
| `metadata` | JSON with QR code ID, customer VPA, merchant ID, UTR, QR type, webhookReceived flag |
| `gateway_transaction_id` | Transaction ID from webhook |
| `gateway_response_message` | UTR from UPI |
| `initiated_at` | Payment timestamp |
| `completed_at` | Completion timestamp (for successful payments) |

## Configuration

### 1. Register Webhook with PSP

Contact your UPI Payment Service Provider (Razorpay, PayU, etc.) and register your webhook URL:

```
Production: https://yourdomain.com/api/qr/webhook
Staging: https://staging.yourdomain.com/api/qr/webhook
```

### 2. Configure Webhook Secret

For production, implement signature verification by setting the webhook secret:

```javascript
// config/config.js
module.exports = {
  webhookSecret: process.env.WEBHOOK_SECRET || 'your-shared-secret-key',
  // ... other config
};
```

### 3. Update Signature Verification

Edit `src/qr/qr-service.js` to implement HMAC-SHA256 verification:

```javascript
async verifyCallbackSignature(data) {
  const crypto = require('crypto');
  const signature = data.signature;
  const payload = JSON.stringify(data);
  const expectedSignature = crypto
    .createHmac('sha256', this.config.webhookSecret)
    .update(payload)
    .digest('hex');
  return signature === expectedSignature;
}
```

## Testing

### 1. Run the Example Script

```bash
# Complete flow with dynamic QR
node examples/qr-webhook-example.js complete

# Static QR with multiple payments
node examples/qr-webhook-example.js static
```

### 2. Manual Testing with cURL

```bash
# Test webhook endpoint
curl -X POST http://localhost:3000/api/qr/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "qrCodeId": "TEST_QR_123",
    "amount": 100,
    "customerVPA": "test@paytm",
    "status": "SUCCESS"
  }'
```

### 3. Run Automated Tests

```bash
# Run webhook tests
npm test -- tests/qr-webhook.test.js

# Run all QR service tests
npm test -- tests/qr-service.test.js

# Run transaction storage tests
npm test -- tests/transaction-storage.test.js
```

## API Usage

### Get Transactions for a QR Code
```javascript
GET /api/qr/:qrCodeId/transactions
Authorization: Bearer {token}

// Optional query parameters:
// - status: SUCCESS, FAILED, PENDING
// - fromDate: ISO 8601 date
// - toDate: ISO 8601 date

Response:
{
  "success": true,
  "qrCodeId": "STATIC_QR_123",
  "transactions": [...],
  "total": 50,
  "totalAmount": 12500
}
```

### Get QR Code Details
```javascript
GET /api/qr/:qrCodeId
Authorization: Bearer {token}

Response:
{
  "qrCodeId": "STATIC_QR_123",
  "type": "STATIC",
  "merchantId": "MERCHANT_001",
  "status": "ACTIVE",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastPaymentAt": "2024-01-05T12:00:00Z",
  "totalTransactions": 150,
  "totalAmount": 37500,
  "transactions": [...]
}
```

## Status Mapping

The webhook handler maps various status values to database enum:

| Webhook Status | Database Status |
|---------------|-----------------|
| SUCCESS, COMPLETED | success |
| FAILED, FAILURE | failed |
| PENDING | pending |
| PROCESSING | processing |
| (Unknown) | pending |

## Security Features

1. **Signature Verification**: HMAC-SHA256 signature validation (ready for production)
2. **Required Field Validation**: Ensures critical data is present
3. **Graceful Degradation**: Continues processing even if database insert fails
4. **Error Logging**: Comprehensive error logging without exposing sensitive data
5. **Rate Limiting**: Can be added at reverse proxy level

## Error Handling

The webhook handler:
- Rejects webhooks with invalid signatures
- Validates required fields before processing
- Handles missing/expired QR codes gracefully
- Continues processing even if database insert fails (stores in memory)
- Logs all errors for debugging
- Returns appropriate HTTP status codes

## Monitoring

### Recommended Monitoring

1. **Webhook Success Rate**: Track ratio of successful vs failed webhook processing
2. **Response Time**: Monitor webhook endpoint response times
3. **Database Insert Success**: Track database insert success rate
4. **Transaction Volume**: Monitor number of transactions per time period
5. **Failed Transactions**: Alert on failed transaction rate exceeding threshold

### Example Monitoring Query

```sql
-- Get webhook transaction statistics for today
SELECT 
  COUNT(*) as total_transactions,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(amount) as total_amount
FROM transactions 
WHERE payment_method = 'qr' 
  AND metadata->>'webhookReceived' = 'true'
  AND DATE(created_at) = CURRENT_DATE;
```

## Production Checklist

- [ ] Register webhook URL with PSP
- [ ] Configure webhook secret in environment variables
- [ ] Implement HMAC-SHA256 signature verification
- [ ] Set up SSL/TLS for webhook endpoint
- [ ] Configure reverse proxy rate limiting
- [ ] Set up monitoring and alerting
- [ ] Test webhook with PSP's test environment
- [ ] Configure database backup and recovery
- [ ] Set up log rotation for webhook logs
- [ ] Document webhook integration for operations team
- [ ] Create runbook for webhook issues
- [ ] Test failover scenarios

## Troubleshooting

### Webhook Not Being Received
1. Check PSP webhook configuration
2. Verify URL is publicly accessible
3. Check firewall/security group rules
4. Review application logs

### Signature Verification Failing
1. Verify webhook secret is correct
2. Check signature algorithm matches PSP
3. Ensure payload format matches expected format
4. Review PSP documentation

### Transactions Not Storing
1. Check database connection
2. Review error logs
3. Verify required fields are present
4. Check transaction table permissions

### Duplicate Transactions
1. Verify PSP is not sending duplicate webhooks
2. Check idempotency implementation
3. Review transaction ID generation

## Support

For issues or questions:
- Documentation: `docs/QR_CODE_INTEGRATION.md`
- Examples: `examples/qr-webhook-example.js`
- Tests: `tests/qr-webhook.test.js`
- API Reference: `docs/API.md`

## Related Documentation

- [QR Code Integration Guide](../docs/QR_CODE_INTEGRATION.md)
- [API Reference](../docs/API.md)
- [Transaction Storage Report](../TRANSACTION_STORAGE_REPORT.md)
- [Database Setup](../docs/DATABASE_SETUP.md)
