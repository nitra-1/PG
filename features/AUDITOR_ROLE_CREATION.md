# Auditor Role Creation Guide

## Overview

This guide provides step-by-step instructions for creating and managing AUDITOR roles in the Payment Gateway system. The AUDITOR role is specifically designed for RBI inspectors, bank auditors, statutory auditors, and internal compliance reviewers.

## ⚠️ Important: Role Naming Convention

The AUDITOR role **MUST** be in **FULL UPPERCASE LETTERS**:

✅ **Correct:** `AUDITOR`  
❌ **Incorrect:** `auditor`, `Auditor`, `AuDiToR`

The system performs case-sensitive role validation. Only the uppercase "AUDITOR" will be granted access to the audit portal.

## 🔐 AUDITOR Role Characteristics

### Permissions
- **READ-ONLY** access to audit portal
- Can view:
  - Accounting period history
  - Settlement status and history
  - Admin override logs
  - Ledger lock history
  - Complete audit trail
  - Compliance reports

### Restrictions
- **CANNOT** write, update, or delete any data
- **CANNOT** approve or reject overrides
- **CANNOT** lock or unlock ledgers
- **CANNOT** close accounting periods
- **CANNOT** access finance admin console
- **CANNOT** access ops console
- **CANNOT** access merchant dashboard

### Time-Boxed Access
- Access is granted for a specific audit window
- Access automatically expires after end date
- No access outside granted time window
- Access windows are tracked and logged

## 📝 Creation Methods

### Method 1: Using SQL (Database Direct)

#### Step 1: Generate Password Hash

First, generate a bcrypt hash for the auditor's password:

```bash
node generate-password-hash.js "SecurePassword123!"
```

Or use this quick script:
```javascript
const bcrypt = require('bcrypt');
const password = 'SecurePassword123!';
const hash = bcrypt.hashSync(password, 10);
console.log(hash);
```

#### Step 2: Create Auditor User

```sql
-- Create auditor user
INSERT INTO platform_users (
  id,
  username,
  email,
  password_hash,
  role,
  status,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'rbi_auditor_jane_doe',
  'jane.doe@rbi.gov.in',
  '$2b$10$... your bcrypt hash here ...',
  'AUDITOR',  -- MUST BE UPPERCASE
  'active',
  NOW(),
  NOW()
);
```

#### Step 3: Grant Time-Boxed Access

```sql
-- Grant access window for specific audit
INSERT INTO auditor_access_windows (
  id,
  auditor_user_id,
  access_start_date,
  access_end_date,
  status,
  audit_case_number,
  audit_type,
  audit_purpose,
  granted_by,
  granted_by_role,
  created_at
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM platform_users WHERE username = 'rbi_auditor_jane_doe'),
  '2024-01-15 00:00:00',  -- Audit start date
  '2024-01-30 23:59:59',  -- Audit end date
  'ACTIVE',
  'RBI-AUD-2024-Q4-001',  -- RBI audit case number
  'RBI_INSPECTION',        -- Type of audit
  'Q4 2023 Quarterly RBI Inspection - Payment Aggregator Compliance Verification',
  'compliance_admin_john',
  'COMPLIANCE_ADMIN',
  NOW()
);
```

### Method 2: Using API (Programmatic)

**Note:** This requires a COMPLIANCE_ADMIN or PLATFORM_ADMIN user to execute.

```javascript
// Create auditor user via API
const response = await fetch('http://localhost:3000/api/ops/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Role': 'COMPLIANCE_ADMIN',
    'X-User-Id': 'compliance-admin-id'
  },
  body: JSON.stringify({
    username: 'rbi_auditor_jane_doe',
    email: 'jane.doe@rbi.gov.in',
    password: 'SecurePassword123!',
    role: 'AUDITOR',  // MUST BE UPPERCASE
    status: 'active'
  })
});

// Grant access window
const accessResponse = await fetch('http://localhost:3000/api/ops/auditor-access', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Role': 'COMPLIANCE_ADMIN',
    'X-User-Id': 'compliance-admin-id'
  },
  body: JSON.stringify({
    auditorUserId: 'auditor-uuid-here',
    accessStartDate: '2024-01-15T00:00:00Z',
    accessEndDate: '2024-01-30T23:59:59Z',
    auditCaseNumber: 'RBI-AUD-2024-Q4-001',
    auditType: 'RBI_INSPECTION',
    auditPurpose: 'Q4 2023 Quarterly RBI Inspection'
  })
});
```

