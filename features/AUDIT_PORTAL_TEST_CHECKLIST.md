# Audit Portal Manual Test Checklist

## 🎯 Testing Objective

Verify that the Audit Portal provides strictly read-only access with complete transparency and zero write capability for auditors.

## ✅ Pre-Test Setup

- [ ] Database migrations run successfully (`npm run migrate:latest`)
- [ ] Test auditor user created with role='AUDITOR' (uppercase)
- [ ] Active access window created for test auditor
- [ ] Test data exists in all relevant tables:
  - [ ] Accounting periods
  - [ ] Settlements
  - [ ] Admin overrides
  - [ ] Ledger locks
  - [ ] Audit trail entries
- [ ] Application server is running (`npm start`)

## 🔐 Access Control Tests

### Test 1: Role Validation - AUDITOR Role Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to `http://localhost:3000/audit-portal.html`
2. In browser console, verify headers:
   ```javascript
   headers = {
     'X-User-Role': 'AUDITOR',
     'X-User-Id': 'test-auditor-id',
     'X-User-Name': 'Test Auditor'
   }
   ```
3. Load overview page

**Expected Result:**
- Overview loads successfully
- Auditor info displayed in sidebar
- Access expiry shown
- Data summary cards visible

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 2: Role Validation - Non-AUDITOR Role Blocked
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
1. Modify headers to:
   ```javascript
   headers = {
     'X-User-Role': 'FINANCE_ADMIN',
     'X-User-Id': 'finance-admin-id'
   }
   ```
2. Try to access `/api/audit-portal/overview`

**Expected Result:**
```json
{
  "success": false,
  "error": "Forbidden: AUDITOR role required",
  "message": "Audit portal is restricted to auditors only",
  "note": "This attempt has been logged for security review"
}
```

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 3: Case Sensitivity - Lowercase "auditor" Rejected
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
1. Modify headers to:
   ```javascript
   headers = {
     'X-User-Role': 'auditor',  // lowercase
     'X-User-Id': 'test-auditor-id'
   }
   ```
2. Try to access any audit portal endpoint

**Expected Result:**
- 403 Forbidden error
- Role validation fails
- Security event logged

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 4: Time-Boxed Access - Active Window
**Expected:** ✅ SUCCESS

**Steps:**
1. Verify access window in database:
   ```sql
   SELECT * FROM auditor_access_windows 
   WHERE auditor_user_id = 'test-auditor-id'
   AND status = 'ACTIVE'
   AND access_start_date <= NOW()
   AND access_end_date >= NOW();
   ```
2. Access audit portal with AUDITOR role

**Expected Result:**
- Access granted
- Last access timestamp updated

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 5: Time-Boxed Access - Expired Window
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
1. Set access window end date to past:
   ```sql
   UPDATE auditor_access_windows
   SET access_end_date = NOW() - INTERVAL '1 day'
   WHERE auditor_user_id = 'test-auditor-id';
   ```
2. Try to access audit portal

**Expected Result:**
```json
{
  "success": false,
  "error": "Access window expired or not granted",
  "message": "Your audit access window has expired...",
  "note": "Time-boxed access is required for audit portal"
}
```

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 🚫 Write Operation Blocking Tests

### Test 6: POST Request Blocked
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
```bash
curl -X POST http://localhost:3000/api/audit-portal/accounting-periods \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: test-auditor-id" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"test","periodType":"DAILY"}'
```

**Expected Result:**
```json
{
  "success": false,
  "error": "Forbidden: Write operations not allowed",
  "message": "Audit portal is READ-ONLY. No mutations are permitted.",
  "method": "POST",
  "note": "This attempt has been logged as a CRITICAL security event"
}
```

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 7: PUT Request Blocked
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
```bash
curl -X PUT http://localhost:3000/api/audit-portal/settlements/test-id \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: test-auditor-id" \
  -H "Content-Type: application/json" \
  -d '{"status":"CONFIRMED"}'
```

**Expected Result:**
- 403 Forbidden
- CRITICAL security event logged

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 8: DELETE Request Blocked
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
```bash
curl -X DELETE http://localhost:3000/api/audit-portal/ledger-locks/test-id \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: test-auditor-id"
```

