# Finance Admin Dashboard - Manual Test Checklist

## 🎯 Test Objective

Validate that the Finance Admin Dashboard meets all RBI-compliance requirements and functions correctly with proper audit controls.

**Test Environment:**
- Database: PostgreSQL with all migrations applied
- Server: Running on localhost:3000
- Users: At least one FINANCE_ADMIN and one COMPLIANCE_ADMIN user created

---

## ✅ Test Suite 1: Access Control & Security

### Test 1.1: Role-Based Access

**Setup:**
- Create users with different roles in platform_users table

**Test Steps:**
1. Attempt to access `/finance-admin-console.html` with no auth
   - **Expected:** Redirect to `/platform-login.html`
   - **Result:** ☐ Pass ☐ Fail

2. Login as `OPS_ADMIN` and access finance console
   - **Expected:** "Access denied" message and redirect
   - **Result:** ☐ Pass ☐ Fail

3. Login as `FINANCE_ADMIN`
   - **Expected:** Access granted, see dashboard
   - **Result:** ☐ Pass ☐ Fail

4. Login as `COMPLIANCE_ADMIN`
   - **Expected:** Access granted, see dashboard
   - **Result:** ☐ Pass ☐ Fail

5. Verify watermark visible at top
   - **Expected:** "⚠️ INTERNAL – FINANCE ONLY – RBI REGULATED ⚠️"
   - **Result:** ☐ Pass ☐ Fail

### Test 1.2: Self-Approval Prevention

**Setup:**
- Login as FINANCE_ADMIN
- Create override request

**Test Steps:**
1. Submit override request as FINANCE_ADMIN
   - **Expected:** Request created successfully
   - **Result:** ☐ Pass ☐ Fail

2. Try to approve own request (same user ID)
   - **Expected:** Error: "Self-approval is forbidden"
   - **Result:** ☐ Pass ☐ Fail

3. Login as different COMPLIANCE_ADMIN user
   - **Expected:** Can see pending request
   - **Result:** ☐ Pass ☐ Fail

4. Approve request as COMPLIANCE_ADMIN
   - **Expected:** Approval successful, logged in admin_overrides_log
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 2: Accounting Period Management

### Test 2.1: View Current Period

**Test Steps:**
1. Navigate to "Accounting Periods" tab
   - **Expected:** See current open period (if exists)
   - **Result:** ☐ Pass ☐ Fail

2. Verify period shows:
   - Period dates
   - Period type (DAILY/MONTHLY)
   - Status (OPEN/SOFT_CLOSED/HARD_CLOSED)
   - Who closed it (if closed)
   - **Result:** ☐ Pass ☐ Fail

### Test 2.2: Close Period (Soft Close)

**Test Steps:**
1. Click "Close" on OPEN period
   - **Expected:** Modal opens
   - **Result:** ☐ Pass ☐ Fail

2. Select "Soft Close" and enter notes
   - **Expected:** Period closes to SOFT_CLOSED
   - **Result:** ☐ Pass ☐ Fail

3. Verify "closed_by" and "closed_at" populated
   - **Expected:** Shows user email and timestamp
   - **Result:** ☐ Pass ☐ Fail

4. Check if postings allowed
   - **Expected:** Shows "override required" message
   - **Result:** ☐ Pass ☐ Fail

### Test 2.3: Hard Close Period (Irreversible)

**Test Steps:**
1. Click "Hard Close" on SOFT_CLOSED period
   - **Expected:** Warning modal: "HARD_CLOSE is irreversible!"
   - **Result:** ☐ Pass ☐ Fail

2. Confirm hard close with notes
   - **Expected:** Period status changes to HARD_CLOSED
   - **Result:** ☐ Pass ☐ Fail

3. Try to post to HARD_CLOSED period
   - **Expected:** Blocked with "Period is HARD_CLOSED" error
   - **Result:** ☐ Pass ☐ Fail

4. Check if PERIOD_LOCK auto-created
   - **Expected:** Lock visible in "Ledger Locks" tab
   - **Result:** ☐ Pass ☐ Fail

### Test 2.4: Create New Period

**Test Steps:**
1. Click "Create New Period"
   - **Expected:** Modal opens with form
   - **Result:** ☐ Pass ☐ Fail

