/**
 * Merchant Onboarding Migration
 * Creates tables for merchant API keys, webhooks, rate limits, IP whitelist, and usage tracking
 */

exports.up = function(knex) {
  return knex.schema
    // Extend merchants table with additional fields
    .alterTable('merchants', function(table) {
      table.string('website_url', 500);
      table.string('callback_url', 500);
      table.string('logo_url', 500);
      table.jsonb('business_details');
      table.boolean('kyc_verified').defaultTo(false);
      table.timestamp('kyc_verified_at');
      table.decimal('daily_limit', 15, 2);
      table.decimal('monthly_limit', 15, 2);
      table.timestamp('last_active_at');
    })
    
    // Create merchant_api_keys table
    .createTable('merchant_api_keys', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.string('key_name', 100).notNullable();
      table.string('api_key', 255).notNullable().unique();
      table.text('api_secret_encrypted').notNullable(); // Encrypted secret
      table.text('api_secret_iv').notNullable(); // IV for decryption
      table.text('api_secret_auth_tag').notNullable(); // Auth tag for GCM
      table.string('api_secret_hash', 255).notNullable(); // Hash for verification
      table.enum('status', ['active', 'inactive', 'revoked']).defaultTo('active');
      table.string('last_used_ip', 45);
      table.timestamp('last_used_at');
      table.timestamp('expires_at');
      table.jsonb('permissions'); // API permissions/scopes
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_id');
      table.index('api_key');
      table.index(['merchant_id', 'status']);
    })
    
    // Create merchant_webhooks table
    .createTable('merchant_webhooks', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.string('webhook_url', 500).notNullable();
      table.string('webhook_secret', 255).notNullable();
      table.enum('status', ['active', 'inactive']).defaultTo('active');
      table.jsonb('events'); // Array of events to subscribe to
      table.integer('retry_attempts').defaultTo(3);
      table.integer('retry_delay').defaultTo(5000);
      table.integer('timeout').defaultTo(30000);
      table.timestamp('last_triggered_at');
      table.integer('success_count').defaultTo(0);
      table.integer('failure_count').defaultTo(0);
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_id');
      table.index(['merchant_id', 'status']);
    })
    
    // Create merchant_rate_limits table
    .createTable('merchant_rate_limits', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.string('endpoint_pattern', 255).notNullable(); // e.g., '/api/payments/*'
      table.integer('max_requests').notNullable(); // Max requests per window
      table.integer('window_ms').notNullable(); // Time window in milliseconds
      table.enum('status', ['active', 'inactive']).defaultTo('active');
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_id');
      table.unique(['merchant_id', 'endpoint_pattern']);
    })
    
    // Create merchant_ip_whitelist table
    .createTable('merchant_ip_whitelist', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.string('ip_address', 45).notNullable(); // Supports IPv4 and IPv6
      table.string('description', 255);
      table.enum('status', ['active', 'inactive']).defaultTo('active');
      table.timestamp('last_used_at');
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_id');
      table.index(['merchant_id', 'ip_address']);
      table.unique(['merchant_id', 'ip_address']);
    })
    
    // Create merchant_usage_stats table
    .createTable('merchant_usage_stats', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.date('date').notNullable();
      table.string('endpoint', 255).notNullable();
      table.integer('request_count').defaultTo(0);
      table.integer('success_count').defaultTo(0);
      table.integer('error_count').defaultTo(0);
      table.decimal('total_amount', 15, 2).defaultTo(0);
      table.integer('transaction_count').defaultTo(0);
      table.timestamps(true, true);
      
      // Indexes
      table.index('merchant_id');
      table.index('date');
      table.index(['merchant_id', 'date']);
      table.unique(['merchant_id', 'date', 'endpoint']);
    })
    
    // Create webhook_delivery_logs table
    .createTable('webhook_delivery_logs', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('webhook_id').notNullable().references('id').inTable('merchant_webhooks').onDelete('CASCADE');
      table.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
      table.string('event_type', 100).notNullable();
      table.jsonb('payload');
      table.enum('status', ['pending', 'success', 'failed']).defaultTo('pending');
      table.integer('attempt_count').defaultTo(0);
      table.integer('response_code');
      table.text('response_body');
      table.text('error_message');
      table.timestamp('next_retry_at');
      table.timestamp('delivered_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index('webhook_id');
      table.index('merchant_id');
      table.index(['status', 'next_retry_at']);
      table.index('created_at');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('webhook_delivery_logs')
    .dropTableIfExists('merchant_usage_stats')
    .dropTableIfExists('merchant_ip_whitelist')
    .dropTableIfExists('merchant_rate_limits')
    .dropTableIfExists('merchant_webhooks')
    .dropTableIfExists('merchant_api_keys')
    .alterTable('merchants', function(table) {
      table.dropColumn('website_url');
      table.dropColumn('callback_url');
      table.dropColumn('logo_url');
      table.dropColumn('business_details');
      table.dropColumn('kyc_verified');
      table.dropColumn('kyc_verified_at');
      table.dropColumn('daily_limit');
      table.dropColumn('monthly_limit');
      table.dropColumn('last_active_at');
    });
};
