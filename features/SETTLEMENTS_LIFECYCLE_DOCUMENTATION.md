# Settlements Lifecycle Documentation

## Executive Summary

This document maps the complete lifecycle of settlements in the Payment Gateway system, from the moment a user makes a payment to how the transaction ultimately appears on the settlements screen. This is intended for debugging and understanding the end-to-end flow.

**Document Version:** 1.0  
**Last Updated:** 2026-01-14  
**System:** Payment Gateway with RBI-Compliant Double-Entry Ledger

---

## Table of Contents

1. [Actors Involved](#actors-involved)
2. [Complete Lifecycle Overview](#complete-lifecycle-overview)
3. [Phase 1: Payment Initiation](#phase-1-payment-initiation)
4. [Phase 2: Payment Processing](#phase-2-payment-processing)
5. [Phase 3: Ledger Recording](#phase-3-ledger-recording)
6. [Phase 4: Settlement Creation](#phase-4-settlement-creation)
7. [Phase 5: Settlement State Machine](#phase-5-settlement-state-machine)
8. [Phase 6: Display on Settlements Screen](#phase-6-display-on-settlements-screen)
9. [Technical Implementation Details](#technical-implementation-details)
10. [Debugging Guide](#debugging-guide)
11. [Common Issues and Solutions](#common-issues-and-solutions)

---

## Actors Involved

### Primary Actors

1. **End Customer/User**
   - Role: Initiates payment for goods/services
   - Interaction Point: Merchant website/app checkout
   - Technical Impact: Triggers payment gateway API calls

2. **Merchant**
   - Role: Receives payment for goods/services sold
   - Interaction Point: Integration with payment gateway
   - Technical Impact: Receives settlement payouts

3. **Payment Gateway System**
   - Role: Orchestrates payment processing
   - Components:
     - Payment Gateway Core (`src/core/payment-gateway.js`)
     - Smart Router (`src/core/routing/smart-router.js`)
     - Circuit Breaker (`src/core/circuit-breaker/circuit-breaker.js`)
     - Retry Handler (`src/core/retry/retry-handler.js`)
   - Technical Impact: Routes, processes, and records all payment transactions

4. **Third-Party Payment Providers**
   - Role: Actually process the payment transactions
   - Examples: Razorpay, PayU, CCAvenue
   - Interaction Point: Gateway adapter layer
   - Technical Impact: Return payment success/failure status

5. **Ledger Service**
   - Role: Records all financial transactions in double-entry format
   - Component: `src/core/ledger/ledger-service.js`
   - Technical Impact: Creates immutable financial records for RBI compliance

6. **Ledger Event Handlers**
   - Role: Maps business events to accounting entries
   - Component: `src/core/ledger/ledger-event-handlers.js`
   - Technical Impact: Ensures proper debit/credit entries for each transaction type

7. **Settlement Service**
   - Role: Manages merchant settlement lifecycle and state machine
   - Component: `src/core/ledger/settlement-service.js`
   - Technical Impact: Tracks settlement status from creation to completion

8. **Finance Admin**
   - Role: Monitors and manages settlements
   - Interaction Point: Finance Admin Console (`/public/finance-admin-console.html`)
   - Technical Impact: Views settlements, initiates state transitions

9. **Bank/Payment Bank**
   - Role: Executes actual fund transfers to merchants
   - Interaction Point: Bank integration layer (external to system)
   - Technical Impact: Provides UTR numbers and confirmation

10. **Compliance Admin**
    - Role: Approves critical financial operations
    - Interaction Point: Compliance Admin Portal
    - Technical Impact: Second-level approval for settlements

### System Components (Internal Actors)

11. **Database (PostgreSQL)**
    - Tables: `ledger_transactions`, `ledger_entries`, `settlements`, `merchants`
    - Role: Persists all financial data

12. **API Layer**
    - Routes: `src/api/routes.js`, `src/api/finance-admin-routes.js`, `src/api/settlement-routes.js`
    - Role: Exposes RESTful endpoints for all operations

13. **Accounting Period Service**
    - Component: `src/core/ledger/accounting-period-service.js`
    - Role: Manages daily/monthly accounting periods and closures

14. **Ledger Lock Service**
    - Component: `src/core/ledger/ledger-lock-service.js`
    - Role: Prevents changes to closed accounting periods

---

## Complete Lifecycle Overview

### High-Level Flow Diagram

```
[User Payment] 
    ↓
[Payment Gateway API] 
    ↓
[Smart Router] → [Circuit Breaker] → [Retry Handler]
    ↓
[Third-Party Provider] (Razorpay/PayU/CCAvenue)
    ↓
[Payment Success/Failure]
    ↓
[Ledger Event Handler] - Maps event to accounting entries
    ↓
[Ledger Service] - Posts double-entry transaction
    ↓
[Database] - Stores in ledger_transactions & ledger_entries
    ↓
[Settlement Service] - Creates settlement record (T+1/T+2)
    ↓
[Settlement State Machine] - Tracks lifecycle
    ↓
[Finance Admin Console] - Displays on settlements screen
```

### Timeline

- **T+0 (Transaction Time):** Payment processed and ledger entry created
- **T+0 to T+1:** Payment confirmation and reconciliation
- **T+1 (Settlement Creation):** Settlement record created for merchant payout
- **T+1 to T+2:** Settlement state transitions (funds reserved → sent to bank)
- **T+2 (Bank Confirmation):** UTR received, settlement marked as bank confirmed
- **T+2 to T+3:** Final settlement and display on screen

---

## Phase 1: Payment Initiation

### 1.1 User Action

**What Happens:**
- User completes checkout on merchant website/app
- User selects payment method (UPI, Card, Net Banking, etc.)
- User provides payment credentials

**Technical Flow:**
```javascript
// Merchant website calls payment gateway
POST /api/payments/process
Headers:
  Authorization: Bearer <merchant_jwt_token>
Body:
  {
    "orderId": "ORDER-12345",
    "amount": 1000.00,
    "currency": "INR",
    "customerId": "CUST-789",
    "paymentMethod": "UPI",
    "merchantId": "merchant-uuid",
    "tenantId": "tenant-uuid"
  }
```

**File:** `src/api/routes.js` (Line 69-82)

### 1.2 Gateway Receives Request

**Component:** `PaymentGateway` class in `src/core/payment-gateway.js`

**What Happens:**
- Request validated
- Tenant ID extracted from JWT token (prevents spoofing)
- Smart router selects optimal payment provider
- Circuit breaker checks provider health

**Code Location:** `src/core/payment-gateway.js:96`

---

## Phase 2: Payment Processing

### 2.1 Smart Routing

**Component:** `SmartRouter` in `src/core/routing/smart-router.js`

**What Happens:**
- Evaluates available payment providers (Razorpay, PayU, CCAvenue)
- Checks circuit breaker status for each provider
- Selects provider based on:
  - Health score
  - Cost optimization
  - Success rate
  - Fallback priority

### 2.2 Payment Gateway Communication

**What Happens:**
- Gateway adapter (Razorpay/PayU/CCAvenue) called
- Payment initiated with provider
- Provider returns transaction ID and status

**Retry Logic:**
- Automatic retry on transient failures
- Exponential backoff: 1s, 2s, 4s, 8s...
- Maximum 3 attempts
- Jitter added to prevent thundering herd

**File:** `src/core/retry/retry-handler.js`

### 2.3 Payment Confirmation

**Success Response:**
```json
{
  "success": true,
  "transactionId": "TXN-ABC123",
  "orderId": "ORDER-12345",
  "amount": 1000.00,
  "status": "SUCCESS",
  "gateway": "razorpay",
  "gatewayTransactionId": "pay_ABC123XYZ",
  "timestamp": "2026-01-14T10:30:00Z"
}
```

---

## Phase 3: Ledger Recording

### 3.1 Event Handling

**Component:** `LedgerEventHandlers` in `src/core/ledger/ledger-event-handlers.js`

**What Happens:**
- Payment success event triggers `handlePaymentSuccess()` method
- Business event mapped to double-entry accounting rules

**File:** `src/core/ledger/ledger-event-handlers.js:69`

### 3.2 Double-Entry Accounting Logic

**For a ₹1,000 payment with ₹20 platform fee and ₹10 gateway fee:**

```
Accounting Entries:
1. Dr. Escrow Bank (ESC-001)              ₹1,000  [Cash In]
   Cr. Escrow Liability (ESC-002)         ₹1,000  [Obligation to customer/merchant]

2. Dr. Merchant Receivables (MER-001)     ₹970   [Merchant's earning]
   Cr. Merchant Payables (MER-002)        ₹970   [Amount owed to merchant]

3. Dr. Platform Receivables (PLT-001)     ₹20    [Platform commission]
   Cr. Platform Revenue (REV-001)         ₹20    [Platform income]

4. Dr. Gateway Fee Expense (GW-FEE-001)   ₹10    [Gateway cost]
   Cr. Gateway Payables (GW-PAY-001)      ₹10    [Amount owed to gateway]
```

**Account Codes:** Defined in `src/core/ledger/ledger-service.js:28-60`

### 3.3 Ledger Transaction Creation

**Component:** `LedgerService.postTransaction()`

**What Happens:**
1. Validates all entries balance (Total Dr = Total Cr)
2. Checks accounting period is open
3. Verifies ledger is not locked
4. Creates transaction record in `ledger_transactions` table
5. Creates individual entries in `ledger_entries` table
6. Updates `account_balances` view
7. Creates audit log entry

**Database Tables:**
- `ledger_transactions`: Master transaction record
- `ledger_entries`: Individual debit/credit entries
- `ledger_accounts`: Chart of accounts
- `account_balances`: Real-time account balance view

**File:** `src/core/ledger/ledger-service.js:95-200`

### 3.4 Idempotency

**Key Feature:** Duplicate transaction prevention
- Every transaction has `idempotencyKey`
- Format: `payment-{transactionId}`
- Prevents double posting if request retried

---

## Phase 4: Settlement Creation

### 4.1 When Settlements are Created

**Timing:** T+1 or T+2 days after payment (configurable)

**Trigger Options:**
1. **Automated:** Batch job runs daily to aggregate merchant transactions
2. **Manual:** Finance admin creates settlement via API
3. **Scheduled:** Based on merchant settlement cycle (daily/weekly/monthly)

### 4.2 Settlement Aggregation Logic

**What Gets Aggregated:**
- All successful payments for a merchant within period
- Platform fees deducted
- Gateway fees deducted
- Refunds subtracted
- Chargebacks subtracted

**Calculation:**
```
Settlement Amount = 
  Σ(Successful Payments) 
  - Σ(Platform Fees) 
  - Σ(Gateway Fees) 
  - Σ(Refunds) 
  - Σ(Chargebacks)
```

### 4.3 Settlement Record Creation

**API Endpoint:** `POST /api/finance-admin/settlements`

**Request:**
```json
{
  "tenantId": "tenant-uuid",
  "merchantId": "merchant-uuid",
  "settlementRef": "SETL-2026-01-14-001",
  "settlementDate": "2026-01-14",
  "periodFrom": "2026-01-12",
  "periodTo": "2026-01-13",
  "grossAmount": 50000.00,
  "feesAmount": 1500.00,
  "netAmount": 48500.00,
  "bankAccountNumber": "1234567890",
  "bankIfsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "metadata": {
    "transactionCount": 50,
    "merchantName": "ABC Store"
  }
}
```

**File:** `src/api/settlement-routes.js:130-186`

**Service Method:** `settlementService.createSettlement()`

**What Happens:**
1. Settlement record inserted into `settlements` table
2. Initial state set to `CREATED`
3. State transitions array initialized
4. Retry counters initialized (max 3 retries)
5. Audit log entry created

**File:** `src/core/ledger/settlement-service.js:52-118`

---

## Phase 5: Settlement State Machine

### 5.1 Settlement States

The settlement follows a strict state machine with no backward transitions (except retry):

```
CREATED 
  ↓
FUNDS_RESERVED (Finance admin reserves funds from escrow)
  ↓
SENT_TO_BANK (Batch file sent to bank)
  ↓
BANK_CONFIRMED (UTR received from bank) ← CRITICAL FINALITY POINT
  ↓
SETTLED (Final state, marked as complete)

FAILED (Error state, can retry)
  ↓
RETRIED (Back to FUNDS_RESERVED)
```

### 5.2 State Transition Rules

**Valid Transitions:** Defined in `src/core/errors/accounting-errors.js`

```javascript
CREATED → [FUNDS_RESERVED, FAILED]
FUNDS_RESERVED → [SENT_TO_BANK, FAILED]
SENT_TO_BANK → [BANK_CONFIRMED, FAILED]
BANK_CONFIRMED → [SETTLED, FAILED]
SETTLED → [] (Terminal state)
FAILED → [RETRIED]
RETRIED → [FUNDS_RESERVED]
```

### 5.3 State Transition Details

#### 5.3.1 CREATED → FUNDS_RESERVED

**Trigger:** Finance admin clicks "Reserve Funds" button

**API:** `POST /api/finance-admin/settlements/:settlementId/reserve-funds`

**What Happens:**
1. Validates current state is `CREATED`
2. Checks sufficient balance in escrow
3. Updates state to `FUNDS_RESERVED`
4. Sets `funds_reserved_at` timestamp
5. Records transition in `state_transitions` array
6. Creates audit log

**File:** `src/api/settlement-routes.js:192-226`

#### 5.3.2 FUNDS_RESERVED → SENT_TO_BANK

**Trigger:** Finance admin generates bank batch file and marks as sent

**API:** `POST /api/finance-admin/settlements/:settlementId/send-to-bank`

**What Happens:**
1. Validates current state is `FUNDS_RESERVED`
2. Updates state to `SENT_TO_BANK`
3. Sets `sent_to_bank_at` timestamp
4. Records `bankBatchId` if provided
5. Creates audit log

**File:** `src/api/settlement-routes.js:232-267`

#### 5.3.3 SENT_TO_BANK → BANK_CONFIRMED

**Trigger:** Bank provides UTR number after processing

**API:** `POST /api/finance-admin/settlements/:settlementId/confirm-by-bank`

**Request:**
```json
{
  "tenantId": "tenant-uuid",
  "utrNumber": "UTR123456789",
  "bankReferenceNumber": "BNK-REF-001",
  "bankTransactionId": "BANK-TXN-789",
  "settlementBatchId": "BATCH-2026-01-14"
}
```

**What Happens:**
1. Validates current state is `SENT_TO_BANK`
2. **Requires UTR number** (mandatory for finality)
3. Updates state to `BANK_CONFIRMED`
4. Sets `bank_confirmed_at` timestamp
5. Records bank details (UTR, reference number, etc.)
6. Creates ledger entries via `ledgerEventHandlers.handleSettlement()`
7. Creates audit log

**File:** `src/api/settlement-routes.js:274-318`

**Critical Note:** This is the point of finality. Once bank confirmed, settlement cannot be reversed.

#### 5.3.4 BANK_CONFIRMED → SETTLED

**Trigger:** Finance admin marks as settled after verification

**API:** `POST /api/finance-admin/settlements/:settlementId/mark-settled`

**What Happens:**
1. Validates current state is `BANK_CONFIRMED`
2. Updates state to `SETTLED`
3. Sets `settled_at` and `completed_at` timestamps
4. Creates audit log

**File:** `src/api/settlement-routes.js:324-358`

#### 5.3.5 Any State → FAILED

**Trigger:** Error occurs during processing or manual marking

**API:** `POST /api/finance-admin/settlements/:settlementId/mark-failed`

**Request:**
```json
{
  "tenantId": "tenant-uuid",
  "failureReason": "Insufficient funds in escrow account"
}
```

**What Happens:**
1. Can transition from any state (except SETTLED)
2. Updates state to `FAILED`
3. Sets `failed_at` timestamp
4. Records `failure_reason`
5. Enables retry mechanism
6. Creates audit log

**File:** `src/api/settlement-routes.js:364-399`

#### 5.3.6 FAILED → RETRIED → FUNDS_RESERVED

**Trigger:** Finance admin clicks "Retry Settlement"

**API:** `POST /api/finance-admin/settlements/:settlementId/retry`

**Retry Logic:**
- Maximum 3 retry attempts
- Exponential backoff: 15 min, 1 hour, 4 hours
- Retry history tracked
- Next retry time calculated

**What Happens:**
1. Validates current state is `FAILED`
2. Checks retry count < max retries (3)
3. Increments retry counter
4. Records retry in `retry_history`
5. Calculates `next_retry_at` with backoff
6. Transitions to `RETRIED` then immediately to `FUNDS_RESERVED`
7. Creates audit log

**File:** `src/core/ledger/settlement-service.js:386-459`

### 5.4 State Immutability

**Key Features:**
- All state transitions are timestamped
- Complete history maintained in `state_transitions` JSON array
- Who performed transition recorded (`transitionBy`)
- Why transition happened recorded (`metadata`)
- No states can be skipped (enforced by validation)
- No backward transitions (except retry)

---

## Phase 6: Display on Settlements Screen

### 6.1 Frontend: Finance Admin Console

**File:** `/public/finance-admin-console.html`

**UI Location:** Finance Admin Console → Settlements Tab

**HTML Structure:** Lines 465-509

```html
<div id="settlements-tab" class="tab-content">
  <h2>Settlement State Management</h2>
  
  <!-- Status Filter -->
  <select id="settlement-status" onchange="loadSettlements()">
    <option value="">All</option>
    <option value="CREATED">Created</option>
    <option value="FUNDS_RESERVED">Funds Reserved</option>
    <option value="SENT_TO_BANK">Sent to Bank</option>
    <option value="BANK_CONFIRMED">Bank Confirmed</option>
    <option value="SETTLED">Settled</option>
    <option value="FAILED">Failed</option>
  </select>
  
  <!-- Search Button -->
  <button class="btn btn-primary" onclick="loadSettlements()">Search</button>
  
  <!-- Settlements Table -->
  <table id="settlementsTable">
    <tbody id="settlementsTableBody">
      <!-- Data loaded here -->
    </tbody>
  </table>
</div>
```

### 6.2 JavaScript: Load Settlements Function

**Function:** `loadSettlements()`

**File:** `/public/finance-admin-console.html:1183`

**Code:**
```javascript
async function loadSettlements() {
  if (!requireTenant()) return;
  
  try {
    // Get selected status filter
    const status = document.getElementById('settlement-status')?.value || '';
    
    // Build API query parameters
    const params = `tenantId=${currentTenantId}${status ? '&status=' + status : ''}`;
    
    // Call API
    const data = await apiCall(`/settlements?${params}`);
    
    if (data.success) {
      const tbody = document.getElementById('settlementsTableBody');
      
      if (data.data?.length > 0) {
        // Render settlements table
        tbody.innerHTML = data.data.map(s => `
          <tr>
            <td>${s.settlement_ref}</td>
            <td>${s.merchant_id}</td>
            <td>${s.net_amount} ${s.currency || 'INR'}</td>
            <td><span class="badge badge-info">${s.status}</span></td>
            <td>${s.utr_number || '-'}</td>
            <td>${new Date(s.created_at).toLocaleString()}</td>
            <td>
              <button class="btn btn-primary" onclick="viewSettlement('${s.id}')">
                View
              </button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="7">No settlements found</td></tr>';
      }
    }
  } catch (error) {
    console.error('Error loading settlements:', error);
    alert('Error: ' + error.message);
  }
}
```

### 6.3 API Call Flow

**Step 1:** Browser makes fetch request

```javascript
fetch('/api/finance-admin/settlements?tenantId=xxx&status=CREATED', {
  headers: {
    'Content-Type': 'application/json',
    'x-user-role': 'FINANCE_ADMIN',
    'x-user-id': 'user-uuid',
    'x-user-email': 'admin@example.com'
  }
})
```

**Step 2:** Request hits Express router

**File:** `src/index.js:95`
- Routes to `/api` handled by `src/api/routes.js`

**Step 3:** Routes to Finance Admin endpoints

**File:** `src/api/routes.js:824-825`
```javascript
const financeAdminRoutes = require('./finance-admin-routes');
router.use('/finance-admin', financeAdminRoutes);
```

**Step 4:** Delegates to Settlement Routes

**File:** `src/api/finance-admin-routes.js:161-162`
```javascript
const settlementRoutes = require('./settlement-routes');
router.use('/settlements', settlementRoutes);
```

**Step 5:** Settlement GET endpoint handler

**File:** `src/api/settlement-routes.js:32-61`

**Code:**
```javascript
router.get('/', requireFinanceOrOps, async (req, res) => {
  try {
    const { tenantId, status, limit } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    // Call settlement service
    const settlements = await settlementService.getSettlementsByStatus({
      tenantId,
      status,
      limit: limit ? parseInt(limit) : undefined
    });
    
    res.json({
      success: true,
      data: settlements
    });
    
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

**Step 6:** Settlement Service queries database

**File:** `src/core/ledger/settlement-service.js:492-505`

**Code:**
```javascript
async getSettlementsByStatus(params) {
  const { tenantId, status, limit = 100 } = params;
  
  let query = db.knex('settlements')
    .where('tenant_id', tenantId)
    .orderBy('created_at', 'desc')
    .limit(limit);
  
  if (status) {
    query = query.where('status', status);
  }
  
  return await query;
}
```

**Step 7:** Results returned to frontend

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "setl-uuid-123",
      "tenant_id": "tenant-uuid",
      "merchant_id": "merchant-uuid",
      "settlement_ref": "SETL-2026-01-14-001",
      "settlement_date": "2026-01-14T00:00:00Z",
      "period_from": "2026-01-12T00:00:00Z",
      "period_to": "2026-01-13T23:59:59Z",
      "gross_amount": "50000.00",
      "fees_amount": "1500.00",
      "net_amount": "48500.00",
      "status": "BANK_CONFIRMED",
      "utr_number": "UTR123456789",
      "bank_confirmed_at": "2026-01-14T12:30:00Z",
      "created_at": "2026-01-14T10:00:00Z",
      "retry_count": 0,
      "max_retries": 3,
      "state_transitions": [...],
      "metadata": {...}
    }
  ]
}
```

### 6.4 User Interaction Flow

1. **Finance Admin logs in** → Authentication sets user role
2. **Navigates to Settlements tab** → Tab becomes active
3. **Selects status filter** (optional) → Dropdown selection
4. **Clicks "Search" button** → Triggers `loadSettlements()`
5. **API call made** → Fetch request to backend
6. **Results displayed** → Table populated with settlement records
7. **Can view details** → Click "View" button for specific settlement
8. **Can perform actions** → Reserve funds, send to bank, confirm, etc.

---

## Technical Implementation Details

### Database Schema

#### settlements Table

```sql
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  merchant_id UUID NOT NULL,
  settlement_ref VARCHAR(100) NOT NULL UNIQUE,
  settlement_date TIMESTAMP NOT NULL,
  period_from TIMESTAMP,
  period_to TIMESTAMP,
  gross_amount DECIMAL(15,2) NOT NULL,
  fees_amount DECIMAL(15,2) DEFAULT 0,
  net_amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  bank_account_number VARCHAR(50),
  bank_ifsc VARCHAR(20),
  bank_name VARCHAR(100),
  status VARCHAR(50) NOT NULL,
  
  -- State tracking timestamps
  funds_reserved_at TIMESTAMP,
  sent_to_bank_at TIMESTAMP,
  bank_confirmed_at TIMESTAMP,
  settled_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  
  -- Bank confirmation details
  bank_reference_number VARCHAR(100),
  bank_transaction_id VARCHAR(100),
  utr_number VARCHAR(50),
  settlement_batch_id VARCHAR(100),
  
  -- Retry management
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_retry_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  failure_reason TEXT,
  retry_history JSONB,
  
  -- Audit trail
  state_transitions JSONB,
  metadata JSONB,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

-- Indexes for performance
CREATE INDEX idx_settlements_tenant_id ON settlements(tenant_id);
CREATE INDEX idx_settlements_merchant_id ON settlements(merchant_id);
CREATE INDEX idx_settlements_status ON settlements(status);
CREATE INDEX idx_settlements_settlement_date ON settlements(settlement_date);
CREATE INDEX idx_settlements_created_at ON settlements(created_at);
```

#### ledger_transactions Table

```sql
CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  transaction_ref VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(255) UNIQUE,
  event_type VARCHAR(50) NOT NULL,
  source_transaction_id VARCHAR(100),
  source_order_id VARCHAR(100),
  amount DECIMAL(15,2) NOT NULL,
  description TEXT,
  metadata JSONB,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

#### ledger_entries Table

```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  account_id UUID NOT NULL,
  entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount DECIMAL(15,2) NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id),
  FOREIGN KEY (account_id) REFERENCES ledger_accounts(id)
);
```

### API Endpoints Summary

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/api/payments/process` | POST | Process payment | Merchant JWT |
| `/api/finance-admin/settlements` | GET | List settlements | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id` | GET | Get settlement details | FINANCE_ADMIN |
| `/api/finance-admin/settlements` | POST | Create settlement | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/reserve-funds` | POST | Reserve funds | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/send-to-bank` | POST | Mark sent to bank | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/confirm-by-bank` | POST | Confirm bank processed | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/mark-settled` | POST | Mark as settled | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/mark-failed` | POST | Mark as failed | FINANCE_ADMIN |
| `/api/finance-admin/settlements/:id/retry` | POST | Retry failed settlement | FINANCE_ADMIN |
| `/api/finance-admin/settlements/retry-queue` | GET | Get settlements ready for retry | FINANCE_ADMIN |

### Configuration

**File:** `src/config/config.js` (likely)

```javascript
module.exports = {
  settlement: {
    cycle: 'T+1',  // T+0, T+1, T+2
    maxRetries: 3,
    retryBackoff: [15, 60, 240], // minutes
    autoCreate: true,
    batchTime: '09:00', // Time to create daily settlements
  }
};
```

---

## Debugging Guide

### Issue: Settlements Not Showing on Screen

#### Debug Step 1: Check if Settlements Exist in Database

```sql
-- Connect to PostgreSQL
SELECT 
  id, 
  settlement_ref, 
  merchant_id, 
  net_amount, 
  status, 
  created_at 
FROM settlements 
WHERE tenant_id = 'your-tenant-id'
ORDER BY created_at DESC 
LIMIT 10;
```

**Expected Result:** Should see settlement records

**If No Records:** Settlements were never created → Check Step 2

**If Records Exist:** Settlements exist but not displaying → Check Step 6

#### Debug Step 2: Check if Payments Were Processed

```sql
-- Check recent payment transactions
SELECT 
  id,
  transaction_ref,
  event_type,
  amount,
  created_at
FROM ledger_transactions
WHERE tenant_id = 'your-tenant-id'
  AND event_type = 'payment'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Result:** Should see payment transactions

**If No Records:** Payments not recorded → Check Step 3

**If Records Exist:** Payments recorded but settlements not created → Check Step 4

#### Debug Step 3: Check Payment Gateway Logs

**Check Browser Console:**
```javascript
// Open browser DevTools (F12)
// Check Network tab for failed requests
// Look for POST /api/payments/process
// Check response status and error messages
```

**Check Server Logs:**
```bash
# If using PM2
pm2 logs

# If using Docker
docker logs <container-name>

# Look for payment processing errors
grep "Error processing payment" logs/app.log
```

#### Debug Step 4: Check Settlement Creation Process

**Option A: Manual Settlement Creation**

Test creating a settlement manually via API:

```bash
curl -X POST http://localhost:3000/api/finance-admin/settlements \
  -H "Content-Type: application/json" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: test-user" \
  -H "x-user-email: admin@test.com" \
  -d '{
    "tenantId": "your-tenant-id",
    "merchantId": "your-merchant-id",
    "settlementRef": "SETL-TEST-001",
    "netAmount": 1000.00,
    "grossAmount": 1100.00,
    "feesAmount": 100.00
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "settlement-uuid",
    "status": "CREATED",
    ...
  }
}
```

**Option B: Check Automated Settlement Job**

If settlements are auto-created by a scheduled job:

```bash
# Check cron jobs
crontab -l

# Check job logs
tail -f logs/settlement-job.log
```

#### Debug Step 5: Check Authentication

Settlements screen requires `FINANCE_ADMIN` or `COMPLIANCE_ADMIN` role.

**Check in Browser Console:**
```javascript
// Check current user
console.log(window.currentUser);
// Should show: { role: 'FINANCE_ADMIN', userId: '...', ... }

// Check tenant ID
console.log(currentTenantId);
// Should show a UUID
```

**If Authentication Fails:**
- User not logged in → Redirect to login
- Wrong role → 403 Forbidden error
- Missing tenant ID → 400 Bad Request

#### Debug Step 6: Check API Request/Response

**Open Browser DevTools → Network Tab**

**When clicking "Search" button:**

1. **Request should be made:**
   - URL: `/api/finance-admin/settlements?tenantId=xxx&status=xxx`
   - Method: GET
   - Status: 200 OK

2. **Check Request Headers:**
   ```
   x-user-role: FINANCE_ADMIN
   x-user-id: user-uuid
   x-user-email: admin@example.com
   ```

3. **Check Response:**
   ```json
   {
     "success": true,
     "data": [...]
   }
   ```

**If Request Fails:**
- 400 Bad Request → Missing or invalid parameters
- 401 Unauthorized → Not authenticated
- 403 Forbidden → Wrong role
- 404 Not Found → Route not registered
- 500 Internal Server Error → Server-side error (check logs)

#### Debug Step 7: Check Frontend JavaScript

**Add Debug Logging:**

Edit `/public/finance-admin-console.html`:

```javascript
async function loadSettlements() {
  console.log('=== Loading Settlements ===');
  console.log('Current Tenant ID:', currentTenantId);
  
  if (!requireTenant()) {
    console.error('Tenant ID not set');
    return;
  }
  
  try {
    const status = document.getElementById('settlement-status')?.value || '';
    console.log('Selected Status:', status);
    
    const params = `tenantId=${currentTenantId}${status ? '&status=' + status : ''}`;
    console.log('API Params:', params);
    
    const data = await apiCall(`/settlements?${params}`);
    console.log('API Response:', data);
    
    if (data.success) {
      console.log('Settlement Count:', data.data?.length);
      // ... rest of code
    }
  } catch (error) {
    console.error('Error loading settlements:', error);
    console.error('Error Stack:', error.stack);
    alert('Error: ' + error.message);
  }
}
```

#### Debug Step 8: Check Database Connection

```sql
-- Test database connection
SELECT NOW();

-- Check settlements table exists
SELECT COUNT(*) FROM settlements;

-- Check table structure
\d settlements
```

#### Debug Step 9: Check Route Registration

**Server Startup Logs:**

When server starts, routes should be registered. Check logs for:

```
Routes registered: /api/finance-admin
Settlement routes mounted at: /api/finance-admin/settlements
```

**Test Route Directly:**

```bash
# Test if route is accessible
curl -X GET "http://localhost:3000/api/finance-admin/settlements?tenantId=test-tenant" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: test-user" \
  -v
```

### Common SQL Queries for Debugging

```sql
-- Get all settlements for a tenant
SELECT * FROM settlements 
WHERE tenant_id = 'your-tenant-id' 
ORDER BY created_at DESC;

-- Get settlements by status
SELECT status, COUNT(*), SUM(net_amount) 
FROM settlements 
WHERE tenant_id = 'your-tenant-id' 
GROUP BY status;

-- Get settlement with full state history
SELECT 
  id,
  settlement_ref,
  status,
  state_transitions,
  retry_history
FROM settlements 
WHERE settlement_ref = 'SETL-2026-01-14-001';

-- Get related ledger entries for a settlement
SELECT 
  lt.transaction_ref,
  lt.event_type,
  le.entry_type,
  le.amount,
  le.description
FROM ledger_transactions lt
JOIN ledger_entries le ON lt.id = le.transaction_id
WHERE lt.source_transaction_id = 'settlement-uuid';

-- Check merchant payables balance
SELECT * FROM account_balances
WHERE tenant_id = 'your-tenant-id'
  AND account_code LIKE 'MER-002%';
```

---

## Common Issues and Solutions

### Issue 1: "No settlements found" Message

**Possible Causes:**
1. No settlements created yet
2. Wrong tenant ID selected
3. Status filter too restrictive
4. Settlements exist but under different tenant

**Solutions:**
1. Create test settlement manually
2. Verify tenant ID is correct
3. Try "All" status filter
4. Check database directly with SQL

### Issue 2: Settlements Stuck in CREATED State

**Possible Causes:**
1. Finance admin not performing state transitions
2. Automated process not running
3. Insufficient balance in escrow

**Solutions:**
1. Manually click "Reserve Funds" button
2. Check batch job logs
3. Verify escrow account balance

### Issue 3: Cannot Transition Settlement State

**Possible Causes:**
1. Invalid state transition attempted
2. Missing required data (e.g., UTR number)
3. User lacks permissions
4. Settlement already in terminal state

**Solutions:**
1. Follow state machine flow in order
2. Provide all required fields
3. Verify user has FINANCE_ADMIN role
4. Check current state is not SETTLED

### Issue 4: Duplicate Settlements Created

**Possible Causes:**
1. Idempotency key not properly set
2. Duplicate API calls
3. Retry logic creating duplicates

**Solutions:**
1. Ensure unique settlement_ref
2. Add idempotency key to settlement creation
3. Check for existing settlement before creating

### Issue 5: Bank Confirmation Fails

**Possible Causes:**
1. Missing UTR number
2. Invalid bank details
3. Settlement not in SENT_TO_BANK state

**Solutions:**
1. Obtain UTR from bank
2. Validate bank reference numbers
3. Ensure settlement was sent to bank first

### Issue 6: Ledger Entries Not Created

**Possible Causes:**
1. Ledger locked (accounting period closed)
2. Accounting period not open
3. Invalid account codes

**Solutions:**
1. Check ledger lock status
2. Open new accounting period
3. Verify account codes exist in chart of accounts

---

## Performance Considerations

### Optimization Tips

1. **Database Indexes:** Ensure indexes exist on:
   - `settlements.tenant_id`
   - `settlements.status`
   - `settlements.created_at`
   - `settlements.merchant_id`

2. **Query Limits:** Default limit of 100 settlements per request

3. **Pagination:** Implement offset-based pagination for large datasets

4. **Caching:** Consider caching frequently accessed data:
   - Merchant details
   - Account balances
   - Settlement status counts

5. **Database Connection Pooling:** Ensure proper pool size configured

---

## Security Considerations

### Role-Based Access Control

- **FINANCE_ADMIN:** Full access to settlements management
- **COMPLIANCE_ADMIN:** Can approve but not request overrides
- **OPERATIONS:** Limited view access
- **AUDITOR:** Read-only access for audit purposes

### Data Protection

1. **Sensitive Data:**
   - Bank account numbers masked in UI
   - Full details only shown to authorized users
   - PCI-DSS compliance for card data

2. **Audit Trail:**
   - All state transitions logged
   - Who, what, when, why recorded
   - Immutable audit logs

3. **API Security:**
   - JWT authentication required
   - Role validation on every request
   - Tenant isolation enforced

---

## Appendix A: Complete File Structure

```
/home/runner/work/PG/PG/
├── src/
│   ├── index.js                          # Main server entry point
│   ├── api/
│   │   ├── routes.js                     # Main API router
│   │   ├── finance-admin-routes.js       # Finance admin endpoints
│   │   ├── settlement-routes.js          # Settlement CRUD operations
│   │   └── ...
│   ├── core/
│   │   ├── payment-gateway.js            # Payment processing
│   │   ├── ledger/
│   │   │   ├── index.js                  # Exports all ledger services
│   │   │   ├── ledger-service.js         # Double-entry ledger core
│   │   │   ├── ledger-event-handlers.js  # Business event to accounting
│   │   │   ├── settlement-service.js     # Settlement state machine
│   │   │   ├── accounting-period-service.js
│   │   │   ├── ledger-lock-service.js
│   │   │   └── reconciliation-service.js
│   │   └── ...
│   └── database/
│       └── index.js                      # Database connection
├── public/
│   └── finance-admin-console.html        # Frontend UI
├── tests/
│   └── settlement-service.test.js        # Unit tests
└── features/
    └── SETTLEMENTS_LIFECYCLE_DOCUMENTATION.md  # This document
```

---

## Appendix B: State Transition Diagram

```
                    ┌─────────────┐
                    │   CREATED   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Reserve     │
                    │ Funds       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────────┐
                    │ FUNDS_RESERVED  │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────┐
                    │ Send to     │
                    │ Bank        │
                    └──────┬──────┘
                           │
                    ┌──────▼──────────┐
                    │ SENT_TO_BANK    │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────────┐
                    │ Bank Confirms   │
                    │ (UTR received)  │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────────┐
                    │ BANK_CONFIRMED  │ ← Finality Point
                    └──────┬──────────┘
                           │
                    ┌──────▼──────┐
                    │ Mark        │
                    │ Settled     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   SETTLED   │ ← Terminal
                    └─────────────┘

            Error Path (from any state):
                           │
                    ┌──────▼──────┐
                    │   FAILED    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   RETRY     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────────┐
              ┌─────┤ FUNDS_RESERVED  │
              │     └─────────────────┘
              │
         Retry Loop (max 3 times)
```

---

## Appendix C: Example Complete Flow

### Scenario: User pays ₹1,000, settlement created next day

**Day 1 - 10:00 AM: User Makes Payment**

1. User: Clicks "Pay Now" on merchant website
2. Merchant: Calls `/api/payments/process`
3. Payment Gateway: Routes to Razorpay
4. Razorpay: Processes payment, returns success
5. Ledger Event Handler: Creates accounting entries
6. Ledger Service: Posts to `ledger_transactions` and `ledger_entries`
7. Database: Payment recorded

**Day 2 - 9:00 AM: Automated Settlement Creation**

8. Batch Job: Runs settlement aggregation
9. Settlement Service: Creates settlement record
10. Database: Settlement in `CREATED` state

**Day 2 - 10:00 AM: Finance Admin Processes Settlement**

11. Finance Admin: Logs into Finance Admin Console
12. Finance Admin: Navigates to Settlements tab
13. Finance Admin: Clicks "Search" button
14. Browser: `loadSettlements()` function called
15. Browser: GET `/api/finance-admin/settlements?tenantId=xxx`
16. Server: Routes to `settlement-routes.js`
17. Settlement Service: Queries database
18. Database: Returns settlement records
19. Server: Responds with JSON
20. Browser: Renders table with settlements
21. Finance Admin: **SEES SETTLEMENTS ON SCREEN** ✓

**Day 2 - 11:00 AM: Process Settlement**

22. Finance Admin: Clicks "Reserve Funds"
23. Server: State transitions to `FUNDS_RESERVED`
24. Finance Admin: Generates bank batch file
25. Finance Admin: Clicks "Send to Bank"
26. Server: State transitions to `SENT_TO_BANK`

**Day 3 - 9:00 AM: Bank Processes**

27. Bank: Processes payout
28. Bank: Returns UTR number
29. Finance Admin: Enters UTR, clicks "Confirm by Bank"
30. Server: State transitions to `BANK_CONFIRMED`
31. Ledger Service: Creates settlement ledger entries
32. Database: Ledger balanced, settlement confirmed

**Day 3 - 10:00 AM: Final Settlement**

33. Finance Admin: Clicks "Mark Settled"
34. Server: State transitions to `SETTLED`
35. Settlement: **COMPLETE** ✓

---

## Conclusion

This document provides a complete mapping of the settlements functionality from payment initiation to display on the settlements screen. The key points are:

1. **Payments** are processed through the payment gateway
2. **Ledger entries** are created for each transaction using double-entry accounting
3. **Settlements** are aggregated and created (T+1 or T+2)
4. **State machine** manages settlement lifecycle with strict rules
5. **Finance Admin Console** displays settlements via REST API
6. **Audit trail** maintains complete history of all operations

For debugging "settlements not showing" issues:
- Verify settlements exist in database
- Check tenant ID is correct
- Verify authentication and role
- Check API request/response in browser DevTools
- Review server logs for errors

**Key Files to Check:**
- Frontend: `/public/finance-admin-console.html`
- API Routes: `src/api/settlement-routes.js`
- Service Logic: `src/core/ledger/settlement-service.js`
- Database: `settlements` table

---

**End of Document**
