/**
 * Fix Audit Logs Schema Migration
 * 
 * This migration adds missing columns to the audit_logs table that are required
 * by the compliance admin portal and other parts of the application.
 * 
 * Added columns:
 * - action_category: Category of the action (e.g., 'COMPLIANCE_ADMIN')
 * - action_type: Specific type of action (e.g., 'VIEW_DASHBOARD')
 * - resource_type: Type of resource being acted upon
 * - resource_id: ID of the resource being acted upon
 * - user_role: Role of the user performing the action
 * - details: Additional details about the action (JSONB)
 */

exports.up = async function(knex) {
  // Check if the table exists
  const tableExists = await knex.schema.hasTable('audit_logs');
  
  if (!tableExists) {
    throw new Error('audit_logs table does not exist. Please run initial migration first.');
  }
  
  // Add missing columns to audit_logs table
  await knex.schema.table('audit_logs', function(table) {
    // Check if columns exist before adding them
    // action_category: Category of action (e.g., 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN')
    table.string('action_category', 100);
    
    // action_type: Specific action type (e.g., 'VIEW_DASHBOARD', 'APPROVE_OVERRIDE')
    table.string('action_type', 100);
    
    // resource_type: Type of resource being acted upon (e.g., 'approval_workflow')
    table.string('resource_type', 100);
    
    // resource_id: ID of the specific resource
    table.uuid('resource_id');
    
    // user_role: Role of the user (e.g., 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN')
    table.string('user_role', 50);
    
    // details: Additional details about the action (stored as JSONB)
    table.jsonb('details');
  });
  
  // Add indexes for the new columns to improve query performance
  await knex.schema.table('audit_logs', function(table) {
    table.index(['action_category', 'action_type']);
    table.index(['resource_type', 'resource_id']);
    table.index(['user_role', 'created_at']);
  });
};

exports.down = async function(knex) {
  return knex.schema.table('audit_logs', function(table) {
    // Drop indexes first
    table.dropIndex(['action_category', 'action_type']);
    table.dropIndex(['resource_type', 'resource_id']);
    table.dropIndex(['user_role', 'created_at']);
    
    // Drop columns
    table.dropColumn('action_category');
    table.dropColumn('action_type');
    table.dropColumn('resource_type');
    table.dropColumn('resource_id');
    table.dropColumn('user_role');
    table.dropColumn('details');
  });
};
