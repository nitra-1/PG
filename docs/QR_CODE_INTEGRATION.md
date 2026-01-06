# QR Code Payment Integration Guide

## Overview

The Payment Gateway provides comprehensive QR code payment solutions with real-time transaction linking, supporting both static and dynamic QR codes for in-store and remote payments.

## Features

- **Static QR Codes**: Reusable QR codes for fixed merchant/store locations
- **Dynamic QR Codes**: Single-use QR codes with pre-defined amounts
- **Real-time Transaction Linking**: Instant tracking of payments made via QR codes
- **Transaction History**: Complete payment history for each QR code
- **UPI Integration**: Full UPI compliance for QR code payments
- **Expiry Management**: Automatic expiry for dynamic QR codes
- **Analytics**: Detailed usage analytics for merchants

## QR Code Types

### 1. Static QR Codes

**Use Cases**:
- Store counters
- Restaurant tables
- Fixed merchant locations
- Recurring collection points

**Features**:
- Reusable
- No pre-defined amount
- Customer enters amount
- Never expires
- Multiple transactions

### 2. Dynamic QR Codes

**Use Cases**:
- Specific orders
- Fixed invoice amounts
- Time-sensitive payments
- One-time collections

**Features**:
- Single-use (optional)
- Pre-defined amount
- Auto-expiry (configurable)
- Linked to specific order
- Enhanced security

## API Endpoints

### 1. Generate Static QR Code

Create a reusable QR code for a merchant or store.

**Endpoint**: `POST /api/qr/static`

**Request**:
```json
{
  "merchantId": "MERCHANT_001",
  "merchantName": "Coffee Shop",
  "merchantVPA": "coffeeshop@upi",
  "storeId": "STORE_001",
  "storeName": "Downtown Branch",
  "purpose": "Store Payment"
}
```

**Response**:
```json
{
  "success": true,
  "qrCodeId": "STATIC_QR_1704456000000",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEU...",
  "qrCodeData": "upi://pay?pa=coffeeshop@upi&pn=Coffee%20Shop&cu=INR",
  "type": "STATIC"
}
```

### 2. Generate Dynamic QR Code

Create a single-use QR code with a specific amount.

**Endpoint**: `POST /api/qr/dynamic`

**Request**:
```json
{
  "merchantId": "MERCHANT_001",
  "merchantName": "Coffee Shop",
  "merchantVPA": "coffeeshop@upi",
  "amount": 250,
  "orderId": "ORDER_123",
  "description": "Coffee and Sandwich",
  "expiryMinutes": 30
}
```

**Response**:
```json
{
  "success": true,
  "qrCodeId": "DYNAMIC_QR_1704456000000",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEU...",
  "qrCodeData": "upi://pay?pa=coffeeshop@upi&pn=Coffee%20Shop&am=250&cu=INR&tr=ORDER_123&tn=Coffee%20and%20Sandwich",
  "type": "DYNAMIC",
  "amount": 250,
  "orderId": "ORDER_123",
  "expiryTime": "2024-01-05T12:30:00Z"
}
```

### 3. Process QR Code Payment

Process a payment made by scanning a QR code.

**Endpoint**: `POST /api/qr/:qrCodeId/payment`

**Request**:
```json
{
  "amount": 250,
  "orderId": "ORDER_123",
  "customerVPA": "customer@upi",
  "customerName": "John Doe"
}
```

**Response**:
```json
{
  "success": true,
  "transactionId": "TXN_QR_1704456000000",
  "qrCodeId": "DYNAMIC_QR_1704456000000",
  "amount": 250,
  "orderId": "ORDER_123",
  "status": "SUCCESS",
  "transaction": {
    "transactionId": "TXN_QR_1704456000000",
    "qrCodeId": "DYNAMIC_QR_1704456000000",
    "merchantId": "MERCHANT_001",
    "amount": 250,
    "orderId": "ORDER_123",
    "customerVPA": "customer@upi",
    "customerName": "John Doe",
    "status": "SUCCESS",
    "paymentMethod": "QR_CODE",
    "qrType": "DYNAMIC",
    "processedAt": "2024-01-05T12:00:00Z"
  },
  "timestamp": "2024-01-05T12:00:00Z"
}
```

### 4. Get QR Code Details

Get details and statistics for a QR code.

**Endpoint**: `GET /api/qr/:qrCodeId`

**Response**:
```json
{
  "qrCodeId": "STATIC_QR_1704456000000",
  "type": "STATIC",
  "merchantId": "MERCHANT_001",
  "status": "ACTIVE",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastPaymentAt": "2024-01-05T12:00:00Z",
  "totalTransactions": 150,
  "totalAmount": 37500,
  "transactions": [
    {
      "transactionId": "TXN_QR_1704456000000",
      "amount": 250,
      "status": "SUCCESS",
      "processedAt": "2024-01-05T12:00:00Z"
    }
  ]
}
```

