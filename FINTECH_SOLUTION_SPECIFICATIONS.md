# Fintech Solution Specifications

## Executive Summary

This document outlines the comprehensive fintech payment gateway solution designed for RBI compliance and bank-grade operations in India.

## Solution Overview

### Platform Capabilities

**Multi-Payment Support**
- UPI (Unified Payments Interface)
- Credit/Debit Cards
- Net Banking
- Wallets
- BNPL (Buy Now Pay Later)
- EMI (Equated Monthly Installments)
- QR Code Payments
- Recurring Payments/Subscriptions

**Core Infrastructure**
- Double-entry accounting ledger system
- Multi-tenant architecture
- Real-time payment processing
- Settlement management with state machine
- Gateway aggregation and smart routing
- Comprehensive reconciliation engine

### RBI Compliance & Audit Readiness

#### Accounting Period Controls (NEW)

**Purpose**: Financial close discipline and period-based posting controls required for RBI Payment Aggregator audits.

**Features**:
- **Accounting Periods Table**: Manages financial posting windows (DAILY, MONTHLY)
- **Graduated Period Locking**:
  - `OPEN`: Normal operations, all postings allowed
  - `SOFT_CLOSED`: Reconciliation in progress, postings require FINANCE_ADMIN override
  - `HARD_CLOSED`: Period immutable, no postings allowed
- **Contiguity Enforcement**: No gaps allowed between periods
- **Single Open Period**: Only one OPEN period per type per tenant
- **Admin Override Workflow**: 
  - Controlled override for SOFT_CLOSED periods
  - Requires FINANCE_ADMIN role
  - Mandatory justification (minimum 10 characters)
  - Complete audit trail in `admin_overrides_log`

**Database Functions**:
- `check_accounting_period_for_posting()`: Validates posting rules
- Partial unique index ensures one OPEN period per type

**Audit Capabilities**:
- Deterministically answer: "Which periods are closed and by whom?"
- Deterministically answer: "Were any entries posted after close, and why?"

#### Settlement State Machine (NEW)

**Purpose**: Strict lifecycle management for merchant settlements with bank confirmation for finality.

**State Flow**:
```
CREATED → FUNDS_RESERVED → SENT_TO_BANK → BANK_CONFIRMED → SETTLED
                                ↓
                             FAILED → RETRIED (back to FUNDS_RESERVED)
```

**Key Features**:
- **No State Skipping**: All transitions must follow strict sequence
- **No Backward Transitions**: Except FAILED → RETRIED
- **Bank Confirmation Requirement**: UTR (Unique Transaction Reference) required for finality
- **Retry Logic**:
  - Maximum 3 retries with exponential backoff (15min, 1hr, 4hr)
  - Retry history tracked in JSON field
  - Terminal failure after max retries
- **State Transitions Logging**: Complete history of all transitions with timestamps
- **Ledger Balance Preservation**: Ledger remains balanced across retries

**Enhanced Settlement Fields**:
- `funds_reserved_at`, `sent_to_bank_at`, `bank_confirmed_at`, `settled_at`
- `bank_reference_number`, `bank_transaction_id`, `utr_number`
- `settlement_batch_id` for batch tracking
- `retry_count`, `max_retries`, `next_retry_at`, `last_retry_at`
- `failure_reason`, `retry_history`, `state_transitions`

**Audit Capabilities**:
- Deterministically answer: "Which settlements are final?"
- BANK_CONFIRMED status means bank has processed and confirmed
- SETTLED is terminal state - no further changes allowed

#### Ledger Locking & Audit Freeze (NEW)

**Purpose**: Enforce read-only mode during audits and prevent retroactive tampering.

**Lock Types**:
1. **PERIOD_LOCK**: Auto-applied when period is HARD_CLOSED
2. **AUDIT_LOCK**: Manual lock during external audits
3. **RECONCILIATION_LOCK**: Applied during reconciliation processes

**Lock Behavior**:
- When locked: No ledger postings, no reversals
- Read-only access always allowed
- PERIOD_LOCK cannot be released (tied to period status)
- AUDIT_LOCK and RECONCILIATION_LOCK can be released by FINANCE_ADMIN

