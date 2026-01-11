# Migration Troubleshooting Guide

## Issue: Constraint Name Length Error in Migration 20240105000000

### Problem Description

When running `npm run migrate:latest`, you may encounter the following error:

```
migration file "20240105000000_accounting_period_controls.js" failed
migration failed with error: alter table "accounting_periods" add constraint 
"accounting_periods_tenant_id_period_type_period_start_period_end_unique" unique (...) 
- relation "accounting_periods_tenant_id_period_type_period_start_period_en" already exists
```

### Root Cause

PostgreSQL has a 63-character limit for identifier names (table names, column names, constraint names, index names). When Knex auto-generates a constraint name that exceeds this limit, PostgreSQL automatically truncates it. The original migration attempted to create a unique constraint with an auto-generated name that was too long, resulting in a truncated name that conflicted with existing database objects.

### Solution

This issue has been fixed in the migration file. The migration now:

1. Uses an explicit, short constraint name (`uq_acct_period_tenant_type_dates`) instead of an auto-generated one
2. Removes redundant index creation that was duplicating the unique constraint
3. Automatically handles upgrade scenarios where the old truncated constraint/index exists

### For Users Experiencing This Error

If you're experiencing this error after pulling the latest changes, you have two options:

#### Option 1: Automatic Fix (Recommended)

The migration has been updated to automatically handle the broken state. Simply run:

```bash
npm run migrate:latest
```

The migration will detect if the table already exists with the old truncated constraint and will:
- Drop the old constraint/index if it exists
- Create the new properly-named constraint

#### Option 2: Manual Rollback (If Option 1 Fails)

If the automatic fix doesn't work, you can manually rollback and re-run:

```bash
# Rollback the failed migration
npm run migrate:rollback

# Re-run migrations
npm run migrate:latest
```

#### Option 3: Manual Database Fix (Last Resort)

If both options above fail, you can manually fix the database:

```sql
-- Connect to your database
psql -U postgres -d payment_gateway

-- Check if the table exists
\d accounting_periods

-- If the old truncated constraint/index exists, drop it
DROP INDEX IF EXISTS accounting_periods_tenant_id_period_type_period_start_period_en;
ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS accounting_periods_tenant_id_period_type_period_start_period_en;

-- If the migration failed and didn't complete, you may need to manually mark it as not run
DELETE FROM knex_migrations WHERE name = '20240105000000_accounting_period_controls.js';

-- Then re-run migrations
-- Exit psql with \q
```

Then run:
```bash
npm run migrate:latest
```

### Prevention

This issue has been prevented in the codebase by:

1. **Always using explicit constraint names** when they might be long
2. **Avoiding redundant indexes** when creating unique constraints (unique constraints automatically create indexes)
3. **Following PostgreSQL naming conventions**: Keep identifier names under 63 characters

### Additional Resources

- [PostgreSQL Naming Conventions](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)
- [Knex.js Migration Guide](https://knexjs.org/guide/migrations.html)