### 5. Get QR Code Transactions

Get all transactions for a specific QR code with filtering options.

**Endpoint**: `GET /api/qr/:qrCodeId/transactions`

**Query Parameters**:
- `status` (optional): Filter by transaction status (SUCCESS, FAILED, PENDING)
- `fromDate` (optional): Start date for filtering (ISO 8601)
- `toDate` (optional): End date for filtering (ISO 8601)

**Response**:
```json
{
  "success": true,
  "qrCodeId": "STATIC_QR_1704456000000",
  "transactions": [
    {
      "transactionId": "TXN_QR_1704456000000",
      "qrCodeId": "STATIC_QR_1704456000000",
      "merchantId": "MERCHANT_001",
      "amount": 250,
      "orderId": "ORDER_123",
      "customerVPA": "customer@upi",
      "customerName": "John Doe",
      "status": "SUCCESS",
      "paymentMethod": "QR_CODE",
      "qrType": "STATIC",
      "processedAt": "2024-01-05T12:00:00Z"
    }
  ],
  "total": 150,
  "totalAmount": 37500
}
```

### 6. Get QR Analytics

Get analytics for merchant's QR codes.

**Endpoint**: `GET /api/qr/analytics?merchantId=MERCHANT_001`

**Response** (existing functionality):
```json
{
  "totalQRCodes": 10,
  "activeQRCodes": 8,
  "usedQRCodes": 50,
  "staticQRCodes": 5,
  "dynamicQRCodes": 5,
  "totalTransactions": 500
}
```

### 6. Get QR Analytics

Get analytics for merchant's QR codes.

**Endpoint**: `GET /api/qr/analytics?merchantId=MERCHANT_001`

**Response** (existing functionality):
```json
{
  "totalQRCodes": 10,
  "activeQRCodes": 8,
  "usedQRCodes": 50,
  "staticQRCodes": 5,
  "dynamicQRCodes": 5,
  "totalTransactions": 500
}
```

### 7. QR Payment Webhook (NEW)

Webhook endpoint to receive payment notifications from UPI Payment Service Providers when users complete payments via QR code scanning.

**Endpoint**: `POST /api/qr/webhook`

**Authentication**: None (public webhook endpoint - signature verified internally)

**Request Body**:
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

**Required Fields**:
- Either `qrCodeId` OR `orderId` (at least one)
- `amount` (transaction amount)
- `status` (SUCCESS, FAILED, PENDING, PROCESSING)

