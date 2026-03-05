# Payment Money Flow - Who Holds the Money?

## Executive Summary

**Answer: The PAPG (Payment Aggregator Payment Gateway) holds the money in an RBI-mandated ESCROW ACCOUNT after payment is done.**

The money does NOT go directly to the merchant. It flows through a controlled escrow system with complete audit trails and RBI compliance.

---

## Complete Money Flow Architecture

```
┌──────────┐         ┌─────────────┐         ┌──────────────┐         ┌──────────┐
│ Customer │ ──────> │   Gateway   │ ──────> │ PAPG Escrow  │ ──────> │ Merchant │
│          │         │ (Razorpay/  │         │  Account     │         │  Bank    │
│          │         │  PayU/etc)  │         │  (ESC-001)   │         │ Account  │
└──────────┘         └─────────────┘         └──────────────┘         └──────────┘
   Payment              Collects &              Holds Funds            Final Payout
   ₹1000                Routes to                Temporarily            ₹970 net
                        Escrow                   (RBI Mandated)
```

---

## Detailed Payment Flow - Step by Step

### Phase 1: Customer Makes Payment

**What Happens:**
- Customer pays ₹1,000 through payment gateway (Razorpay, PayU, CCAvenue)
- Gateway provider processes the payment
- Gateway provider transfers funds to **PAPG's Escrow Bank Account**

**Who Has the Money?**
- ✅ **PAPG holds it in Escrow Account (ESC-001)**
- ❌ NOT the gateway provider (they only route it)
- ❌ NOT the merchant (not yet)

**Ledger Entries:**
```
Dr. Escrow Bank (ESC-001)              ₹1,000  [Asset - Cash In]
   Cr. Escrow Liability (ESC-002)              ₹1,000  [Liability to pay out]
```

**Code Reference:** `src/services/ledger-event-handlers.js` (lines 28-67)

---

### Phase 2: Fee Deduction

**What Happens:**
- Platform deducts MDR (Merchant Discount Rate) - typically 2%
- Gateway provider's processing fee - typically 1%
- Net amount available for merchant: ₹1,000 - ₹20 - ₹10 = ₹970

**Who Has the Money?**
- ✅ **Still in PAPG Escrow Account**
- Fees are accounted for but not yet transferred

**Ledger Entries:**
```
// Platform Revenue
Dr. Escrow Liability (ESC-002)         ₹20  [Reduce liability]
   Cr. Platform MDR Revenue (REV-001)          ₹20  [Revenue earned]

// Gateway Fee
Dr. Escrow Liability (ESC-002)         ₹10  [Reduce liability]
   Cr. Gateway Payables (GTW-PAY-001)          ₹10  [Owe to gateway]
```

**Code Reference:** `src/services/payment-gateway.js` (lines 322-340)

---

### Phase 3: Merchant Receivable Created

**What Happens:**
- Merchant becomes entitled to ₹970 (payment minus fees)
- Creates merchant receivable/payable accounts in ledger

**Who Has the Money?**
- ✅ **Still in PAPG Escrow Account**
- Merchant has a claim/receivable, but not the cash yet

**Ledger Entries:**
```
Dr. Merchant Receivables (MER-001)     ₹970  [Merchant is owed]
   Cr. Merchant Payables (MER-002)             ₹970  [Obligation to pay merchant]
```

**Code Reference:** `src/services/ledger-event-handlers.js` (lines 105-120)

---

### Phase 4: Settlement State Machine

**What Happens:**
- Settlement process begins following strict RBI-compliant state machine
- States: CREATED → FUNDS_RESERVED → SENT_TO_BANK → BANK_CONFIRMED → SETTLED

**Who Has the Money?**

| Settlement State | Money Location | Notes |
|------------------|----------------|-------|
| **CREATED** | ✅ PAPG Escrow | Settlement record created |
| **FUNDS_RESERVED** | ✅ PAPG Escrow | Funds earmarked for payout |
| **SENT_TO_BANK** | ✅ PAPG Escrow | Payout instructions sent |
| **BANK_CONFIRMED** | 🔄 In Transit | Bank confirmed with UTR |
| **SETTLED** | ❌ Merchant Bank | Payout complete |

**Ledger Entries at Settlement:**
```
// When settlement is sent to bank
Dr. Merchant Payables (MER-002)        ₹970  [Reduce obligation]
   Cr. Merchant Settlement (MER-003)           ₹970  [Track payout]

Dr. Escrow Liability (ESC-002)         ₹970  [Reduce liability]
   Cr. Escrow Bank (ESC-001)                   ₹970  [Cash out]
```

**Code Reference:** 
- `src/services/settlement-service.js` (settlement state machine)
- `src/services/ledger-event-handlers.js` (lines 331-379)

---

### Phase 5: Final Settlement to Merchant

**What Happens:**
- Bank confirms payout with UTR (Unique Transaction Reference)
- Money actually reaches merchant's bank account
- Settlement state becomes SETTLED (terminal state)

