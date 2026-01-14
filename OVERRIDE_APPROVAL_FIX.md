# Fix for Override Approval Database Error

## Problem
When approving overrides in the compliance admin portal, users encountered the following error:
```
Error approving override: insert into "admin_overrides_log" ("affected_transaction_ids", ...) - 
column "affected_transaction_ids" of relation "admin_overrides_log" does not exist
```

## Root Causes
1. **Column Name Mismatch**: The database migration created a column named `affected_entities`, but the API code tried to insert into `affected_transaction_ids`
2. **Missing Columns**: The original migration was missing `approval_reason` and `approved_by_role` columns required by the approval workflow
3. **Missing Required Fields**: The API routes were not providing the required `entity_type` field in insert statements

## Solution Applied

### 1. Fixed Column Name References
Updated both API route files to use the correct column name:
- `src/api/compliance-admin-routes.js` (line 414)
- `src/api/finance-admin-routes.js` (line 547)

Changed: `affected_transaction_ids` → `affected_entities`

### 2. Added Missing Database Columns
Created migration `20240111000000_add_approval_fields_to_overrides_log.js` to add:
- `approval_reason` (TEXT) - stores the reason for approval/rejection
- `approved_by_role` (VARCHAR(50)) - stores the role of the approver

The migration uses defensive IF NOT EXISTS/IF EXISTS patterns for idempotency.

### 3. Added Required Fields
Updated insert statements in both API routes to include:
- `entity_type: 'approval_request'`
- `entity_id: requestId`

## How to Apply This Fix

### Step 1: Update Your Code
Pull the latest changes from this branch or manually apply the changes to:
- `src/api/compliance-admin-routes.js`
- `src/api/finance-admin-routes.js`
- `src/database/migrations/20240111000000_add_approval_fields_to_overrides_log.js` (new file)

### Step 2: Run the Migration
Run the new migration to add the missing columns:
```bash
npm run migrate:latest
```

Or using knex CLI:
```bash
npx knex migrate:latest
```

### Step 3: Verify the Migration
Check that the columns were added successfully:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'admin_overrides_log'
ORDER BY ordinal_position;
```

Expected new columns:
- `approval_reason` (text, YES)
- `approved_by_role` (character varying, YES)

### Step 4: Restart Your Application
After running the migration, restart your Node.js application:
```bash
npm start
```

## Testing the Fix

1. Create an override request as a FINANCE_ADMIN user
2. Approve the request as a COMPLIANCE_ADMIN user
3. Verify that:
   - No database errors occur
   - The override is logged in `admin_overrides_log` table
   - All fields are populated correctly including `affected_entities`, `approval_reason`, and `approved_by_role`

## Database Schema Reference

After applying the fix, the `admin_overrides_log` table should have these columns:

```sql
CREATE TABLE admin_overrides_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  override_type VARCHAR(50) NOT NULL,
  justification TEXT NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  affected_entities JSONB,
  override_by VARCHAR(100) NOT NULL,
  override_by_role VARCHAR(50) NOT NULL,
  override_by_email VARCHAR(255),
  approved_by VARCHAR(100),
  approved_at TIMESTAMP,
  approval_reason TEXT,              -- Added by migration 20240111000000
  approved_by_role VARCHAR(50),       -- Added by migration 20240111000000
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);
```

## Rollback (if needed)

If you need to rollback this migration:
```bash
npm run migrate:rollback
```

This will safely remove the `approval_reason` and `approved_by_role` columns using defensive IF EXISTS checks.

## Summary

This fix ensures that:
- ✅ All column names match between code and database
- ✅ All required columns exist in the database
- ✅ All NOT NULL constraints are satisfied in insert statements
- ✅ The migration is safe and idempotent
- ✅ The override approval workflow works correctly
