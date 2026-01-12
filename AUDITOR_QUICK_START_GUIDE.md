# Quick Start Guide for Auditors

## Overview
This guide explains how to access the Audit Portal and generate compliance reports.

## Prerequisites
- You must have the AUDITOR role (case-sensitive, uppercase)
- Your user ID must be registered in the system

## Access Workflow

### Step 1: Login and Browse (No Access Window Required)
When you first access the audit portal, you can browse:

1. **Available Tenants** (`/tenants` endpoint)
   - See list of merchants/tenants in the system
   - Select which tenant you want to audit
   
2. **Available Reports** (`/compliance-reports/available` endpoint)
   - See what compliance reports exist
   - View report descriptions and parameters
   - Understand what data is available

**Note**: These endpoints only show metadata - no sensitive financial data is exposed at this stage.

### Step 2: Request Access Window
To generate actual reports, you need an active access window:

1. Contact your compliance admin team
2. Provide:
   - Your auditor user ID
   - Audit case number
   - Audit type (e.g., RBI_INSPECTION, INTERNAL_AUDIT)
   - Requested access period (start and end dates)
   - Audit purpose

3. Admin will create an access window record:
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
  'your-user-id',
  '2024-01-15 00:00:00',
  '2024-01-30 23:59:59',
  'AUD-2024-001',
  'RBI_INSPECTION',
  'Q4 2023 Audit',
  'compliance-admin-id',
  'COMPLIANCE_ADMIN',
  'ACTIVE'
);
```

### Step 3: Generate Reports (Requires Active Access Window)
Once your access window is active, you can generate reports:

1. **Escrow Balance Report** (`/compliance-reports/escrow-balance`)
   - Daily snapshot of escrow accounts
   - Parameters: `reportDate`

2. **Merchant Outstanding Report** (`/compliance-reports/merchant-outstanding`)
   - Amounts pending settlement per merchant
   - Parameters: `asOfDate`

3. **Platform Revenue Report** (`/compliance-reports/platform-revenue`)
   - Fee collection summary
   - Parameters: `periodStart`, `periodEnd`

4. **Settlement Aging Report** (`/compliance-reports/settlement-aging`)
   - How long settlements have been pending
   - Parameters: `asOfDate`

## Common Errors

### "Access window expired or not granted"
**Cause**: You're trying to generate an actual report without an active access window, or your access window has expired.

**Solution**: 
- Check if you have an active access window
- Verify the current date is between `access_start_date` and `access_end_date`
- Contact compliance admin if you need a new or extended access window

### "Forbidden: AUDITOR role required"
**Cause**: Your user doesn't have the AUDITOR role, or the role is not in uppercase.

**Solution**:
- Verify your user has role='AUDITOR' (uppercase) in platform_users table
- Contact admin to update your role if needed

### "Authentication required"
**Cause**: You're not sending the required authentication headers.

**Solution**:
- Ensure you're sending these headers:
  - `X-User-Role`: AUDITOR
  - `X-User-Id`: your-user-id
  - `X-User-Name`: Your Name (optional)

## Security Features

### Read-Only Access
- You cannot modify any data
- All write operations (POST, PUT, DELETE, PATCH) are blocked
- Attempts to write are logged as CRITICAL security events

### Time-Boxed Access
- Access is limited to the dates specified in your access window
- Access automatically expires after `access_end_date`
- Extensions require admin approval

### Complete Audit Trail
- All your actions are logged
- Logs include: endpoint accessed, timestamp, IP address, query parameters
- Logs are immutable and retained for compliance

### Watermarks
- Every page displays "READ-ONLY / AUDIT MODE"
- Watermark includes your name, audit case number, and timestamp
- Prevents screenshot misuse

## Support

### Technical Issues
- Email: tech-support@paymentgateway.com
- Slack: #audit-portal-support

### Access Requests
- Email: compliance@paymentgateway.com
- Contact: Compliance Admin

## API Reference

### Endpoints That Don't Require Access Window
- `GET /api/audit-portal/tenants` - List available tenants
- `GET /api/audit-portal/compliance-reports/available` - List available report types

### Endpoints That Require Active Access Window
- `GET /api/audit-portal/overview` - Dashboard overview
- `GET /api/audit-portal/accounting-periods` - View accounting periods
- `GET /api/audit-portal/settlements` - View settlements
- `GET /api/audit-portal/admin-overrides` - View admin overrides
- `GET /api/audit-portal/ledger-locks` - View ledger locks
- `GET /api/audit-portal/audit-trail` - View audit trail
- `GET /api/audit-portal/compliance-reports/{reportType}` - Generate specific report

## Example Usage

### 1. Check Available Reports (No Access Window Needed)
```bash
curl -X GET http://localhost:3000/api/audit-portal/compliance-reports/available \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: auditor-001" \
  -H "X-User-Name: John Auditor"
```

### 2. Generate Escrow Balance Report (Requires Access Window)
```bash
curl -X GET "http://localhost:3000/api/audit-portal/compliance-reports/escrow-balance?tenantId=tenant-123&reportDate=2024-01-15" \
  -H "X-User-Role: AUDITOR" \
  -H "X-User-Id: auditor-001" \
  -H "X-User-Name: John Auditor"
```

## Best Practices

1. **Request Access Windows in Advance**: Plan your audit schedule and request access windows ahead of time
2. **Use Specific Date Ranges**: Request only the time period you need for the audit
3. **Document Your Audit Case**: Include clear audit case numbers and purposes
4. **Export Reports Promptly**: Generate and export reports during your access window
5. **Log Out When Done**: Ensure proper session cleanup

## Version History
- **v1.1** (2024-01-12): Added `/compliance-reports/available` to endpoints accessible without access window
- **v1.0** (2024-01-09): Initial audit portal release with `/tenants` endpoint exemption
