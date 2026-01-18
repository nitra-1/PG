# QR Code Payments - Code Trace Document

## Overview
**Payment Type**: QR Code Payments (Static & Dynamic)  
**Purpose**: Generate and process payments via UPI QR codes (contactless payments)  
**Entry Point**: QR Service API  
**Primary File**: `/src/qr/qr-service.js`

---

## Execution Flow

### 1. GENERATE STATIC QR CODE
**Function**: `generateStaticQR(qrData)`  
**Entry Point**: Merchant creates reusable QR for store/counter  
**API Endpoint**: `POST /api/qr/static`

#### Flow Steps:
1. **Input Validation**
   - **Required Fields**: merchantId, merchantVPA
   - **Optional Fields**: merchantName, storeId, storeName, purpose
   
2. **QR Code ID Generation**
   - Format: `STATIC_QR_{timestamp}`
   - Example: `STATIC_QR_1705566789012`

3. **Build UPI URL** (`buildStaticQRData`)
   - **UPI Format**: `upi://pay?pa={merchantVPA}&pn={merchantName}&cu=INR`
   - **Parameters**:
     - `pa`: Payee address (merchant VPA)
     - `pn`: Payee name (URL encoded)
     - `cu`: Currency (INR)
   - **No Amount**: Static QR allows any amount
   - Example: `upi://pay?pa=merchant@icici&pn=MyStore&cu=INR`

4. **Generate QR Image** (`generateQRImage`)
   - **Library**: npm package 'qrcode'
   - **Method**: `QRCode.toDataURL(data, options)`
   - **Options**:
     - errorCorrectionLevel: 'M' (Medium)
     - type: 'image/png'
     - width: 300 pixels
     - margin: 2
   - **Output**: Base64 encoded data URL (PNG image)

5. **Store QR Code** (In-Memory Map)
   - **Storage**: `this.qrCodes` (Map object)
   - **Key**: qrCodeId
   - **Value Object**:
     - qrCodeId, type: 'STATIC'
     - merchantId, merchantVPA
     - storeId (optional)
     - qrCodeData (UPI URL)
     - qrCodeImage (Base64)
     - status: 'ACTIVE'
     - createdAt: ISO timestamp
     - transactions: [] (empty array, populated on payment)

6. **Response**
   ```json
   {
     "success": true,
     "qrCodeId": "STATIC_QR_1705566789012",
     "qrCodeImage": "data:image/png;base64,...",
     "qrCodeData": "upi://pay?pa=...",
     "type": "STATIC"
   }
   ```

---

### 2. GENERATE DYNAMIC QR CODE
**Function**: `generateDynamicQR(qrData)`  
**Entry Point**: Create single-use QR for specific order/amount  
**API Endpoint**: `POST /api/qr/dynamic`

#### Flow Steps:
1. **Input Validation**
   - **Required Fields**: merchantId, merchantVPA, amount, orderId
   - **Optional Fields**: merchantName, description, expiryMinutes (default: 30)

2. **QR Code ID Generation**
   - Format: `DYNAMIC_QR_{timestamp}`
   - Example: `DYNAMIC_QR_1705566789012`

3. **Build UPI URL** (`buildDynamicQRData`)
   - **UPI Format**: `upi://pay?pa={merchantVPA}&pn={merchantName}&am={amount}&tr={orderId}&cu=INR&tn={description}`
   - **Parameters**:
     - `pa`: Payee address (merchant VPA)
     - `pn`: Payee name (URL encoded)
     - `am`: Amount (fixed in QR)
     - `tr`: Transaction reference (orderId)
     - `cu`: Currency (INR)
     - `tn`: Transaction note (optional, URL encoded)
   - Example: `upi://pay?pa=merchant@icici&pn=MyStore&am=1000&tr=ORD_123&cu=INR&tn=Payment%20for%20Order`

4. **Generate QR Image** (`generateQRImage`)
   - Same as static QR generation
   - Uses QRCode library with same options

