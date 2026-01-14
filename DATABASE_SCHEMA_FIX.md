# Database Schema Fix - Compliance Admin Portal

## Problem Summary

When using the Compliance Admin Portal to select a merchant, two database errors occurred:

### Error 1: Missing columns in `audit_logs` table
```
Error: column "action_category" of relation "audit_logs" does not exist
```

The `audit_logs` table was missing several columns that the compliance admin portal code was trying to insert:
- `action_category`
- `action_type`
- `resource_type`
- `resource_id`
- `user_role`
- `details`

### Error 2: Incorrect column names in `ledger_locks` query
```
Error: column "is_active" does not exist
```

The compliance admin dashboard was querying the `ledger_locks` table using incorrect column names:
- Used `is_active` instead of `lock_status`
- Used `applied_at` instead of `locked_at`

## Solution

### 1. Database Migration (20240110000000_fix_audit_logs_schema.js)

Created a new migration to add the missing columns to the `audit_logs` table:

**Added Columns:**
- `action_category` (VARCHAR 100) - Category of action (e.g., 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN')
- `action_type` (VARCHAR 100) - Specific action type (e.g., 'VIEW_DASHBOARD', 'APPROVE_OVERRIDE')
- `resource_type` (VARCHAR 100) - Type of resource being acted upon (e.g., 'approval_workflow')
- `resource_id` (UUID) - ID of the specific resource
- `user_role` (VARCHAR 50) - Role of the user performing the action
- `details` (JSONB) - Additional details about the action

**Added Indexes:**
- `(action_category, action_type)` - For filtering by action category and type
- `(resource_type, resource_id)` - For finding actions on specific resources
- `(user_role, created_at)` - For auditing actions by role over time

### 2. Code Fix (compliance-admin-routes.js)

Fixed the SQL query in the dashboard endpoint to use correct column names:

**Before:**
```sql
WHERE tenant_id = ? AND is_active = true AND applied_at >= ?
```

**After:**
```sql
WHERE tenant_id = ? AND lock_status = 'ACTIVE' AND locked_at >= ?
```

## How to Apply the Fix

### Step 1: Run the Migration

```bash
# Navigate to the project directory
cd /path/to/PG

# Run the migration
npm run migrate:latest
```

This will apply migration `20240110000000_fix_audit_logs_schema.js` which adds the missing columns to the `audit_logs` table.

### Step 2: Restart the Application

```bash
# Stop the current server (Ctrl+C)
# Then restart
npm start
```

### Step 3: Verify the Fix

1. Access the Compliance Admin Portal:
   ```
   http://localhost:3000/compliance-admin-portal.html
   ```

2. Log in with COMPLIANCE_ADMIN credentials

3. Select a merchant from the dropdown

4. Verify that:
   - The dashboard loads without errors
   - High-risk actions are displayed correctly
   - No database errors appear in the server logs

## Testing

Run the compliance admin portal test suite:

```bash
# Start the server first
npm start

# In another terminal, run the test
node tests/compliance-admin-portal.test.js
```

## Files Changed

1. **New Migration:** `src/database/migrations/20240110000000_fix_audit_logs_schema.js`
   - Adds missing columns to `audit_logs` table
   - Adds indexes for performance

2. **Updated Code:** `src/api/compliance-admin-routes.js`
   - Line 153: Fixed ledger_locks query to use `lock_status = 'ACTIVE'` instead of `is_active = true`
   - Line 153: Fixed ledger_locks query to use `locked_at` instead of `applied_at`

## Database Schema Changes

### audit_logs Table - BEFORE
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  user_id VARCHAR(100),
  user_email VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  changes_before JSONB,
  changes_after JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### audit_logs Table - AFTER
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  user_id VARCHAR(100),
  user_email VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  changes_before JSONB,
  changes_after JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  -- NEW COLUMNS ADDED:
  action_category VARCHAR(100),
  action_type VARCHAR(100),
  resource_type VARCHAR(100),
  resource_id UUID,
  user_role VARCHAR(50),
  details JSONB
);
```

## Rollback (if needed)

If you need to rollback this migration:

```bash
npm run migrate:rollback
```

This will remove the added columns and indexes from the `audit_logs` table.

## Related Files

- Migration: `src/database/migrations/20240110000000_fix_audit_logs_schema.js`
- API Routes: `src/api/compliance-admin-routes.js`
- Test Suite: `tests/compliance-admin-portal.test.js`
- Documentation: `COMPLIANCE_ADMIN_PORTAL_README.md`

## Notes

- This fix maintains backward compatibility with existing `audit_logs` entries
- The new columns are nullable, so existing rows won't be affected
- The indexes improve query performance for compliance admin operations
- All changes follow the existing code style and conventions
