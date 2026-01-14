/**
 * Add Approval Fields to Admin Overrides Log
 * 
 * This migration adds missing columns to the admin_overrides_log table:
 * - approval_reason: Text field to store the reason for approval/rejection
 * - approved_by_role: String field to store the role of the approver
 * 
 * These fields are required for the dual-approval workflow where
 * COMPLIANCE_ADMIN approves/rejects override requests from FINANCE_ADMIN.
 */

exports.up = async function(knex) {
  // Check if the table exists
  const tableExists = await knex.schema.hasTable('admin_overrides_log');
  
  if (!tableExists) {
    throw new Error('admin_overrides_log table does not exist. Please run migration 20240105000000 first.');
  }
  
  // Add missing columns using raw SQL with IF NOT EXISTS for idempotency
  await knex.raw(`
    DO $$ 
    BEGIN
      -- Add approval_reason column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'admin_overrides_log' AND column_name = 'approval_reason'
      ) THEN
        ALTER TABLE admin_overrides_log ADD COLUMN approval_reason TEXT;
      END IF;
      
      -- Add approved_by_role column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'admin_overrides_log' AND column_name = 'approved_by_role'
      ) THEN
        ALTER TABLE admin_overrides_log ADD COLUMN approved_by_role VARCHAR(50);
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  return knex.schema.table('admin_overrides_log', function(table) {
    table.dropColumn('approval_reason');
    table.dropColumn('approved_by_role');
  });
};
