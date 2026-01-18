# PayOut (Disbursements) - Code Trace Document

## Overview
**Payment Type**: PayOut (Disbursements)  
**Purpose**: Send payments to beneficiaries via IMPS/NEFT/RTGS/UPI  
**Entry Point**: Payout Service API  
**Primary File**: `/src/payout/payout-service.js`

---

## Execution Flow

### 1. CREATE BENEFICIARY
**Function**: `createBeneficiary(beneficiaryData)`  
**Entry Point**: Merchant adds beneficiary for payouts

#### Flow Steps:
1. **Validation** (`validateBeneficiaryData`)
   - Required fields: name, accountNumber, ifscCode
   - Validate IFSC format: `^[A-Z]{4}0[A-Z0-9]{6}$`

2. **Bank Account Verification** (`verifyBankAccount`)
   - **Interface Point**: Penny Drop API / Bank Verification Service
   - Validates account number + IFSC combination
   - **External System**: Banking partner verification API

3. **Beneficiary Creation**
   - Generate beneficiaryId: `BEN_{timestamp}`
   - Set accountType: 'savings' (default)
   - Status: 'ACTIVE'

4. **Database Operations** (`storeBeneficiary`)
   - **Table**: `beneficiaries`
   - **Operation**: INSERT
   - **Fields**:
     - beneficiary_name, account_number, ifsc_code
     - bank_name, branch_name
     - email, phone, status, metadata
     - tenant_id (multi-tenancy)

5. **Response**
   - Returns: beneficiaryId, status

---

### 2. CREATE SINGLE PAYOUT
**Function**: `createPayout(payoutData)`  
**Entry Point**: Merchant initiates payout

#### Flow Steps:
1. **Validation** (`validatePayoutData`)
   - Required: beneficiaryId, amount
   - Validate amount > 0
   - Valid modes: IMPS, NEFT, RTGS, UPI

2. **Beneficiary Retrieval** (`getBeneficiary`)
   - **Table**: `beneficiaries`
   - **Operation**: SELECT
   - Validate beneficiary exists and is ACTIVE

3. **Balance Check** (`checkBalance`)
   - Verify merchant has sufficient balance
   - **Table**: `merchants`
   - Check balance >= payout amount

4. **Payout Processing** (`processPayout`)
   - **Interface Point**: Banking Partner API
   - Generate payoutId: `PAYOUT_{timestamp}`
   - Mode: IMPS (default), NEFT, RTGS, UPI
   - Status: 'INITIATED'
   
   **External System Call**:
   - **Service**: Banking Partner (e.g., RazorpayX, Cashfree)
   - **Data Sent**:
     - account_number, ifsc_code
     - amount, currency
     - purpose, reference
     - transfer_mode (IMPS/NEFT/RTGS/UPI)
   
   **Response Expected**:
   - UTR number (Unique Transaction Reference)
   - status: PROCESSING/SUCCESS/FAILED

5. **Database Operations**
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - transaction_ref: payoutId
     - order_id: payoutId
     - payment_method: 'payout'
     - gateway: mode (IMPS/NEFT/RTGS/UPI)
     - amount, currency, status: 'processing'
     - metadata: {beneficiaryId, accountNumber, ifscCode, purpose, reference, mode, utr}
     - gateway_transaction_id: UTR
     - gateway_response_message: "Payout initiated via {mode}"

6. **Response**
   - Returns: payoutId, status, utr, timestamp

---

### 3. CREATE BULK PAYOUT
**Function**: `createBulkPayout(bulkData)`  
**Entry Point**: Merchant bulk payout upload

#### Flow Steps:
1. **Batch Creation**
   - Generate batchId: `BATCH_{timestamp}`
   - Calculate totalAmount (sum of all payouts)

2. **Iterative Processing**
   - Loop through each payout in array
   - Call `createPayout()` for each
   - Collect results: SUCCESS or FAILED

3. **Batch Summary**
   - successCount, failedCount
   - Results array with status for each payout

4. **Response**
   - Returns: batchId, totalPayouts, successCount, failedCount, results[]

---

### 4. GET PAYOUT STATUS
**Function**: `getPayoutStatus(payoutId)`  
**Entry Point**: Check payout status

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Operation**: SELECT
   - **Query**: WHERE transaction_ref = payoutId AND payment_method = 'payout'

2. **Response**
   - Returns: payoutId, status, utr, amount, timestamp

---

### 5. GET ACCOUNT BALANCE
**Function**: `getBalance()`  
**Entry Point**: Check available payout balance

#### Flow Steps:
1. **Database Query**
   - **Table**: `merchants`
   - **Operation**: SELECT
   - **Query**: Get balance for current tenant

2. **Response**
   - Returns: balance, currency ('INR'), timestamp

---

### 6. GET PAYOUT HISTORY
**Function**: `getPayoutHistory(filters)`  
**Entry Point**: Retrieve past payouts

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Operation**: SELECT with filters
   - **Filters**: startDate, endDate, status, limit

2. **Response**
   - Returns: payouts array, total, page, limit

---

## External System Interfaces

### 1. Bank Verification API (Penny Drop)
**Interface Point**: `verifyBankAccount(accountNumber, ifscCode)`  
**Purpose**: Validate bank account before adding beneficiary

**Providers**:
- Razorpay Fund Accounts
- Cashfree Beneficiary Verification
- Direct Bank APIs

**Request**:
```json
{
  "account_number": "1234567890",
  "ifsc_code": "SBIN0001234"
}
```

