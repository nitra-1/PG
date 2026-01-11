# Audit Portal – Read-Only Compliance & Audit Access

## 🎯 Objective

The Audit Portal provides **STRICTLY READ-ONLY** access for RBI inspectors, bank auditors, statutory/external auditors, and internal compliance reviewers to verify compliance without requiring database access, screenshots, or Excel exports.

## 🔐 Key Features

### 1. **Zero Write Capability**
- All write operations (POST, PUT, DELETE, PATCH) are blocked at middleware level
- Returns HTTP 403 for any mutation attempt
- All write attempts are logged as CRITICAL security events

### 2. **Time-Boxed Access**
- Each auditor is granted access for a specific audit window
- Access automatically expires after the end date
- Access windows are tracked in `auditor_access_windows` table
- No access outside the granted time window

### 3. **Mandatory Watermark**
- Every page displays "READ-ONLY / AUDIT MODE" watermark
- Watermark includes auditor name, audit case number, and timestamp
- Prevents screenshot misuse out of context
- Watermark is fixed and appears on all pages

### 4. **Complete Audit Trail**
- All auditor activities are logged in `audit_portal_access_log`
- Includes: endpoint accessed, query parameters, response time, IP address
- Also logged in main `audit_trail` table for comprehensive tracking

### 5. **Role-Based Access Control**
- Only `AUDITOR` role can access audit portal
- Case-sensitive, must be uppercase "AUDITOR"
- No role switching or impersonation allowed
- Separate from FINANCE_ADMIN and OPS_ADMIN roles

## 📊 Available Modules

### 1. **Accounting Period History** (READ-ONLY)
**Endpoint:** `GET /api/audit-portal/accounting-periods`

**Answers:** "When were the books closed, and by whom?"

**Displays:**
- Period start & end dates
- Status (OPEN / SOFT_CLOSED / HARD_CLOSED)
- Closed by (user)
- Closed at (timestamp)
- Closure type and notes

**Restrictions:**
- 🚫 No create
- 🚫 No reopen
- 🚫 No edit

### 2. **Settlement Status Viewer** (READ-ONLY)
**Endpoint:** `GET /api/audit-portal/settlements`

**Answers:** "Was this settlement actually completed at the bank?"

**Displays:**
- Settlement ID and reference
- Merchant name
- Amount (gross, fees, net)
- Current state in state machine
  - CREATED → FUNDS_RESERVED → SENT_TO_BANK → BANK_CONFIRMED → SETTLED
- Bank reference number / UTR
- All state transition timestamps
- Bank confirmation timestamp

**Restrictions:**
- 🚫 No retries
- 🚫 No confirmations
- 🚫 No edits

### 3. **Admin Override Log** (READ-ONLY)
**Endpoint:** `GET /api/audit-portal/admin-overrides`

**Answers:** "Were exceptional overrides used, and were they approved correctly?"

**Displays:**
- Override request ID
- Requested by (Finance Admin)
- Approved by (Compliance Admin)
- Justification
- Affected transaction IDs
- All timestamps

**Restrictions:**
- 🚫 No approval
- 🚫 No rejection
- 🚫 No edits

### 4. **Ledger Lock History** (READ-ONLY)
**Endpoint:** `GET /api/audit-portal/ledger-locks`

**Answers:** "Was the ledger frozen during audit or month close?"

**Displays:**
- Lock type (PERIOD_LOCK / AUDIT_LOCK / RECONCILIATION_LOCK)
- Applied by (user)
- Applied at (timestamp)
- Released at (timestamp)
- Reason for lock

**Restrictions:**
- 🚫 No lock
- 🚫 No unlock

### 5. **Complete Audit Trail** (READ-ONLY)
**Endpoint:** `GET /api/audit-portal/audit-trail`

**Answers:** "Who did what, when, and why?"

**Displays:**
- Entity type
- Action performed
- Before / after snapshot (masked if needed)
- User
- Timestamp
- Source system

**Restrictions:**
- 🚫 No filtering that hides data
- 🚫 No deletion

### 6. **Compliance Reports** (READ-ONLY)
**Endpoints:**
- `GET /api/audit-portal/compliance-reports/escrow-balance`
- `GET /api/audit-portal/compliance-reports/merchant-outstanding`
- `GET /api/audit-portal/compliance-reports/platform-revenue`
- `GET /api/audit-portal/compliance-reports/settlement-aging`