5. **Calculate Expiry**
   - Default: 30 minutes from creation
   - Formula: `Date.now() + expiryMinutes * 60000`
   - Stored as ISO timestamp

6. **Store QR Code** (In-Memory Map)
   - **Storage**: `this.qrCodes` (Map object)
   - **Key**: qrCodeId
   - **Value Object**:
     - qrCodeId, type: 'DYNAMIC'
     - merchantId, merchantVPA
     - amount, orderId
     - qrCodeData (UPI URL)
     - qrCodeImage (Base64)
     - status: 'ACTIVE'
     - singleUse: true
     - expiryTime: ISO timestamp
     - createdAt: ISO timestamp
     - transactions: [] (empty array)

7. **Response**
   ```json
   {
     "success": true,
     "qrCodeId": "DYNAMIC_QR_1705566789012",
     "qrCodeImage": "data:image/png;base64,...",
     "qrCodeData": "upi://pay?pa=...",
     "type": "DYNAMIC",
     "amount": 1000,
     "orderId": "ORD_123",
     "expiryTime": "2024-01-18T10:30:00.000Z"
   }
   ```

---

### 3. PROCESS QR PAYMENT
**Function**: `processQRPayment(qrCodeId, paymentData)`  
**Entry Point**: User scans QR and completes payment  
**API Endpoint**: `POST /api/qr/:qrCodeId/payment`

#### Flow Steps:
1. **Retrieve QR Code**
   - Lookup from `this.qrCodes` Map by qrCodeId
   - If not found: throw 'QR code not found'

2. **Validation Checks** (in order)
   - **For Dynamic QR - Check Expiry**:
     - Compare current time with qrCode.expiryTime
     - If expired: throw 'QR code has expired'
   
   - **For Dynamic QR - Check Single-Use**:
     - If `qrCode.singleUse && qrCode.usedAt`: throw 'QR code already used'
     - Checked BEFORE status check for better error messages
   
   - **Check Active Status**:
     - If `qrCode.status !== 'ACTIVE'`: throw 'QR code is not active'
   
   - **For Dynamic QR - Validate Amount**:
     - If `paymentData.amount !== qrCode.amount`: throw 'Amount mismatch'

3. **Create Transaction Object**
   - **Transaction ID**: `TXN_QR_{timestamp}`
   - **Transaction Fields**:
     - transactionId, qrCodeId
     - merchantId (from qrCode)
     - amount (paymentData.amount OR qrCode.amount)
     - orderId (qrCode.orderId OR paymentData.orderId)
     - customerVPA, customerName
     - status: 'SUCCESS'
     - paymentMethod: 'QR_CODE'
     - qrType: qrCode.type
     - processedAt: ISO timestamp

4. **Real-Time Transaction Linking** (In-Memory)
   - **Purpose**: Instant transaction tracking and analytics
   - **Implementation**:
     - Initialize `qrCode.transactions = []` if not exists
     - Push transaction to array: `qrCode.transactions.push(transaction)`
   - **Benefits**:
     - Instant queryability after creation
     - Automatic QR code analytics aggregation
     - Direct payment reconciliation
     - Complete audit trail per QR code

5. **Persist Transaction to Database** (`insertWithTenant`)
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - `transaction_ref`: transactionId (TXN_QR_...)
     - `order_id`: transaction.orderId OR transactionId
     - `payment_method`: 'qr'
     - `gateway`: 'qr'
     - `amount`: transaction.amount
     - `currency`: 'INR'
     - `status`: 'success'
     - `customer_name`: transaction.customerName
     - `metadata`: JSON string containing:
       - qrCodeId
       - qrType (STATIC/DYNAMIC)
       - customerVPA
       - merchantId
     - `gateway_transaction_id`: transactionId
     - `initiated_at`: transaction.processedAt
     - `completed_at`: transaction.processedAt
     - `tenant_id`: config.tenantId OR config.defaultTenantId
   - **Multi-tenancy**: Automatically handled by `insertWithTenant()`
   - **Error Handling**: If DB fails, log error but continue (in-memory storage available)
   - **Return Value**: Database record with auto-generated `id` field

