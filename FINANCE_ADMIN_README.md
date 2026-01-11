# Finance Admin Dashboard

> **⚠️ INTERNAL USE ONLY – RBI REGULATED PLATFORM**

A comprehensive, RBI-compliant Finance Admin Dashboard for Payment Aggregator platforms. This dashboard provides complete financial control, audit safety, and regulatory compliance.

---

## 🎯 Quick Start

### 1. Access the Dashboard

**URL:** `http://localhost:3000/finance-admin-console.html`

### 2. Create Finance Admin User

```bash
# Method 1: Using SQL
psql -d payment_gateway -U postgres

INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES (
  'finance_admin',
  'finance@yourdomain.com',
  -- Generate hash: node generate-password-hash.js YourPassword123!
  '$2b$10$YOUR_BCRYPT_HASH_HERE',
  'FINANCE_ADMIN',
  'active'
);

# Method 2: Using Node.js
node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('YourPassword123!', 10).then(hash => console.log(hash));
"
# Copy the hash and use in INSERT statement above
```

### 3. Login

1. Navigate to: `http://localhost:3000/platform-login.html`
2. Enter credentials (finance_admin / your password)
3. Access Finance Admin Console

---

## 📊 What You Get

### 8 Comprehensive Modules

1. **📊 Dashboard** - Real-time overview of financial operations
2. **📅 Accounting Periods** - Control financial close discipline
3. **💰 Settlements** - Track settlement lifecycle for finality
4. **🔒 Ledger Locks** - Enforce read-only mode during audits
5. **✋ Override Approvals** - Dual-confirmation workflow (CRITICAL)
6. **🔄 Reconciliation** - Identify discrepancies without mutation
7. **📖 Ledger Explorer** - View-only ledger access (READ-ONLY)
8. **📈 Financial Reports** - Regulator-friendly reporting

---

## 🔐 Security Features

### Role-Based Access
- ✅ `FINANCE_ADMIN`: Requests overrides, manages periods, applies locks
- ✅ `COMPLIANCE_ADMIN`: Approves override requests (cannot request)
- ❌ No `PLATFORM_ADMIN` or `OPS_ADMIN` access

### Dual-Confirmation Workflow
```
Finance Admin → Request Override (with justification)
                      ↓
              Pending Approval
                      ↓
Compliance Admin → Approve/Reject (with reason)
                      ↓
              Logged in audit trail
```

**Self-approval is FORBIDDEN** - enforced at API level

### Audit Logging
- Every action logged with user, timestamp, and reason
- Complete audit trail for RBI compliance
- Justification required for all overrides

---

## 🚫 What You CANNOT Do

The following actions are **blocked by design**:

- ❌ Edit ledger entries directly
- ❌ Delete transactions
- ❌ Reopen HARD_CLOSED periods
- ❌ Skip settlement state transitions
- ❌ Self-approve overrides
- ❌ Bypass dual-confirmation

These restrictions ensure **RBI compliance** and **audit safety**.

---

## 📚 Available Features by Role

### FINANCE_ADMIN Can:
- ✅ View dashboard
- ✅ Manage accounting periods
- ✅ View/transition settlements
- ✅ Apply/release ledger locks
- ✅ **Request** admin overrides
- ✅ Create reconciliation batches
- ✅ View ledger (read-only)
- ✅ Generate financial reports

### COMPLIANCE_ADMIN Can:
- ✅ View dashboard
- ✅ View accounting periods (cannot modify)
- ✅ View settlements (cannot modify)
- ✅ **Approve** admin overrides
- ✅ **Reject** admin overrides
- ✅ View ledger (read-only)
- ✅ Generate financial reports

### Both CANNOT:
- ❌ Edit ledger entries
- ❌ Delete transactions
- ❌ Reopen HARD_CLOSED periods
- ❌ Self-approve overrides

---

## 📖 Documentation

### Getting Started
1. **FINANCE_ADMIN_SETUP_GUIDE.md** - User creation and login procedures
2. **FINANCE_ADMIN_TEST_CHECKLIST.md** - Manual test suite (90+ tests)
3. **FINANCE_ADMIN_IMPLEMENTATION_SUMMARY.md** - Technical details

### Quick Links
- **Setup:** See `FINANCE_ADMIN_SETUP_GUIDE.md`
- **Testing:** See `FINANCE_ADMIN_TEST_CHECKLIST.md`
- **Architecture:** See `FINANCE_ADMIN_IMPLEMENTATION_SUMMARY.md`

---

## 🎓 Common Tasks

### Task 1: Close Accounting Period

1. Navigate to "Accounting Periods" tab
2. Click "Close" on open period
3. Select "Soft Close" or "Hard Close"
4. Enter closure notes
5. Confirm

**⚠️ Warning:** HARD_CLOSE is **irreversible**!

### Task 2: Request Override (Finance Admin)

1. Navigate to "Override Approvals" tab
2. Click "Request Override"
3. Select override type
4. Enter detailed justification
5. Submit request

**Note:** Another user (Compliance Admin) must approve.

### Task 3: Approve Override (Compliance Admin)

1. Navigate to "Override Approvals" tab
2. Find pending request
3. Review justification
4. Click "Approve" and enter approval reason
5. Confirm

**⚠️ Critical:** Cannot approve your own request.

### Task 4: View Ledger (Read-Only)

1. Navigate to "Ledger Explorer" tab
2. Select date range
3. Select event type (optional)
4. Click "Search"
5. Export to CSV if needed

**Note:** No edit/delete buttons - strictly read-only.

### Task 5: Generate Financial Report

1. Navigate to "Reports" tab
2. Select report type:
   - Daily Escrow Balance
   - Merchant Payables
   - Platform Revenue
   - Settlement Aging
