# Compliance Admin Portal - RBI Maker-Checker Control

> **⚠️ CRITICAL: This is the CHECKER role in the maker-checker (dual control) model**
> 
> **This role is independent of Finance Admin and must never be merged with it.**

## 🎯 Overview

The Compliance Admin Portal implements the "Checker" role in an RBI-regulated Payment Aggregator's maker-checker workflow. This portal provides independent oversight and approval authority over financial operations without the ability to initiate them.

**Access URL:** `http://localhost:3000/compliance-admin-portal.html`

---

## 🔐 Security Model

### Role: `COMPLIANCE_ADMIN`

**Can Do:**
- ✅ Review override requests
- ✅ Approve override requests (with justification)
- ✅ Reject override requests (with reason)
- ✅ View high-risk financial actions
- ✅ View control breaches and violations
- ✅ Access complete audit trail

**Cannot Do (FORBIDDEN):**
- 🚫 Edit ledger entries
- 🚫 Confirm settlements
- 🚫 Manage accounting periods
- 🚫 Execute ledger locks
- 🚫 Perform reconciliation actions
- 🚫 Request overrides (only approve/reject)
- 🚫 Access user management
- 🚫 Impersonate other roles

### Separation of Duties

```
┌─────────────────────┐          ┌──────────────────────┐
│   FINANCE_ADMIN     │          │  COMPLIANCE_ADMIN    │
│   (Maker/Requester) │          │  (Checker/Approver)  │
└─────────────────────┘          └──────────────────────┘
          │                                  │
          │ 1. Requests Override             │
          │    with justification            │
          ├─────────────────────────────────>│
          │                                  │
          │                                  │ 2. Reviews request
          │                                  │ 3. Approves/Rejects
          │                                  │    with reason
          │<─────────────────────────────────┤
          │                                  │
          │ 4. System logs action            │
          │    to audit trail                │
          └──────────────────────────────────┘
```

**Critical Rules:**
- Finance Admin CANNOT approve their own requests
- Compliance Admin CANNOT create override requests
- No user can have both roles simultaneously
- All actions require timestamp + reason + audit log

---

## 📦 Features (4 Mandatory Modules)

### 1️⃣ Override Approval Console (CORE FEATURE)

**Purpose:** Review and approve/reject override requests from Finance Admin

**Displays:**
- Override Request ID
- Request Type (SOFT_CLOSE_POSTING, EXCEPTIONAL_CORRECTION)
- Requested by (Finance Admin name & email)
- Request timestamp
- Justification text
- Affected transaction IDs
- Impact summary

**Actions:**
- **Approve Override:** Requires approval reason, creates audit log
- **Reject Override:** Requires rejection reason, blocks the request

**Rules Enforced:**
- Compliance Admin cannot request overrides (only approve/reject)
- Finance Admin cannot approve overrides (only request)
- Self-approval is forbidden (enforced at API level)
- Approval is final and immutable in audit log

### 2️⃣ High-Risk Action Monitor (READ-ONLY)

**Purpose:** "What exceptional things happened in the system?"

**Displays:**
- Accounting period hard closes (SOFT_CLOSED → HARD_CLOSED)
- Ledger locks applied/released
- Settlement retries after failure
- Emergency overrides (EXCEPTIONAL_CORRECTION type)

**No Actions Allowed:** This is purely monitoring/visibility

### 3️⃣ Control Breach & Violation Viewer (READ-ONLY)

**Purpose:** "Did the system prevent improper actions?"

**Displays:**
- Attempted postings in HARD_CLOSED periods (blocked by system)
- Failed override attempts (rejected by compliance)
- Blocked settlement actions
- Unauthorized access attempts

**No Actions Allowed:** This validates that controls are working

### 4️⃣ Audit Support View (READ-ONLY)

**Purpose:** Complete audit trail with internal annotations