6. **Create Ledger Transaction** (`ledgerEventHandlers.handlePaymentSuccess`)
   - **Purpose**: Record financial accounting entries
   - **Integration**: `/src/core/ledger.js`
   - **Fee Calculation**:
     - Platform Fee: paymentData.platformFee OR (amount × platformFeeRate)
     - Gateway Fee: paymentData.gatewayFee OR (amount × gatewayFeeRate)
     - Default Rates: platform=1.5%, gateway=0.5% (from config)
   - **Ledger Event Data**:
     - tenantId, transactionId (DB id OR TXN_QR_...)
     - orderId, merchantId, gateway: 'qr'
     - amount, platformFee, gatewayFee
     - createdBy: 'qr_service'
   - **Error Handling**: Log error but don't fail payment if ledger fails

7. **Mark Single-Use QR as Used**
   - If `qrCode.singleUse === true`:
     - Set `qrCode.usedAt = ISO timestamp`
     - Set `qrCode.status = 'USED'`

8. **Update QR Analytics**
   - `qrCode.lastPaymentAt = ISO timestamp`
   - `qrCode.totalTransactions = (existing || 0) + 1`
   - `qrCode.totalAmount = (existing || 0) + amount`

9. **Response**
   ```json
   {
     "success": true,
     "transactionId": "TXN_QR_1705566789012",
     "qrCodeId": "DYNAMIC_QR_1705566789012",
     "amount": 1000,
     "orderId": "ORD_123",
     "status": "SUCCESS",
     "transaction": { /* full transaction object */ },
     "timestamp": "2024-01-18T10:00:00.000Z"
   }
   ```

---

### 4. GET QR CODE DETAILS
**Function**: `getQRCode(qrCodeId)`  
**Entry Point**: Retrieve QR code information  
**API Endpoint**: `GET /api/qr/:qrCodeId`

#### Flow Steps:
1. **Retrieve QR Code**
   - Lookup from `this.qrCodes` Map by qrCodeId
   - If not found: throw 'QR code not found'

2. **Build Response**
   - **Fields Returned**:
     - qrCodeId, type (STATIC/DYNAMIC)
     - merchantId, status
     - createdAt, expiryTime (if dynamic)
     - lastPaymentAt (if any payment made)
     - totalTransactions (count)
     - totalAmount (sum of all payments)
     - transactions (array of all transactions)

3. **Response**
   ```json
   {
     "qrCodeId": "STATIC_QR_1705566789012",
     "type": "STATIC",
     "merchantId": "MERCH_123",
     "status": "ACTIVE",
     "createdAt": "2024-01-18T09:00:00.000Z",
     "lastPaymentAt": "2024-01-18T10:00:00.000Z",
     "totalTransactions": 5,
     "totalAmount": 5000,
     "transactions": [...]
   }
   ```

---

### 5. GET QR TRANSACTIONS
**Function**: `getQRTransactions(qrCodeId, filters)`  
**Entry Point**: Query payment history for QR code  
**API Endpoint**: `GET /api/qr/:qrCodeId/transactions`

#### Flow Steps:
1. **Retrieve QR Code**
   - Lookup from `this.qrCodes` Map by qrCodeId
   - If not found: throw 'QR code not found'

2. **Get Transactions**
   - Start with `qrCode.transactions || []`

3. **Apply Filters** (Query Parameters)
   - **Status Filter**: `filters.status`
     - Filter: `txn => txn.status === filters.status`
   
   - **From Date Filter**: `filters.fromDate`
     - Filter: `txn => new Date(txn.processedAt) >= new Date(filters.fromDate)`
   
   - **To Date Filter**: `filters.toDate`
     - Filter: `txn => new Date(txn.processedAt) <= new Date(filters.toDate)`

4. **Calculate Aggregates**
   - Total count: `transactions.length`
   - Total amount: `transactions.reduce((sum, txn) => sum + txn.amount, 0)`