2. Enter valid period dates (contiguous with last period)
   - **Expected:** Period created successfully
   - **Result:** ☐ Pass ☐ Fail

3. Try to create overlapping period
   - **Expected:** Error: "Period overlap detected"
   - **Result:** ☐ Pass ☐ Fail

4. Try to create period with gap
   - **Expected:** Error: "Period gap detected"
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 3: Settlement State Management

### Test 3.1: View Settlements

**Test Steps:**
1. Navigate to "Settlements" tab
   - **Expected:** List of settlements shown
   - **Result:** ☐ Pass ☐ Fail

2. Filter by status "CREATED"
   - **Expected:** Only CREATED settlements shown
   - **Result:** ☐ Pass ☐ Fail

3. View settlement details
   - **Expected:** Shows status, UTR, amounts, dates
   - **Result:** ☐ Pass ☐ Fail

### Test 3.2: Settlement State Transitions

**Test Steps:**
1. Create settlement (status: CREATED)
   - **Expected:** Settlement created
   - **Result:** ☐ Pass ☐ Fail

2. Transition to FUNDS_RESERVED
   - **Expected:** State changes, timestamp updated
   - **Result:** ☐ Pass ☐ Fail

3. Try to skip to SETTLED (without SENT_TO_BANK)
   - **Expected:** Error: "Invalid state transition"
   - **Result:** ☐ Pass ☐ Fail

4. Transition through valid states: SENT_TO_BANK → BANK_CONFIRMED → SETTLED
   - **Expected:** All transitions succeed
   - **Result:** ☐ Pass ☐ Fail

5. Verify UTR required for BANK_CONFIRMED
   - **Expected:** Error if UTR missing
   - **Result:** ☐ Pass ☐ Fail

### Test 3.3: Settlement Retry

**Test Steps:**
1. Mark settlement as FAILED
   - **Expected:** Status changes to FAILED
   - **Result:** ☐ Pass ☐ Fail

2. Retry failed settlement
   - **Expected:** Status changes to RETRIED, then FUNDS_RESERVED
   - **Result:** ☐ Pass ☐ Fail

3. Retry 3 times and fail again
   - **Expected:** Error: "Max retries exhausted"
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 4: Ledger Lock Management

### Test 4.1: Apply Audit Lock

**Test Steps:**
1. Navigate to "Ledger Locks" tab
   - **Expected:** See active locks section
   - **Result:** ☐ Pass ☐ Fail

2. Click "Apply Ledger Lock"
   - **Expected:** Modal opens
   - **Result:** ☐ Pass ☐ Fail

3. Select "AUDIT_LOCK", enter dates and reason
   - **Expected:** Lock applied successfully
   - **Result:** ☐ Pass ☐ Fail

4. Try to post transaction during lock period
   - **Expected:** Error: "Ledger is locked"
   - **Result:** ☐ Pass ☐ Fail

5. Verify read-only access still works
   - **Expected:** Can view ledger transactions
   - **Result:** ☐ Pass ☐ Fail

### Test 4.2: Release Lock

**Test Steps:**
1. Click "Release Lock" on active lock
   - **Expected:** Prompt for release notes
   - **Result:** ☐ Pass ☐ Fail

2. Enter release notes and confirm
   - **Expected:** Lock released, disappears from active locks
   - **Result:** ☐ Pass ☐ Fail

3. Check lock history
   - **Expected:** Shows who/when locked and released
   - **Result:** ☐ Pass ☐ Fail

### Test 4.3: Period Lock (Auto-Created)

**Test Steps:**
1. Hard close an accounting period
   - **Expected:** PERIOD_LOCK automatically created
   - **Result:** ☐ Pass ☐ Fail

2. Verify cannot release period lock manually
   - **Expected:** Lock tied to period, cannot be released independently
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 5: Override Approval Workflow (CRITICAL)

### Test 5.1: Request Override (Finance Admin)

**Setup:**
- Login as FINANCE_ADMIN

**Test Steps:**
1. Navigate to "Override Approvals" tab
   - **Expected:** See "Request Override" button (FINANCE_ADMIN only)
   - **Result:** ☐ Pass ☐ Fail

