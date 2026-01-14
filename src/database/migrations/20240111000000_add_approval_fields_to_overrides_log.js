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
  return knex.schema.table('admin_overrides_log', function(table) {
    // Add approval_reason if it doesn't exist
    table.text('approval_reason');
    
    // Add approved_by_role if it doesn't exist
    table.string('approved_by_role', 50);
  });
};

exports.down = async function(knex) {
  return knex.schema.table('admin_overrides_log', function(table) {
    table.dropColumn('approval_reason');
    table.dropColumn('approved_by_role');
  });
};
