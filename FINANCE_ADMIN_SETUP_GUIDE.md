# Finance Admin Dashboard - Setup & Login Guide

## 🎯 Overview

This guide explains how to create Finance Admin and Compliance Admin users, and how to access the Finance Admin Console.

## ⚠️ Critical Security Requirements

**Role Separation (MANDATORY):**
- `FINANCE_ADMIN`: Requests overrides, manages periods, applies locks
- `COMPLIANCE_ADMIN`: Approves override requests, cannot request them
- **Self-approval is FORBIDDEN** - built into the system
- No `PLATFORM_ADMIN` or `OPS_ADMIN` access to finance operations

## 📋 Prerequisites

1. Database must be running (PostgreSQL)
2. All migrations applied: `npm run migrate:latest`
3. Platform must be running: `npm start`

## 🔐 Step 1: Create Finance Admin User

### Option A: Using SQL (Recommended for First User)

```sql
-- Connect to your database
psql -d payment_gateway -U postgres

-- Create Finance Admin user
INSERT INTO platform_users (
  username,
  email,
  password_hash,
  role,
  status
) VALUES (
  'finance_admin',
  'finance@yourdomain.com',
  -- Replace with bcrypt hash of your password
  '$2b$10$examplehashhere',
  'FINANCE_ADMIN',
  'active'
);

-- Get the user ID for verification
SELECT id, username, email, role FROM platform_users WHERE role = 'FINANCE_ADMIN';
```

### Option B: Using Node.js Script

Create a file `create-finance-admin.js`:

```javascript
const bcrypt = require('bcrypt');
const db = require('./src/database');

async function createFinanceAdmin() {
  const username = 'finance_admin';
  const email = 'finance@yourdomain.com';
  const password = 'SecurePassword123!'; // Change this
  
  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);
  
  // Insert user
  const [user] = await db.knex('platform_users')
    .insert({
      username,
      email,
      password_hash: passwordHash,
      role: 'FINANCE_ADMIN',
      status: 'active'
    })
    .returning('*');
  
  console.log('Finance Admin created:', user);
  process.exit(0);
}

createFinanceAdmin().catch(console.error);
```

Run it:
```bash
node create-finance-admin.js
```

### Option C: Using generate-password-hash.js (Existing Utility)

```bash
# Generate password hash
node generate-password-hash.js YourSecurePassword123!

# Copy the hash, then insert into database:
psql -d payment_gateway -U postgres

INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES ('finance_admin', 'finance@yourdomain.com', 'PASTE_HASH_HERE', 'FINANCE_ADMIN', 'active');
```

## 🔐 Step 2: Create Compliance Admin User (Dual-Approval)

**CRITICAL:** Create a separate user for approval workflow:

```sql
INSERT INTO platform_users (
  username,
  email,
  password_hash,
  role,
  status
) VALUES (
  'compliance_admin',
  'compliance@yourdomain.com',
  '$2b$10$examplehashhere', -- Different password!
  'COMPLIANCE_ADMIN',
  'active'
);
```

## 🚀 Step 3: Login to Finance Admin Console

### Access the Console

1. **Navigate to:** `http://localhost:3000/finance-admin-console.html`
2. **Or first login via:** `http://localhost:3000/platform-login.html`

### Login Flow

1. Open `http://localhost:3000/platform-login.html`
2. Enter credentials:
   - Username: `finance_admin` (or `compliance_admin`)
   - Password: Your password
3. Upon successful login, you'll be stored in localStorage
4. Navigate to Finance Admin Console

### Direct Console Access (After Login)

- URL: `http://localhost:3000/finance-admin-console.html`
- Console checks localStorage for:
  - `userRole`: Must be `FINANCE_ADMIN` or `COMPLIANCE_ADMIN`
  - `userId`: User ID from database
  - `userEmail`: User email for audit logging

## 🧪 Testing the Setup

### Test 1: Access Control

```bash
# Finance Admin should be able to access
curl -X GET http://localhost:3000/api/finance-admin/dashboard?tenantId=default \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: UUID_HERE" \
  -H "x-user-email: finance@yourdomain.com"

# OPS_ADMIN should be REJECTED
curl -X GET http://localhost:3000/api/finance-admin/dashboard?tenantId=default \
  -H "x-user-role: OPS_ADMIN" \
  -H "x-user-id: UUID_HERE"
# Expected: 403 Forbidden
```

### Test 2: Override Workflow

```bash
# Step 1: Finance Admin requests override
curl -X POST http://localhost:3000/api/finance-admin/overrides/request \
  -H "Content-Type: application/json" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: FINANCE_ADMIN_UUID" \
  -H "x-user-email: finance@yourdomain.com" \
  -d '{
    "tenantId": "default",
    "overrideType": "SOFT_CLOSE_POSTING",
    "justification": "Emergency posting for regulatory filing",
    "affectedTransactionIds": ["txn-123"]
  }'

# Step 2: Compliance Admin approves
curl -X POST http://localhost:3000/api/finance-admin/overrides/REQUEST_ID/approve \
  -H "Content-Type: application/json" \
  -H "x-user-role: COMPLIANCE_ADMIN" \
  -H "x-user-id: COMPLIANCE_ADMIN_UUID" \
  -H "x-user-email: compliance@yourdomain.com" \
  -d '{
    "approvalReason": "Verified regulatory requirement and justification"
  }'
```