5. **Response**
   ```json
   {
     "success": true,
     "qrCodeId": "STATIC_QR_1705566789012",
     "transactions": [...],
     "total": 5,
     "totalAmount": 5000
   }
   ```

---

### 6. HANDLE UPI WEBHOOK/CALLBACK
**Function**: `handleCallback(callbackData)`  
**Entry Point**: PSP notifies when user scans QR and pays via UPI app  
**API Endpoint**: `POST /api/qr/webhook` (NO authentication - signature verified)

#### Flow Steps:
1. **Verify Webhook Signature** (`verifyCallbackSignature`)
   - **Security**: HMAC-SHA256 verification (production)
   - **Purpose**: Ensure webhook is from legitimate PSP
   - **Implementation**:
     - Check `this.config.webhookSecret` configuration
     - If not configured: Log warning, allow in dev/test (security risk)
     - **Production Implementation** (template provided):
       - Extract signature from `data.signature` OR `headers['x-webhook-signature']`
       - Build payload string from callback data
       - Calculate HMAC-SHA256: `crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex')`
       - Compare calculated vs provided signature
       - Return false if mismatch
   - If invalid: throw 'Invalid callback signature'

2. **Extract Callback Data**
   - **Fields**:
     - qrCodeId (optional)
     - transactionId, merchantId
     - amount, orderId
     - customerVPA, customerName
     - utr (UPI Transaction Reference)
     - status (SUCCESS/FAILED/PENDING)
     - timestamp

3. **Validate Required Fields**
   - Must have: (qrCodeId OR orderId) AND amount AND status
   - If missing: throw 'Missing required callback fields'

4. **Find QR Code**
   - **By qrCodeId**: `this.qrCodes.get(qrCodeId)` (if provided)
   - **By orderId**: Search Map for `qr => qr.orderId === orderId` (for dynamic QR)
   - **If Not Found**: Log warning but continue processing
     - Reason: Static QR or QR not in memory (server restart)
     - Can still store transaction and create ledger entry

5. **Generate/Use Transaction ID**
   - If provided: use callbackData.transactionId
   - If not provided: generate `TXN_QR_{timestamp}`

6. **Create Transaction Object**
   - **Transaction Fields**:
     - transactionId (from callback or generated)
     - qrCodeId (from callback or 'UNKNOWN')
     - merchantId (callback OR qrCode.merchantId OR 'UNKNOWN')
     - amount, orderId (callback OR transactionId)
     - customerVPA, customerName, utr
     - status: mapped via `mapStatusToDBStatus(status)`
     - paymentMethod: 'QR_CODE'
     - qrType: qrCode.type OR 'UNKNOWN'
     - processedAt: callback.timestamp OR current time

7. **Update QR Code** (If Found)
   - **Link Transaction**:
     - Initialize `qrCode.transactions = []` if not exists
     - Push transaction to array
   
   - **Mark Single-Use Dynamic QR**:
     - If `qrCode.singleUse && qrCode.type === 'DYNAMIC'`:
       - Set `qrCode.usedAt = ISO timestamp`
       - Set `qrCode.status = 'USED'`
   
   - **Update Analytics**:
     - `qrCode.lastPaymentAt = ISO timestamp`
     - `qrCode.totalTransactions = (existing || 0) + 1`
     - `qrCode.totalAmount = (existing || 0) + amount`

8. **Persist Transaction to Database** (`insertWithTenant`)
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - `transaction_ref`: txnId
     - `order_id`: transaction.orderId
     - `payment_method`: 'qr'
     - `gateway`: 'qr'
     - `amount`, `currency`: 'INR'
     - `status`: transaction.status (mapped)
     - `customer_name`: transaction.customerName
     - `metadata`: JSON string:
       - qrCodeId, qrType, customerVPA
       - merchantId, utr
       - webhookReceived: true
     - `gateway_transaction_id`: txnId
     - `gateway_response_message`: `UTR: {utr}` (if present)
     - `initiated_at`: transaction.processedAt
     - `completed_at`: transaction.processedAt (if status=success) OR null
     - `tenant_id`: config.tenantId OR config.defaultTenantId
   - **Error Handling**: Log error, continue even if DB fails
   - **Return Value**: Database record with auto-generated `id`