2. Click "Request Override"
   - **Expected:** Modal opens
   - **Result:** ☐ Pass ☐ Fail

3. Fill form:
   - Override Type: "SOFT_CLOSE_POSTING"
   - Justification: "Emergency regulatory filing correction"
   - Affected Transaction IDs: "txn-123"
   - **Expected:** Request created
   - **Result:** ☐ Pass ☐ Fail

4. Verify request appears in "Pending Approvals"
   - **Expected:** Request visible with status "pending"
   - **Result:** ☐ Pass ☐ Fail

5. Check database entry:
   ```sql
   SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY requested_at DESC LIMIT 1;
   ```
   - **Expected:** Request exists with requestor_id
   - **Result:** ☐ Pass ☐ Fail

### Test 5.2: Approve Override (Compliance Admin)

**Setup:**
- Logout, login as COMPLIANCE_ADMIN (different user)

**Test Steps:**
1. Navigate to "Override Approvals" tab
   - **Expected:** See pending request
   - **Result:** ☐ Pass ☐ Fail

2. Click "Approve" button
   - **Expected:** Prompt for approval reason
   - **Result:** ☐ Pass ☐ Fail

3. Enter approval reason and confirm
   - **Expected:** Request status changes to "approved"
   - **Result:** ☐ Pass ☐ Fail

4. Check admin_overrides_log:
   ```sql
   SELECT * FROM admin_overrides_log ORDER BY created_at DESC LIMIT 1;
   ```
   - **Expected:** Entry with override_by (requestor) and approved_by (approver)
   - **Result:** ☐ Pass ☐ Fail

5. Verify timestamps captured:
   - Requested at
   - Approved at
   - **Result:** ☐ Pass ☐ Fail

### Test 5.3: Reject Override (Compliance Admin)

**Test Steps:**
1. Create new override request (as FINANCE_ADMIN)
   - **Expected:** Request created
   - **Result:** ☐ Pass ☐ Fail

2. Login as COMPLIANCE_ADMIN
   - **Expected:** See new pending request
   - **Result:** ☐ Pass ☐ Fail

3. Click "Reject" and enter reason
   - **Expected:** Request status changes to "rejected"
   - **Result:** ☐ Pass ☐ Fail

4. Verify NOT logged in admin_overrides_log
   - **Expected:** Only approved overrides logged there
   - **Result:** ☐ Pass ☐ Fail

### Test 5.4: Dual-Confirmation Enforcement

**Test Steps:**
1. Create override request as FINANCE_ADMIN
   - **Expected:** Request created
   - **Result:** ☐ Pass ☐ Fail

2. Try to approve with SAME user ID
   - **Expected:** Error: "Self-approval is forbidden"
   - **Result:** ☐ Pass ☐ Fail

3. Try to approve as FINANCE_ADMIN (different user)
   - **Expected:** Error: "COMPLIANCE_ADMIN role required for approvals"
   - **Result:** ☐ Pass ☐ Fail

4. Approve as COMPLIANCE_ADMIN (different user ID)
   - **Expected:** Success
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 6: Reconciliation Console

### Test 6.1: Create Reconciliation Batch

**Test Steps:**
1. Navigate to "Reconciliation" tab
   - **Expected:** See "Create Reconciliation Batch" button
   - **Result:** ☐ Pass ☐ Fail

2. Click button and fill form:
   - Type: GATEWAY_SETTLEMENT
   - Gateway: Razorpay
   - Period: Last month
   - **Expected:** Batch created
   - **Result:** ☐ Pass ☐ Fail

3. Verify batch visible in list
   - **Expected:** Shows status "IN_PROGRESS"
   - **Result:** ☐ Pass ☐ Fail

### Test 6.2: View Reconciliation Items

**Test Steps:**
1. Click "View" on a batch
   - **Expected:** Shows matched/mismatched items
   - **Result:** ☐ Pass ☐ Fail

2. Check item details:
   - Match status (MATCHED/MISSING/MISMATCHED)
   - Amounts
   - Transaction IDs
   - **Result:** ☐ Pass ☐ Fail

### Test 6.3: Resolve Discrepancy

**Test Steps:**
1. Find MISMATCHED item
   - **Expected:** Shows amount difference
   - **Result:** ☐ Pass ☐ Fail

