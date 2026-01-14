# Fix for Ambiguous Column Reference Error

## Problem

After making a payment, the application was throwing the following error:

```
Failed to create ledger transaction: error: SELECT * FROM check_accounting_period_for_posting($1, $2) - column reference "period_type" is ambiguous
```

**Error Details:**
- **PostgreSQL Error Code:** 42702
- **Error Message:** "column reference 'period_type' is ambiguous"
- **Detail:** "It could refer to either a PL/pgSQL variable or a table column."

## Root Cause

The `check_accounting_period_for_posting` PostgreSQL function had an ambiguous column reference issue. The function declares `period_type TEXT` in its `RETURNS TABLE` clause, which creates a PL/pgSQL variable in the function's scope. When the function's SQL query referenced `period_type` in the WHERE clause without qualification:

```sql
WHERE period_type = 'DAILY'
```

PostgreSQL couldn't determine if this referred to:
1. The table column `accounting_periods.period_type`, OR
2. The function variable `period_type` from the RETURNS TABLE declaration

## Solution

The fix qualifies all column references in the function with the table alias `ap`:

**Before:**
```sql
SELECT id, status, period_type, period_start, period_end
INTO v_period
FROM accounting_periods
WHERE tenant_id = p_tenant_id
  AND period_type = 'DAILY'
  AND p_transaction_date >= period_start
  AND p_transaction_date <= period_end
```

**After:**
```sql
SELECT ap.id, ap.status, ap.period_type, ap.period_start, ap.period_end
INTO v_period
FROM accounting_periods ap
WHERE ap.tenant_id = p_tenant_id
  AND ap.period_type = 'DAILY'
  AND p_transaction_date >= ap.period_start
  AND p_transaction_date <= ap.period_end
```

## Changes Made

1. **Updated base migration** (`20240105000000_accounting_period_controls.js`):
   - Added table alias `ap` to `FROM accounting_periods`
   - Qualified all column references with `ap.` prefix in SELECT and WHERE clauses

2. **Created new migration** (`20240112000000_fix_accounting_period_function_ambiguous_column.js`):
   - Updates the existing function in databases that already have the old version
   - Uses `CREATE OR REPLACE FUNCTION` to apply the fix
   - Includes both `up` and `down` migrations for rollback capability

## How to Apply the Fix

### For New Installations
Simply run migrations as normal:
```bash
npm run migrate:latest
```

### For Existing Installations
Run the new migration to update the function:
```bash
npm run migrate:latest
```

The migration uses `CREATE OR REPLACE FUNCTION`, which will update the existing function without data loss.

## Verification

After applying the fix, the payment processing should work without the ambiguous column error. The function will correctly:

1. Find the applicable DAILY accounting period for a transaction date
2. Check if posting is allowed based on period status
3. Return appropriate flags for posting_allowed and override_required

## Technical Notes

- This is a minimal fix that only changes the SQL function definition
- No database schema changes are required
- No data migration is needed
- The fix is backward compatible
- All existing functionality remains unchanged
