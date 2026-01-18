# Wallet - Code Trace Document

## Overview
**Payment Type**: Digital Wallet Integration  
**Purpose**: Support wallet payments (Paytm, PhonePe, Google Pay, Amazon Pay, MobiKwik, Freecharge)  
**Entry Point**: Wallet Service API  
**Primary File**: `/src/wallet/wallet-service.js`

---

## Supported Wallets
- **Paytm**
- **PhonePe**
- **Google Pay** (GPay)
- **Amazon Pay**
- **MobiKwik**
- **Freecharge**

---

## Execution Flow

### 1. INITIATE WALLET PAYMENT
**Function**: `initiateWalletPayment(paymentData)`  
**Entry Point**: Customer selects wallet as payment method

#### Flow Steps:
1. **Wallet Type Validation**
   - Check if walletType in supportedWallets array
   - Supported: ['paytm', 'phonepe', 'googlepay', 'amazonpay', 'mobikwik', 'freecharge']

2. **Payment Data Validation** (`validatePaymentData`)
   - Required: walletType, amount, orderId, customerId
   - Validate amount > 0

3. **Payment Request Creation**
   - Generate paymentId: `WALLET_{timestamp}`
   - Set status: 'INITIATED'
   - Set currency: 'INR'
   - Set expiry: 15 minutes

4. **Generate Wallet URL** (`generateWalletPaymentUrl`)
   - **Interface Point**: Wallet Provider Deep Link/API
   - Build wallet-specific payment URL:
     - Paytm: `https://paytm.com/pay?paymentId=...&amount=...`
     - PhonePe: `phonepe://pay?...` (deep link)
     - Google Pay: `gpay://pay?...` (deep link)
     - Amazon Pay: `https://amazonpay.com/pay?...`
     - MobiKwik: `https://mobikwik.com/pay?...`
     - Freecharge: `https://freecharge.in/pay?...`

5. **Response**
   - Returns: paymentId, walletType, paymentUrl, orderId, amount, expiryTime

---

### 2. CHECK WALLET BALANCE
**Function**: `checkWalletBalance(walletData)`  
**Entry Point**: Query customer's wallet balance

#### Flow Steps:
1. **Wallet Validation**
   - Validate walletType is supported

2. **Balance Query**
   - **Interface Point**: Wallet Provider Balance API
   - **External System**: Wallet provider (Paytm, PhonePe, etc.)
   - Query using customerId or walletId

3. **Response**
   - Returns: walletType, customerId, balance, currency, timestamp

---

### 3. PROCESS WALLET-TO-WALLET TRANSFER
**Function**: `processWalletTransfer(transferData)`  
**Entry Point**: P2P wallet transfers

#### Flow Steps:
1. **Validation**
   - Required: sourceWalletId, amount, (targetWalletId OR targetPhone)
   - Validate amount > 0

2. **Balance Check** (`checkWalletBalance`)
   - Verify source wallet has sufficient balance

3. **Transfer Processing**
   - **Interface Point**: Wallet Provider Transfer API
   - Generate transferId: `TRANSFER_{timestamp}`
   - Execute P2P transfer

4. **Response**
   - Returns: transferId, amount, status, timestamp

---

### 4. ADD MONEY TO WALLET
**Function**: `addMoneyToWallet(addMoneyData)`  
**Entry Point**: Top-up wallet balance

#### Flow Steps:
1. **Validation**
   - Required: walletId, amount, paymentMethod
   - Validate amount: 1 ≤ amount ≤ 100,000

2. **Payment Processing**
   - **Interface Point**: Wallet Provider Add Money API
   - Process via card/UPI/netbanking
   - Generate transactionId: `ADDMONEY_{timestamp}`

3. **Response**
   - Returns: transactionId, amount, newBalance, status, timestamp

---

### 5. LINK WALLET TO MERCHANT
**Function**: `linkWallet(linkData)`  
**Entry Point**: Connect customer wallet to merchant account

#### Flow Steps:
1. **Validation**
   - Required: merchantId, walletType, walletId, customerPhone

2. **OTP Verification** (`verifyOTP`)
   - Validate OTP for customer phone
   - **Mock**: OTP = '123456'