2. Add resolution notes
   - **Expected:** Notes saved
   - **Result:** ☐ Pass ☐ Fail

3. Mark as resolved
   - **Expected:** Status changes
   - **Result:** ☐ Pass ☐ Fail

### Test 6.4: Complete Reconciliation

**Test Steps:**
1. Mark all items as resolved
   - **Expected:** All items have resolution
   - **Result:** ☐ Pass ☐ Fail

2. Click "Complete Batch"
   - **Expected:** Batch status changes to "COMPLETED"
   - **Result:** ☐ Pass ☐ Fail

3. Verify ledger NOT mutated
   - **Expected:** No ledger entries changed
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 7: Ledger Explorer (READ-ONLY)

### Test 7.1: View Ledger Transactions

**Test Steps:**
1. Navigate to "Ledger Explorer" tab
   - **Expected:** See READ-ONLY badge
   - **Result:** ☐ Pass ☐ Fail

2. See warning: "🚫 No Edits: Ledger is strictly read-only"
   - **Expected:** Warning visible
   - **Result:** ☐ Pass ☐ Fail

3. Select date range and click Search
   - **Expected:** Transactions listed
   - **Result:** ☐ Pass ☐ Fail

4. Verify NO edit/delete buttons
   - **Expected:** Only "View" buttons
   - **Result:** ☐ Pass ☐ Fail

### Test 7.2: Filter Ledger Transactions

**Test Steps:**
1. Filter by event type "payment_success"
   - **Expected:** Only payment_success transactions shown
   - **Result:** ☐ Pass ☐ Fail

2. Filter by date range
   - **Expected:** Only transactions in range shown
   - **Result:** ☐ Pass ☐ Fail

3. Verify transaction details:
   - Transaction ref
   - Event type
   - Debit/credit entries
   - Balances
   - **Result:** ☐ Pass ☐ Fail

### Test 7.3: Export Ledger

**Test Steps:**
1. Select date range
   - **Expected:** Dates selected
   - **Result:** ☐ Pass ☐ Fail

2. Click "Export CSV"
   - **Expected:** File downloads
   - **Result:** ☐ Pass ☐ Fail

3. Open CSV file
   - **Expected:** Contains all ledger entries with columns:
     - Date, Transaction Ref, Event Type, Account, Entry Type, Amount, Created By
   - **Result:** ☐ Pass ☐ Fail

4. Verify CSV is read-only export (not editable)
   - **Expected:** Static export, no re-import functionality
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 8: Financial Reports

### Test 8.1: Daily Escrow Balance Report

**Test Steps:**
1. Navigate to "Reports" tab
   - **Expected:** See report cards
   - **Result:** ☐ Pass ☐ Fail

2. Click "Generate Report" on Daily Escrow Balance
   - **Expected:** Report shows:
     - Escrow Balance (ESC-001)
     - Customer Liability (ESC-002)
     - Reconciled status (should match)
   - **Result:** ☐ Pass ☐ Fail

3. Verify reconciled = true if balances match
   - **Expected:** ✓ Yes if balanced
   - **Result:** ☐ Pass ☐ Fail

### Test 8.2: Merchant Payables Report

**Test Steps:**
1. Click "Generate Report" on Merchant Payables
   - **Expected:** Shows list of merchants with outstanding payables
   - **Result:** ☐ Pass ☐ Fail

2. Verify totals calculated correctly
   - **Expected:** Sum of all MER-002 accounts
   - **Result:** ☐ Pass ☐ Fail

### Test 8.3: Platform Revenue Report

**Test Steps:**
1. Select date range
   - **Expected:** From/To dates selected
   - **Result:** ☐ Pass ☐ Fail

2. Click "Generate Report"
   - **Expected:** Shows revenue by account (REV-001, REV-002, etc.)
   - **Result:** ☐ Pass ☐ Fail

3. Verify revenue is credit-side only
   - **Expected:** Only credit entries counted
   - **Result:** ☐ Pass ☐ Fail

### Test 8.4: Settlement Aging Report

**Test Steps:**
1. Click "Generate Report" on Settlement Aging
   - **Expected:** Shows settlements grouped by status
   - **Result:** ☐ Pass ☐ Fail

