/**
 * Merchant Dashboard Enhancements Migration
 * Creates: refunds, disputes tables for merchant dashboard features
 * Adds merchant-safe views and indices
 */

exports.up = function(knex) {
  return knex.schema
    // Create refunds table
    .createTable('refunds', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('merchant_id').notNullable().index();
      table.uuid('transaction_id').notNullable().index();
      table.string('refund_ref', 100).notNullable().unique();
      table.decimal('refund_amount', 15, 2).notNullable();
      table.decimal('original_amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      table.enum('refund_type', ['full', 'partial']).notNullable();
      table.enum('status', [
        'initiated',
        'processing',
        'completed',
        'failed',
        'cancelled'
      ]).defaultTo('initiated').notNullable().index();
      table.string('reason', 500);
      table.text('notes');
      table.string('gateway_refund_id', 255);
      table.string('gateway_response_code', 50);
      table.text('gateway_response_message');
      table.jsonb('metadata');
      table.string('initiated_by', 255);
      table.timestamp('initiated_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at');
      table.timestamps(true, true);
      
      // Indexes for performance
      table.index(['merchant_id', 'status']);
      table.index(['merchant_id', 'transaction_id']);
      table.index(['tenant_id', 'status']);
      table.index('created_at');
      
      // Foreign key
      table.foreign('transaction_id').references('id').inTable('transactions').onDelete('RESTRICT');
    })
    
    // Create disputes table
    .createTable('disputes', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().index();
      table.uuid('merchant_id').notNullable().index();
      table.uuid('transaction_id').notNullable().index();
      table.string('dispute_ref', 100).notNullable().unique();
      table.decimal('disputed_amount', 15, 2).notNullable();
      table.string('currency', 3).defaultTo('INR');
      table.enum('dispute_type', [
        'chargeback',
        'fraud',
        'product_not_received',
        'product_defective',
        'unauthorized_transaction',
        'duplicate_charge',
        'other'
      ]).notNullable();
      table.enum('status', [
        'open',
        'under_review',
        'accepted',
        'won',
        'lost',
        'closed'
      ]).defaultTo('open').notNullable().index();
      table.string('reason_code', 50);
      table.text('customer_reason');
      table.text('merchant_response');
      table.string('gateway_dispute_id', 255);
      table.date('dispute_date').notNullable();
      table.date('response_due_date');
      table.date('resolved_date');
      table.jsonb('evidence');
      table.jsonb('metadata');
      table.string('raised_by', 255);
      table.timestamps(true, true);
      
      // Indexes for performance
      table.index(['merchant_id', 'status']);
      table.index(['merchant_id', 'dispute_date']);
      table.index(['tenant_id', 'status']);
      table.index('created_at');
      table.index('response_due_date');
      
      // Foreign key
      table.foreign('transaction_id').references('id').inTable('transactions').onDelete('RESTRICT');
    })
    
    // Add last_active_at to merchants if not exists
    .raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='merchants' AND column_name='last_active_at'
        ) THEN
          ALTER TABLE merchants ADD COLUMN last_active_at timestamp;
        END IF;
      END $$;
    `);
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('disputes')
    .dropTableIfExists('refunds');
};
