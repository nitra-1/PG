/**
 * Accounting Template Event Types
 *
 * Extends allowed ledger event_type values for real money lifecycle events.
 * This does not alter ledger table shape or entry semantics.
 */

exports.up = async function(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_transactions_event_type') THEN
        ALTER TYPE ledger_transactions_event_type ADD VALUE IF NOT EXISTS 'gateway_settlement';
        ALTER TYPE ledger_transactions_event_type ADD VALUE IF NOT EXISTS 'merchant_payout';
        ALTER TYPE ledger_transactions_event_type ADD VALUE IF NOT EXISTS 'refund';
        ALTER TYPE ledger_transactions_event_type ADD VALUE IF NOT EXISTS 'chargeback';
      END IF;
    END $$;

    ALTER TABLE ledger_transactions
      DROP CONSTRAINT IF EXISTS ledger_transactions_event_type_check;

    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_transactions_event_type_check
      CHECK (event_type IN (
        'payment_success',
        'payment_failure',
        'refund_initiated',
        'refund_completed',
        'refund',
        'settlement',
        'merchant_payout',
        'gateway_settlement',
        'gateway_fee',
        'platform_fee',
        'chargeback_debit',
        'chargeback',
        'chargeback_reversal',
        'manual_adjustment'
      ));
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    ALTER TABLE ledger_transactions
      DROP CONSTRAINT IF EXISTS ledger_transactions_event_type_check;

    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_transactions_event_type_check
      CHECK (event_type IN (
        'payment_success',
        'payment_failure',
        'refund_initiated',
        'refund_completed',
        'settlement',
        'gateway_fee',
        'platform_fee',
        'chargeback_debit',
        'chargeback_reversal',
        'manual_adjustment'
      ));
  `);
};
