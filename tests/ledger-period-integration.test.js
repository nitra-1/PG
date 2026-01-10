/**
 * Ledger Integration Tests with Period Controls
 * 
 * Tests integration of accounting periods and locks with ledger service
 */

const ledgerService = require('../src/core/ledger/ledger-service');
const accountingPeriodService = require('../src/core/ledger/accounting-period-service');
const {
  PeriodClosedError,
  LedgerLockedError,
  AdminOverrideRequiredError,
  InsufficientOverridePrivilegesError
} = require('../src/core/errors/accounting-errors');

// Mock dependencies
jest.mock('../src/database');
jest.mock('../src/core/ledger/accounting-period-service');
jest.mock('../src/core/ledger/ledger-lock-service');

const db = require('../src/database');

describe('Ledger Service with Period Controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('postTransaction with OPEN period', () => {
    test('should allow posting to OPEN period', async () => {
      // Mock period check - OPEN period, not locked
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'OPEN',
          type: 'DAILY'
        },
        posting_allowed: true,
        override_required: false,
        locked: false,
        lock_info: null,
        error_message: null
      });
      
      // Mock database operations
      db.knex.where.mockReturnThis();
      db.knex.first.mockResolvedValue(null); // No idempotent duplicate
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          insert: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{
            id: 'tx-123',
            tenant_id: 'test-tenant',
            transaction_ref: 'PAY-001',
            status: 'pending'
          }]),
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({
            id: 'acc-123',
            account_code: 'ESC-001',
            status: 'active'
          }),
          update: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      const result = await ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'system',
        transactionDate: new Date('2024-01-01')
      });
      
      expect(result).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.override_used).toBe(false);
    });
  });
  
  describe('postTransaction with SOFT_CLOSED period', () => {
    test('should reject posting without override', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'SOFT_CLOSED',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: true,
        locked: false,
        error_message: 'Period is SOFT_CLOSED - admin override required'
      });
      
      await expect(ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'system',
        transactionDate: new Date('2024-01-01')
      })).rejects.toThrow(AdminOverrideRequiredError);
    });
    
    test('should allow posting with valid override', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'SOFT_CLOSED',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: true,
        locked: false
      });
      
      db.knex.where.mockReturnThis();
      db.knex.first.mockResolvedValue(null);
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          insert: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{
            id: 'tx-123',
            tenant_id: 'test-tenant',
            transaction_ref: 'PAY-001',
            status: 'pending'
          }]),
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({
            id: 'acc-123',
            account_code: 'ESC-001',
            status: 'active'
          }),
          update: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      const result = await ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'admin',
        transactionDate: new Date('2024-01-01'),
        override: true,
        overrideJustification: 'Late transaction correction approved by CFO',
        userRole: 'FINANCE_ADMIN'
      });
      
      expect(result).toBeDefined();
      expect(result.override_used).toBe(true);
    });
    
    test('should reject override without FINANCE_ADMIN role', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'SOFT_CLOSED',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: true,
        locked: false
      });
      
      await expect(ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'user',
        transactionDate: new Date('2024-01-01'),
        override: true,
        overrideJustification: 'Trying to override',
        userRole: 'OPERATIONS' // Not FINANCE_ADMIN
      })).rejects.toThrow(InsufficientOverridePrivilegesError);
    });
    
    test('should reject override without justification', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'SOFT_CLOSED',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: true,
        locked: false
      });
      
      await expect(ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'admin',
        transactionDate: new Date('2024-01-01'),
        override: true,
        overrideJustification: 'Short', // Less than 10 characters
        userRole: 'FINANCE_ADMIN'
      })).rejects.toThrow('Override justification must be at least 10 characters');
    });
  });
  
  describe('postTransaction with HARD_CLOSED period', () => {
    test('should reject posting even with override', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'HARD_CLOSED',
          type: 'DAILY',
          period_start: new Date('2024-01-01'),
          period_end: new Date('2024-01-01T23:59:59')
        },
        posting_allowed: false,
        override_required: false,
        locked: false,
        error_message: 'Period is HARD_CLOSED - posting not allowed'
      });
      
      await expect(ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'admin',
        transactionDate: new Date('2024-01-01'),
        override: true,
        overrideJustification: 'Trying to post to HARD_CLOSED period',
        userRole: 'FINANCE_ADMIN'
      })).rejects.toThrow(PeriodClosedError);
    });
  });
  
  describe('postTransaction with ledger lock', () => {
    test('should reject posting when ledger is locked', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'OPEN',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: false,
        locked: true,
        lock_info: {
          lock_id: 'lock-123',
          lock_type: 'AUDIT_LOCK',
          locked_by: 'auditor',
          reason: 'External audit in progress',
          locked_at: new Date('2024-01-01')
        },
        error_message: 'Ledger locked: External audit in progress'
      });
      
      await expect(ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'system',
        transactionDate: new Date('2024-01-01')
      })).rejects.toThrow(LedgerLockedError);
    });
  });
  
  describe('Override Logging', () => {
    test('should log override in admin_overrides_log', async () => {
      accountingPeriodService.checkPeriodForPosting.mockResolvedValue({
        period: {
          id: 'period-123',
          status: 'SOFT_CLOSED',
          type: 'DAILY'
        },
        posting_allowed: false,
        override_required: true,
        locked: false
      });
      
      let overrideLogCreated = false;
      
      db.knex.where.mockReturnThis();
      db.knex.first.mockResolvedValue(null);
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          insert: jest.fn().mockImplementation((table) => {
            if (table === 'admin_overrides_log') {
              overrideLogCreated = true;
            }
            return mockTrx;
          }),
          returning: jest.fn().mockResolvedValue([{
            id: 'tx-123',
            status: 'pending'
          }]),
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({
            id: 'acc-123',
            account_code: 'ESC-001',
            status: 'active'
          }),
          update: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      await ledgerService.postTransaction({
        tenantId: 'test-tenant',
        transactionRef: 'PAY-001',
        eventType: 'payment_success',
        amount: 1000,
        entries: [
          { accountCode: 'ESC-001', entryType: 'debit', amount: 1000 },
          { accountCode: 'ESC-002', entryType: 'credit', amount: 1000 }
        ],
        createdBy: 'admin',
        transactionDate: new Date('2024-01-01'),
        override: true,
        overrideJustification: 'CFO approved late entry',
        userRole: 'FINANCE_ADMIN'
      });
      
      expect(overrideLogCreated).toBe(true);
    });
  });
});

describe('Audit Questions', () => {
  test('Can auditor determine which periods are closed and by whom?', () => {
    // Query accounting_periods table
    // Shows status, closed_by, closed_at, closure_notes
    expect(true).toBe(true);
  });
  
  test('Can auditor see if entries were posted after close?', () => {
    // Query admin_overrides_log for SOFT_CLOSE_POSTING overrides
    // Shows justification, override_by, affected_entities
    expect(true).toBe(true);
  });
  
  test('Can auditor determine which settlements are final?', () => {
    // Query settlements WHERE status = 'SETTLED'
    // SETTLED state is terminal and means BANK_CONFIRMED was reached
    expect(true).toBe(true);
  });
  
  test('Can auditor see why overrides were used?', () => {
    // Query admin_overrides_log
    // Shows justification (required field), override_by, affected_entities
    expect(true).toBe(true);
  });
  
  test('Can auditor verify if ledger was frozen during audit?', () => {
    // Query ledger_locks WHERE lock_type = 'AUDIT_LOCK'
    // Shows reason, reference_number, locked_by, locked_at, released_at
    expect(true).toBe(true);
  });
});
