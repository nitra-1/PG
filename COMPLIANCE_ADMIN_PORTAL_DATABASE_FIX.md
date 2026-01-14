# Compliance Admin Portal Database Fixes

## Problem Statement

When selecting a merchant on the compliance admin portal, two database errors occurred:

### Error 1: audit_logs Constraint Violation
```
Error logging compliance action: error: insert into "audit_logs" ... 
null value in column "entity_type" of relation "audit_logs" violates not-null constraint
```

**Root Cause**: The `logComplianceAction` middleware was not setting the required NOT NULL fields `entity_type`, `entity_id`, and `action` when inserting audit logs.

### Error 2: settlements Column Missing
```
Error fetching compliance dashboard: ... column "updated_at" does not exist
hint: Perhaps you meant to reference the column "settlements.created_at".
```

**Root Cause**: The dashboard and high-risk-actions queries referenced `settlements.updated_at` which doesn't exist in the schema. The settlements table only has `created_at`, `approved_at`, and `completed_at` columns.

## Solution

### Fix 1: audit_logs Insertion
Updated the `logComplianceAction` middleware in `/src/api/compliance-admin-routes.js`:

```javascript
// Added module-level constant
const AUDIT_DUMMY_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

// Updated logComplianceAction to include all required fields
await db.knex('audit_logs').insert({
  tenant_id: req.query.tenantId || req.body.tenantId,
  entity_type: 'compliance_action',           // ✅ Added
  entity_id: entityId,                        // ✅ Added (with fallback to dummy UUID)
  action: 'read',                             // ✅ Added
  user_id: req.complianceUser.userId,
  user_role: req.complianceUser.userRole,
  action_type: action,
  action_category: 'COMPLIANCE_ADMIN',
  resource_type: 'approval_workflow',
  resource_id: req.params.requestId || null,
  details: JSON.stringify({ /* ... */ }),
  ip_address: req.complianceUser.ipAddress,
  user_agent: req.headers['user-agent']
});
```

**Key Points**:
- `entity_type` is now set to `'compliance_action'` for all compliance admin actions
- `entity_id` uses `req.params.requestId` when available, or falls back to a dummy UUID constant
- `action` is set to `'read'` which is a valid enum value in the audit_logs schema

### Fix 2: settlements Query
Changed all references from `settlements.updated_at` to `settlements.created_at`:

**Dashboard Query (Line 165)**:
```javascript
// Before:
WHERE tenant_id = ? AND retry_count > 0 AND updated_at >= ?

// After:
WHERE tenant_id = ? AND retry_count > 0 AND created_at >= ?
```

**High-Risk Actions Query (Line 509)**:
```javascript
// Before:
.whereBetween('updated_at', [from, to])
.orderBy('updated_at', 'desc');

// After:
.whereBetween('created_at', [from, to])
.orderBy('created_at', 'desc');
```

## Database Schema Reference

### audit_logs Table
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,  -- Required field
  entity_id UUID NOT NULL,             -- Required field
  action ENUM NOT NULL,                -- Required field ('create', 'read', 'update', 'delete', ...)
  user_id VARCHAR(100),
  user_role VARCHAR(50),
  action_type VARCHAR(100),
  action_category VARCHAR(100),
  resource_type VARCHAR(100),
  resource_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### settlements Table
```sql
CREATE TABLE settlements (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  merchant_id UUID NOT NULL,
  -- ... other fields ...
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  completed_at TIMESTAMP
  -- NOTE: No updated_at column!
);
```

## Testing

Created comprehensive unit tests in `/tests/compliance-admin-fix.test.js`:

```bash
$ node tests/compliance-admin-fix.test.js

✓ PASS: entity_type field is included in audit_logs insert
✓ PASS: entity_id field is properly handled with fallback UUID
✓ PASS: action field is included in audit_logs insert
✓ PASS: settlements query correctly uses created_at instead of updated_at
✓ PASS: settlementRetries query uses created_at instead of updated_at

Results: 5/5 tests passed ✓
```

## Verification

To verify the fix works:

1. Start the application server
2. Log in with COMPLIANCE_ADMIN role
3. Select a merchant on the compliance admin portal
4. Navigate to the dashboard

**Expected Result**: No database errors should occur, and the dashboard should load successfully with audit logs being properly recorded.

## Security

- ✅ CodeQL scan: 0 alerts
- ✅ No SQL injection vulnerabilities
- ✅ No security issues introduced
- ✅ Proper audit logging maintained

## Files Changed

- `src/api/compliance-admin-routes.js` - Fixed audit logging and settlements queries
- `tests/compliance-admin-fix.test.js` - Added unit tests for validation

## Related Issues

This fix resolves the errors shown in the console:
- PostgreSQL error code `23502`: NOT NULL constraint violation
- PostgreSQL error code `42703`: Column does not exist

## Migration Notes

No database migration required - these are code-only fixes that align with the existing schema.