9. **Create Ledger Transaction** (For Successful Payments Only)
   - **Condition**: `transaction.status === 'success'`
   - **Fee Calculation**:
     - Platform Fee: callbackData.platformFee OR (amount × 0.015)
     - Gateway Fee: callbackData.gatewayFee OR (amount × 0.005)
   - **Ledger Event**: `ledgerEventHandlers.handlePaymentSuccess`
   - **Event Data**:
     - tenantId, transactionId (DB id OR txnId)
     - orderId, merchantId, gateway: 'qr'
     - amount, platformFee, gatewayFee
     - createdBy: 'qr_webhook'
   - **Error Handling**: Log error but don't fail webhook acknowledgment

10. **Response** (Acknowledge Webhook)
    ```json
    {
      "success": true,
      "acknowledged": true,
      "transactionId": "TXN_QR_1705566789012",
      "status": "success"
    }
    ```

11. **Status Mapping** (`mapStatusToDBStatus`)
    - SUCCESS/COMPLETED → 'success'
    - FAILED/FAILURE → 'failed'
    - PENDING → 'pending'
    - PROCESSING → 'processing'
    - Others → 'pending' (default)

---

## External System Interfaces

### 1. UPI Payment Service Provider (PSP) Webhook
- **Direction**: PSP → Payment Gateway
- **Trigger**: User scans QR code and completes payment in UPI app
- **Endpoint**: `POST /api/qr/webhook`
- **Authentication**: Webhook signature verification (HMAC-SHA256)
- **Webhook Data**:
  ```json
  {
    "qrCodeId": "DYNAMIC_QR_1705566789012",
    "transactionId": "PSP_TXN_123",
    "merchantId": "MERCH_123",
    "amount": 1000,
    "orderId": "ORD_123",
    "customerVPA": "user@paytm",
    "customerName": "John Doe",
    "utr": "234567890123",
    "status": "SUCCESS",
    "timestamp": "2024-01-18T10:00:00.000Z",
    "signature": "hmac_sha256_signature"
  }
  ```

### 2. QRCode Library (npm package 'qrcode')
- **Package**: `qrcode` (npm)
- **Usage**: Generate QR code images from UPI URLs
- **Method**: `QRCode.toDataURL(data, options)`
- **Input**: UPI URL string
- **Output**: Base64 encoded PNG data URL
- **Configuration**:
  - Error Correction: Medium (M)
  - Image Type: PNG
  - Width: 300px
  - Margin: 2 units

---

## Database Tables & Operations

### 1. Transactions Table
**Table Name**: `transactions`

#### INSERT Operations (QR Payments)
**Scenarios**:
- Direct payment processing via `processQRPayment()`
- Webhook callback via `handleCallback()`

**Fields Written**:
```javascript
{
  transaction_ref: 'TXN_QR_1705566789012',      // QR transaction ID
  order_id: 'ORD_123',                          // Order reference
  payment_method: 'qr',                         // Fixed: 'qr'
  gateway: 'qr',                                // Fixed: 'qr'
  amount: 1000,                                 // Payment amount
  currency: 'INR',                              // Fixed: 'INR'
  status: 'success',                            // success/failed/pending/processing
  customer_name: 'John Doe',                    // Payer name
  metadata: {                                   // JSON field
    qrCodeId: 'DYNAMIC_QR_1705566789012',
    qrType: 'DYNAMIC',                          // STATIC or DYNAMIC
    customerVPA: 'user@paytm',
    merchantId: 'MERCH_123',
    utr: '234567890123',                        // Only in webhook
    webhookReceived: true                       // Only in webhook
  },
  gateway_transaction_id: 'TXN_QR_1705566789012',
  gateway_response_message: 'UTR: 234567890123', // Only in webhook
  initiated_at: '2024-01-18T10:00:00.000Z',
  completed_at: '2024-01-18T10:00:00.000Z',     // Null if not success
  tenant_id: 'default-tenant'                    // Multi-tenancy
}
```