**Optional Fields**:
- `transactionId` (auto-generated if not provided)
- `merchantId` (extracted from QR if not provided)
- `customerVPA` (customer's UPI ID)
- `customerName` (customer's name)
- `utr` (Unique Transaction Reference from UPI)
- `timestamp` (payment timestamp, defaults to current time)

**Response**:
```json
{
  "success": true,
  "acknowledged": true,
  "transactionId": "UPI_TXN_123456",
  "status": "success"
}
```

**Status Values**:
- `SUCCESS` / `COMPLETED` → Mapped to `success`
- `FAILED` / `FAILURE` → Mapped to `failed`
- `PENDING` → Mapped to `pending`
- `PROCESSING` → Mapped to `processing`

**Security**:
- Signature verification using HMAC-SHA256 (configured in production)
- Validates required fields
- Prevents duplicate transaction storage
- Handles missing QR codes gracefully

## Integration Flow

### Static QR Code Flow

```
Merchant Setup
    ↓
Generate Static QR (POST /api/qr/static)
    ↓
Display/Print QR Code at Location
    ↓
Customer Scans QR with UPI App (GPay/Amazon Pay/PhonePe)
    ↓
Customer Enters Amount in UPI App
    ↓
Payment Processed via UPI/NPCI
    ↓
PSP Sends Webhook (POST /api/qr/webhook) ← NEW
    ↓
Transaction Automatically Stored in Database ← NEW
    ↓
Merchant Webhook Notification (if configured)
    ↓
Real-time Transaction Available (GET /api/qr/:qrCodeId/transactions)
```

### Dynamic QR Code Flow

```
Customer Places Order
    ↓
Generate Dynamic QR (POST /api/qr/dynamic)
    ↓
Display QR to Customer
    ↓
Customer Scans QR with UPI App
    ↓
Amount Pre-filled in UPI App
    ↓
Customer Confirms Payment
    ↓
Payment Processed via UPI/NPCI
    ↓
PSP Sends Webhook (POST /api/qr/webhook) ← NEW
    ↓
Transaction Automatically Stored in Database ← NEW
    ↓
QR Marked as USED (for single-use QR)
    ↓
Real-time Transaction Update
```

### Webhook Integration Flow (NEW)

```
1. User Scans QR Code
   ↓
2. Opens UPI App (GPay/Amazon Pay/PhonePe/etc.)
   ↓
3. Confirms Payment in UPI App
   ↓
4. UPI/NPCI Processes Payment
   ↓
5. Payment Service Provider (PSP) Sends Webhook
   ↓
   POST /api/qr/webhook
   {
     "qrCodeId": "QR_123",
     "amount": 250,
     "customerVPA": "customer@paytm",
     "utr": "UTR12345",
     "status": "SUCCESS"
   }
   ↓
6. Payment Gateway:
   - Verifies webhook signature
   - Finds QR code (by qrCodeId or orderId)
   - Stores transaction in database
   - Updates QR statistics
   - Marks single-use QR as USED
   ↓
7. Returns acknowledgment
   ↓
8. Transaction immediately available via API
```

## Real-Time Transaction Linking

### How It Works

1. **QR Code Generation**: Each QR code gets a unique ID
2. **Payment Processing**: When payment is made, transaction is created
3. **Instant Linking**: Transaction is immediately linked to QR code
4. **Real-time Updates**: QR code statistics updated instantly
5. **Historical Tracking**: All transactions stored with QR code reference

### Transaction Data Structure

Each transaction includes:
- Transaction ID
- QR Code ID
- Merchant ID
- Amount
- Order ID (if applicable)
- Customer details (VPA, name)
- Payment status
- Payment method
- QR type (STATIC/DYNAMIC)
- Processing timestamp

### Benefits

- **Instant Reconciliation**: Match payments to QR codes immediately
- **Fraud Prevention**: Track suspicious patterns across QR codes
- **Analytics**: Real-time insights into QR code performance
- **Customer Service**: Quick lookup of payment details
- **Audit Trail**: Complete transaction history

## UPI QR Code Format

### Static QR Format
```
upi://pay?pa=<VPA>&pn=<Name>&cu=INR
```

Example:
```
upi://pay?pa=merchant@upi&pn=Coffee%20Shop&cu=INR
```

### Dynamic QR Format
```
upi://pay?pa=<VPA>&pn=<Name>&am=<Amount>&cu=INR&tr=<OrderID>&tn=<Description>
```

Example:
```
upi://pay?pa=merchant@upi&pn=Coffee%20Shop&am=250&cu=INR&tr=ORDER_123&tn=Coffee%20and%20Sandwich
```

## Error Handling

### Common Errors

```json
{
  "error": "QR code not found"
}
```

```json
{
  "error": "QR code is not active"
}
```

```json
{
  "error": "QR code has expired"
}
```

```json
{
  "error": "QR code already used"
}
```

```json
{
  "error": "Amount mismatch"
}
```

## Webhook Notifications

### Configuring Webhooks

To receive automatic notifications when users pay via QR codes:

1. **Register Webhook URL with PSP**: Contact your UPI Payment Service Provider (Razorpay, PayU, etc.) and register your webhook URL:
   ```
   https://yourdomain.com/api/qr/webhook
   ```

2. **Configure Webhook Secret**: Set up HMAC-SHA256 signature verification:
   ```javascript
   // In your config
   {
     webhookSecret: 'your-shared-secret-key'
   }
   ```

3. **Test Webhook**: Use PSP's test environment to verify webhook reception:
   ```bash
   curl -X POST https://yourdomain.com/api/qr/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "qrCodeId": "TEST_QR_123",
       "amount": 100,
       "status": "SUCCESS"
     }'
   ```

### QR Payment Success
```json
{
  "event": "qr.payment.success",
  "data": {
    "transactionId": "TXN_QR_1704456000000",
    "qrCodeId": "DYNAMIC_QR_1704456000000",
    "merchantId": "MERCHANT_001",
    "amount": 250,
    "orderId": "ORDER_123",
    "processedAt": "2024-01-05T12:00:00Z"
  }
}
```

### QR Payment Failed
```json
{
  "event": "qr.payment.failed",
  "data": {
    "qrCodeId": "DYNAMIC_QR_1704456000000",
    "merchantId": "MERCHANT_001",
    "amount": 250,
    "reason": "Insufficient funds",
    "timestamp": "2024-01-05T12:00:00Z"
  }
}
```

### QR Code Expired
```json
{
  "event": "qr.expired",
  "data": {
    "qrCodeId": "DYNAMIC_QR_1704456000000",
    "merchantId": "MERCHANT_001",
    "orderId": "ORDER_123",
    "expiredAt": "2024-01-05T12:30:00Z"
  }
}
```

## Best Practices

1. **QR Code Placement**: Place static QR codes at visible, accessible locations
2. **Expiry Time**: Set appropriate expiry times for dynamic QR codes (15-30 minutes)
3. **Error Handling**: Handle expired and used QR codes gracefully
4. **Security**: Validate all payment details before processing
5. **Customer Communication**: Display clear instructions for scanning
6. **Fallback Options**: Provide alternative payment methods
7. **Transaction Reconciliation**: Use real-time linking for instant reconciliation
8. **Analytics**: Monitor QR code performance regularly
9. **QR Code Quality**: Ensure QR codes are high quality and scannable
10. **Testing**: Test QR codes with multiple UPI apps before deployment
11. **Webhook Monitoring**: Set up alerts for webhook failures or delays
12. **Database Backup**: Regularly backup transaction data

## Transaction Storage

### How Transactions are Stored

When a user scans a QR code and completes payment via a UPI app:

1. **Payment Initiation**: User scans QR code with their UPI app (GPay, Amazon Pay, PhonePe, etc.)
2. **UPI Processing**: Payment is processed through UPI/NPCI infrastructure
3. **Webhook Notification**: Payment Service Provider sends webhook to `/api/qr/webhook`
4. **Automatic Storage**: Transaction is automatically stored in the database with:
   - Transaction reference ID
   - QR code ID (for tracking)
   - Merchant ID
   - Amount and currency
   - Customer VPA and name
   - UPI UTR (Unique Transaction Reference)
   - Payment status (success/failed/pending)
   - Timestamp
5. **Real-time Updates**: QR code statistics updated (total transactions, total amount)
6. **Immediate Availability**: Transaction can be queried immediately via API

### Database Schema

Transactions are stored in the `transactions` table with these fields:
- `transaction_ref`: Unique transaction ID
- `order_id`: Associated order reference
- `payment_method`: 'qr'
- `gateway`: 'qr'
- `amount`: Transaction amount
- `currency`: 'INR'
- `status`: 'success', 'failed', or 'pending'
- `customer_name`: Customer's name
- `metadata`: JSON with QR code ID, customer VPA, merchant ID, UTR, QR type
- `gateway_transaction_id`: Transaction ID from webhook
- `gateway_response_message`: UTR from UPI
- `initiated_at`: Payment initiation timestamp
- `completed_at`: Payment completion timestamp

### Verifying Transactions

```javascript
// Get all transactions for a specific QR code
const response = await fetch('/api/qr/STATIC_QR_123/transactions', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});

const data = await response.json();
// Returns: { transactions: [...], total: 50, totalAmount: 12500 }
```

```javascript
// Get QR code details with statistics
const response = await fetch('/api/qr/STATIC_QR_123', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});

const data = await response.json();
// Returns: { qrCodeId, type, totalTransactions, totalAmount, transactions: [...] }
```

## Testing

### Test Merchant Details
- Merchant ID: `TEST_MERCHANT_001`
- Merchant VPA: `testmerchant@upi`
- Merchant Name: `Test Coffee Shop`

### Test Scenarios

1. **Static QR - Multiple Payments**
   - Generate static QR
   - Process 5 payments with different amounts
   - Verify transaction linking

2. **Dynamic QR - Single Use**
   - Generate dynamic QR with amount
   - Process payment
   - Attempt second payment (should fail)

3. **Dynamic QR - Expiry**
   - Generate dynamic QR with 1-minute expiry
   - Wait for expiry
   - Attempt payment (should fail)

4. **Transaction Filtering**
   - Generate QR
   - Process multiple payments
   - Test filtering by date range and status

## Integration Examples

### Frontend Integration

```javascript
// Generate Dynamic QR Code
const response = await fetch('/api/qr/dynamic', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    merchantId: 'MERCHANT_001',
    merchantName: 'Coffee Shop',
    merchantVPA: 'coffeeshop@upi',
    amount: 250,
    orderId: 'ORDER_123',
    description: 'Coffee and Sandwich'
  })
});

const data = await response.json();

// Display QR Code
document.getElementById('qr-image').src = data.qrCodeImage;
```

### Backend Webhook Handler

```javascript
app.post('/webhooks/qr-payment', (req, res) => {
  const { event, data } = req.body;
  
  if (event === 'qr.payment.success') {
    // Update order status
    updateOrder(data.orderId, 'PAID');
    
    // Send confirmation to customer
    sendPaymentConfirmation(data.transactionId);
    
    // Log transaction
    logTransaction(data);
  }
  
  res.json({ success: true });
});
```

## Support

For issues or questions:
- Email: qr-support@paymentgateway.com
- Documentation: https://docs.paymentgateway.com/qr-codes
- API Status: https://status.paymentgateway.com
