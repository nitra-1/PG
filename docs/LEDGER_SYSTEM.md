# Double-Entry Ledger System - RBI Compliant Payment Aggregator

## Overview

This is a bank-grade, double-entry accounting ledger system built for an Indian RBI-regulated Payment Aggregator (PA). It serves as the single source of truth for all monetary movements and supports audits, reconciliation, disputes, settlements, and regulatory reporting.

## Architecture

### Four Logically Separated Ledgers

1. **Merchant Ledger**: Tracks merchant receivables and payouts
2. **Gateway Ledger**: Tracks gateway collections and fees (reconciliation with payment gateways)
3. **Escrow Ledger**: RBI-mandated nodal/escrow account holding customer funds
4. **Platform Revenue Ledger**: Tracks MDR, commissions, and platform fees

### Key Design Principles

- **Double-Entry Accounting**: Every transaction has balanced debits and credits
- **Immutability**: Ledger entries cannot be updated or deleted, only reversed
- **Idempotency**: Same operation with same key produces same result
- **Audit Trail**: Complete history of all operations with metadata
- **Derived Balances**: Account balances are calculated from entries, never stored as truth
- **PCI Compliance**: No storage of PAN, CVV, or PII data

## Database Schema

### Core Tables

#### `ledger_accounts`
Chart of accounts defining all ledger accounts in the system.

```sql
- id (UUID, PK)
- account_code (unique identifier, e.g., 'ESC-001')
- account_name
- account_type (merchant, gateway, escrow, platform_revenue)
- normal_balance (debit or credit)
- category (asset, liability, revenue, expense, equity)
- merchant_id (optional, for merchant-specific accounts)
- gateway_name (optional, for gateway-specific accounts)
- status (active, inactive, closed)
```

#### `ledger_transactions`
Groups related ledger entries, ensures balanced transactions.

```sql
- id (UUID, PK)
- tenant_id
- transaction_ref (unique reference)
- idempotency_key (for duplicate prevention)
- event_type (payment_success, refund_completed, settlement, etc.)
- source_transaction_id (link to source transaction)
- source_order_id
- amount
- currency (default: INR)
- status (pending, posted, reversed, failed)
- reverses_transaction_id (if this reverses another)
- reversed_by_transaction_id (if this was reversed)
- created_by, source_event, created_at (immutable)
```

#### `ledger_entries`
Individual debit/credit entries (immutable records).

```sql
- id (UUID, PK)
- tenant_id
- transaction_id (FK to ledger_transactions)
- account_id (FK to ledger_accounts)
- entry_type (debit or credit)
- amount (always positive)
- currency
- description
- created_by, created_at (immutable, no updates allowed)
```

#### `settlements`
Tracks merchant settlements and payouts.

```sql
- id (UUID, PK)
- tenant_id, merchant_id
- settlement_ref, settlement_date
- period_from, period_to
- gross_amount, fees_amount, net_amount
- bank_account_number, bank_ifsc, utr_number
- status (pending, processing, completed, failed, reversed)
- ledger_transaction_id (link to ledger entry)
```

#### `reconciliation_batches`
Tracks gateway and bank reconciliation batches.

```sql
- id (UUID, PK)
- tenant_id, batch_ref
- reconciliation_type (gateway_settlement, bank_escrow_statement)
- gateway_name, gateway_settlement_id
- period_from, period_to
- total_transactions, matched_transactions, missing_transactions
- mismatched_transactions, duplicate_transactions
- expected_amount, actual_amount, difference_amount
- status (in_progress, completed, discrepancy_found, resolved)
```

#### `reconciliation_items`
Individual transaction reconciliation status.

```sql
- id (UUID, PK)
- batch_id (FK to reconciliation_batches)
- transaction_id, ledger_transaction_id
- external_ref, external_transaction_id
- match_status (matched, missing_internal, missing_external, amount_mismatch, duplicate)
- internal_amount, external_amount, difference_amount
- resolution_status (unresolved, investigating, resolved, written_off)
```

#### `account_balances` (VIEW)
Derived view, NOT a table. Balances are calculated from ledger entries.

```sql
SELECT 
  account_id, account_code, account_name, account_type,
  SUM(debit amounts), SUM(credit amounts), 
  calculated_balance, entry_count
FROM ledger_entries
WHERE ledger_transactions.status = 'posted'
GROUP BY account
```

### Security Features

- **Immutability Trigger**: Prevents UPDATE/DELETE on `ledger_entries`
- **Balance Validation Function**: Validates double-entry balance
- **Audit Logs**: Complete trail in `ledger_audit_logs`