**Key Differences**:
- **payment_method**: Always 'qr' (identifies QR payments)
- **gateway**: Always 'qr' (QR channel)
- **metadata.qrType**: Distinguishes STATIC vs DYNAMIC QR
- **metadata.webhookReceived**: True only for webhook-initiated transactions
- **utr**: UPI Transaction Reference (only from webhook)

---

## Security

### 1. Webhook Signature Verification
**Function**: `verifyCallbackSignature(data)`

**Purpose**: Prevent fraudulent webhook attacks

**Implementation Status**:
- **Development/Test**: Signature check disabled (with warning log)
- **Production**: Must implement HMAC-SHA256 verification

**Production Implementation**:
```javascript
const crypto = require('crypto');

// Extract signature from webhook
const signature = data.signature || data.headers?.['x-webhook-signature'];
if (!signature) {
  return false; // Reject: No signature
}

// Build payload (adjust format per PSP requirements)
const payload = JSON.stringify({
  qrCodeId: data.qrCodeId,
  transactionId: data.transactionId,
  amount: data.amount,
  status: data.status,
  timestamp: data.timestamp
});

// Calculate expected signature
const expectedSignature = crypto
  .createHmac('sha256', this.config.webhookSecret)
  .update(payload)
  .digest('hex');

// Compare signatures
return signature === expectedSignature;
```

**Configuration**:
- **Key**: `config.webhookSecret`
- **Source**: Provided by UPI Payment Service Provider
- **Storage**: Environment variable `WEBHOOK_SECRET`

---

## Error Handling

### 1. QR Generation Errors
- **Missing Required Fields**:
  - Static: merchantId, merchantVPA
  - Dynamic: merchantId, merchantVPA, amount, orderId
  - Error: "Missing required {field} details"

- **QR Image Generation Failure**:
  - QRCode library errors
  - Error: "QR code image generation failed: {reason}"

### 2. Payment Processing Errors
- **QR Not Found**: "QR code not found"
- **QR Expired**: "QR code has expired" (dynamic only)
- **Already Used**: "QR code already used" (single-use dynamic)
- **Not Active**: "QR code is not active"
- **Amount Mismatch**: "Amount mismatch" (dynamic only)

### 3. Webhook Errors
- **Invalid Signature**: "Invalid callback signature"
- **Missing Fields**: "Missing required callback fields"
- **Database Persistence**: Logged but non-blocking
- **Ledger Creation**: Logged but non-blocking

### 4. Error Recovery Strategy
- **In-Memory Storage**: Primary storage, fast access
- **Database Persistence**: Secondary, continues if fails
- **Ledger Integration**: Optional, doesn't block payment
- **Webhook Acknowledgment**: Always return success if signature valid

---

## Configuration Requirements

### 1. Required Configuration (`config.js`)
```javascript
{
  // Tenant Configuration
  tenantId: process.env.TENANT_ID || 'default-tenant',
  defaultTenantId: 'default-tenant',

  // Webhook Security
  webhookSecret: process.env.QR_WEBHOOK_SECRET || 'your-shared-secret-key',

  // Fee Configuration
  fees: {
    platform: {
      qr: 0.015  // 1.5% platform fee
    },
    gateway: {
      qr: 0.005  // 0.5% gateway fee
    }
  },

  // QR Code Settings (optional)
  qr: {
    defaultExpiryMinutes: 30,      // Dynamic QR expiry
    maxAmount: 200000,             // ₹2 Lakhs per transaction
    minAmount: 1                   // ₹1 minimum
  }
}
```