### Method 3: Using Knex Migration/Seed

Create a seed file: `src/database/seeds/03_create_auditors.js`

```javascript
exports.seed = async function(knex) {
  const bcrypt = require('bcrypt');
  
  // Hash password
  const passwordHash = await bcrypt.hash('SecurePassword123!', 10);
  
  // Create auditor user
  const [auditorUser] = await knex('platform_users')
    .insert({
      username: 'rbi_auditor_jane_doe',
      email: 'jane.doe@rbi.gov.in',
      password_hash: passwordHash,
      role: 'AUDITOR',  // MUST BE UPPERCASE
      status: 'active'
    })
    .returning('id');
  
  // Grant access window
  await knex('auditor_access_windows').insert({
    auditor_user_id: auditorUser.id,
    access_start_date: new Date('2024-01-15'),
    access_end_date: new Date('2024-01-30'),
    status: 'ACTIVE',
    audit_case_number: 'RBI-AUD-2024-Q4-001',
    audit_type: 'RBI_INSPECTION',
    audit_purpose: 'Q4 2023 Quarterly RBI Inspection',
    granted_by: 'compliance_admin',
    granted_by_role: 'COMPLIANCE_ADMIN'
  });
};
```

Then run:
```bash
npm run seed:run
```

## 📋 Audit Types

When creating an auditor access window, specify the appropriate audit type:

| Audit Type | Description | Typical Duration |
|------------|-------------|------------------|
| `RBI_INSPECTION` | Reserve Bank of India regulatory inspection | 2-4 weeks |
| `BANK_AUDIT` | Sponsor bank audit of aggregator operations | 1-2 weeks |
| `STATUTORY_AUDIT` | Annual statutory audit by CA firm | 2-4 weeks |
| `INTERNAL_AUDIT` | Internal compliance review | 1 week |
| `SPECIAL_AUDIT` | Special purpose investigation | Variable |

## ✅ Verification Steps

After creating an auditor, verify the setup:

### 1. Check User Creation

```sql
SELECT 
  id,
  username,
  email,
  role,
  status,
  created_at
FROM platform_users
WHERE role = 'AUDITOR'
ORDER BY created_at DESC;
```

Expected output:
```
id                                   | username              | email                  | role    | status | created_at
-------------------------------------|-----------------------|------------------------|---------|--------|-------------------
abcd-1234-...                        | rbi_auditor_jane_doe  | jane.doe@rbi.gov.in   | AUDITOR | active | 2024-01-11 ...
```

### 2. Check Access Window

```sql
SELECT 
  id,
  auditor_user_id,
  access_start_date,
  access_end_date,
  status,
  audit_case_number,
  audit_type
FROM auditor_access_windows
WHERE status = 'ACTIVE'
ORDER BY created_at DESC;
```

Expected output:
```
id          | auditor_user_id | access_start_date   | access_end_date     | status | audit_case_number    | audit_type
------------|-----------------|---------------------|---------------------|--------|---------------------|---------------
xyz-5678... | abcd-1234...    | 2024-01-15 00:00:00 | 2024-01-30 23:59:59 | ACTIVE | RBI-AUD-2024-Q4-001 | RBI_INSPECTION
```

### 3. Test Portal Access

```bash
# Test with curl
curl -X GET http://localhost:3000/api/audit-portal/overview?tenantId=tenant-uuid \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: abcd-1234..." \
  -H "X-User-Name: Jane Doe - RBI Inspector"
```

Expected response:
```json
{
  "success": true,
  "overview": {
    "auditor": {
      "name": "Jane Doe - RBI Inspector",
      "auditCaseNumber": "RBI-AUD-2024-Q4-001",
      "auditType": "RBI_INSPECTION",
      "accessStartDate": "2024-01-15T00:00:00.000Z",
      "accessEndDate": "2024-01-30T23:59:59.000Z"
    },
    ...
  }
}
```

