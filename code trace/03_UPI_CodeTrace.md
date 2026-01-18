# UPI - Code Trace Document

## Overview
**Payment Type**: UPI (Unified Payments Interface)  
**Purpose**: UPI collect requests, VPA validation, intent-based payments  
**Entry Point**: UPI Service API  
**Primary File**: `/src/upi/upi-service.js`

---

## Execution Flow

### 1. VALIDATE VPA (Virtual Payment Address)
**Function**: `validateVPA(vpa)`  
**Entry Point**: Before creating collect request

#### Flow Steps:
1. **Format Validation**
   - Regex: `^[a-zA-Z0-9._-]+@[a-zA-Z]+$`
   - Examples: `user@paytm`, `9876543210@ybl`

2. **NPCI Verification** (`checkVPAWithNPCI`)
   - **Interface Point**: NPCI VPA Validation API
   - **External System**: NPCI (National Payments Corporation of India)
   - Checks if VPA exists and is active

3. **Response**
   - Returns: boolean (true/false)

---

### 2. CREATE UPI COLLECT REQUEST
**Function**: `createCollectRequest(collectData)`  
**Entry Point**: Merchant initiates UPI payment

#### Flow Steps:
1. **Input Validation**
   - Required: vpa, amount, orderId
   - Validate VPA format

2. **VPA Validation** (`validateVPA`)
   - Check with NPCI if VPA is valid

3. **Collect Request Creation**
   - Generate requestId: `UPI_{timestamp}_{random}`
   - Set merchantVPA from config
   - Set customerVPA from input
   - Expiry: 15 minutes
   - Status: 'PENDING'

4. **Send to Customer** (`sendCollectRequest`)
   - **Interface Point**: UPI Payment Service Provider API
   - **External System**: Payment Gateway (NPCI member)
   - Sends notification to customer's UPI app
   
   **Request Format**:
   ```json
   {
     "merchantVPA": "merchant@icici",
     "customerVPA": "user@paytm",
     "amount": 1000,
     "description": "Payment for Order#123",
     "orderId": "ORD_123",
     "expiryMinutes": 15
   }
   ```

5. **Response**
   - Returns: requestId, status ('PENDING'), expiryTime

---

### 3. GENERATE UPI QR CODE
**Function**: `generateQRCode(qrData)`  
**Entry Point**: Generate QR for payment

#### Flow Steps:
1. **Build UPI URL** (`buildUPIURL`)
   - Format: `upi://pay?pa={merchantVPA}&pn={merchantName}&am={amount}&tn={description}&tr={orderId}&cu=INR`
   - Parameters:
     - pa: Payee address (merchant VPA)
     - pn: Payee name
     - am: Amount (optional for static QR)
     - tn: Transaction note
     - tr: Transaction reference
     - cu: Currency

2. **Generate QR Image** (`generateQRImage`)
   - Uses QRCode library
   - Returns: Base64 encoded PNG image

3. **Response**
   - Returns: qrCodeId, qrCodeData (UPI URL), qrCodeImage, amount, orderId

---

### 4. PROCESS UPI INTENT
**Function**: `processIntent(intentData)`  
**Entry Point**: Deep link for UPI apps

#### Flow Steps:
1. **Build Intent URL** (`buildUPIURL`)
   - Same as QR URL format
   - Opens directly in UPI app

2. **Response**
   - Returns: intentURL, orderId, expiryTime (15 min)

---

### 5. CHECK TRANSACTION STATUS
**Function**: `checkTransactionStatus(transactionId)`  
**Entry Point**: Poll payment status

#### Flow Steps:
1. **Query Payment Service Provider**
   - **Interface Point**: Gateway Status API
   - **External System**: Payment Gateway

2. **Response**
   - Returns: transactionId, status (SUCCESS/FAILED/PENDING), amount, utr, timestamp

---

### 6. HANDLE UPI CALLBACK/WEBHOOK
**Function**: `handleCallback(callbackData)`  
**Entry Point**: Gateway webhook notification

#### Flow Steps:
1. **Signature Verification** (`verifyCallbackSignature`)
   - **Security**: HMAC-SHA256 verification
   - Validates webhook authenticity

2. **Transaction Status Update** (`updateTransactionStatus`)
   - **Table**: `transactions`
   - **Operation**: INSERT or UPDATE
   - **Find by**: transaction_ref OR gateway_transaction_id
   
   **If Found (UPDATE)**:
   - status: mapStatusToDBStatus(status)
   - gateway_response_message: UTR
   - completed_at: current time (if SUCCESS)
   - updated_at: current time
   
   **If Not Found and amount provided (INSERT)**:
   - transaction_ref, order_id: transactionId
   - payment_method: 'upi'
   - gateway: 'upi'
   - amount, currency: 'INR'
   - status: mapped from callback
   - gateway_transaction_id: transactionId
   - gateway_response_message: UTR

3. **Merchant Notification** (`notifyMerchant`)
   - Send webhook to merchant callback URL

4. **Response**
   - Returns: { success: true, acknowledged: true }

---

## External System Interfaces

### 1. NPCI VPA Validation API
**Interface Point**: `checkVPAWithNPCI(vpa)`  
**Purpose**: Validate if VPA exists

**Request**:
```json
{
  "vpa": "user@paytm"
}
```

