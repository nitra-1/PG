# Ledger Entries Examples - RBI Compliant PA

This document shows example ledger entries for various business events in the Payment Aggregator system.

## Chart of Accounts (Quick Reference)

### Escrow Ledger
- **ESC-001**: Escrow Bank Account (Asset, Dr)
- **ESC-002**: Customer Deposits Liability (Liability, Cr)

### Merchant Ledger
- **MER-001**: Merchant Receivables (Asset, Dr)
- **MER-002**: Merchant Payables (Liability, Cr)
- **MER-003**: Merchant Settlement Account (Asset, Dr)

### Gateway Ledger
- **GTW-001-RZP**: Gateway Collections - Razorpay (Asset, Dr)
- **GTW-FEE-001**: Gateway Fee Expense - Razorpay (Expense, Dr)
- **GTW-PAY-001**: Gateway Payables (Liability, Cr)

### Platform Revenue Ledger
- **REV-001**: Platform Revenue - MDR (Revenue, Cr)
- **REV-REC-001**: Platform Receivables (Asset, Dr)

### Other Accounts
- **REF-001**: Refunds Payable (Liability, Cr)
- **CHB-001**: Chargeback Liability (Liability, Cr)

---

## Example 1: Customer Payment Success

### Business Event
Customer pays ₹1,000 for an order. Platform charges 2% MDR (₹20) and gateway charges 1.5% (₹15). Merchant gets ₹965.

### Accounting Logic
1. Cash enters escrow → Asset increases (Debit Escrow)
2. Liability to customer created → Liability increases (Credit Escrow Liability)
3. Merchant earns right to payment → Asset increases (Debit Merchant Receivable)
4. Platform owes merchant → Liability increases (Credit Merchant Payable)
5. Platform earns MDR → Revenue increases (Credit Revenue), Asset increases (Debit Receivable)
6. Gateway fee incurred → Expense increases (Debit Fee), Liability increases (Credit Payable)

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| ESC-001 | Escrow Bank | 1,000.00 | | Payment received for order-123 |
| ESC-002 | Escrow Liability | | 1,000.00 | Customer funds held in escrow |
| MER-001 | Merchant Receivables | 965.00 | | Merchant receivable for order-123 |
| MER-002 | Merchant Payables | | 965.00 | Amount payable to merchant |
| REV-REC-001 | Platform Receivables | 20.00 | | Platform MDR for order-123 |
| REV-001 | Platform MDR Revenue | | 20.00 | Platform revenue earned |
| GTW-FEE-001 | Gateway Fee Expense | 15.00 | | Razorpay gateway fee |
| GTW-PAY-001 | Gateway Payables | | 15.00 | Gateway fee payable to Razorpay |
| **TOTAL** | | **2,000.00** | **2,000.00** | **BALANCED ✓** |

### Balance Impact
- Escrow Bank: +₹1,000 (Asset ↑)
- Escrow Liability: +₹1,000 (Liability ↑)
- Merchant Receivables: +₹965 (Asset ↑)
- Merchant Payables: +₹965 (Liability ↑)
- Platform Receivables: +₹20 (Asset ↑)
- Platform Revenue: +₹20 (Revenue ↑)
- Gateway Fee Expense: +₹15 (Expense ↑)
- Gateway Payables: +₹15 (Liability ↑)

---

## Example 2: Refund Completed

### Business Event
Customer requests refund of ₹1,000. Platform reverses ₹20 MDR and ₹15 gateway fee.

### Accounting Logic
1. Reduce escrow liability (Debit Escrow Liability)
2. Cash leaves escrow (Credit Escrow Bank)
3. Reduce merchant payable (Debit Merchant Payable)
4. Reduce merchant receivable (Credit Merchant Receivable)
5. Reverse platform revenue (Debit Revenue, Credit Receivable)

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| ESC-002 | Escrow Liability | 1,000.00 | | Refund processed for order-123 |
| ESC-001 | Escrow Bank | | 1,000.00 | Refund paid to customer |
| MER-002 | Merchant Payables | 965.00 | | Merchant payable reduced |
| MER-001 | Merchant Receivables | | 965.00 | Merchant receivable reduced |
| REV-001 | Platform MDR Revenue | 20.00 | | Platform revenue reversed |
| REV-REC-001 | Platform Receivables | | 20.00 | Platform receivable reversed |
| **TOTAL** | | **1,985.00** | **1,985.00** | **BALANCED ✓** |