3. **Wallet Linking**
   - Generate linkId: `LINK_{timestamp}`
   - Status: 'ACTIVE'
   - Store link in database

4. **Response**
   - Returns: linkId, walletType, status, timestamp

---

### 6. GET TRANSACTION HISTORY
**Function**: `getTransactionHistory(filters)`  
**Entry Point**: View wallet transaction history

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Filters**: walletId, startDate, endDate, limit
   - **Query**: WHERE payment_method = 'wallet' AND wallet_id IN metadata

2. **Response**
   - Returns: transactions array, total, limit

---

### 7. HANDLE WALLET CALLBACK
**Function**: `handleCallback(callbackData)`  
**Entry Point**: Wallet provider webhook

#### Flow Steps:
1. **Signature Verification** (`verifyCallbackSignature`)
   - **Security**: HMAC signature verification
   - Validates webhook authenticity

2. **Database Operations**
   - **Table**: `transactions`
   - **Operation**: UPDATE or INSERT
   
   **If transaction exists (UPDATE)**:
   - status: mapStatusToDBStatus(status)
   - gateway_transaction_id: walletTransactionId
   - completed_at: current time (if SUCCESS)
   
   **If new transaction (INSERT)**:
   - transaction_ref: paymentId
   - order_id: orderId or paymentId
   - payment_method: 'wallet'
   - gateway: 'wallet'
   - amount, currency: 'INR'
   - status: mapped from callback
   - gateway_transaction_id: walletTransactionId

3. **Response**
   - Returns: { success: true, acknowledged: true }

---

## External System Interfaces

### 1. Wallet Provider Payment API
**Interface Point**: `generateWalletPaymentUrl()`, payment initiation

**Paytm API**:
```json
POST https://paytm.com/api/v1/payment/initiate
{
  "merchantId": "MERCHANT_001",
  "orderId": "ORD_123",
  "amount": 1000,
  "currency": "INR",
  "customerId": "CUST_001",
  "customerPhone": "9876543210",
  "callbackUrl": "https://merchant.com/callback"
}
Response:
{
  "paymentUrl": "https://paytm.com/pay?token=abc123",
  "transactionId": "PAYTM_TXN_123"
}
```

**PhonePe/GPay Deep Links**:
```
phonepe://pay?pa=merchant@icici&pn=MerchantName&am=1000&tr=ORD_123&cu=INR
gpay://upi/pay?pa=merchant@icici&pn=MerchantName&am=1000&tr=ORD_123&cu=INR
```

---

### 2. Wallet Balance API
**Interface Point**: `checkWalletBalance()`

```json
GET https://api.paytm.com/v1/wallet/balance
Headers: Authorization: Bearer <access_token>

Response:
{
  "balance": 5000.00,
  "currency": "INR",
  "walletId": "WALLET_123"
}
```

---

### 3. Wallet Transfer API (P2P)
**Interface Point**: `processWalletTransfer()`

```json
POST https://api.paytm.com/v1/wallet/transfer
{
  "sourceWalletId": "WALLET_123",
  "targetPhone": "9876543210",
  "amount": 500,
  "description": "Transfer to friend"
}
Response:
{
  "transferId": "TXN_456",
  "status": "SUCCESS",
  "balance": 4500.00
}
```

---

### 4. Add Money API
**Interface Point**: `addMoneyToWallet()`

```json
POST https://api.paytm.com/v1/wallet/add-money
{
  "walletId": "WALLET_123",
  "amount": 1000,
  "paymentMethod": "card",
  "cardDetails": { ... }
}
Response:
{
  "transactionId": "ADD_789",
  "status": "SUCCESS",
  "newBalance": 6000.00
}
```

---

### 5. Wallet Callback Webhook
**Interface Point**: `handleCallback()`

```json
POST https://merchant.com/api/wallet/callback
Headers: 
  X-Signature: hmac_sha256_signature
Body:
{
  "paymentId": "WALLET_123456",
  "status": "SUCCESS",
  "walletTransactionId": "PAYTM_TXN_789",
  "amount": 1000,
  "orderId": "ORD_123",
  "timestamp": "2024-01-18T10:00:00Z"
}
```

---

## Database Tables & Operations

### 1. transactions
**Purpose**: Track wallet payment transactions

