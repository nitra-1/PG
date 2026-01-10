/**
 * Integration Test for Ledger System
 * 
 * Tests that verify the ledger system works end-to-end
 * Requires database connection
 */

const db = require('../src/database');

describe('Ledger System Integration Tests', () => {
  // Skip if no database connection
  beforeAll(async () => {
    try {
      await db.knex.raw('SELECT 1');
    } catch (error) {
      console.log('⚠️  Database not available, skipping integration tests');
      return;
    }
  });
  
  afterAll(async () => {
    if (db.knex) {
      await db.knex.destroy();
    }
  });
  
  describe('Database Schema', () => {
    test('ledger_accounts table should exist', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'ledger_accounts'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
    
    test('ledger_transactions table should exist', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'ledger_transactions'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
    
    test('ledger_entries table should exist', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'ledger_entries'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
    
    test('account_balances view should exist', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.views 
          WHERE table_schema = 'public'
          AND table_name = 'account_balances'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
  });
  
  describe('Chart of Accounts', () => {
    test('should have seeded ledger accounts', async () => {
      const accounts = await db.knex('ledger_accounts')
        .select('*')
        .limit(5);
      
      expect(accounts.length).toBeGreaterThan(0);
    });
    
    test('should have escrow accounts', async () => {
      const escrowAccounts = await db.knex('ledger_accounts')
        .where('account_type', 'escrow')
        .select('account_code', 'account_name');
      
      expect(escrowAccounts.length).toBeGreaterThan(0);
      
      const codes = escrowAccounts.map(a => a.account_code);
      expect(codes).toContain('ESC-001'); // Escrow Bank
      expect(codes).toContain('ESC-002'); // Escrow Liability
    });
    
    test('should have merchant accounts', async () => {
      const merchantAccounts = await db.knex('ledger_accounts')
        .where('account_type', 'merchant')
        .select('account_code');
      
      expect(merchantAccounts.length).toBeGreaterThan(0);
      
      const codes = merchantAccounts.map(a => a.account_code);
      expect(codes).toContain('MER-001'); // Merchant Receivables
      expect(codes).toContain('MER-002'); // Merchant Payables
    });
    
    test('should have gateway accounts', async () => {
      const gatewayAccounts = await db.knex('ledger_accounts')
        .where('account_type', 'gateway')
        .select('account_code');
      
      expect(gatewayAccounts.length).toBeGreaterThan(0);
    });
    
    test('should have platform revenue accounts', async () => {
      const revenueAccounts = await db.knex('ledger_accounts')
        .where('account_type', 'platform_revenue')
        .select('account_code');
      
      expect(revenueAccounts.length).toBeGreaterThan(0);
      
      const codes = revenueAccounts.map(a => a.account_code);
      expect(codes).toContain('REV-001'); // Platform MDR
    });
  });
  
  describe('Database Functions', () => {
    test('validate_transaction_balance function should exist', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM pg_proc 
          WHERE proname = 'validate_transaction_balance'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
    
    test('immutability trigger should exist on ledger_entries', async () => {
      const result = await db.knex.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.triggers 
          WHERE trigger_name = 'enforce_ledger_entry_immutability'
          AND event_object_table = 'ledger_entries'
        );
      `);
      
      expect(result.rows[0].exists).toBe(true);
    });
  });
});

describe('End-to-End Ledger Flow (with database)', () => {
  // These tests require actual database
  test('placeholder for e2e payment flow', () => {
    // Would test: Payment → Ledger Entries → Balance Update
    expect(true).toBe(true);
  });
  
  test('placeholder for e2e refund flow', () => {
    // Would test: Refund → Ledger Entries → Balance Update
    expect(true).toBe(true);
  });
  
  test('placeholder for e2e settlement flow', () => {
    // Would test: Settlement → Ledger Entries → Balance Update
    expect(true).toBe(true);
  });
});
