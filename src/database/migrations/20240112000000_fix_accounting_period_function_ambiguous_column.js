/**
 * Fix Ambiguous Column Reference in check_accounting_period_for_posting Function
 * 
 * This migration fixes the PostgreSQL error:
 * "column reference "period_type" is ambiguous"
 * 
 * The issue occurs because the function declares `period_type` in RETURNS TABLE,
 * which creates a PL/pgSQL variable that conflicts with the table column.
 * The fix qualifies all column references with the table alias.
 */

exports.up = async function(knex) {
  // Drop and recreate the function with qualified column references
  return knex.raw(`
    CREATE OR REPLACE FUNCTION check_accounting_period_for_posting(
      p_tenant_id UUID,
      p_transaction_date TIMESTAMP
    )
    RETURNS TABLE(
      period_id UUID,
      period_status TEXT,
      period_type TEXT,
      posting_allowed BOOLEAN,
      override_required BOOLEAN,
      error_message TEXT
    ) AS $$
    DECLARE
      v_period RECORD;
    BEGIN
      -- Find applicable DAILY period for transaction date
      -- Use table alias (ap) to avoid ambiguity with function variable period_type
      SELECT ap.id, ap.status, ap.period_type, ap.period_start, ap.period_end
      INTO v_period
      FROM accounting_periods ap
      WHERE ap.tenant_id = p_tenant_id
        AND ap.period_type = 'DAILY'
        AND p_transaction_date >= ap.period_start
        AND p_transaction_date <= ap.period_end
      LIMIT 1;
      
      -- If no period found, posting not allowed
      IF v_period.id IS NULL THEN
        RETURN QUERY SELECT 
          NULL::UUID as period_id,
          NULL::TEXT as period_status,
          'DAILY'::TEXT as period_type,
          FALSE as posting_allowed,
          FALSE as override_required,
          'No open accounting period found for transaction date'::TEXT as error_message;
        RETURN;
      END IF;
      
      -- Check period status
      IF v_period.status = 'OPEN' THEN
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          TRUE as posting_allowed,
          FALSE as override_required,
          NULL::TEXT as error_message;
      ELSIF v_period.status = 'SOFT_CLOSED' THEN
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          FALSE as posting_allowed,
          TRUE as override_required,
          'Period is SOFT_CLOSED - admin override required'::TEXT as error_message;
      ELSE -- HARD_CLOSED
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          FALSE as posting_allowed,
          FALSE as override_required,
          'Period is HARD_CLOSED - posting not allowed'::TEXT as error_message;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = function(knex) {
  // Rollback to the original version with unqualified columns
  // (Note: This would reintroduce the bug, but included for migration completeness)
  return knex.raw(`
    CREATE OR REPLACE FUNCTION check_accounting_period_for_posting(
      p_tenant_id UUID,
      p_transaction_date TIMESTAMP
    )
    RETURNS TABLE(
      period_id UUID,
      period_status TEXT,
      period_type TEXT,
      posting_allowed BOOLEAN,
      override_required BOOLEAN,
      error_message TEXT
    ) AS $$
    DECLARE
      v_period RECORD;
    BEGIN
      -- Find applicable DAILY period for transaction date
      SELECT id, status, period_type, period_start, period_end
      INTO v_period
      FROM accounting_periods
      WHERE tenant_id = p_tenant_id
        AND period_type = 'DAILY'
        AND p_transaction_date >= period_start
        AND p_transaction_date <= period_end
      LIMIT 1;
      
      -- If no period found, posting not allowed
      IF v_period.id IS NULL THEN
        RETURN QUERY SELECT 
          NULL::UUID as period_id,
          NULL::TEXT as period_status,
          'DAILY'::TEXT as period_type,
          FALSE as posting_allowed,
          FALSE as override_required,
          'No open accounting period found for transaction date'::TEXT as error_message;
        RETURN;
      END IF;
      
      -- Check period status
      IF v_period.status = 'OPEN' THEN
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          TRUE as posting_allowed,
          FALSE as override_required,
          NULL::TEXT as error_message;
      ELSIF v_period.status = 'SOFT_CLOSED' THEN
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          FALSE as posting_allowed,
          TRUE as override_required,
          'Period is SOFT_CLOSED - admin override required'::TEXT as error_message;
      ELSE -- HARD_CLOSED
        RETURN QUERY SELECT 
          v_period.id,
          v_period.status::TEXT,
          v_period.period_type::TEXT,
          FALSE as posting_allowed,
          FALSE as override_required,
          'Period is HARD_CLOSED - posting not allowed'::TEXT as error_message;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