**Expected Result:**
- 403 Forbidden
- CRITICAL security event logged

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 9: PATCH Request Blocked
**Expected:** ❌ 403 FORBIDDEN

**Steps:**
```bash
curl -X PATCH http://localhost:3000/api/audit-portal/admin-overrides/test-id \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: test-auditor-id" \
  -H "Content-Type: application/json" \
  -d '{"status":"APPROVED"}'
```

**Expected Result:**
- 403 Forbidden
- CRITICAL security event logged

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 📊 Data Access Tests

### Test 10: Accounting Periods - View Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Accounting Periods tab
2. Apply filters (if any)
3. View list of periods

**Expected Result:**
- Periods displayed in table
- Columns shown: Period Type, Start, End, Status, Closed By, Closed At
- 🚫 No create/edit/delete buttons visible
- Read-only notice displayed

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 11: Settlements - View Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Settlements tab
2. Filter by status (if desired)
3. View settlement list

**Expected Result:**
- Settlements displayed with state machine info
- Bank confirmation details visible
- UTR numbers shown
- 🚫 No retry/confirm/edit buttons visible
- Read-only notice displayed

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 12: Admin Overrides - View Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Admin Overrides tab
2. View override log

**Expected Result:**
- Overrides displayed
- Requestor, approver, justification shown
- Timestamps visible
- 🚫 No approve/reject buttons visible
- Read-only notice displayed

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 13: Ledger Locks - View Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Ledger Locks tab
2. View lock history

**Expected Result:**
- Locks displayed
- Lock type, reason, timestamps shown
- Applied by and released by shown
- 🚫 No lock/unlock buttons visible
- Read-only notice displayed

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 14: Audit Trail - View Access
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Audit Trail tab
2. Apply filters (event type, date range)
3. View audit entries

**Expected Result:**
- Audit entries displayed
- Who, what, when, where visible
- No data suppression
- 🚫 No delete or filter-hide options
- Read-only notice displayed

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 📈 Compliance Reports Tests

### Test 15: Escrow Balance Report
**Expected:** ✅ SUCCESS

**Steps:**
1. Navigate to Compliance Reports tab
2. Select "Escrow Balance" report
3. Choose report date
4. Generate report

**Expected Result:**
- Report generates successfully
- Escrow account balances shown
- As-of date displayed
- Total balance calculated
- Download button available
- Data derived from ledger

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 16: Merchant Outstanding Report
**Expected:** ✅ SUCCESS

**Steps:**
1. Select "Merchant Outstanding" report
2. Choose as-of date
3. Generate report

**Expected Result:**
- Pending settlements by merchant shown
- Transaction counts displayed
- Total outstanding calculated
- Download button available

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 17: Platform Revenue Report
**Expected:** ✅ SUCCESS

**Steps:**
1. Select "Platform Revenue" report
2. Choose period start and end dates
3. Generate report

**Expected Result:**
- Fee breakdown by type shown
- Total revenue calculated
- Period-bounded
- Download button available

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 18: Settlement Aging Report
**Expected:** ✅ SUCCESS

**Steps:**
1. Select "Settlement Aging" report
2. Choose as-of date
3. Generate report

**Expected Result:**
- Age buckets displayed (0-1, 1-3, 3-7, 7+ days)
- Settlements categorized by age
- Total pending amount shown
- Download button available

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 🎨 UI/UX Tests

### Test 19: Mandatory Watermark Presence
**Expected:** ✅ VISIBLE

**Steps:**
1. View any page in audit portal
2. Check for watermark

**Expected Result:**
- Red watermark bar at top: "🔒 READ-ONLY / AUDIT MODE"
- Auditor name shown
- Audit case number shown
- Timestamp updates every second
- Watermark visible on print preview

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 20: Watermark Information Accuracy
**Expected:** ✅ CORRECT

**Steps:**
1. Check watermark details
2. Verify against access window

**Expected Result:**
- Auditor name matches user
- Case number matches access window
- Access expiry shows correct date
- Timestamp is current

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 21: Read-Only Notices
**Expected:** ✅ VISIBLE

**Steps:**
1. Visit each tab
2. Check for read-only notice