**Response**:
```json
{
  "valid": true,
  "account_holder_name": "John Doe",
  "account_type": "savings"
}
```

---

### 2. Banking Partner Payout API
**Interface Point**: `processPayout(payout, beneficiary)`  
**Purpose**: Execute fund transfer

**Providers**:
- RazorpayX Payouts
- Cashfree Payouts
- ICICI Bank API
- HDFC Bank API

**Transfer Modes**:
- **IMPS**: Immediate (24x7), up to ₹2 lakhs
- **NEFT**: Batch-based, no upper limit
- **RTGS**: Real-time, minimum ₹2 lakhs
- **UPI**: Instant, up to ₹1 lakh

**Request**:
```json
{
  "account_number": "1234567890",
  "ifsc": "SBIN0001234",
  "beneficiary_name": "John Doe",
  "amount": 10000,
  "currency": "INR",
  "mode": "IMPS",
  "purpose": "vendor_payment",
  "reference_id": "PAYOUT_123"
}
```

**Response**:
```json
{
  "status": "PROCESSING",
  "utr": "UTR1234567890",
  "payout_id": "PAYOUT_123",
  "fee": 5.00
}
```

---

## Database Tables & Operations

### 1. beneficiaries
**Purpose**: Store verified beneficiary bank accounts

**Schema**:
```sql
- id (UUID, primary key)
- tenant_id (UUID, indexed) - Multi-tenancy
- beneficiary_name (VARCHAR)
- account_number (VARCHAR)
- ifsc_code (VARCHAR)
- bank_name, branch_name (VARCHAR)
- email, phone (VARCHAR)
- status (ENUM: active, inactive, blocked)
- metadata (JSONB)
- created_at, updated_at (TIMESTAMP)

UNIQUE INDEX: (tenant_id, account_number, ifsc_code)
```

**Operations**:
- **INSERT**: `storeBeneficiary()` - Add new beneficiary
- **SELECT**: `getBeneficiary()` - Retrieve for payout
- **UPDATE**: Deactivate/block beneficiary

---

### 2. transactions
**Purpose**: Track payout transactions

**Schema**: Same as PayIn (see PayIn trace)

**Payout-Specific Fields**:
- payment_method: 'payout'
- gateway: 'IMPS', 'NEFT', 'RTGS', 'UPI'
- metadata: Contains beneficiaryId, account details, purpose, UTR

**Operations**:
- **INSERT**: `processPayout()` - Record payout transaction
- **SELECT**: `getPayoutStatus()`, `getPayoutHistory()`
- **UPDATE**: Status updates from banking partner webhooks

---

### 3. merchants
**Purpose**: Track merchant balance for payouts

**Schema**:
```sql
- id (UUID)
- merchant_code (VARCHAR, unique)
- merchant_name (VARCHAR)
- email, phone (VARCHAR)
- balance (DECIMAL 15,2) - Available payout balance
- status (ENUM: active, inactive, suspended)
- created_at, updated_at (TIMESTAMP)
```

**Operations**:
- **SELECT**: `checkBalance()` - Verify sufficient funds
- **UPDATE**: Deduct on payout initiation, add on settlement

---

## Security & Compliance

### 1. Bank Account Validation
- Penny drop verification before activation
- IFSC code format validation
- Duplicate account prevention (unique constraint)

### 2. Balance Management
- Real-time balance check before payout
- Atomic balance deduction (database transactions)

### 3. Multi-Tenancy
- All beneficiaries scoped to tenant_id
- Balance checks per merchant account

---

## Error Handling

### Common Errors:
1. **Beneficiary creation failed**: Invalid IFSC code format
2. **Bank verification failed**: Account doesn't exist
3. **Payout creation failed**: Missing beneficiaryId or amount
4. **Beneficiary not found**: Invalid beneficiaryId
5. **Insufficient balance**: Merchant balance < payout amount
6. **Invalid transfer mode**: Mode not in [IMPS, NEFT, RTGS, UPI]
7. **Banking partner failure**: Network error or API timeout

### Retry Logic:
- Banking partner API failures: Retry 3 times with exponential backoff
- Status polling: Check UTR status periodically

---

## Configuration Requirements

```javascript
{
  tenantId: '<merchant_tenant_id>',
  defaultTenantId: '<fallback_tenant_id>',
  bankingPartnerApiKey: '<api_key>',
  bankingPartnerSecret: '<secret>',
  defaultPayoutMode: 'IMPS'
}
```

---

## Related Services

1. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record payout as debit entry
   - Track fees (₹3-5 per payout)

2. **Settlement Service** (`/src/core/ledger/settlement-service.js`)
   - Reconcile payouts with bank statements
   - Update merchant balance

3. **Audit Service** (`/src/security/audit-trail-service.js`)
   - Log all payout operations
   - PCI-DSS compliance

---

## Monitoring & Analytics

### Key Metrics:
- Payout success rate by mode
- Average payout processing time
- Beneficiary verification success rate
- Failed payout reasons

### Logs:
- Beneficiary stored: `beneficiaryId`
- Payout initiated: `payoutId, mode, amount, utr`
- Bulk payout: `batchId, successCount, failedCount`

---

## API Endpoints (Typical Integration)

```
POST /api/payouts/beneficiaries - Create beneficiary
GET  /api/payouts/beneficiaries/:id - Get beneficiary
POST /api/payouts/create - Single payout
POST /api/payouts/bulk - Bulk payout
GET  /api/payouts/:payoutId - Payout status
GET  /api/payouts/history - Payout history
GET  /api/payouts/balance - Account balance
```