**Reports Available:**

1. **Escrow Balance Report**
   - Daily snapshot of escrow accounts
   - Per RBI guidelines
   - Shows balance as of specific date

2. **Merchant Outstanding Report**
   - Amounts pending settlement per merchant
   - Transaction counts
   - Total outstanding amounts

3. **Platform Revenue Report**
   - Fee collection summary
   - Breakdown by fee type
   - Time-bounded period reporting

4. **Settlement Aging Report**
   - How long settlements have been pending
   - Grouped by age buckets (0-1, 1-3, 3-7, 7+ days)
   - Total pending amounts

**Report Characteristics:**
- ✅ Derived from ledger (single source of truth)
- ✅ Time-bounded and reproducible
- ✅ Cached for performance
- ✅ No Excel manipulation required

## 🔧 Technical Architecture

### Database Schema

#### `auditor_access_windows`
Manages time-boxed access for auditors:
```sql
- id (uuid, primary key)
- auditor_user_id (uuid, references platform_users)
- access_start_date (timestamp)
- access_end_date (timestamp)
- status (ACTIVE / EXPIRED / REVOKED)
- audit_case_number (string)
- audit_type (string)
- audit_purpose (text)
- granted_by (string)
- granted_by_role (string)
```

#### `compliance_reports_cache`
Caches generated compliance reports:
```sql
- id (uuid, primary key)
- tenant_id (uuid)
- report_type (string)
- report_date (timestamp)
- period_start (timestamp, optional)
- period_end (timestamp, optional)
- report_data (jsonb)
- generated_at (timestamp)
- expires_at (timestamp)
- is_final (boolean)
```

#### `audit_portal_access_log`
Tracks all auditor activities:
```sql
- id (uuid, primary key)
- auditor_user_id (uuid, references platform_users)
- endpoint (string)
- http_method (string)
- http_status_code (integer)
- ip_address (string)
- user_agent (string)
- query_parameters (jsonb)
- response_time_ms (integer)
- accessed_at (timestamp)
```

### Middleware Stack

All audit portal routes go through this middleware chain:

1. **`requireAuditorRole`**
   - Validates AUDITOR role
   - Checks time-boxed access window
   - Updates last access timestamp
   - Sets req.auditor context

2. **`enforceReadOnly`**
   - Blocks all non-GET/OPTIONS methods
   - Logs write attempts as CRITICAL events
   - Returns 403 for mutations

3. **`logAuditAccess`**
   - Logs to audit_portal_access_log
   - Logs to main audit_trail
   - Tracks response time and status

4. **`addAuditWatermarkHeaders`**
   - Adds X-Audit-Mode header
   - Adds auditor identification headers
   - Adds access expiry header

5. **`validateTenantAccess`**
   - Validates tenant access (if scoped)
   - Can be configured per audit

### API Routes Structure

```
/api/audit-portal
  GET /overview
  GET /tenants
  
  GET /accounting-periods
  GET /accounting-periods/:id
  
  GET /settlements
  GET /settlements/:id
  
  GET /admin-overrides
  
  GET /ledger-locks
  
  GET /audit-trail
  
  GET /compliance-reports/available
  GET /compliance-reports/escrow-balance
  GET /compliance-reports/merchant-outstanding
  GET /compliance-reports/platform-revenue
  GET /compliance-reports/settlement-aging
```

## 🚀 Setup & Configuration

### 1. Run Database Migration

```bash
npm run migrate:latest
```

This will:
- Add AUDITOR role to platform_users enum
- Create auditor_access_windows table
- Create compliance_reports_cache table
- Create audit_portal_access_log table

### 2. Create Auditor User

See [AUDITOR_ROLE_CREATION.md](./AUDITOR_ROLE_CREATION.md) for detailed instructions.

Quick SQL example:
```sql
INSERT INTO platform_users (
  username, 
  email, 
  password_hash, 
  role, 
  status
) VALUES (
  'rbi_auditor_001',
  'auditor@rbi.gov.in',
  '$2b$10$...',  -- bcrypt hash
  'AUDITOR',
  'active'
);
```

### 3. Grant Time-Boxed Access

