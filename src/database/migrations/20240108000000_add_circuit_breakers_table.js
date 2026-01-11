/**
 * Circuit Breakers Table Migration
 * Creates table for storing circuit breaker states
 */

exports.up = function(knex) {
  return knex.schema
    .createTable('circuit_breakers', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('gateway', 50).notNullable().unique();
      table.enum('state', ['closed', 'open', 'half_open']).defaultTo('closed').notNullable();
      table.integer('failure_count').defaultTo(0);
      table.integer('success_count').defaultTo(0);
      table.timestamp('last_failure_time');
      table.timestamp('last_success_time');
      table.timestamps(true, true);
      
      // Indexes
      table.index('gateway');
      table.index('state');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('circuit_breakers');
};
