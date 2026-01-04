/**
 * Initial Migration - Create Core Tables
 * Creates: transactions, payment_orders, audit_logs tables
 * Adds multi-tenancy support with tenant_id
 */

exports.up = function(knex) {
  return knex.schema
    // Create transactions table
    .createTable('transactions', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('order_id', 100).notNullable().index();
      table.string('transaction_ref', 100).unique();
      table.string('payment_method', 50).notNullable();
      table.string('gateway', 50).notNullable();
      table.decimal('amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      table.enum('status', ['pending', 'processing', 'success', 'failed', 'refunded']).defaultTo('pending').index();
      table.string('customer_email', 255);
      table.string('customer_phone', 20);
      table.string('customer_name', 255);
      table.jsonb('metadata');
      table.string('gateway_transaction_id', 255);
      table.string('gateway_response_code', 50);
      table.text('gateway_response_message');
      table.timestamp('initiated_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at');
      table.timestamps(true, true);
      
      // Indexes for performance
      table.index(['tenant_id', 'status']);
      table.index(['tenant_id', 'order_id']);
      table.index('gateway_transaction_id');
      table.index('created_at');
    })
    
    // Create payment_orders table
    .createTable('payment_orders', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('order_id', 100).notNullable().unique();
      table.decimal('amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      table.enum('status', ['created', 'pending', 'authorized', 'captured', 'failed', 'cancelled']).defaultTo('created').index();
      table.string('customer_id', 100).index();
      table.string('customer_email', 255);
      table.string('customer_phone', 20);
      table.jsonb('customer_details');
      table.jsonb('billing_address');
      table.jsonb('shipping_address');
      table.jsonb('line_items');
      table.string('payment_method', 50);
      table.string('gateway', 50);
      table.string('gateway_order_id', 255);
      table.string('callback_url', 500);
      table.string('webhook_url', 500);
      table.jsonb('metadata');
      table.timestamp('expires_at');
      table.timestamps(true, true);
      
      // Indexes for performance
      table.index(['tenant_id', 'customer_id']);
      table.index(['tenant_id', 'status']);
      table.index('created_at');
    })
    
    // Create audit_logs table
    .createTable('audit_logs', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('entity_type', 100).notNullable();
      table.uuid('entity_id').notNullable();
      table.enum('action', ['create', 'read', 'update', 'delete', 'login', 'logout', 'payment', 'refund']).notNullable();
      table.string('user_id', 100);
      table.string('user_email', 255);
      table.string('ip_address', 45);
      table.string('user_agent', 500);
      table.jsonb('changes_before');
      table.jsonb('changes_after');
      table.jsonb('metadata');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes for performance
      table.index(['tenant_id', 'entity_type', 'entity_id']);
      table.index(['tenant_id', 'action']);
      table.index('created_at');
    })
    
    // Create merchants table for multi-tenancy
    .createTable('merchants', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('merchant_code', 50).notNullable().unique();
      table.string('merchant_name', 255).notNullable();
      table.string('business_type', 100);
      table.string('email', 255).notNullable();
      table.string('phone', 20);
      table.jsonb('address');
      table.enum('status', ['active', 'inactive', 'suspended']).defaultTo('active').index();
      table.jsonb('settings');
      table.jsonb('api_credentials');
      table.decimal('balance', 15, 2).defaultTo(0);
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_code');
      table.index('status');
    })
    
    // Create beneficiaries table for payout
    .createTable('beneficiaries', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.string('beneficiary_name', 255).notNullable();
      table.string('account_number', 100).notNullable();
      table.string('ifsc_code', 20).notNullable();
      table.string('bank_name', 255);
      table.string('branch_name', 255);
      table.string('email', 255);
      table.string('phone', 20);
      table.enum('status', ['active', 'inactive', 'blocked']).defaultTo('active');
      table.jsonb('metadata');
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant_id', 'status']);
      table.unique(['tenant_id', 'account_number', 'ifsc_code']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('beneficiaries')
    .dropTableIfExists('merchants')
    .dropTableIfExists('audit_logs')
    .dropTableIfExists('payment_orders')
    .dropTableIfExists('transactions');
};