**Displays:**
- Complete override history
- Approval timelines
- Compliance admin comments
- Linked audit logs with context
- User actions with timestamps and IP addresses

**Alignment:** More detailed than public Audit Portal, includes internal notes

---

## 🚀 Setup & Usage

### Step 1: Create Compliance Admin User

**Option A: Via Ops Console UI**
1. Login to Ops Console: `http://localhost:3000/ops-console.html`
2. Navigate to User Management
3. Click "Create User"
4. Fill in details:
   - Username: `compliance_admin`
   - Email: `compliance@yourdomain.com`
   - Password: (secure password)
   - **Role:** `COMPLIANCE_ADMIN` (Maker-Checker)
5. Submit

**Option B: Via SQL (Direct Database)**
```sql
-- Generate password hash first
-- Run: node generate-password-hash.js YourPassword123!

INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES (
  'compliance_admin',
  'compliance@yourdomain.com',
  '$2b$10$YOUR_BCRYPT_HASH_HERE',
  'COMPLIANCE_ADMIN',
  'active'
);
```

**Option C: Via generate-password-hash.js script**
```bash
node generate-password-hash.js YourPassword123!
# Copy the hash and use in SQL INSERT above
```

### Step 2: Login

1. Navigate to: `http://localhost:3000/platform-login.html`
2. Enter credentials: `compliance_admin` / your password
3. You will be automatically redirected to Compliance Admin Portal

**OR** directly access: `http://localhost:3000/compliance-admin-portal.html`

### Step 3: Select Merchant

- Use the merchant selector dropdown at the top of the sidebar
- Select the tenant/merchant you want to monitor
- Dashboard will load automatically

---

## 📋 API Endpoints

All endpoints require `COMPLIANCE_ADMIN` role via headers:
- `x-user-role: COMPLIANCE_ADMIN`
- `x-user-id: <user-id>`
- `x-user-email: <email>`

### Dashboard
```http
GET /api/compliance-admin/dashboard?tenantId={uuid}
```

### Override Approval
```http
GET  /api/compliance-admin/overrides/pending
GET  /api/compliance-admin/overrides/history?tenantId={uuid}
POST /api/compliance-admin/overrides/{requestId}/approve
     Body: { "approvalReason": "..." }
POST /api/compliance-admin/overrides/{requestId}/reject
     Body: { "rejectionReason": "..." }
```

### High-Risk Actions
```http
GET /api/compliance-admin/high-risk-actions?tenantId={uuid}&fromDate={date}&toDate={date}
```

### Control Breaches
```http
GET /api/compliance-admin/control-breaches?tenantId={uuid}&fromDate={date}&toDate={date}
```

### Audit Support
```http
GET /api/compliance-admin/audit-support?tenantId={uuid}&actionType={type}&fromDate={date}&toDate={date}
```

---

## 🧪 Testing

### Automated Tests

Run the test suite:
```bash
# Make sure server is running first
npm start

# In another terminal:
node test-compliance-admin-portal.js
```

### Manual Testing Checklist

**Test 1: Access Control**
- [ ] COMPLIANCE_ADMIN can access portal
- [ ] FINANCE_ADMIN cannot access portal (403 forbidden)
- [ ] MERCHANT cannot access portal (403 forbidden)
- [ ] AUDITOR cannot access portal (403 forbidden)

**Test 2: Override Approval Flow**
1. Login as FINANCE_ADMIN at `/finance-admin-console.html`
2. Navigate to "Override Approvals" tab
3. Click "Request Override"
4. Fill justification and submit
5. Logout and login as COMPLIANCE_ADMIN
6. Navigate to "Override Approvals" tab
7. See pending request
8. [ ] Click "Approve" and provide reason → Success
9. OR [ ] Click "Reject" and provide reason → Blocked

**Test 3: Self-Approval Prevention**
- [ ] Attempt to approve your own request → Must fail with error