## API Usage

### 1. Post a Payment Success Transaction

```javascript
const { ledgerEventHandlers } = require('./src/core/ledger');

const result = await ledgerEventHandlers.handlePaymentSuccess({
  tenantId: 'merchant-123',
  transactionId: 'txn-456',
  orderId: 'order-789',
  merchantId: 'merchant-123',
  gateway: 'razorpay',
  amount: 1000.00,
  platformFee: 20.00,    // 2% MDR
  gatewayFee: 15.00,     // Gateway charges
  createdBy: 'payment-api'
});
```

**Ledger Entries Created:**
```
Debit:  Escrow Bank (ESC-001)                 ₹1,000.00
Credit: Escrow Liability (ESC-002)            ₹1,000.00

Debit:  Merchant Receivables (MER-001)        ₹965.00
Credit: Merchant Payables (MER-002)           ₹965.00

Debit:  Platform Receivables (REV-REC-001)    ₹20.00
Credit: Platform MDR Revenue (REV-001)        ₹20.00

Debit:  Gateway Fee Expense (GTW-FEE-001)     ₹15.00
Credit: Gateway Payables (GTW-PAY-001)        ₹15.00

Total Debits:  ₹2,000.00 = Total Credits: ₹2,000.00 ✓
```

### 2. Process a Refund

```javascript
const result = await ledgerEventHandlers.handleRefundCompleted({
  tenantId: 'merchant-123',
  transactionId: 'txn-456',
  orderId: 'order-789',
  refundId: 'refund-111',
  merchantId: 'merchant-123',
  refundAmount: 1000.00,
  platformFeeRefund: 20.00,
  gatewayFeeRefund: 15.00,
  createdBy: 'refund-api'
});
```

**Ledger Entries Created:**
```
Debit:  Escrow Liability (ESC-002)            ₹1,000.00
Credit: Escrow Bank (ESC-001)                 ₹1,000.00

Debit:  Merchant Payables (MER-002)           ₹965.00
Credit: Merchant Receivables (MER-001)        ₹965.00

Debit:  Platform MDR Revenue (REV-001)        ₹20.00
Credit: Platform Receivables (REV-REC-001)    ₹20.00

Total Debits:  ₹1,985.00 = Total Credits: ₹1,985.00 ✓
```

### 3. Process Merchant Settlement

```javascript
const result = await ledgerEventHandlers.handleSettlement({
  tenantId: 'merchant-123',
  settlementId: 'setl-222',
  settlementRef: 'SETL-2024-01-001',
  merchantId: 'merchant-123',
  settlementAmount: 48250.00,  // Net amount after fees
  utrNumber: 'UTR123456789',
  createdBy: 'settlement-batch'
});
```

**Ledger Entries Created:**
```
Debit:  Merchant Payables (MER-002)           ₹48,250.00
Credit: Merchant Settlement (MER-003)         ₹48,250.00

Debit:  Escrow Liability (ESC-002)            ₹48,250.00
Credit: Escrow Bank (ESC-001)                 ₹48,250.00

Total Debits:  ₹96,500.00 = Total Credits: ₹96,500.00 ✓
```

### 4. Get Account Balance

```javascript
const { ledgerService } = require('./src/core/ledger');

const balance = await ledgerService.getAccountBalance({
  tenantId: 'merchant-123',
  accountCode: 'ESC-001'  // Escrow Bank Account
});

console.log(balance);
// {
//   account_code: 'ESC-001',
//   account_name: 'Escrow Bank Account - Nodal Account',
//   account_type: 'escrow',
//   normal_balance: 'debit',
//   balance: 125000.50,
//   total_debits: 500000.00,
//   total_credits: 374999.50,
//   entry_count: 1250
// }
```

### 5. Reconcile Gateway Settlement

```javascript
const { reconciliationService } = require('./src/core/ledger');

// Create reconciliation batch
const batch = await reconciliationService.createReconciliationBatch({
  tenantId: 'merchant-123',
  reconciliationType: 'gateway_settlement',
  gatewayName: 'razorpay',
  gatewaySettlementId: 'RZP-SETL-123',
  periodFrom: '2024-01-01',
  periodTo: '2024-01-31',
  createdBy: 'admin'
});

// Perform reconciliation with gateway data
const result = await reconciliationService.reconcileGatewaySettlement({
  batchId: batch.id,
  externalTransactions: [
    {
      externalRef: 'RZP-TXN-001',
      orderId: 'order-789',
      amount: 1000.00,
      date: '2024-01-15'
    },
    // ... more transactions
  ]
});

console.log(result.summary);
// {
//   total_external: 150,
//   total_internal: 148,
//   matched: 145,
//   missing_internal: 5,
//   missing_external: 3,
//   amount_mismatch: 2,
//   expected_amount: 148000.00,
//   actual_amount: 150000.00,
//   difference_amount: 2000.00
// }
```

