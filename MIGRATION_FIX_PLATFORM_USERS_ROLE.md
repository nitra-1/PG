# Migration Fix: Platform Users Role Type Not Found

## Issue
Migration `20240109000000_audit_portal_infrastructure.js` was failing with the error:
```
type "platform_users_role" does not exist
```

## Root Cause
The migration assumed that migration `20240107000000_ops_console_infrastructure.js` had already been executed, which creates:
- `platform_users_role` enum type with roles: PLATFORM_ADMIN, OPS_ADMIN, FINANCE_ADMIN, MERCHANT
- `platform_users` table

## Solution
The migration has been updated to be **self-sufficient** and handle cases where dependencies don't exist.

### What Changed

#### Before
```javascript
// Simply tried to add AUDITOR to existing enum
ALTER TYPE platform_users_role ADD VALUE 'AUDITOR';
```

#### After
```javascript
// Check if enum type exists
IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_users_role') THEN
  -- Create the enum with all roles including AUDITOR
  CREATE TYPE platform_users_role AS ENUM ('PLATFORM_ADMIN', 'OPS_ADMIN', 'FINANCE_ADMIN', 'MERCHANT', 'AUDITOR');
ELSE
  -- Add AUDITOR to existing enum if not present
  IF NOT EXISTS (SELECT enumlabel FROM pg_enum WHERE enumlabel = 'AUDITOR') THEN
    ALTER TYPE platform_users_role ADD VALUE 'AUDITOR';
  END IF;
END IF;
```

Additionally, the migration now checks if `platform_users` table exists and creates it if missing.

## Migration Scenarios

### Scenario 1: Fresh Database
- No migrations have been run
- ✅ Migration creates `platform_users_role` enum with all roles including AUDITOR
- ✅ Migration creates `platform_users` table
- ✅ Migration creates audit portal tables

### Scenario 2: Missing Prerequisite Migration
- Migration 20240107 was skipped or failed
- ✅ Migration creates `platform_users_role` enum with all roles including AUDITOR
- ✅ Migration creates `platform_users` table
- ✅ Migration creates audit portal tables

### Scenario 3: Normal Flow
- Migration 20240107 was executed successfully
- ✅ Migration finds existing `platform_users_role` enum
- ✅ Migration adds AUDITOR to the enum
- ✅ Migration creates audit portal tables

### Scenario 4: Re-run Migration
- Migration 20240109 has already been executed
- ✅ Migration is idempotent and doesn't fail
- ✅ No duplicate enum values created

## Testing the Migration

### Manual Test (with PostgreSQL database)
```bash
# Run migrations
npm run migrate:latest

# Verify enum type
psql -d payment_gateway -c "\dT+ platform_users_role"

# Verify tables exist
psql -d payment_gateway -c "\dt platform_users"
psql -d payment_gateway -c "\dt auditor_access_windows"
psql -d payment_gateway -c "\dt compliance_reports_cache"
psql -d payment_gateway -c "\dt audit_portal_access_log"
```

### Rollback
```bash
# Rollback the migration
npm run migrate:rollback

# Note: The enum type is not automatically removed on rollback
# This is by design as it may have existing data
```

## Key Improvements

1. **Idempotent**: Migration can be run multiple times without errors
2. **Self-sufficient**: Doesn't require strict migration order
3. **Backward compatible**: Maintains same structure as original design
4. **Well-documented**: Clear comments explain each step
5. **Error-resistant**: Handles edge cases gracefully

## Migration File Location
`src/database/migrations/20240109000000_audit_portal_infrastructure.js`

## Related Migrations
- `20240107000000_ops_console_infrastructure.js` - Creates platform_users infrastructure
- `20240109000000_audit_portal_infrastructure.js` - Adds audit portal capabilities (FIXED)

## Notes
- The self-referencing foreign key `created_by` in `platform_users` table is intentional
- It's nullable with `onDelete('SET NULL')` to allow bootstrapping the first admin user
- Enum values are kept consistent with migration 20240107 for compatibility