**Wallet-Specific Fields**:
- payment_method: 'wallet'
- gateway: 'wallet'
- metadata: {walletType, walletId, walletTransactionId}
- gateway_transaction_id: Wallet provider transaction ID

**Operations**:
- **INSERT**: New wallet payment via callback
- **UPDATE**: Status update from callback
- **SELECT**: Transaction history by walletId

---

### 2. wallet_links (Optional - if implemented)
**Purpose**: Store merchant-customer wallet links

**Schema**:
```sql
- id (UUID)
- tenant_id (UUID)
- link_id (VARCHAR)
- merchant_id (VARCHAR)
- wallet_type (VARCHAR)
- wallet_id (VARCHAR)
- customer_phone (VARCHAR)
- status (ENUM: active, inactive)
- linked_at (TIMESTAMP)
```

---

## Security & Compliance

### 1. Webhook Verification
- HMAC signature validation
- Shared secret with wallet provider

### 2. OTP Verification
- Required for wallet linking
- Phone number validation

### 3. Amount Limits
- Add money: ₹1 - ₹1,00,000
- Wallet transfer: Provider-specific limits

---

## Error Handling

### Common Errors:
1. **Unsupported wallet**: walletType not in supported list
2. **Missing required fields**: walletType, amount, orderId, customerId
3. **Invalid amount**: amount ≤ 0 or > 100,000
4. **Insufficient balance**: Wallet balance < transfer amount
5. **Invalid OTP**: OTP verification failed
6. **Wallet provider timeout**: API timeout or network error
7. **Invalid callback signature**: Webhook rejected

### Retry Logic:
- API failures: Retry 3 times with exponential backoff
- Webhook processing: Idempotent handling

---

## Status Mapping

```javascript
Wallet Status → Database Status
'SUCCESS' → 'success'
'FAILED' → 'failed'
'PENDING' → 'pending'
'PROCESSING' → 'processing'
```

---

## Configuration Requirements

```javascript
{
  supportedWallets: ['paytm', 'phonepe', 'googlepay', 'amazonpay', 'mobikwik', 'freecharge'],
  tenantId: '<merchant_tenant_id>',
  defaultTenantId: '<fallback_tenant_id>',
  walletApiKeys: {
    paytm: '<paytm_api_key>',
    phonepe: '<phonepe_api_key>',
    // ... other wallet keys
  },
  webhookSecrets: {
    paytm: '<paytm_secret>',
    phonepe: '<phonepe_secret>',
    // ... other wallet secrets
  }
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - Wallet as payment method option

2. **UPI Service** (`/src/upi/upi-service.js`)
   - PhonePe, GPay use UPI protocol

3. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record wallet transactions in ledger

---

## Monitoring & Analytics

### Key Metrics:
- Wallet payment success rate by provider
- Wallet balance query response time
- Transfer success rate
- Add money success rate
- Callback processing latency

### Logs:
- Payment initiated: `paymentId, walletType, amount, paymentUrl`
- Balance checked: `walletType, customerId, balance`
- Transfer processed: `transferId, amount, status`
- Callback received: `paymentId, status, walletTransactionId`

---

## API Endpoints (Typical Integration)

```
POST /api/wallet/initiate - Initiate wallet payment
GET  /api/wallet/balance - Check wallet balance
POST /api/wallet/transfer - P2P wallet transfer
POST /api/wallet/add-money - Top-up wallet
POST /api/wallet/link - Link wallet to merchant
GET  /api/wallet/history - Transaction history
POST /api/wallet/callback - Wallet provider webhook (internal)
```

---

## Wallet-Specific Features

### Paytm:
- Supports wallet balance, add money, P2P transfer
- Postpaid feature for eligible users
- Cashback and rewards

### PhonePe:
- UPI-based wallet
- Deep link integration
- QR code support

### Google Pay:
- UPI-based
- Deep link integration
- No balance check API (UPI direct)

### Amazon Pay:
- Gift card balance
- Add money via card/UPI
- Web-based checkout

### MobiKwik:
- Wallet balance
- ZIP (Buy Now Pay Later) integration
- Reward points

### Freecharge:
- Wallet balance
- Bill payment integration
- Cashback features