### 6. Reverse a Transaction (Admin Only)

```javascript
const result = await ledgerService.reverseTransaction({
  tenantId: 'merchant-123',
  originalTransactionId: 'ledger-txn-uuid',
  reason: 'Customer dispute approved - merchant accepted return',
  createdBy: 'admin-user'
});

// Creates reversing entries with opposite debit/credit
// Marks original transaction as 'reversed'
```

### 7. Manual Adjustment (Requires Approval)

```javascript
const result = await ledgerEventHandlers.handleManualAdjustment({
  tenantId: 'merchant-123',
  adjustmentId: 'adj-333',
  adjustmentType: 'reconciliation_correction',
  amount: 50.00,
  fromAccountCode: 'ADJ-002',  // Reconciliation Suspense
  toAccountCode: 'ESC-001',     // Escrow Bank
  reason: 'Bank reconciliation - missing deposit entry',
  approvedBy: 'cfo@company.com',
  createdBy: 'admin@company.com'
});
```

## Audit Trail

Every ledger operation creates an audit log entry:

```javascript
// Automatically logged
{
  entity_type: 'ledger_transaction',
  entity_id: 'transaction-uuid',
  action: 'post',
  user_id: 'admin',
  user_email: 'admin@company.com',
  source_system: 'ledger_service',
  before_state: { ... },
  after_state: { ... },
  reason: 'Manual adjustment approved',
  created_at: '2024-01-15T10:30:00Z'
}
```

## Reconciliation Process

### Gateway Reconciliation Flow

1. **Create Batch**: Start a new reconciliation batch for a period
2. **Import Data**: Load gateway settlement report (CSV/API)
3. **Match Transactions**: System matches by order ID and amount
4. **Identify Discrepancies**:
   - Missing in internal system (we don't have their transaction)
   - Missing in external system (gateway doesn't have our transaction)
   - Amount mismatches (amounts don't match)
   - Duplicates (same transaction multiple times)
5. **Review & Resolve**: Admin reviews and resolves discrepancies
6. **Complete**: Mark batch as completed or resolved

### Bank Escrow Reconciliation Flow

1. **Create Batch**: Start escrow statement reconciliation
2. **Import Statement**: Load bank statement for escrow account
3. **Calculate Balances**: 
   - Ledger balance from `account_balances` view
   - Bank balance from statement
4. **Compare**: Check if balances match
5. **Investigate**: If mismatch, drill down to find differences
6. **Adjust**: Create manual adjustments if needed (with approval)

## RBI Compliance Features

✅ **Separate Escrow Account**: Dedicated escrow ledger as per RBI PA guidelines
✅ **Immutable Records**: Ledger entries cannot be modified or deleted
✅ **Audit Trail**: Complete history of all monetary movements
✅ **Double-Entry**: Every rupee is tracked on both sides
✅ **Reconciliation**: Gateway and bank statement reconciliation
✅ **Traceability**: Can trace any payment from customer → escrow → merchant → fees
✅ **Segregation**: Clear separation of merchant funds, platform revenue, and escrow

## Testing

Run the ledger test suite:

```bash
npm test tests/ledger-service.test.js
```

## Security Considerations

- **No PAN/CVV Storage**: Compliant with PCI-DSS
- **Row-Level Security**: All queries filtered by tenant_id
- **Immutability**: Database triggers prevent modifications
- **Approval Required**: Manual adjustments require approval
- **Audit Logging**: All operations logged with user context
- **Idempotency**: Duplicate operations are safely handled

## Performance Optimization

- **Indexed Queries**: All common queries have proper indexes
- **Materialized View**: Consider materializing `account_balances` for large volumes
- **Partitioning**: Partition ledger tables by date for high transaction volumes
- **Read Replicas**: Use read replicas for balance queries and reporting

## Maintenance

### Daily Operations
- Monitor reconciliation status
- Review unresolved discrepancies
- Check escrow balance matches bank

### Monthly Operations
- Run comprehensive gateway reconciliation
- Review platform revenue recognition
- Generate regulatory reports

### Quarterly Operations
- Audit trail review
- Performance optimization
- Archive old ledger data (if needed, but keep accessible)

## Support

For questions or issues:
- Technical: dev-team@company.com
- Compliance: compliance@company.com
- Finance: finance@company.com