```sql
INSERT INTO auditor_access_windows (
  auditor_user_id,
  access_start_date,
  access_end_date,
  audit_case_number,
  audit_type,
  audit_purpose,
  granted_by,
  granted_by_role,
  status
) VALUES (
  '... auditor user id ...',
  '2024-01-15 00:00:00',
  '2024-01-30 23:59:59',
  'RBI-AUD-2024-001',
  'RBI_INSPECTION',
  'Q4 2023 RBI Inspection',
  'compliance_admin_001',
  'COMPLIANCE_ADMIN',
  'ACTIVE'
);
```

### 4. Access the Portal

Navigate to: `http://localhost:3000/audit-portal.html`

Login with AUDITOR credentials (role must be set in headers for API calls).

## 🧪 Testing

### Manual Test Checklist

See [AUDIT_PORTAL_TEST_CHECKLIST.md](./AUDIT_PORTAL_TEST_CHECKLIST.md)

### Security Tests

1. **Test Write Operation Blocking**
   ```bash
   # Should return 403
   curl -X POST http://localhost:3000/api/audit-portal/accounting-periods \
     -H "X-User-Role: AUDITOR" \
     -H "X-User-Id: auditor-001"
   ```

2. **Test Role Enforcement**
   ```bash
   # Should return 403
   curl -X GET http://localhost:3000/api/audit-portal/overview \
     -H "X-User-Role: FINANCE_ADMIN" \
     -H "X-User-Id: finance-001"
   ```

3. **Test Time-Boxed Access**
   - Grant access window ending tomorrow
   - Wait until after expiry
   - Attempt to access portal
   - Should return 403 with "Access window expired" message

## 📋 Compliance Verification

### For Auditors

An auditor must be able to:

✅ **Complete audit without DB access**
- All necessary data is accessible through the portal
- No need to request database exports

✅ **Verify controls without screenshots**
- Portal is self-documenting
- Watermark prevents screenshot misuse

✅ **Trust that data is unaltered and complete**
- Read-only access ensures data integrity
- Complete audit trail shows all access

✅ **Finish audit faster than traditional methods**
- No manual data extraction required
- Reports are pre-generated and cached

### Success Criteria

If an auditor asks for:
- "Can you export this manually?" → **Portal has failed**

If an auditor says:
- "This is exactly what I need" → **Success!**

## 🚫 Strictly Forbidden

The following are NON-NEGOTIABLE violations:

- ❌ Any edit or action button
- ❌ Any ledger mutation
- ❌ Any settlement confirmation
- ❌ Any override approval
- ❌ Any configuration change
- ❌ Any hidden filters that suppress data

If any of these exist → **Implementation is invalid**

## 🔒 Security Considerations

### Access Control
- AUDITOR role is uppercase and case-sensitive
- Time-boxed access windows are strictly enforced
- No role escalation or impersonation possible
- All access is logged and auditable

### Data Protection
- Sensitive data (PCI/PII) is masked if needed
- Gateway responses are redacted in audit logs
- No raw database access provided

### Audit Trail
- Every page view is logged
- Query parameters are captured
- IP address and user agent tracked
- Response times recorded for performance monitoring

## 📞 Support & Troubleshooting

### Common Issues

**Issue:** "Access window expired or not granted"
- **Solution:** Check `auditor_access_windows` table for active window
- Ensure dates are current and status is 'ACTIVE'

**Issue:** "403 Forbidden: AUDITOR role required"
- **Solution:** Verify X-User-Role header is set to 'AUDITOR' (uppercase)
- Check user exists in platform_users with role='AUDITOR'

**Issue:** "Reports not loading"
- **Solution:** Check tenant selection
- Verify data exists for the selected tenant
- Check browser console for API errors

### Contact

For technical support:
- Email: tech-support@paymentgateway.com
- Slack: #audit-portal-support

For audit access requests:
- Email: compliance@paymentgateway.com
- Contact: Compliance Admin

## 📚 Additional Documentation

- [Auditor Role Creation Guide](./AUDITOR_ROLE_CREATION.md)
- [Manual Test Checklist](./AUDIT_PORTAL_TEST_CHECKLIST.md)
- [Gap Analysis](./AUDIT_PORTAL_GAP_ANALYSIS.md)
- [API Documentation](./AUDIT_PORTAL_API_DOCS.md)

## 🔄 Version History

- **v1.0.0** (2024-01-11): Initial release
  - Core read-only access
  - Time-boxed windows
  - Six compliance modules
  - Mandatory watermark
  - Complete audit trail

---

**Built for RBI Compliance | Audit-First Design | Zero Write Capability**