Note: Gateway fee reversal would follow similar pattern if gateway refunds their fee.

### Balance Impact
- Escrow Bank: -₹1,000 (Asset ↓)
- Escrow Liability: -₹1,000 (Liability ↓)
- Merchant Receivables: -₹965 (Asset ↓)
- Merchant Payables: -₹965 (Liability ↓)
- Platform Revenue: -₹20 (Revenue ↓)
- Platform Receivables: -₹20 (Asset ↓)

---

## Example 3: Merchant Settlement (T+1)

### Business Event
Settle ₹48,250 to merchant via bank transfer (UTR: UTR123456789).

### Accounting Logic
1. Clear merchant payable (Debit Merchant Payable)
2. Record settlement (Credit Settlement Account)
3. Reduce escrow liability (Debit Escrow Liability)
4. Cash leaves escrow (Credit Escrow Bank)

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| MER-002 | Merchant Payables | 48,250.00 | | Settlement to merchant - UTR123456789 |
| MER-003 | Merchant Settlement | | 48,250.00 | Settlement paid to merchant |
| ESC-002 | Escrow Liability | 48,250.00 | | Escrow released for settlement |
| ESC-001 | Escrow Bank | | 48,250.00 | Settlement payment to merchant |
| **TOTAL** | | **96,500.00** | **96,500.00** | **BALANCED ✓** |

### Balance Impact
- Merchant Payables: -₹48,250 (Liability ↓)
- Merchant Settlement: +₹48,250 (Asset ↑)
- Escrow Liability: -₹48,250 (Liability ↓)
- Escrow Bank: -₹48,250 (Asset ↓)

---

## Example 4: Gateway Fee Settlement

### Business Event
Pay accumulated gateway fees of ₹5,000 to Razorpay.

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| GTW-PAY-001 | Gateway Payables | 5,000.00 | | Payment to Razorpay for accumulated fees |
| ESC-001 | Escrow Bank | | 5,000.00 | Gateway fee payment |
| **TOTAL** | | **5,000.00** | **5,000.00** | **BALANCED ✓** |

---

## Example 5: Chargeback from Gateway

### Business Event
Customer files chargeback for ₹500. Amount deducted from merchant future settlements.

### Accounting Logic
1. Create chargeback liability (Debit Chargeback Liability - acts as contra)
2. Reduce merchant receivable (Credit Merchant Receivable)
3. Reduce escrow liability (Debit Escrow Liability)
4. Cash leaves escrow for chargeback (Credit Escrow Bank)

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| CHB-001 | Chargeback Liability | 500.00 | | Chargeback for order-789 |
| MER-001 | Merchant Receivables | | 500.00 | Merchant receivable reduced |
| ESC-002 | Escrow Liability | 500.00 | | Escrow liability adjusted |
| ESC-001 | Escrow Bank | | 500.00 | Chargeback payment |
| **TOTAL** | | **1,000.00** | **1,000.00** | **BALANCED ✓** |

---

## Example 6: Chargeback Reversal (Merchant Wins)

### Business Event
Merchant wins chargeback dispute. Reverse the original chargeback entry.

### Ledger Entries

Simply reverse the original chargeback transaction:

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| MER-001 | Merchant Receivables | 500.00 | | REVERSAL: Merchant receivable restored |
| CHB-001 | Chargeback Liability | | 500.00 | REVERSAL: Chargeback liability cleared |
| ESC-001 | Escrow Bank | 500.00 | | REVERSAL: Funds returned to escrow |
| ESC-002 | Escrow Liability | | 500.00 | REVERSAL: Escrow liability restored |
| **TOTAL** | | **1,000.00** | **1,000.00** | **BALANCED ✓** |

