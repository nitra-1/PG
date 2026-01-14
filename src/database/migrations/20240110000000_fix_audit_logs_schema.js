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
  
  // Add missing columns to audit_logs table using raw SQL with IF NOT EXISTS
  await knex.raw(`
    DO $$ 
    BEGIN
      -- Add action_category column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'action_category'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN action_category VARCHAR(100);
      END IF;
      
      -- Add action_type column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'action_type'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN action_type VARCHAR(100);
      END IF;
      
      -- Add resource_type column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'resource_type'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN resource_type VARCHAR(100);
      END IF;
      
      -- Add resource_id column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'resource_id'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN resource_id UUID;
      END IF;
      
      -- Add user_role column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'user_role'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN user_role VARCHAR(50);
      END IF;
      
      -- Add details column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'details'
      ) THEN
        ALTER TABLE audit_logs ADD COLUMN details JSONB;
      END IF;
    END $$;
  `);
  
  // Add indexes for the new columns to improve query performance
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS audit_logs_action_category_action_type_idx 
    ON audit_logs (action_category, action_type);
    
    CREATE INDEX IF NOT EXISTS audit_logs_resource_type_resource_id_idx 
    ON audit_logs (resource_type, resource_id);
    
    CREATE INDEX IF NOT EXISTS audit_logs_user_role_created_at_idx 
    ON audit_logs (user_role, created_at);
  `);
};

exports.down = async function(knex) {
  // Drop indexes first (using IF EXISTS to avoid errors)
  await knex.raw(`
    DROP INDEX IF EXISTS audit_logs_action_category_action_type_idx;
    DROP INDEX IF EXISTS audit_logs_resource_type_resource_id_idx;
    DROP INDEX IF EXISTS audit_logs_user_role_created_at_idx;
  `);
  
  // Drop columns
  return knex.schema.table('audit_logs', function(table) {
    table.dropColumn('action_category');
    table.dropColumn('action_type');
    table.dropColumn('resource_type');
    table.dropColumn('resource_id');
    table.dropColumn('user_role');
    table.dropColumn('details');
  });
};