**Who Has the Money?**
- ❌ No longer in PAPG Escrow
- ✅ **In Merchant's Bank Account**

**Verification:**
```sql
SELECT * FROM settlements 
WHERE merchant_id = 'MERCHANT_ID'
AND status IN ('BANK_CONFIRMED', 'SETTLED');
```

**Code Reference:** `src/services/settlement-service.js`

---

## Key Insights: Who Holds the Money?

### 1. **PAPG Holds Money in Escrow (Primary Holder)**

**Yes - PAPG is the primary holder** from payment success until settlement completion:
- Required by RBI Payment Aggregator norms
- Funds held in dedicated Escrow Bank Account (ESC-001)
- Complete isolation and tracking via double-entry ledger
- Typical holding period: T+1 to T+7 days (configurable per merchant)

### 2. **Gateway Providers (Razorpay, PayU, etc.) - Transit Only**

**No - Gateways do NOT hold money:**
- They collect payment from customer
- Immediately route to PAPG's escrow account
- They receive their processing fee from PAPG later
- Act as payment processors, not fund holders

### 3. **Direct to Merchant?**

**No - Never goes directly to merchant:**
- Always flows through PAPG escrow account
- Ensures RBI compliance and audit trail
- Protects against fraud and disputes
- Enables refunds, chargebacks, reconciliation

---

## Why Escrow Account? (RBI Compliance)

### Regulatory Requirements

The Reserve Bank of India (RBI) mandates Payment Aggregators to:

1. **Maintain Escrow Account**
   - Dedicated bank account for customer funds
   - Segregated from company's operational funds
   - Daily reconciliation required

2. **No Commingling**
   - Merchant funds must be separate from PA's funds
   - Clear audit trail required
   - Settlement within agreed timeframe

3. **Bank-Grade Accounting**
   - Double-entry ledger system
   - Immutable transaction records
   - Complete reconciliation capability

**Code Reference:** See `FINTECH_SOLUTION_EXECUTIVE_SUMMARY.md` and `FINTECH_SOLUTION_SPECIFICATIONS.md`

---

## Ledger Account Structure

The platform maintains multiple ledger accounts to track money flow:

### Escrow Accounts
```
ESC-001  Escrow Bank Account       (Type: escrow, Asset - actual bank balance)
ESC-002  Escrow Liability Account  (Type: escrow, Liability - obligation to pay out)
```

### Merchant Accounts
```
MER-001  Merchant Receivables      (Type: merchant, What merchant is owed)
MER-002  Merchant Payables         (Type: merchant, Platform's obligation to merchant)
MER-003  Merchant Settlement       (Type: merchant, Actual payouts tracking)
```

### Platform Revenue Accounts
```
REV-001  Platform MDR Revenue      (Type: platform_revenue, Platform's commission income)
REV-002  Convenience Fee Revenue   (Type: platform_revenue, Additional fees)
```

### Gateway Accounts
```
GTW-001-RZP  Gateway Collections - Razorpay  (Type: gateway, Payments via gateway)
GTW-PAY-001  Gateway Payables                (Type: gateway, Fees owed to gateway)
```

**Note:** Each account has an `account_code` (e.g., ESC-001) and an `account_type` (e.g., escrow, merchant, gateway, platform_revenue) for categorization.

**Code Reference:** `src/services/ledger-service.js` and database schema

---

## Example: ₹1,000 Payment Journey

Let's trace a complete ₹1,000 payment:

| Time | Event | Money Location | Amount in Escrow |
|------|-------|----------------|------------------|
| T+0 00:00 | Customer pays | Gateway processing | ₹0 |
| T+0 00:05 | Gateway settles to PAPG | **PAPG Escrow** | **₹1,000** |
| T+0 00:05 | Platform fee (2%) | **PAPG Escrow** | **₹1,000** (₹20 marked as revenue) |
| T+0 00:05 | Gateway fee (1%) | **PAPG Escrow** | **₹1,000** (₹10 marked as payable) |
| T+0 00:05 | Merchant receivable created | **PAPG Escrow** | **₹1,000** (₹970 marked for merchant) |
| T+1 09:00 | Settlement initiated | **PAPG Escrow** | **₹1,000** (funds reserved) |
| T+1 10:00 | Sent to merchant's bank | **PAPG Escrow** | **₹1,000** (instruction sent) |
| T+1 11:00 | Bank confirms with UTR | **In Transit** | **₹1,000 → ₹30** (₹970 leaving) |
| T+1 12:00 | Settlement complete | **PAPG Escrow** | **₹30** (only fees remain) |
| T+1 12:00 | Merchant receives | Merchant Bank | ₹970 |

**Final Escrow Balance:** ₹30 (₹20 platform revenue + ₹10 gateway payable)

---

## Audit & Compliance

### How to Verify Who Has the Money

