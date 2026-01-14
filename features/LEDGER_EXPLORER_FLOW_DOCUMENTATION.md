# Ledger Explorer Functionality - Complete Flow Documentation

## Executive Summary

This document provides a comprehensive mapping of the Ledger Explorer functionality, from user payment initiation to transaction display in the Finance Admin Console. It traces the entire lifecycle including:

1. **User Payment Flow** - Customer initiates payment
2. **Payment Processing** - Gateway processing and validation  
3. **Ledger Recording** - Double-entry accounting entries
4. **Data Storage** - Database persistence
5. **Ledger Explorer Search** - UI search functionality
6. **Data Retrieval** - API endpoint and database queries
7. **Display Rendering** - Transaction display in the UI

This document is designed to help debug the "no data showing" issue in the Ledger Explorer.

---

## Table of Contents

1. [Transaction Lifecycle Overview](#transaction-lifecycle-overview)
2. [Payment Initiation Flow](#payment-initiation-flow)
3. [Ledger Recording Flow](#ledger-recording-flow)
4. [Ledger Explorer Search Flow](#ledger-explorer-search-flow)
5. [Database Schema](#database-schema)
6. [Debugging Guide](#debugging-guide)
7. [Common Issues](#common-issues)

---

## 1. Transaction Lifecycle Overview

```
┌─────────────┐
│  Customer   │
│   Payment   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Payment Gateway Processing        │
│   (Razorpay/PayU/CCAvenue)          │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Payment Success Event             │
│   (payment-gateway.js)              │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Ledger Event Handler              │
│   (ledger-event-handlers.js)        │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Ledger Service                    │
│   (ledger-service.js)               │
│   - Creates Transaction             │
│   - Creates Ledger Entries          │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Database Tables                   │
│   - ledger_transactions             │
│   - ledger_entries                  │
│   - ledger_accounts                 │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Ledger Explorer UI                │
│   (finance-admin-console.html)      │
│   - Search Button Click             │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   API Endpoint                      │
│   GET /api/finance-admin/           │
│       ledger/transactions           │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Query Database                    │
│   - Join transactions & entries     │
│   - Filter by tenantId, dates, etc  │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Return JSON Response              │
│   - transactions array              │
│   - total count                     │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Render in HTML Table              │
│   (ledgerTransactionsTableBody)     │
└─────────────────────────────────────┘
```

---

## 2. Payment Initiation Flow

### 2.1 User Makes Payment

**Location**: Customer-facing payment page (checkout)

**Process**:
1. Customer enters payment details (card/UPI/netbanking)
2. Payment request sent to backend
3. Backend routes to appropriate payment gateway

### 2.2 Payment Gateway Processing

**File**: `/src/core/payment-gateway.js`

**Key Function**: `processPayment(paymentData)`

```javascript
async processPayment(paymentData) {
  // Step 1: Validate payment data
  this.validatePaymentData(paymentData);
  
  // Step 2: Select gateway using smart router
  const primaryGateway = this.smartRouter.selectGateway(paymentData);
  
  // Step 3: Process with gateway
  const result = await this.processWithGateway(primaryGateway, paymentData);
  
  // Step 4: Log transaction
  await this.logTransaction(paymentData, result, gatewayName);
  
  return {
    success: true,
    transactionId: response.transactionId,
    status: response.status,
    gateway: gatewayName
  };
}
```

**Key Properties**:
- `paymentData.tenantId` - Merchant/Tenant identifier
- `paymentData.amount` - Payment amount
- `paymentData.orderId` - Order reference
- `paymentData.merchantId` - Merchant identifier

---

## 3. Ledger Recording Flow

### 3.1 Payment Success Event Trigger

**File**: `/src/core/ledger/ledger-event-handlers.js`

**Key Function**: `handlePaymentSuccess(params)`

This is triggered after a successful payment is confirmed by the gateway.

```javascript
async handlePaymentSuccess(params) {
  const {
    tenantId,           // CRITICAL: Tenant/Merchant ID
    transactionId,      // Transaction ID
    orderId,           // Order ID
    merchantId,        // Merchant ID
    gateway,           // Gateway name (razorpay/payu/ccavenue)
    amount,            // Total amount
    platformFee,       // Platform commission
    gatewayFee         // Gateway processing fee
  } = params;
  
  // Calculate merchant settlement
  const merchantAmount = amount - platformFee - gatewayFee;
  
  // Create ledger entries...
}
```

### 3.2 Double-Entry Accounting Logic

**For a ₹1000 payment with ₹20 platform fee and ₹10 gateway fee:**

| Account | Entry Type | Amount | Description |
|---------|-----------|--------|-------------|
| Escrow Bank (ESC-001) | Debit | ₹1000 | Cash received |
| Escrow Liability (ESC-002) | Credit | ₹1000 | Obligation to customer |
| Merchant Receivables (MER-001) | Debit | ₹970 | Merchant's right to payment |
| Merchant Payables (MER-002) | Credit | ₹970 | Obligation to pay merchant |
| Platform Receivables (PLT-001) | Debit | ₹20 | Platform's right to fee |
| Platform Revenue (REV-001) | Credit | ₹20 | Revenue recognition |
| Gateway Fee Expense (GW-FEE-*) | Debit | ₹10 | Cost incurred |
| Gateway Payables (GW-PAY) | Credit | ₹10 | Obligation to gateway |

### 3.3 Ledger Service Processing

**File**: `/src/core/ledger/ledger-service.js`

**Key Function**: `postTransaction(transactionData)`

```javascript
async postTransaction(transactionData) {
  const {
    tenantId,              // CRITICAL: For filtering in Ledger Explorer
    transactionRef,        // e.g., "PAY-ORDER123"
    idempotencyKey,        // Prevents duplicates
    eventType,             // e.g., "payment_success"
    sourceTransactionId,   // Original transaction ID
    sourceOrderId,         // Order ID
    amount,                // Transaction amount
    description,           // Human-readable description
    entries,               // Array of debit/credit entries
    metadata,              // Additional data
    createdBy              // User/system who created
  } = transactionData;
  
  // Step 1: Check idempotency
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) return existing;
  
  // Step 2: Create transaction record
  const transaction = await db.knex('ledger_transactions').insert({
    tenant_id: tenantId,  // CRITICAL for Ledger Explorer filtering
    transaction_ref: transactionRef,
    idempotency_key: idempotencyKey,
    event_type: eventType,
    source_transaction_id: sourceTransactionId,
    source_order_id: sourceOrderId,
    amount,
    description,
    status: 'posted',
    metadata: JSON.stringify(metadata),
    created_by: createdBy,
    source_event: transactionData.sourceEvent
  }).returning('*');
  
  // Step 3: Create ledger entries (debits and credits)
  for (const entry of entries) {
    await db.knex('ledger_entries').insert({
      tenant_id: tenantId,  // CRITICAL for filtering
      transaction_id: transaction.id,
      account_id: accountId,  // From ledger_accounts
      entry_type: entry.entryType,  // 'debit' or 'credit'
      amount: entry.amount,
      description: entry.description,
      metadata: JSON.stringify(entry.metadata || {})
    });
  }
  
  return transaction;
}
```

---

## 4. Ledger Explorer Search Flow

### 4.1 UI Components

**File**: `/public/finance-admin-console.html`

**Search Form** (Lines 636-660):
```html
<div class="filters">
  <div class="form-group">
    <label>From Date</label>
    <input type="date" id="ledger-from-date">
  </div>
  <div class="form-group">
    <label>To Date</label>
    <input type="date" id="ledger-to-date">
  </div>
  <div class="form-group">
    <label>Event Type</label>
    <select id="ledger-event-type">
      <option value="">All</option>
      <option value="payment_success">Payment Success</option>
      <option value="refund_completed">Refund</option>
      <option value="settlement">Settlement</option>
      <option value="manual_adjustment">Manual Adjustment</option>
    </select>
  </div>
  <div class="form-group">
    <label>&nbsp;</label>
    <button class="btn btn-primary" onclick="loadLedgerTransactions()">Search</button>
  </div>
</div>
```

**Results Table** (Lines 663-679):
```html
<div class="card">
  <table id="ledgerTransactionsTable">
    <thead>
      <tr>
        <th>Date</th>
        <th>Transaction Ref</th>
        <th>Event Type</th>
        <th>Description</th>
        <th>Amount</th>
        <th>Created By</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="ledgerTransactionsTableBody">
      <tr><td colspan="7">Loading...</td></tr>
    </tbody>
  </table>
</div>
```

### 4.2 Search Button Click Handler

**File**: `/public/finance-admin-console.html`

**Function**: `loadLedgerTransactions()` (Lines 1432-1492)

```javascript
async function loadLedgerTransactions() {
  const tbody = document.getElementById('ledgerTransactionsTableBody');
  
  // CRITICAL CHECK: Tenant must be selected
  if (!requireTenant()) {
    tbody.innerHTML = '<tr><td colspan="7">Please select a merchant/tenant...</td></tr>';
    return;
  }
  
  try {
    // Show loading state
    tbody.innerHTML = '<tr><td colspan="7">🔍 Searching...</td></tr>';
    
    // Get filter values
    const fromDate = document.getElementById('ledger-from-date')?.value || '';
    const toDate = document.getElementById('ledger-to-date')?.value || '';
    const eventType = document.getElementById('ledger-event-type')?.value || '';
    
    // Build query parameters
    const params = new URLSearchParams({
      tenantId: currentTenantId,  // CRITICAL: Must be set
      limit: 50
    });
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    if (eventType) params.append('eventType', eventType);
    
    // Call API
    const data = await apiCall(`/ledger/transactions?${params.toString()}`);
    
    // Render results
    if (data.success && data.data?.transactions?.length > 0) {
      tbody.innerHTML = data.data.transactions.map(txn => `
        <tr>
          <td>${new Date(txn.transaction_date).toLocaleDateString()}</td>
          <td>${txn.transaction_ref}</td>
          <td>${txn.event_type}</td>
          <td>${txn.description || '-'}</td>
          <td>${txn.entries?.reduce((sum, e) => sum + parseFloat(e.amount), 0).toFixed(2)}</td>
          <td>${txn.created_by}</td>
          <td>
            <button class="btn btn-secondary" onclick="viewTransaction('${txn.id}')">View</button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="7">No transactions found...</td></tr>';
    }
  } catch (error) {
    console.error('Error loading ledger transactions:', error);
    tbody.innerHTML = `<tr><td colspan="7">Error: ${error.message}</td></tr>`;
  }
}
```

**Key Points**:
1. **Tenant Selection Required**: `currentTenantId` must be set via merchant selector
2. **API Call**: Goes to `/api/finance-admin/ledger/transactions`
3. **Query Parameters**: tenantId, fromDate, toDate, eventType, limit
4. **Response Expected**: `{ success: true, data: { transactions: [...], total: N } }`

### 4.3 API Helper

**Function**: `apiCall(endpoint, options)` (Lines 1005-1030)

```javascript
async function apiCall(endpoint, options = {}) {
  // Check authentication
  if (!window.currentUser?.role || !window.currentUser?.userId) {
    throw new Error('Authentication required');
  }
  
  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    'x-user-role': window.currentUser.role,      // FINANCE_ADMIN or COMPLIANCE_ADMIN
    'x-user-id': window.currentUser.userId,
    'x-user-email': storage.getItem('userEmail') || 'unknown',
    ...options.headers
  };
  
  // Make request
  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || data.message || 'API request failed');
  }
  
  return data;
}
```

**Full URL**: `https://[domain]/api/finance-admin/ledger/transactions?tenantId=xxx&limit=50`

---

## 5. API Endpoint Processing

### 5.1 Route Handler

**File**: `/src/api/finance-admin-routes.js`

**Endpoint**: `GET /api/finance-admin/ledger/transactions` (Lines 180-252)

```javascript
router.get('/ledger/transactions', requireFinanceRole, async (req, res) => {
  try {
    // Extract and validate parameters
    const { 
      tenantId,      // CRITICAL: Must be valid UUID
      fromDate, 
      toDate, 
      accountCode, 
      eventType, 
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // Validation: tenantId is required
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    // Validation: tenantId must be valid UUID
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    // Build database query
    let query = db.knex('ledger_transactions as lt')
      .select(
        'lt.*',
        db.knex.raw('json_agg(le.*) as entries')  // Aggregate all entries
      )
      .leftJoin('ledger_entries as le', 'lt.id', 'le.transaction_id')
      .where('lt.tenant_id', tenantId)  // CRITICAL: Filter by tenant
      .groupBy('lt.id')
      .orderBy('lt.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    // Apply optional filters
    if (fromDate) {
      query = query.where('lt.created_at', '>=', new Date(fromDate));
    }
    
    if (toDate) {
      query = query.where('lt.created_at', '<=', new Date(toDate));
    }
    
    if (eventType) {
      query = query.where('lt.event_type', eventType);
    }
    
    // Execute query
    const transactions = await query;
    
    // Count total matching records
    const countQuery = db.knex('ledger_transactions')
      .where('tenant_id', tenantId)
      .count('* as count');
    
    if (fromDate) countQuery.where('created_at', '>=', new Date(fromDate));
    if (toDate) countQuery.where('created_at', '<=', new Date(toDate));
    if (eventType) countQuery.where('event_type', eventType);
    
    const [{ count }] = await countQuery;
    
    // Return response
    res.json({
      success: true,
      data: {
        transactions,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Error fetching ledger transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

**Query Breakdown**:

```sql
SELECT 
  lt.*,
  json_agg(le.*) as entries
FROM ledger_transactions lt
LEFT JOIN ledger_entries le ON lt.id = le.transaction_id
WHERE lt.tenant_id = ? 
  AND lt.created_at >= ?
  AND lt.created_at <= ?
  AND lt.event_type = ?
GROUP BY lt.id
ORDER BY lt.created_at DESC
LIMIT ? OFFSET ?
```

**Response Format**:
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "tenant_id": "uuid",
        "transaction_ref": "PAY-ORDER123",
        "event_type": "payment_success",
        "amount": "1000.00",
        "description": "Payment successful for order ORDER123",
        "created_by": "system",
        "created_at": "2024-01-14T10:30:00.000Z",
        "entries": [
          {
            "id": "uuid",
            "account_id": "uuid",
            "entry_type": "debit",
            "amount": "1000.00",
            "description": "Payment received"
          },
          // ... more entries
        ]
      }
    ],
    "total": 150,
    "limit": 50,
    "offset": 0
  }
}
```

---

## 6. Database Schema

### 6.1 Core Tables

#### `ledger_transactions`

**File**: `/src/database/migrations/20240104000000_ledger_system.js` (Lines 77-131)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | **CRITICAL**: Merchant/Tenant identifier for filtering |
| transaction_ref | VARCHAR(100) | Unique reference (e.g., "PAY-ORDER123") |
| idempotency_key | VARCHAR(255) | Prevents duplicate processing |
| event_type | ENUM | payment_success, refund_completed, settlement, etc. |
| source_transaction_id | UUID | Link to original payment transaction |
| source_order_id | VARCHAR(100) | Order reference |
| amount | DECIMAL(15,2) | Transaction amount |
| currency | VARCHAR(3) | Default: 'INR' |
| description | TEXT | Human-readable description |
| status | ENUM | pending, posted, reversed, failed |
| metadata | JSONB | Additional context |
| created_by | VARCHAR(100) | User/system who created |
| source_event | VARCHAR(255) | Original event trigger |
| created_at | TIMESTAMP | Creation timestamp |

**Indexes**:
- `(tenant_id, event_type)`
- `(tenant_id, status)`
- `(tenant_id, created_at)` - **Important for date-based queries**

#### `ledger_entries`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | Tenant identifier |
| transaction_id | UUID | Foreign key to ledger_transactions |
| account_id | UUID | Foreign key to ledger_accounts |
| entry_type | ENUM | 'debit' or 'credit' |
| amount | DECIMAL(15,2) | Entry amount (always positive) |
| description | TEXT | Entry description |
| metadata | JSONB | Additional context |
| created_at | TIMESTAMP | Creation timestamp |

#### `ledger_accounts`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| account_code | VARCHAR(50) | Unique code (e.g., "ESC-001") |
| account_name | VARCHAR(255) | Account name |
| account_type | ENUM | merchant, gateway, escrow, platform_revenue |
| normal_balance | ENUM | debit, credit |
| category | ENUM | asset, liability, revenue, expense, equity |
| merchant_id | UUID | Optional merchant link |
| gateway_name | VARCHAR(50) | Optional gateway link |
| status | ENUM | active, inactive, closed |

---

## 7. Debugging Guide

### 7.1 Common "No Data" Issues

#### Issue #1: No Tenant Selected

**Symptom**: Table shows "Please select a merchant/tenant"

**Root Cause**: `currentTenantId` is null or undefined

**Check**:
```javascript
// In browser console
console.log('Current Tenant ID:', currentTenantId);
console.log('Merchant Selector:', document.getElementById('merchantSelector').value);
```

**Fix**:
1. Ensure merchants are loaded: Check `/api/finance-admin/merchants` endpoint
2. Select a merchant from the dropdown
3. Check localStorage: `localStorage.getItem('selectedTenantId')`

#### Issue #2: Invalid Tenant ID

**Symptom**: API returns "tenantId must be a valid UUID"

**Root Cause**: tenantId is not a valid UUID format

**Check**:
```javascript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
console.log('Is valid UUID:', UUID_REGEX.test(currentTenantId));
```

**Fix**: Ensure the merchant selector contains valid merchant UUIDs from the database

#### Issue #3: No Transactions in Database

**Symptom**: API returns empty array but no error

**Root Cause**: No ledger transactions exist for the selected tenant

**Check Database**:
```sql
-- Check if transactions exist for tenant
SELECT COUNT(*) 
FROM ledger_transactions 
WHERE tenant_id = 'your-tenant-uuid';

-- Check if any transactions exist at all
SELECT COUNT(*) FROM ledger_transactions;

-- Check recent transactions
SELECT id, tenant_id, transaction_ref, event_type, created_at 
FROM ledger_transactions 
ORDER BY created_at DESC 
LIMIT 10;
```

**Fix**: 
1. Process a test payment to create ledger entries
2. Verify `handlePaymentSuccess()` is being called
3. Check if payment success events are triggering ledger recording

#### Issue #4: Authentication/Authorization Failure

**Symptom**: API returns 401 or 403 error

**Root Cause**: User not authenticated or wrong role

**Check**:
```javascript
// In browser console
console.log('User Role:', window.currentUser?.role);
console.log('User ID:', window.currentUser?.userId);
console.log('Storage Role:', localStorage.getItem('userRole'));
console.log('Storage UserID:', localStorage.getItem('userId'));
```

**Fix**:
1. Ensure user is logged in as FINANCE_ADMIN or COMPLIANCE_ADMIN
2. Check `/api/finance-admin/dashboard` works (same auth requirements)
3. Clear localStorage and re-login if needed

#### Issue #5: Date Filter Issues

**Symptom**: Results show but not matching expected date range

**Root Cause**: Date parsing or timezone issues

**Check**:
```javascript
// In browser console
const fromDate = document.getElementById('ledger-from-date')?.value;
const toDate = document.getElementById('ledger-to-date')?.value;
console.log('From Date:', fromDate, '-> Date:', new Date(fromDate));
console.log('To Date:', toDate, '-> Date:', new Date(toDate));
```

**Fix**: Ensure dates are in ISO format (YYYY-MM-DD)

#### Issue #6: Event Type Filter Not Working

**Symptom**: All event types shown regardless of filter

**Root Cause**: Event type value mismatch

**Check Database Event Types**:
```sql
SELECT DISTINCT event_type 
FROM ledger_transactions 
WHERE tenant_id = 'your-tenant-uuid';
```

**Valid Event Types**:
- `payment_success`
- `payment_failure`
- `refund_initiated`
- `refund_completed`
- `settlement`
- `gateway_fee`
- `platform_fee`
- `chargeback_debit`
- `chargeback_reversal`
- `manual_adjustment`

### 7.2 Debugging Steps

#### Step 1: Check Browser Console

Open browser DevTools (F12) and check Console tab for:
- JavaScript errors
- Failed API requests
- Authentication issues

#### Step 2: Check Network Tab

In DevTools Network tab, find the request to `/api/finance-admin/ledger/transactions`:

1. **Request URL**: Should include `tenantId` parameter
2. **Request Headers**: Should include `x-user-role` and `x-user-id`
3. **Response Status**: Should be 200
4. **Response Body**: Check `data.transactions` array

Example Request:
```
GET /api/finance-admin/ledger/transactions?tenantId=550e8400-e29b-41d4-a716-446655440000&limit=50
Headers:
  x-user-role: FINANCE_ADMIN
  x-user-id: user-uuid
  x-user-email: admin@example.com
```

Example Response (Success):
```json
{
  "success": true,
  "data": {
    "transactions": [/* array of transactions */],
    "total": 10,
    "limit": 50,
    "offset": 0
  }
}
```

Example Response (Error):
```json
{
  "success": false,
  "error": "tenantId is required"
}
```

#### Step 3: Check Database Directly

Connect to PostgreSQL database:

```sql
-- 1. Check if tenant exists
SELECT id, tenant_id, merchant_code, merchant_name 
FROM merchants 
WHERE id = 'your-tenant-uuid';

-- 2. Check transaction count
SELECT COUNT(*) as transaction_count
FROM ledger_transactions
WHERE tenant_id = 'your-tenant-uuid';

-- 3. Check recent transactions with entries
SELECT 
  lt.id,
  lt.transaction_ref,
  lt.event_type,
  lt.amount,
  lt.description,
  lt.created_at,
  COUNT(le.id) as entry_count
FROM ledger_transactions lt
LEFT JOIN ledger_entries le ON lt.id = le.transaction_id
WHERE lt.tenant_id = 'your-tenant-uuid'
GROUP BY lt.id
ORDER BY lt.created_at DESC
LIMIT 10;

-- 4. Check if entries are properly linked
SELECT 
  lt.transaction_ref,
  le.entry_type,
  le.amount,
  la.account_code,
  la.account_name
FROM ledger_transactions lt
JOIN ledger_entries le ON lt.id = le.transaction_id
JOIN ledger_accounts la ON le.account_id = la.id
WHERE lt.tenant_id = 'your-tenant-uuid'
ORDER BY lt.created_at DESC
LIMIT 20;
```

#### Step 4: Check Backend Logs

Check Node.js application logs for:
- Database connection errors
- Query execution errors
- Authentication failures
- Error stack traces

Look for:
```
Error fetching ledger transactions: [error message]
```

#### Step 5: Test API Directly

Use curl or Postman to test the API endpoint:

```bash
curl -X GET "http://localhost:3000/api/finance-admin/ledger/transactions?tenantId=550e8400-e29b-41d4-a716-446655440000&limit=10" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: user-uuid" \
  -H "x-user-email: admin@example.com" \
  -H "Content-Type: application/json"
```

#### Step 6: Verify Ledger Recording

Test if payments are creating ledger entries:

1. **Trigger a test payment**
2. **Check logs** for "handlePaymentSuccess" calls
3. **Verify database** immediately after payment

```sql
-- Check most recent transaction
SELECT * FROM ledger_transactions 
ORDER BY created_at DESC 
LIMIT 1;

-- Check its entries
SELECT * FROM ledger_entries 
WHERE transaction_id = 'latest-transaction-id';
```

### 7.3 Enable Debug Logging

Add debug logging to track the flow:

**In ledger-service.js**:
```javascript
async postTransaction(transactionData) {
  console.log('[LEDGER] Posting transaction:', {
    tenantId: transactionData.tenantId,
    transactionRef: transactionData.transactionRef,
    eventType: transactionData.eventType,
    amount: transactionData.amount,
    entriesCount: transactionData.entries?.length
  });
  
  // ... existing code ...
  
  console.log('[LEDGER] Transaction posted successfully:', transaction.id);
  return transaction;
}
```

**In finance-admin-routes.js**:
```javascript
router.get('/ledger/transactions', requireFinanceRole, async (req, res) => {
  console.log('[API] Ledger transactions request:', {
    tenantId: req.query.tenantId,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    eventType: req.query.eventType,
    userRole: req.financeUser.userRole
  });
  
  // ... existing code ...
  
  console.log('[API] Returning transactions:', {
    count: transactions.length,
    total: count
  });
});
```

**In finance-admin-console.html**:
```javascript
async function loadLedgerTransactions() {
  console.log('[UI] Loading ledger transactions:', {
    tenantId: currentTenantId,
    fromDate: document.getElementById('ledger-from-date')?.value,
    toDate: document.getElementById('ledger-to-date')?.value,
    eventType: document.getElementById('ledger-event-type')?.value
  });
  
  // ... existing code ...
  
  console.log('[UI] Received transactions:', data.data?.transactions?.length);
}
```

---

## 8. Common Issues and Solutions

### Issue: "No transactions found for the selected filters"

**Possible Causes**:
1. No payments have been processed for this tenant
2. Payments were processed but ledger entries weren't created
3. Date filters are too restrictive
4. Event type filter doesn't match actual data

**Solutions**:
1. Process a test payment
2. Check `handlePaymentSuccess()` is wired up correctly
3. Clear date filters (leave empty for all dates)
4. Select "All" for event type

### Issue: Merchant selector shows "No merchants available"

**Possible Causes**:
1. No merchants in database
2. API endpoint `/api/finance-admin/merchants` failing
3. User doesn't have proper permissions

**Solutions**:
1. Check database: `SELECT COUNT(*) FROM merchants;`
2. Check browser console for API errors
3. Verify user role is FINANCE_ADMIN or COMPLIANCE_ADMIN

### Issue: Transactions show but with wrong amounts

**Possible Causes**:
1. Ledger entries aggregation issue
2. Missing entries for a transaction
3. Currency conversion issues

**Solutions**:
1. Check database for orphaned entries
2. Verify all transactions have balanced debits/credits
3. Check `json_agg(le.*)` is working correctly

---

## 9. Testing Checklist

### Manual Testing Steps

1. **Login as Finance Admin**
   - [ ] Navigate to `/platform-login.html`
   - [ ] Login with FINANCE_ADMIN credentials
   - [ ] Verify role indicator shows "FINANCE_ADMIN"

2. **Select Merchant**
   - [ ] Merchant selector loads with merchants
   - [ ] Select a merchant from dropdown
   - [ ] Verify `currentTenantId` is set (check console)
   - [ ] Verify selection is saved to localStorage

3. **Navigate to Ledger Explorer**
   - [ ] Click "📖 Ledger Explorer" in sidebar
   - [ ] Tab switches to ledger explorer view
   - [ ] Initial state shows appropriate message

4. **Search Without Filters**
   - [ ] Click "Search" button without setting filters
   - [ ] Verify API call is made with tenantId
   - [ ] Check Network tab for request/response
   - [ ] Verify transactions display (if data exists)

5. **Search With Date Filters**
   - [ ] Set "From Date" to a week ago
   - [ ] Set "To Date" to today
   - [ ] Click "Search"
   - [ ] Verify results are within date range

6. **Search With Event Type Filter**
   - [ ] Select "Payment Success" from event type
   - [ ] Click "Search"
   - [ ] Verify only payment_success events show

7. **Export Functionality**
   - [ ] Set date range
   - [ ] Click "Export CSV"
   - [ ] Verify CSV file downloads
   - [ ] Verify CSV contains correct data

8. **View Transaction Details**
   - [ ] Click "View" button on a transaction
   - [ ] Verify modal/details appear (if implemented)

### Automated Test Cases

```javascript
// Test 1: Verify API endpoint exists and requires auth
describe('Ledger Explorer API', () => {
  it('should require authentication', async () => {
    const response = await fetch('/api/finance-admin/ledger/transactions?tenantId=test');
    expect(response.status).toBe(401);
  });
  
  it('should require valid tenantId', async () => {
    const response = await authenticatedFetch('/api/finance-admin/ledger/transactions');
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('tenantId is required');
  });
  
  it('should validate UUID format', async () => {
    const response = await authenticatedFetch('/api/finance-admin/ledger/transactions?tenantId=invalid');
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('valid UUID');
  });
});

// Test 2: Verify ledger recording
describe('Ledger Recording', () => {
  it('should create ledger transaction on payment success', async () => {
    const paymentData = {
      tenantId: testTenantId,
      transactionId: 'test-txn-123',
      orderId: 'ORDER-123',
      merchantId: testMerchantId,
      gateway: 'razorpay',
      amount: 1000,
      platformFee: 20,
      gatewayFee: 10
    };
    
    await ledgerEventHandlers.handlePaymentSuccess(paymentData);
    
    const transaction = await db.knex('ledger_transactions')
      .where('source_transaction_id', 'test-txn-123')
      .first();
    
    expect(transaction).toBeDefined();
    expect(transaction.tenant_id).toBe(testTenantId);
    expect(transaction.event_type).toBe('payment_success');
  });
});
```

---

## 10. Quick Reference

### Key Files

| File | Purpose |
|------|---------|
| `/public/finance-admin-console.html` | UI for Ledger Explorer |
| `/src/api/finance-admin-routes.js` | API endpoints |
| `/src/core/ledger/ledger-service.js` | Ledger business logic |
| `/src/core/ledger/ledger-event-handlers.js` | Event-to-ledger mapping |
| `/src/core/payment-gateway.js` | Payment processing |

### Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `loadLedgerTransactions()` | finance-admin-console.html | Search button handler |
| `apiCall()` | finance-admin-console.html | HTTP request helper |
| `GET /ledger/transactions` | finance-admin-routes.js | API endpoint |
| `handlePaymentSuccess()` | ledger-event-handlers.js | Create ledger entries |
| `postTransaction()` | ledger-service.js | Save to database |

### Key Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `currentTenantId` | String (UUID) | Selected merchant/tenant |
| `window.currentUser` | Object | Authenticated user info |
| `API_BASE` | String | Base API path ('/api/finance-admin') |

### Database Tables

| Table | Purpose |
|-------|---------|
| `ledger_transactions` | Transaction headers |
| `ledger_entries` | Individual debits/credits |
| `ledger_accounts` | Chart of accounts |
| `merchants` | Merchant/tenant records |

---

## 11. Appendix

### A. Complete Event Flow Example

**Scenario**: Customer pays ₹1000 for an order

1. **Customer submits payment** → Payment form
2. **Payment processed** → `payment-gateway.js:processPayment()`
3. **Gateway confirms** → Returns success response
4. **Payment success event** → Triggers `ledger-event-handlers.js:handlePaymentSuccess()`
5. **Ledger entries created** → `ledger-service.js:postTransaction()`
6. **Database insert** → `ledger_transactions` + `ledger_entries` tables
7. **Finance admin opens Ledger Explorer** → `finance-admin-console.html`
8. **Admin selects merchant** → Sets `currentTenantId`
9. **Admin clicks Search** → Calls `loadLedgerTransactions()`
10. **API request** → `GET /api/finance-admin/ledger/transactions?tenantId=xxx`
11. **Database query** → Joins transactions + entries
12. **Response sent** → JSON with transactions array
13. **UI renders** → Table populated with data

### B. Sample SQL Queries

**Get all transactions for a tenant**:
```sql
SELECT * FROM ledger_transactions 
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;
```

**Get transactions with entries**:
```sql
SELECT 
  lt.*,
  json_agg(le.*) as entries
FROM ledger_transactions lt
LEFT JOIN ledger_entries le ON lt.id = le.transaction_id
WHERE lt.tenant_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY lt.id
ORDER BY lt.created_at DESC
LIMIT 50;
```

**Verify balanced entries**:
```sql
SELECT 
  lt.transaction_ref,
  SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END) as total_debits,
  SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) as total_credits,
  SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END) as balance
FROM ledger_transactions lt
JOIN ledger_entries le ON lt.id = le.transaction_id
WHERE lt.tenant_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY lt.id, lt.transaction_ref
HAVING ABS(SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END)) > 0.01;
```

### C. Environment Variables

Required environment variables for the system:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/payment_gateway

# Server
PORT=3000
NODE_ENV=production

# Security
JWT_SECRET=your-secret-key
SESSION_SECRET=your-session-secret
```

---

## Conclusion

This document provides a complete map of the Ledger Explorer functionality from payment initiation to transaction display. Use the debugging guide to troubleshoot "no data" issues by checking each layer of the stack:

1. ✅ **UI Layer**: Tenant selection, search parameters
2. ✅ **API Layer**: Authentication, request handling
3. ✅ **Database Layer**: Query execution, data retrieval
4. ✅ **Data Recording**: Payment event → Ledger entry creation

**Most Common Issue**: No merchant/tenant selected in the UI dropdown. Always verify `currentTenantId` is set before debugging deeper.

---

**Document Version**: 1.0  
**Last Updated**: 2024-01-14  
**Author**: Development Team  
**Status**: Complete