**Database Functions**:
- `check_ledger_locks()`: Returns active locks for date range
- Partial unique index prevents overlapping locks of same type

**Audit Capabilities**:
- Deterministically answer: "Was the ledger frozen during audit?"
- Complete history of lock/unlock with reasons in `ledger_locks` table

### Ledger System

#### Double-Entry Accounting

**Account Structure**:
- **Escrow Accounts**: RBI-mandated nodal/escrow bank account tracking
- **Merchant Accounts**: Receivables, payables, settlement accounts
- **Gateway Accounts**: Gateway collections and fee tracking
- **Platform Revenue**: MDR, commissions, convenience fees, settlement fees

**Key Principles**:
- Every transaction must balance (debits = credits)
- Immutability: Entries cannot be modified, only reversed
- Idempotency: Same idempotency key returns same result
- Audit trail: Complete history of all operations
- Balances are derived, never stored as source of truth

**Enhanced Posting Guards** (NEW):
```javascript
async postTransaction(params) {
  // 1. Check accounting period
  const periodCheck = await accountingPeriodService.checkPeriodForPosting()
  
  // 2. Block if ledger locked
  if (periodCheck.locked) throw LedgerLockedError
  
  // 3. Block or require override if period closed
  if (!periodCheck.posting_allowed && !override) {
    if (periodCheck.override_required) throw AdminOverrideRequiredError
    else throw PeriodClosedError
  }
  
  // 4. Validate override if requested
  if (override) {
    validateRole('FINANCE_ADMIN')
    validateJustification(min: 10 chars)
    logOverride()
  }
  
  // 5. Post transaction
  // ...
}
```

#### Reconciliation Engine

**Gateway Reconciliation**:
- Match internal transactions with gateway settlement files
- Identify missing, mismatched, and duplicate transactions
- Track discrepancies and resolution status

**Bank Escrow Reconciliation**:
- Match ledger balances with bank statements
- Verify all funds in escrow account
- Ensure compliance with RBI norms

**Reconciliation Status**:
- `matched`: Internal and external records match
- `missing_internal`: In external but not in system
- `missing_external`: In system but not in external
- `amount_mismatch`: Records exist but amounts differ
- `duplicate`: Duplicate entries detected

### Security & Compliance

#### PCI DSS Compliance
- Tokenization of card data
- Encrypted storage of sensitive information
- Secure key management
- Audit logging of all access

#### RBI Payment Aggregator Norms
- Escrow account segregation
- Settlement tracking with state machine (NEW)
- Merchant onboarding with KYC
- Transaction monitoring
- Accounting period controls (NEW)
- Ledger locking for audits (NEW)

#### Access Controls
- Role-based access control (RBAC)
- FINANCE_ADMIN role for sensitive operations
- Multi-factor authentication support
- IP whitelisting capabilities

### API Architecture

#### Merchant APIs
- Payment initialization
- Payment status queries
- Refund processing
- Settlement status
- Transaction history

#### Internal APIs
- Ledger operations (with period checks)
- Accounting period management (NEW)
- Settlement state management (NEW)
- Ledger lock management (NEW)
- Reconciliation operations
- Admin overrides audit trail (NEW)

#### Webhook System
- Real-time payment notifications
- Settlement notifications
- Refund notifications
- Configurable retry mechanism

### Gateway Integration

**Supported Gateways**:
- Razorpay
- PayU
- CCAvenue
- Extensible framework for additional gateways

**Smart Routing**:
- Success rate optimization
- Fallback handling
- Gateway health monitoring
- Dynamic routing rules

### Resilience Features

#### Circuit Breaker
- Automatic gateway failure detection
- Fallback to healthy gateways
- Self-healing with exponential backoff

#### Retry Mechanism
- Configurable retry attempts
- Exponential backoff
- Idempotency enforcement
- Settlement retry logic with max attempts (NEW)

#### Rate Limiting
- Per-endpoint rate limits
- Tenant-based quotas
- DDoS protection

### Data Architecture

#### Multi-Tenancy
- Tenant isolation at database level
- Tenant-specific configurations
- Separate escrow tracking per tenant

#### Database Schema