**Query 1: Check Escrow Balance**
```sql
SELECT 
    la.account_code,
    la.account_name,
    la.account_type,
    SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END) as balance
FROM ledger_entries le
JOIN ledger_accounts la ON le.account_id = la.account_id
WHERE la.account_code IN ('ESC-001', 'ESC-002')
  AND la.tenant_id = 'YOUR_TENANT_ID'
GROUP BY la.account_code, la.account_name, la.account_type;
```

**Query 2: Check Unsettled Merchant Payables**
```sql
SELECT 
    merchant_id,
    SUM(amount) as pending_settlement
FROM settlements
WHERE status NOT IN ('BANK_CONFIRMED', 'SETTLED')
  AND tenant_id = 'YOUR_TENANT_ID'
GROUP BY merchant_id;
```

**Query 3: Check Money Flow for Specific Transaction**
```sql
SELECT 
    la.account_code,
    la.account_name,
    le.entry_type,
    le.amount,
    le.created_at
FROM ledger_entries le
JOIN ledger_accounts la ON le.account_id = la.account_id
JOIN ledger_transactions lt ON le.transaction_id = lt.transaction_id
WHERE lt.reference_id = 'TRANSACTION_ID'
  AND lt.tenant_id = 'YOUR_TENANT_ID'
ORDER BY le.created_at;
```

---

## Security & Immutability

### Why This Architecture is Secure

1. **Double-Entry Accounting**
   - Every rupee is tracked from source to destination
   - Debits always equal credits (balanced ledger)
   - Impossible to "lose" money in the system

2. **Immutable Ledger**
   - Entries cannot be modified or deleted
   - Only reversals allowed (creates new entry)
   - Complete audit trail forever

3. **RBI Audit Readiness**
   - Accounting period controls (OPEN/SOFT_CLOSED/HARD_CLOSED)
   - Ledger locking during audits
   - Override logging with justifications

4. **Settlement State Machine**
   - No state skipping allowed
   - Bank confirmation required for finality
   - Retry mechanism with exponential backoff

**Code Reference:** See `RBI_AUDIT_READINESS_README.md`

---

## Common Questions Answered

### Q1: Who holds the money after payment is done?
**A:** PAPG (Payment Aggregator Payment Gateway) holds it in an RBI-mandated Escrow Account.

### Q2: Does Razorpay or other gateway providers hold the money?
**A:** No. Gateway providers only process and route the payment to PAPG's escrow account. They don't hold merchant funds.

### Q3: Does money go directly to the merchant?
**A:** No. It always flows through PAPG's escrow account first, then settles to merchant based on configured schedule (T+1, T+3, T+7, etc.).

### Q4: How long does PAPG hold the money?
**A:** Depends on merchant's settlement schedule. Typically:
- Standard merchants: T+3 days
- Premium merchants: T+1 days
- High-risk merchants: T+7 days

### Q5: What happens during disputes or refunds?
**A:** Money remains in escrow until dispute is resolved. For refunds, money flows back from escrow to customer via gateway.

### Q6: Can I see where my money is?
**A:** Yes. Query the ledger_entries table or use the merchant dashboard to see:
- Receivables (money owed to you)
- Settlements (money being paid out)
- Balance (pending amount in escrow)

### Q7: Is this RBI compliant?
**A:** Yes. This architecture follows RBI Payment Aggregator guidelines:
- Escrow account segregation ✅
- Daily reconciliation ✅
- Audit trail ✅
- Settlement tracking ✅
- Period-based controls ✅

---

## Technical Implementation References

### Key Files
1. **Payment Processing:** `src/services/payment-gateway.js`
2. **Ledger System:** `src/services/ledger-service.js`
3. **Settlement State Machine:** `src/services/settlement-service.js`
4. **Ledger Event Handlers:** `src/services/ledger-event-handlers.js`
5. **Accounting Periods:** `src/services/accounting-period-service.js`

### Database Schema
1. **Escrow Tracking:** `ledger_accounts` table (ESC-001, ESC-002)
2. **Settlement Tracking:** `settlements` table with state machine
3. **Ledger Entries:** `ledger_entries` table (immutable)
4. **Audit Compliance:** `accounting_periods`, `ledger_locks`, `admin_overrides_log`

### Documentation
1. **Executive Summary:** `FINTECH_SOLUTION_EXECUTIVE_SUMMARY.md`
2. **Specifications:** `FINTECH_SOLUTION_SPECIFICATIONS.md`
3. **Architecture:** `ARCHITECTURE.md`
4. **RBI Compliance:** `RBI_AUDIT_READINESS_README.md`

---

## Conclusion

**The PAPG platform holds all payment money in a dedicated RBI-compliant Escrow Account from the moment it's received from payment gateways until it's settled to merchants.**

This architecture ensures:
- ✅ RBI compliance
- ✅ Complete audit trail
- ✅ Protection against fraud
- ✅ Ability to handle refunds/disputes
- ✅ Bank-grade accounting
- ✅ Merchant fund safety

The money flow is transparent, auditable, and secure at every step.

---

**Document Version:** 1.0  
**Last Updated:** February 2024  
**Maintained By:** Development Team