---

## Example 7: Manual Adjustment (Reconciliation)

### Business Event
During bank reconciliation, found ₹50 missing in system. Admin adds manual adjustment with approval.

### Ledger Entries

| Account Code | Account Name | Debit (₹) | Credit (₹) | Description |
|--------------|--------------|-----------|------------|-------------|
| ESC-001 | Escrow Bank | 50.00 | | Manual adjustment: Bank reconciliation |
| ADJ-002 | Reconciliation Suspense | | 50.00 | Temporary suspense pending investigation |
| **TOTAL** | | **50.00** | **50.00** | **BALANCED ✓** |

Note: After investigation, this would be reclassified to the correct account.

---

## Example 8: Multiple Payments in One Day

### Summary
3 payments processed in one day:
- Order-001: ₹1,000 (MDR ₹20, Gateway ₹15)
- Order-002: ₹2,500 (MDR ₹50, Gateway ₹37.50)
- Order-003: ₹750 (MDR ₹15, Gateway ₹11.25)

### Consolidated Ledger Position (End of Day)

| Account | Opening Balance | Debits | Credits | Closing Balance |
|---------|----------------|--------|---------|-----------------|
| Escrow Bank | 100,000.00 | +4,250.00 | 0.00 | 104,250.00 |
| Escrow Liability | 100,000.00 | 0.00 | +4,250.00 | 104,250.00 |
| Merchant Receivables | 50,000.00 | +4,065.00 | 0.00 | 54,065.00 |
| Merchant Payables | 50,000.00 | 0.00 | +4,065.00 | 54,065.00 |
| Platform Receivables | 5,000.00 | +85.00 | 0.00 | 5,085.00 |
| Platform Revenue | 5,000.00 | 0.00 | +85.00 | 5,085.00 |
| Gateway Fee Expense | 1,500.00 | +63.75 | 0.00 | 1,563.75 |
| Gateway Payables | 1,500.00 | 0.00 | +63.75 | 1,563.75 |

**Verification:**
- Escrow Bank = Escrow Liability ✓ (104,250 = 104,250)
- Merchant Receivables = Merchant Payables ✓ (54,065 = 54,065)
- All accounts balanced ✓

---

## RBI Audit Trace Example

An auditor wants to trace a payment from customer to merchant:

**Transaction:** Order-123, ₹1,000

### Step 1: Customer Payment (T+0)
- Customer pays → Escrow Bank: +₹1,000
- Obligation created → Escrow Liability: +₹1,000
- Merchant entitled → Merchant Receivable: +₹965
- Platform obligation → Merchant Payable: +₹965

### Step 2: Settlement (T+2)
- Clear obligation → Merchant Payable: -₹965
- Pay merchant → Merchant Settlement: +₹965
- Release escrow → Escrow Liability: -₹965
- Cash out → Escrow Bank: -₹965

### Complete Trace
```
Customer (₹1,000) 
  → Escrow Bank (+₹1,000, then -₹965)
  → Merchant Bank Account (+₹965 via settlement)
  
Platform earns: ₹20 (recorded in Platform Revenue)
Gateway earns: ₹15 (recorded in Gateway Payables)
```

### Audit Questions Answered
1. **Where is customer money?** In Escrow Bank (ESC-001)
2. **How much do we owe merchants?** Check Merchant Payables (MER-002)
3. **How much has been settled?** Check Merchant Settlement (MER-003)
4. **What's our platform revenue?** Check Platform MDR Revenue (REV-001)
5. **Does escrow balance match bank?** Compare ESC-001 balance with bank statement

---

## Key Principles Demonstrated

✅ **Double-Entry**: Every transaction has equal debits and credits
✅ **Segregation**: Clear separation of merchant, escrow, gateway, platform funds
✅ **Traceability**: Can trace every rupee through the system
✅ **Immutability**: Corrections are reversals, not modifications
✅ **Balancing**: Escrow bank always equals escrow liability
✅ **Audit Trail**: Complete history of all monetary movements