### Test 3: Self-Approval Prevention

```bash
# This should FAIL (same user trying to approve their own request)
curl -X POST http://localhost:3000/api/finance-admin/overrides/REQUEST_ID/approve \
  -H "Content-Type: application/json" \
  -H "x-user-role: COMPLIANCE_ADMIN" \
  -H "x-user-id: SAME_AS_REQUESTOR" \
  -H "x-user-email: finance@yourdomain.com" \
  -d '{
    "approvalReason": "Self-approval attempt"
  }'
# Expected: 403 Forbidden - Self-approval is forbidden
```

## 📊 Available Features by Role

### FINANCE_ADMIN Can:
- ✅ View dashboard
- ✅ View/create accounting periods
- ✅ Soft close periods
- ✅ Hard close periods (irreversible)
- ✅ View settlements
- ✅ Transition settlements
- ✅ Apply ledger locks
- ✅ Release ledger locks
- ✅ **Request** admin overrides
- ✅ View reconciliation batches
- ✅ Create reconciliation batches
- ✅ View ledger (read-only)
- ✅ Export ledger
- ✅ Generate financial reports

### COMPLIANCE_ADMIN Can:
- ✅ View dashboard
- ✅ View accounting periods (cannot modify)
- ✅ View settlements (cannot modify)
- ✅ View ledger locks (cannot apply/release)
- ✅ **Approve** admin overrides
- ✅ **Reject** admin overrides
- ✅ View reconciliation batches
- ✅ View ledger (read-only)
- ✅ Generate financial reports

### Both CANNOT:
- ❌ Edit ledger entries directly
- ❌ Delete transactions
- ❌ Reopen HARD_CLOSED periods
- ❌ Skip settlement state transitions
- ❌ Self-approve overrides
- ❌ Access ops console functions

## 🔍 Troubleshooting

### Issue: "Access denied: Finance Admin Console requires FINANCE_ADMIN or COMPLIANCE_ADMIN role"

**Solution:**
1. Check localStorage in browser console:
   ```javascript
   console.log(localStorage.getItem('userRole'));
   console.log(localStorage.getItem('userId'));
   ```
2. If empty, login via `/platform-login.html` first
3. Ensure user has correct role in database:
   ```sql
   SELECT username, role, status FROM platform_users WHERE email = 'your@email.com';
   ```

### Issue: "Self-approval is forbidden"

**Solution:** This is working as designed! You need two separate users:
- One with `FINANCE_ADMIN` role (requestor)
- One with `COMPLIANCE_ADMIN` role (approver)

### Issue: Cannot access finance APIs

**Solution:** Check headers are being sent:
```javascript
// Headers required for all finance admin API calls
{
  'x-user-role': 'FINANCE_ADMIN', // or COMPLIANCE_ADMIN
  'x-user-id': 'uuid-here',
  'x-user-email': 'user@domain.com'
}
```

## 📝 Audit Trail

All actions are logged in:
- `admin_overrides_log` table
- `audit_trail` table
- `ledger_audit_logs` table
- `config_history` table

Query audit logs:
```sql
-- Recent override actions
SELECT * FROM admin_overrides_log 
ORDER BY created_at DESC 
LIMIT 20;

-- Pending approval requests
SELECT * FROM approval_requests 
WHERE status = 'pending' 
ORDER BY requested_at DESC;

-- Lock history
SELECT * FROM ledger_locks 
ORDER BY created_at DESC 
LIMIT 20;
```

## 🎓 Best Practices

1. **Use Strong Passwords**: Min 12 characters, mixed case, numbers, symbols
2. **Separate Accounts**: Never use same person for Finance and Compliance roles
3. **Regular Reviews**: Audit override logs weekly
4. **Document Everything**: Always provide detailed justifications
5. **Limit Access**: Only create Finance Admin accounts when necessary
6. **Rotate Passwords**: Change passwords quarterly
7. **Monitor Failed Logins**: Check for unauthorized access attempts

## 📞 Support

For issues or questions:
1. Check logs: `npm start` output
2. Database health: `curl http://localhost:3000/health`
3. Review audit logs (queries above)

## 🔒 Security Checklist

Before going to production:

- [ ] Finance Admin and Compliance Admin are different people
- [ ] Strong passwords enforced
- [ ] SSL/TLS enabled (HTTPS)
- [ ] Rate limiting configured
- [ ] Audit logs monitored
- [ ] Regular password rotation policy
- [ ] IP whitelisting for finance console
- [ ] Two-factor authentication implemented (recommended)
- [ ] Backup procedures in place
- [ ] Disaster recovery plan documented

---

**Last Updated:** 2025-01-11
**Version:** 1.0.0