2. Check aging buckets:
   - CREATED
   - FUNDS_RESERVED
   - SENT_TO_BANK
   - BANK_CONFIRMED
   - **Result:** ☐ Pass ☐ Fail

3. Verify oldest settlement highlighted
   - **Expected:** Shows oldest date per status
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 9: Audit Trail Verification

### Test 9.1: Override Logging

**Test Steps:**
1. Create and approve an override
   - **Expected:** Logged in admin_overrides_log
   - **Result:** ☐ Pass ☐ Fail

2. Check log entry contains:
   - override_type
   - justification
   - override_by (requestor email)
   - approved_by (approver email)
   - affected_transaction_ids
   - timestamps
   - **Result:** ☐ Pass ☐ Fail

### Test 9.2: Period Closure Logging

**Test Steps:**
1. Close an accounting period
   - **Expected:** Logged in accounting_periods table
   - **Result:** ☐ Pass ☐ Fail

2. Check fields populated:
   - closed_by
   - closed_at
   - closure_notes
   - **Result:** ☐ Pass ☐ Fail

### Test 9.3: Lock Logging

**Test Steps:**
1. Apply and release a lock
   - **Expected:** Logged in ledger_locks table
   - **Result:** ☐ Pass ☐ Fail

2. Check fields:
   - locked_by / locked_by_role
   - locked_at
   - released_by / released_by_role
   - released_at
   - **Result:** ☐ Pass ☐ Fail

---

## ✅ Test Suite 10: RBI Auditor Questions (CRITICAL)

**Can an RBI auditor answer these questions from the UI?**

### Q1: Who closed this accounting period?

**Test:**
1. Navigate to Accounting Periods tab
2. Find closed period
3. Check "Closed By" column
   - **Expected:** Shows user email
   - **Result:** ☐ Pass ☐ Fail

### Q2: Were any entries posted after close?

**Test:**
1. View accounting period details
2. Check period status and lock status
3. Query admin_overrides_log for that period
   - **Expected:** If HARD_CLOSED, no entries. If SOFT_CLOSED, see override log.
   - **Result:** ☐ Pass ☐ Fail

### Q3: Who approved this override?

**Test:**
1. Navigate to Override Approvals → History
2. Find specific override
3. Check "Approved By" column
   - **Expected:** Shows compliance admin email
   - **Result:** ☐ Pass ☐ Fail

### Q4: When was the ledger locked?

**Test:**
1. Navigate to Ledger Locks → History
2. Find lock entry
3. Check "Locked At" and "Locked By" columns
   - **Expected:** Shows exact timestamp and user
   - **Result:** ☐ Pass ☐ Fail

### Q5: Are settlements bank-confirmed?

**Test:**
1. Navigate to Settlements tab
2. Filter by status "BANK_CONFIRMED" or "SETTLED"
3. Check UTR column
   - **Expected:** All confirmed settlements have UTR
   - **Result:** ☐ Pass ☐ Fail

### Q6: Is the ledger immutable?

**Test:**
1. Verify no edit/delete buttons in Ledger Explorer
2. Try to modify via API directly (should fail)
3. Check database trigger prevents UPDATE/DELETE on ledger_entries
   - **Expected:** Ledger is completely immutable
   - **Result:** ☐ Pass ☐ Fail

---

## 📊 Test Summary

### Pass/Fail Counts

- **Total Tests:** 90+
- **Passed:** ___
- **Failed:** ___
- **Skipped:** ___

### Critical Failures (Block Production)

List any failures in:
- [ ] Self-approval prevention
- [ ] Ledger immutability
- [ ] Period hard close finality
- [ ] Settlement state enforcement
- [ ] Audit logging

### Issues Found

| Test # | Issue Description | Severity | Status |
|--------|------------------|----------|--------|
| | | | |

---

## ✅ Sign-Off

**Tester Name:** _________________  
**Date:** _________________  
**Environment:** _________________  

**Approval:**

- [ ] All critical tests passed
- [ ] Audit trail complete
- [ ] RBI auditor questions answerable from UI
- [ ] Security requirements met
- [ ] Ready for production deployment

**Notes:**

---

**Last Updated:** 2026-01-11  
**Version:** 1.0.0