### 2. Environment Variables
```bash
# Tenant Configuration
TENANT_ID=your-tenant-id
DEFAULT_TENANT_ID=default-tenant

# Webhook Security
QR_WEBHOOK_SECRET=your-shared-secret-from-psp

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_gateway
DB_USER=postgres
DB_PASSWORD=yourpassword

# Fee Configuration (optional)
QR_PLATFORM_FEE_RATE=0.015
QR_GATEWAY_FEE_RATE=0.005
```

---

## Related Services

### 1. Ledger Integration
**Module**: `/src/core/ledger.js`  
**Handler**: `ledgerEventHandlers.handlePaymentSuccess`

**Purpose**: Record double-entry accounting for QR payments

**Called From**:
- `processQRPayment()` - Direct payment processing
- `handleCallback()` - Webhook-triggered payments

**Data Passed**:
```javascript
{
  tenantId: 'default-tenant',
  transactionId: 123,              // DB transaction.id
  orderId: 'ORD_123',
  merchantId: 'MERCH_123',
  gateway: 'qr',
  amount: 1000,
  platformFee: 15,                 // 1.5% of 1000
  gatewayFee: 5,                   // 0.5% of 1000
  createdBy: 'qr_service'          // or 'qr_webhook'
}
```

**Ledger Entries Created**:
- Debit: Customer Payment Collection
- Credit: Merchant Revenue (amount - fees)
- Credit: Platform Fee Income
- Credit: Gateway Fee Income

**Error Handling**: Non-blocking (logged only)

### 2. UPI Service
**Module**: `/src/upi/upi-service.js`

**Relationship**:
- QR codes use UPI protocol for payment
- UPI URL format: `upi://pay?pa=...&pn=...&am=...&tr=...&cu=INR`
- Separate UPI service handles UPI collect requests
- QR service focuses on QR code generation and scanning

### 3. Database Module
**Module**: `/src/database/index.js`

**Functions Used**:
- `insertWithTenant(table, data, tenantId)`: Insert transaction records
- Multi-tenancy: Automatically adds tenant_id to records

---

## Monitoring & Analytics

### 1. Real-Time Transaction Tracking
**Implementation**: In-memory Map + Database

**In-Memory Storage** (`this.qrCodes`):
- **Purpose**: Instant access to QR status and transactions
- **Structure**: Map<qrCodeId, QRCodeObject>
- **QR Object Fields**:
  - transactions: Array of all payments
  - totalTransactions: Count
  - totalAmount: Sum
  - lastPaymentAt: Timestamp
  - status: ACTIVE/USED/INACTIVE

**Benefits**:
- Zero-latency transaction queries
- Automatic aggregation
- Real-time analytics
- Complete payment history per QR

### 2. QR Code Analytics
**Function**: `getQRAnalytics(merchantId, filters)`

**Metrics Provided**:
- Total QR codes created
- Active QR codes
- Used QR codes (single-use)
- Static vs Dynamic distribution
- Total transactions processed

**Usage**: Merchant dashboards, reporting

### 3. Logging
**Events Logged**:
- QR generation (static/dynamic)
- Payment processing
- Webhook receipt
- Database persistence success/failure
- Ledger creation success/failure
- Signature verification failures

**Log Levels**:
- INFO: Normal operations
- WARN: Missing QR in webhook, unconfigured secrets
- ERROR: Database/ledger failures, invalid signatures

---

## API Endpoints

### 1. Generate Static QR Code
**Endpoint**: `POST /api/qr/static`  
**Authentication**: Required (JWT)  
**Request**:
```json
{
  "merchantId": "MERCH_123",
  "merchantName": "My Store",
  "merchantVPA": "mystore@icici",
  "storeId": "STORE_456",
  "storeName": "Main Branch",
  "purpose": "Counter Payment"
}
```
**Response**: QR code object with image

### 2. Generate Dynamic QR Code
**Endpoint**: `POST /api/qr/dynamic`  
**Authentication**: Required (JWT)  
**Request**:
```json
{
  "merchantId": "MERCH_123",
  "merchantName": "My Store",
  "merchantVPA": "mystore@icici",
  "amount": 1000,
  "orderId": "ORD_123",
  "description": "Payment for Order #123",
  "expiryMinutes": 30
}
```
**Response**: QR code object with image, expiry