**Response**:
```json
{
  "valid": true,
  "account_name": "John Doe",
  "bank": "PAYTM"
}
```

---

### 2. UPI Payment Service Provider
**Interface Point**: `sendCollectRequest(collectRequest)`  
**Purpose**: Send collect notification to customer's UPI app

**Providers**:
- Razorpay UPI
- PayU UPI
- PhonePe Switch
- Direct NPCI integration

**Request**:
```json
{
  "merchantVPA": "merchant@icici",
  "customerVPA": "9876543210@ybl",
  "amount": 1000,
  "currency": "INR",
  "description": "Order Payment",
  "orderId": "ORD_123",
  "expiryMinutes": 15
}
```

**Response**:
```json
{
  "requestId": "UPI_1234567890",
  "status": "PENDING",
  "expiryTime": "2024-01-18T10:00:00Z"
}
```

**Callback Webhook**:
```json
{
  "transactionId": "UPI_1234567890",
  "status": "SUCCESS",
  "utr": "402512345678",
  "amount": 1000,
  "signature": "hmac_sha256_signature"
}
```

---

### 3. QR Code Generation
**Library**: `qrcode` npm package  
**No External API**: Local generation

---

## Database Tables & Operations

### 1. transactions
**Purpose**: Track UPI payment transactions

**UPI-Specific Fields**:
- payment_method: 'upi'
- gateway: 'upi'
- gateway_transaction_id: UPI transaction ID
- gateway_response_message: UTR (Unique Transaction Reference)
- metadata: Can contain VPA, collect request ID

**Operations**:
- **INSERT**: New UPI transaction from webhook
- **UPDATE**: Status update from webhook
- **SELECT**: Check transaction status

**Indexes**:
- transaction_ref, gateway_transaction_id for webhook lookup

---

### 2. payment_orders
**Purpose**: Link UPI transaction to order (if via PayIn service)

**Operations**:
- **SELECT**: Retrieve order for UPI payment
- **UPDATE**: Update with UPI transaction details

---

## UPI Transaction Flow Diagram

```
Merchant → UPI Service → NPCI/Gateway → Customer UPI App
                                ↓
                         Customer Approves
                                ↓
                         NPCI/Gateway → Webhook → UPI Service
                                                        ↓
                                                 Update Database
                                                        ↓
                                                 Notify Merchant
```

---

## Security & Compliance

### 1. VPA Validation
- Always validate before sending collect request
- Prevents failed transactions

### 2. Webhook Security
- HMAC-SHA256 signature verification
- Shared secret with payment gateway

### 3. Expiry Management
- 15-minute expiry for collect requests
- Prevents stale requests

---

## Error Handling

### Common Errors:
1. **VPA validation failed**: Invalid VPA format or NPCI returns false
2. **Collect request failed**: Missing vpa, amount, or orderId
3. **Invalid VPA**: Customer VPA doesn't exist
4. **Transaction not found**: Webhook for unknown transaction (logged but not failed)
5. **Invalid callback signature**: Webhook rejected
6. **NPCI timeout**: Network issues with NPCI API

### Retry Logic:
- VPA validation: Retry 2 times on network error
- Collect request: No auto-retry (user must reinitiate)
- Webhook processing: Idempotent (duplicate webhooks handled safely)

---

## Status Mapping

```javascript
UPI Status → Database Status
'SUCCESS' → 'success'
'FAILED' → 'failed'
'PENDING' → 'pending'
'PROCESSING' → 'processing'
```

---

## Configuration Requirements

```javascript
{
  merchantVPA: 'merchant@icici',
  merchantId: 'MERCHANT_001',
  merchantName: 'Example Store',
  tenantId: '<merchant_tenant_id>',
  defaultTenantId: '<fallback_tenant_id>',
  npciApiKey: '<npci_api_key>',
  webhookSecret: '<shared_secret>'
}
```

---

## Related Services

1. **QR Service** (`/src/qr/qr-service.js`)
   - Uses UPI URL format for QR codes
   - Static and dynamic QR generation

2. **PayIn Service** (`/src/payin/payin-service.js`)
   - UPI as payment method option
   - Order management integration

3. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record UPI transaction in ledger

---

## Monitoring & Analytics

### Key Metrics:
- VPA validation success rate
- Collect request acceptance rate
- UPI transaction success rate
- Average approval time
- Webhook processing latency

### Logs:
- VPA validation: `vpa, valid`
- Collect request sent: `requestId, customerVPA, amount`
- Callback received: `transactionId, status, utr`
- Transaction updated: `transactionId, status`

---

## API Endpoints (Typical Integration)

```
POST /api/upi/validate-vpa - Validate VPA
POST /api/upi/collect - Create collect request
POST /api/upi/qr - Generate QR code
POST /api/upi/intent - Create intent link
GET  /api/upi/status/:txnId - Check transaction status
POST /api/upi/callback - NPCI/Gateway webhook (internal)
```

---

## UPI Limits & Specifications

- **Per Transaction**: ₹1 lakh (₹100,000)
- **Per Day**: ₹1 lakh (most banks)
- **Collect Expiry**: 15 minutes (configurable)
- **QR Expiry**: 30 minutes (dynamic QR)
- **VPA Format**: `[a-zA-Z0-9._-]+@[a-zA-Z]+`