**Test 4: Override Request Prevention**
- [ ] COMPLIANCE_ADMIN should NOT see "Request Override" button
- [ ] API should reject override request from COMPLIANCE_ADMIN

**Test 5: Audit Logging**
- [ ] All approval actions logged in `audit_logs` table
- [ ] All rejection actions logged in `audit_logs` table
- [ ] Timestamps, user ID, and IP address captured

**Test 6: High-Risk Actions**
- [ ] View accounting period closures
- [ ] View ledger locks
- [ ] View settlement retries
- [ ] View emergency overrides
- [ ] No edit/delete actions available

**Test 7: Control Breaches**
- [ ] View blocked actions from audit logs
- [ ] View failed override attempts
- [ ] Data is read-only

**Test 8: Audit Support**
- [ ] Complete audit trail visible
- [ ] Filter by date range works
- [ ] Filter by action type works
- [ ] Data is read-only

---

## ✅ Success Criteria (RBI Audit Lens)

An RBI auditor must be able to say:

1. ✅ **Overrides require independent approval**
   - Finance Admin requests, Compliance Admin approves
   - Enforced by separate API routes and role checks

2. ✅ **Compliance cannot execute money movement**
   - No ledger editing endpoints available
   - No settlement confirmation capability
   - No reconciliation actions allowed

3. ✅ **Finance cannot approve its own exceptions**
   - Self-approval check in approval API
   - Requestor ID compared with approver ID
   - Returns 403 Forbidden if same user

4. ✅ **Every exception is justified and logged**
   - Override requests require justification (mandatory field)
   - Approvals require approval reason (mandatory field)
   - All actions logged in `admin_overrides_log` table
   - All access logged in `audit_logs` table

---

## 🔍 Monitoring & Alerts

**Recommended Monitoring:**
- Alert on high volume of override requests (potential control weakness)
- Alert on high rejection rate (potential training issue)
- Alert on zero approvals for extended period (compliance inactivity)
- Alert on after-hours access (potential unauthorized activity)
- Alert on multiple failed login attempts

**Audit Queries:**
```sql
-- All compliance actions in last 30 days
SELECT * FROM audit_logs 
WHERE user_role = 'COMPLIANCE_ADMIN' 
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

-- Override approval rate
SELECT 
  COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
  COUNT(*) as total_requests
FROM approval_requests
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Self-approval attempts (should be zero)
SELECT * FROM approval_requests
WHERE requestor_id = approver_id;
```

---

## 📚 Related Documentation

- [Finance Admin Dashboard](features/FINANCE_ADMIN_README.md)
- [Audit Portal](features/AUDIT_PORTAL_README.md)
- [Platform Ops Console](features/PLATFORM_OPS_CONSOLE_README.md)
- [RBI Audit Readiness](RBI_AUDIT_READINESS_README.md)

---

## 🆘 Troubleshooting

**Issue: Cannot access portal (403 Forbidden)**
- Verify user has `COMPLIANCE_ADMIN` role in `platform_users` table
- Check browser localStorage for `userRole` value
- Clear browser cache and re-login

**Issue: Cannot see override requests**
- Verify Finance Admin has created requests
- Check `approval_requests` table for pending requests
- Verify tenant ID is correct

**Issue: Approval/Rejection fails**
- Ensure approval/rejection reason is provided
- Check for self-approval attempt
- Verify request is in 'pending' status

**Issue: No data in high-risk actions**
- Check date range filters
- Verify tenant ID has activity in selected period
- Confirm accounting periods exist for tenant

---

## 📞 Support

For issues or questions:
1. Check audit logs: `SELECT * FROM audit_logs WHERE action_category = 'COMPLIANCE_ADMIN'`
2. Review API error responses for specific error messages
3. Check browser console for JavaScript errors
4. Verify database connectivity and table existence

---

**Version:** 1.0.0  
**Last Updated:** 2024  
**Compliance:** RBI Payment Aggregator Guidelines