### 4. Verify Write Operations Blocked

```bash
# This should return 403
curl -X POST http://localhost:3000/api/audit-portal/accounting-periods \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: abcd-1234..." \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"test","periodType":"DAILY"}'
```

Expected response:
```json
{
  "success": false,
  "error": "Forbidden: Write operations not allowed",
  "message": "Audit portal is READ-ONLY. No mutations are permitted.",
  "method": "POST",
  "note": "This attempt has been logged as a CRITICAL security event"
}
```

## 🔄 Managing Auditor Access

### Extend Access Window

```sql
UPDATE auditor_access_windows
SET 
  access_end_date = '2024-02-15 23:59:59',
  updated_at = NOW()
WHERE id = 'access-window-id';
```

### Revoke Access Early

```sql
UPDATE auditor_access_windows
SET 
  status = 'REVOKED',
  revoked_at = NOW(),
  revocation_reason = 'Audit completed early'
WHERE id = 'access-window-id';
```

### Disable Auditor User

```sql
UPDATE platform_users
SET 
  status = 'disabled',
  updated_at = NOW()
WHERE id = 'auditor-user-id';
```

## 📊 Monitoring Auditor Activity

### View All Auditor Access Logs

```sql
SELECT 
  apal.accessed_at,
  pu.username,
  apal.endpoint,
  apal.http_method,
  apal.http_status_code,
  apal.response_time_ms,
  apal.ip_address
FROM audit_portal_access_log apal
JOIN platform_users pu ON apal.auditor_user_id = pu.id
ORDER BY apal.accessed_at DESC
LIMIT 100;
```

### View Access Summary by Auditor

```sql
SELECT 
  pu.username,
  pu.email,
  COUNT(*) as access_count,
  MIN(apal.accessed_at) as first_access,
  MAX(apal.accessed_at) as last_access
FROM audit_portal_access_log apal
JOIN platform_users pu ON apal.auditor_user_id = pu.id
GROUP BY pu.username, pu.email
ORDER BY access_count DESC;
```

### View Failed Access Attempts

```sql
SELECT 
  pu.username,
  apal.accessed_at,
  apal.endpoint,
  apal.http_status_code,
  apal.ip_address
FROM audit_portal_access_log apal
JOIN platform_users pu ON apal.auditor_user_id = pu.id
WHERE apal.http_status_code >= 400
ORDER BY apal.accessed_at DESC;
```

## 🚨 Security Best Practices

### 1. Password Requirements
- Minimum 12 characters
- Must include uppercase, lowercase, numbers, and symbols
- Must not be a common password
- Should be unique per auditor

### 2. Access Window Sizing
- Grant minimum necessary duration
- Typical RBI audit: 2-4 weeks
- Extend only if audit continues
- Revoke immediately when audit completes

### 3. Principle of Least Privilege
- One auditor user per physical person
- No sharing of credentials
- Deactivate users after audit completion
- Regular review of active auditors

### 4. Audit Trail Review
- Monitor for unusual access patterns
- Review failed access attempts
- Check for off-hours access
- Verify IP address consistency

## 📞 Support

### For Creating Auditors
Contact: Compliance Admin Team
- Email: compliance@paymentgateway.com
- Slack: #compliance-admin

### For Technical Issues
Contact: DevOps Team
- Email: devops@paymentgateway.com
- Slack: #audit-portal-support

### For Audit Access Requests
Contact: Chief Compliance Officer
- Email: cco@paymentgateway.com
- Phone: +91-XXXX-XXXXXX

## 📚 Related Documentation

- [Audit Portal README](./AUDIT_PORTAL_README.md)
- [Manual Test Checklist](./AUDIT_PORTAL_TEST_CHECKLIST.md)
- [Gap Analysis](./AUDIT_PORTAL_GAP_ANALYSIS.md)

---

**Remember:** The AUDITOR role is UPPERCASE only! 🔤
