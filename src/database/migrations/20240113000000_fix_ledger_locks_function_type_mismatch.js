/**
 * Fix Type Mismatch in check_ledger_locks Function
 * 
 * This migration fixes the PostgreSQL error:
 * "Returned type character varying(100) does not match expected type text in column 3"
 * 
 * The issue occurs because the function returns `locked_by` column which is VARCHAR(100),
 * but the function signature declares it as TEXT. The fix adds explicit casting to TEXT.
 */

exports.up = async function(knex) {
  // Drop and recreate the function with explicit type casting
  return knex.raw(`
    CREATE OR REPLACE FUNCTION check_ledger_locks(
      p_tenant_id UUID,
      p_transaction_date TIMESTAMP
    )
    RETURNS TABLE(
      lock_id UUID,
      lock_type TEXT,
      locked_by TEXT,
      reason TEXT,
      is_locked BOOLEAN
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        ll.id as lock_id,
        ll.lock_type::TEXT,
        ll.locked_by::TEXT,
        ll.reason,
        TRUE as is_locked
      FROM ledger_locks ll
      WHERE ll.tenant_id = p_tenant_id
        AND ll.lock_status = 'ACTIVE'
        AND p_transaction_date >= ll.lock_start_date
        AND p_transaction_date <= ll.lock_end_date
      LIMIT 1;
      
      -- If no locks found, return unlocked status
      IF NOT FOUND THEN
        RETURN QUERY SELECT 
          NULL::UUID as lock_id,
          NULL::TEXT as lock_type,
          NULL::TEXT as locked_by,
          NULL::TEXT as reason,
          FALSE as is_locked;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = function(knex) {
  // Rollback to the original version without explicit casting
  // (Note: This would reintroduce the bug, but included for migration completeness)
  return knex.raw(`
    CREATE OR REPLACE FUNCTION check_ledger_locks(
      p_tenant_id UUID,
      p_transaction_date TIMESTAMP
    )
    RETURNS TABLE(
      lock_id UUID,
      lock_type TEXT,
      locked_by TEXT,
      reason TEXT,
      is_locked BOOLEAN
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        ll.id as lock_id,
        ll.lock_type::TEXT,
        ll.locked_by,
        ll.reason,
        TRUE as is_locked
      FROM ledger_locks ll
      WHERE ll.tenant_id = p_tenant_id
        AND ll.lock_status = 'ACTIVE'
        AND p_transaction_date >= ll.lock_start_date
        AND p_transaction_date <= ll.lock_end_date
      LIMIT 1;
      
      -- If no locks found, return unlocked status
      IF NOT FOUND THEN
        RETURN QUERY SELECT 
          NULL::UUID as lock_id,
          NULL::TEXT as lock_type,
          NULL::TEXT as locked_by,
          NULL::TEXT as reason,
          FALSE as is_locked;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