### 3. Process QR Payment
**Endpoint**: `POST /api/qr/:qrCodeId/payment`  
**Authentication**: Required (JWT)  
**Request**:
```json
{
  "amount": 1000,
  "orderId": "ORD_123",
  "customerVPA": "user@paytm",
  "customerName": "John Doe"
}
```
**Response**: Transaction success details

### 4. Get QR Code Details
**Endpoint**: `GET /api/qr/:qrCodeId`  
**Authentication**: Required (JWT)  
**Response**: QR code details with analytics

### 5. Get QR Transactions
**Endpoint**: `GET /api/qr/:qrCodeId/transactions`  
**Authentication**: Required (JWT)  
**Query Parameters**:
- status: Filter by transaction status
- fromDate: Start date (ISO 8601)
- toDate: End date (ISO 8601)  
**Response**: Transaction list with aggregates

### 6. QR Webhook (PSP Callback)
**Endpoint**: `POST /api/qr/webhook`  
**Authentication**: None (signature verified internally)  
**Request**: PSP webhook data with signature  
**Response**: Acknowledgment

---

## Static vs Dynamic QR Differences

| Feature | Static QR | Dynamic QR |
|---------|-----------|------------|
| **QR Code ID** | STATIC_QR_{timestamp} | DYNAMIC_QR_{timestamp} |
| **Amount** | Not specified (user enters) | Fixed in QR code |
| **UPI URL** | upi://pay?pa=...&pn=...&cu=INR | upi://pay?pa=...&pn=...&am=...&tr=...&cu=INR |
| **Reusability** | Reusable (multiple payments) | Single-use (if singleUse=true) |
| **Expiry** | No expiry | 30 minutes (configurable) |
| **Order ID** | Not required | Required |
| **Validation** | Merchant details only | Merchant + amount + orderId |
| **Use Case** | Store counter, donation box | Specific order payment |
| **Status Transition** | Remains ACTIVE | ACTIVE → USED (after payment) |
| **Analytics** | Tracks all payments over time | Tracks single payment |

---

## UPI URL Format

### Static QR URL
```
upi://pay?pa={merchantVPA}&pn={merchantName}&cu=INR
```

**Parameters**:
- `pa`: Payee Address (merchant VPA) - **Required**
- `pn`: Payee Name (URL encoded) - **Required**
- `cu`: Currency (INR) - **Required**

**Example**:
```
upi://pay?pa=mystore@icici&pn=My%20Store&cu=INR
```

### Dynamic QR URL
```
upi://pay?pa={merchantVPA}&pn={merchantName}&am={amount}&tr={orderId}&cu=INR&tn={description}
```

**Parameters**:
- `pa`: Payee Address (merchant VPA) - **Required**
- `pn`: Payee Name (URL encoded) - **Required**
- `am`: Amount in rupees - **Required**
- `tr`: Transaction Reference (orderId) - **Required**
- `cu`: Currency (INR) - **Required**
- `tn`: Transaction Note (URL encoded) - **Optional**

**Example**:
```
upi://pay?pa=mystore@icici&pn=My%20Store&am=1000&tr=ORD_123&cu=INR&tn=Payment%20for%20Order
```

---

## Notes

1. **In-Memory Storage**: QR codes and transactions stored in Map (lost on server restart)
2. **Database Persistence**: All transactions persisted for long-term storage
3. **Multi-Tenancy**: All database operations include tenant_id
4. **Webhook Security**: Must configure webhookSecret before production
5. **Fee Configuration**: Platform (1.5%) and Gateway (0.5%) fees from config
6. **Error Resilience**: Payment succeeds even if DB or ledger fails
7. **Real-Time Tracking**: Transactions immediately queryable via in-memory storage
8. **UPI Standard**: Follows NPCI UPI linking specification for QR codes

---

**Document Version**: 1.0  
**Last Updated**: January 2024  
**Maintainer**: Payment Gateway Team