3. Click "Generate Report"
4. View results

---

## 🧪 Testing Your Setup

### Test 1: Access Control

```bash
# Should succeed (FINANCE_ADMIN)
curl -X GET http://localhost:3000/api/finance-admin/dashboard?tenantId=default \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: YOUR_USER_ID"

# Should fail (OPS_ADMIN)
curl -X GET http://localhost:3000/api/finance-admin/dashboard?tenantId=default \
  -H "x-user-role: OPS_ADMIN" \
  -H "x-user-id: YOUR_USER_ID"
# Expected: 403 Forbidden
```

### Test 2: Self-Approval Prevention

1. Login as FINANCE_ADMIN
2. Request an override
3. Try to approve your own request
4. **Expected:** Error: "Self-approval is forbidden"

---

## 🔍 Troubleshooting

### Problem: "Access denied"

**Solution:**
1. Check localStorage:
   ```javascript
   console.log(localStorage.getItem('userRole'));
   console.log(localStorage.getItem('userId'));
   ```
2. Login via `/platform-login.html` first
3. Ensure role is `FINANCE_ADMIN` or `COMPLIANCE_ADMIN`

### Problem: Cannot approve override

**Solution:**
- Check if you're the requestor (self-approval is forbidden)
- Ensure you have `COMPLIANCE_ADMIN` role
- Different user must approve

### Problem: Ledger shows no data

**Solution:**
- Ensure date range is correct
- Check that ledger entries exist in database
- Verify tenantId is correct

---

## 🎯 RBI Compliance

### Auditor Questions - All Answerable from UI

1. **Who closed this accounting period?**
   → Check "Accounting Periods" tab, "Closed By" column

2. **Were any entries posted after close?**
   → Check "Override History" for SOFT_CLOSED periods

3. **Who approved this override?**
   → Check "Override Approvals" → "History", "Approved By" column

4. **When was the ledger locked?**
   → Check "Ledger Locks" → "History", "Locked At" column

5. **Are settlements bank-confirmed?**
   → Check "Settlements" tab, "UTR" column

6. **Is the ledger immutable?**
   → Check "Ledger Explorer" - no edit/delete buttons, read-only badge

---

## 🚀 Production Deployment Checklist

Before deploying to production:

- [ ] Create Finance Admin user
- [ ] Create Compliance Admin user (different person)
- [ ] Test dual-approval workflow
- [ ] Verify self-approval prevention
- [ ] Verify ledger immutability
- [ ] Enable SSL/TLS (HTTPS)
- [ ] Configure rate limiting
- [ ] Set up audit log monitoring
- [ ] IP whitelist finance console
- [ ] Enable 2FA (recommended)
- [ ] Test all 8 modules
- [ ] Run manual test checklist

---

## 📞 Support

### Documentation
- **Setup:** `FINANCE_ADMIN_SETUP_GUIDE.md`
- **Testing:** `FINANCE_ADMIN_TEST_CHECKLIST.md`
- **Technical:** `FINANCE_ADMIN_IMPLEMENTATION_SUMMARY.md`

### Logs
```bash
# Check application logs
npm start

# Check database health
curl http://localhost:3000/health

# Check audit logs
psql -d payment_gateway -c "SELECT * FROM admin_overrides_log ORDER BY created_at DESC LIMIT 10;"
```

---

## 🔒 Security Best Practices

1. **Use Strong Passwords**
   - Minimum 12 characters
   - Mixed case, numbers, symbols

2. **Separate Accounts**
   - Never use same person for Finance and Compliance roles
   - Different email addresses
   - Different passwords

3. **Regular Reviews**
   - Audit override logs weekly
   - Review lock history monthly
   - Check settlement aging regularly

4. **Document Everything**
   - Always provide detailed justifications
   - Include business reason in override requests
   - Keep approval reasons clear

5. **Limit Access**
   - Only create Finance Admin accounts when necessary
   - Disable accounts when user leaves
   - Review user list quarterly

---

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Finance Admin Console UI                 │
│              (finance-admin-console.html)                │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────────┐
│              Finance Admin API Routes                    │
│            (/api/finance-admin/*)                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ • Dashboard API                                   │  │
│  │ • Override Workflow (Dual-Confirmation)          │  │
│  │ • Ledger Explorer (Read-Only)                    │  │
│  │ • Reconciliation APIs                            │  │
│  │ • Financial Reports                              │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────────┐
│              Existing Backend Services                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ • Accounting Period Service                      │  │
│  │ • Settlement Service                             │  │
│  │ • Ledger Lock Service                            │  │
│  │ • Ledger Service                                 │  │
│  │ • Reconciliation Service                         │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ • ledger_transactions                            │  │
│  │ • ledger_entries (immutable)                     │  │
│  │ • accounting_periods                             │  │
│  │ • settlements                                    │  │
│  │ • ledger_locks                                   │  │
│  │ • admin_overrides_log                            │  │
│  │ • approval_requests                              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ Success Criteria

Your Finance Admin Dashboard is working correctly if:

- ✅ RBI auditors can answer all 6 questions from UI
- ✅ No verbal explanation needed
- ✅ Complete audit trail visible
- ✅ Ledger is strictly read-only
- ✅ Dual-confirmation enforced
- ✅ Self-approval prevention works

---

## 🎉 You're Ready!

The Finance Admin Dashboard is **production-ready**. Follow the setup guide, create your users, and start using the dashboard.

**Need help?** Check the documentation files listed above.

---

**Version:** 1.0.0  
**Last Updated:** 2026-01-11  
**Status:** ✅ PRODUCTION READY
