/**
 * Platform Ops Console Infrastructure Migration
 * Creates tables for platform operations console with strict financial isolation
 * 
 * CRITICAL: This console must NOT have financial authority
 * System configs marked with is_financial=true are BLOCKED from ops console access
 */

exports.up = function(knex) {
  return knex.schema
    // Create platform_users table - Platform user management
    .createTable('platform_users', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('username', 100).notNullable().unique();
      table.string('email', 255).notNullable().unique();
      table.string('password_hash', 255).notNullable();
      table.enum('role', ['PLATFORM_ADMIN', 'OPS_ADMIN', 'FINANCE_ADMIN', 'MERCHANT']).notNullable();
      table.enum('status', ['active', 'disabled', 'pending']).defaultTo('active');
      table.timestamp('last_login_at');
      table.uuid('created_by'); // References platform_users.id but nullable for first user
      table.timestamps(true, true);
      
      // Indexes
      table.index('username');
      table.index('email');
      table.index(['role', 'status']);
    })
    
    // Create system_config table - System configuration management
    .createTable('system_config', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('config_key', 255).notNullable().unique();
      table.jsonb('config_value').notNullable();
      table.string('category', 100).notNullable(); // e.g., 'feature_flags', 'timeouts', 'thresholds'
      // CRITICAL: is_financial flag blocks Ops Console access
      // Financial configs require FINANCE_ADMIN role
      table.boolean('is_financial').defaultTo(false);
      table.integer('version').defaultTo(1); // For rollback support
      table.text('description');
      table.uuid('updated_by').references('id').inTable('platform_users');
      table.timestamps(true, true);
      
      // Indexes
      table.index('config_key');
      table.index('category');
      table.index('is_financial');
    })
    
    // Create config_history table - Configuration change history
    .createTable('config_history', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('config_id').notNullable().references('id').inTable('system_config').onDelete('CASCADE');
      table.string('config_key', 255).notNullable();
      table.jsonb('old_value');
      table.jsonb('new_value');
      table.uuid('changed_by').notNullable().references('id').inTable('platform_users');
      table.text('change_reason');
      table.timestamp('changed_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index('config_id');
      table.index('changed_by');
      table.index('changed_at');
    })
    
    // Create approval_requests table - Dual approval workflow
    .createTable('approval_requests', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('request_type', 100).notNullable(); // e.g., 'role_assignment', 'gateway_override'
      table.uuid('requestor_id').notNullable().references('id').inTable('platform_users');
      table.uuid('approver_id').references('id').inTable('platform_users');
      table.enum('status', ['pending', 'approved', 'rejected', 'cancelled']).defaultTo('pending');
      table.jsonb('request_data').notNullable();
      table.text('approval_reason');
      table.timestamp('requested_at').defaultTo(knex.fn.now());
      table.timestamp('approved_at');
      table.timestamps(true, true);
      
      // Indexes
      table.index('requestor_id');
      table.index('approver_id');
      table.index(['status', 'requested_at']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('approval_requests')
    .dropTableIfExists('config_history')
    .dropTableIfExists('system_config')
    .dropTableIfExists('platform_users');
};