**Expected Result:**
- Yellow notice box on every data page
- 🚫 Symbol visible
- Clear statement of restrictions
- Specific restrictions listed per module

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 22: No Action Buttons
**Expected:** ✅ NONE VISIBLE

**Steps:**
1. Scan all pages for action buttons
2. Check for edit/delete/approve/create buttons

**Expected Result:**
- NO create buttons
- NO edit buttons
- NO delete buttons
- NO approve/reject buttons
- NO submit buttons
- ONLY view and download buttons

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 📝 Audit Logging Tests

### Test 23: Access Logging - Portal Access
**Expected:** ✅ LOGGED

**Steps:**
1. Access several pages in audit portal
2. Query audit_portal_access_log:
   ```sql
   SELECT * FROM audit_portal_access_log
   WHERE auditor_user_id = 'test-auditor-id'
   ORDER BY accessed_at DESC
   LIMIT 10;
   ```

**Expected Result:**
- All page accesses logged
- Endpoint, method, status code recorded
- IP address and user agent captured
- Response time tracked

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 24: Security Event Logging - Write Attempts
**Expected:** ✅ LOGGED AS CRITICAL

**Steps:**
1. Attempt POST/PUT/DELETE (from Test 6-9)
2. Query audit_trail for security events:
   ```sql
   SELECT * FROM audit_trail
   WHERE event_type = 'SECURITY_EVENT'
   AND user_id = 'test-auditor-id'
   ORDER BY timestamp DESC;
   ```

**Expected Result:**
- Write attempts logged as CRITICAL
- Event subtype: 'AUDIT_PORTAL_WRITE_ATTEMPT'
- Mitigation action recorded
- Full details captured

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 🔍 Data Integrity Tests

### Test 25: Complete Data Visibility
**Expected:** ✅ NO SUPPRESSION

**Steps:**
1. Compare data in portal with database
2. Pick a random accounting period from DB
3. Verify it's visible in portal

**Expected Result:**
- All records visible in portal
- No hidden filters
- Data matches database
- Pagination works correctly

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

### Test 26: Timestamps Accuracy
**Expected:** ✅ ACCURATE

**Steps:**
1. Check timestamp displays in various tables
2. Compare with database values

**Expected Result:**
- Timestamps display correctly
- Timezone handled properly
- Format is consistent
- Precision maintained

**Actual Result:** ________________

**Status:** [ ] PASS [ ] FAIL

---

## 📱 Cross-Browser Tests

### Test 27: Chrome Browser
**Expected:** ✅ WORKS

**Steps:**
1. Open audit portal in Chrome
2. Test all major functions

**Status:** [ ] PASS [ ] FAIL

---

### Test 28: Firefox Browser
**Expected:** ✅ WORKS

**Steps:**
1. Open audit portal in Firefox
2. Test all major functions

**Status:** [ ] PASS [ ] FAIL

---

### Test 29: Safari Browser
**Expected:** ✅ WORKS

**Steps:**
1. Open audit portal in Safari
2. Test all major functions

**Status:** [ ] PASS [ ] FAIL

---

### Test 30: Edge Browser
**Expected:** ✅ WORKS

**Steps:**
1. Open audit portal in Edge
2. Test all major functions

**Status:** [ ] PASS [ ] FAIL

---

## 📊 Test Summary

**Total Tests:** 30  
**Passed:** ___  
**Failed:** ___  
**Pass Rate:** ___%

**Critical Issues Found:**
_________________________________
_________________________________
_________________________________

**Non-Critical Issues Found:**
_________________________________
_________________________________
_________________________________

**Recommendations:**
_________________________________
_________________________________
_________________________________

---

**Tested By:** ___________________  
**Date:** ___________________  
**Time:** ___________________  
**Environment:** [ ] Development [ ] Staging [ ] Production

---

## ✅ Sign-Off

**QA Tester:**  
Name: ___________________  
Signature: ___________________  
Date: ___________________

**Technical Lead:**  
Name: ___________________  
Signature: ___________________  
Date: ___________________

**Compliance Officer:**  
Name: ___________________  
Signature: ___________________  
Date: ___________________

---

**Notes:**
_________________________________
_________________________________
_________________________________
_________________________________