**Core Tables**:
- `transactions`: Payment transactions
- `ledger_accounts`: Chart of accounts
- `ledger_transactions`: Transaction groups
- `ledger_entries`: Individual debits/credits
- `settlements`: Settlement records with state machine
- `reconciliation_batches`: Reconciliation tracking
- `accounting_periods`: Financial posting windows (NEW)
- `ledger_locks`: Audit freeze management (NEW)
- `admin_overrides_log`: Override audit trail (NEW)

**Audit Tables**:
- `ledger_audit_logs`: Ledger operation history
- `audit_trail`: General system audit logs

#### Database Triggers
- `prevent_ledger_entry_modification()`: Enforces immutability
- Automatic validation of double-entry balance

#### Views
- `account_balances`: Real-time derived balances

### Monitoring & Observability

#### Logging
- Structured logging with Winston
- Transaction-level tracing
- Error tracking and alerting
- Override logging for compliance (NEW)

#### Metrics
- Payment success/failure rates
- Gateway performance
- Settlement success rates and retry metrics (NEW)
- API response times
- Reconciliation accuracy
- Period closure metrics (NEW)

### Deployment Architecture

#### Application Tier
- Node.js/Express application
- Stateless design for horizontal scaling
- Load balancing support

#### Database Tier
- PostgreSQL for transactional data
- Read replicas for reporting
- Point-in-time recovery

#### Caching Tier
- Redis for session management
- Rate limit tracking
- Circuit breaker state

### Admin Operations

#### Period Management (NEW)
- Create new accounting periods
- Close periods (OPEN → SOFT_CLOSED → HARD_CLOSED)
- Monitor override usage
- Query override audit trail

#### Settlement Management (NEW)
- Monitor settlement pipeline
- Manage failed settlements
- Process retries
- Confirm bank settlements

#### Ledger Management (NEW)
- Apply audit locks
- Release locks (AUDIT_LOCK, RECONCILIATION_LOCK only)
- Query lock history
- Override soft-closed period postings (with justification)

#### Reconciliation Management
- Initiate reconciliation batches
- Review discrepancies
- Resolve reconciliation items
- Generate reconciliation reports

#### Merchant Management
- Onboard new merchants
- Update merchant details
- Configure settlement schedules
- Monitor merchant transactions

### Audit & Compliance Queries

The system is designed to answer these audit questions deterministically:

1. **"Which periods are closed and by whom?"**
   - Query: `SELECT * FROM accounting_periods WHERE tenant_id = ? ORDER BY period_start DESC`
   - Shows: status, closed_by, closed_at, closure_notes

2. **"Were any entries posted after close?"**
   - Query: `SELECT * FROM admin_overrides_log WHERE override_type = 'SOFT_CLOSE_POSTING'`
   - Shows: justification, override_by, affected_entities, timestamp

3. **"Which settlements are final?"**
   - Query: `SELECT * FROM settlements WHERE status IN ('BANK_CONFIRMED', 'SETTLED')`
   - Shows: All confirmed/settled settlements with UTR numbers

4. **"Were overrides used, and why?"**
   - Query: `SELECT * FROM admin_overrides_log WHERE tenant_id = ?`
   - Shows: Complete override history with justifications

5. **"Was the ledger frozen during audit?"**
   - Query: `SELECT * FROM ledger_locks WHERE lock_type = 'AUDIT_LOCK'`
   - Shows: Lock periods, reasons, reference numbers, locked_by

### Success Metrics

**Operational**:
- 99.9% uptime
- < 2 second payment processing time
- < 5 minute settlement confirmation time
- 100% reconciliation accuracy

**Compliance**:
- Zero unapproved period postings
- 100% audit trail completeness
- All settlements with bank confirmation
- All overrides with valid justification

**Business**:
- Support for 10,000+ merchants
- Process 1M+ transactions/day
- Real-time settlement status
- Same-day reconciliation

## Version History

- **v1.0**: Initial payment gateway with basic features
- **v1.1**: Added ledger system with double-entry accounting
- **v1.2**: Added PCI DSS compliance features
- **v1.3**: Enhanced resilience with circuit breaker and retry
- **v1.4**: QR code payments and webhooks
- **v1.5**: RBI audit readiness - Accounting periods, settlement state machine, ledger locks (CURRENT)

## Contact & Support

For implementation details, contact the development team.
