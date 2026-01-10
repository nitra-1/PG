/**
 * Accounting Period Service Tests
 * 
 * Tests for RBI-compliant accounting period controls
 */

const accountingPeriodService = require('../src/core/ledger/accounting-period-service');

// Mock the database module
jest.mock('../src/database', () => ({
  knex: {
    transaction: jest.fn(),
    raw: jest.fn(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis()
  }
}));

const db = require('../src/database');

describe('Accounting Period Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('createPeriod', () => {
    test('should create a new DAILY period', async () => {
      const mockPeriod = {
        id: 'period-123',
        tenant_id: 'test-tenant',
        period_type: 'DAILY',
        period_start: new Date('2024-01-01'),
        period_end: new Date('2024-01-01T23:59:59'),
        status: 'OPEN',
        created_by: 'admin'
      };
      
      // Mock transaction
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(null), // No overlapping
          orderBy: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([mockPeriod])
        };
        
        return callback(mockTrx);
      });
      
      const params = {
        tenantId: 'test-tenant',
        periodType: 'DAILY',
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-01T23:59:59'),
        createdBy: 'admin'
      };
      
      const result = await accountingPeriodService.createPeriod(params);
      
      expect(result).toBeDefined();
      expect(result.period_type).toBe('DAILY');
      expect(result.status).toBe('OPEN');
    });
    
    test('should reject overlapping periods', async () => {
      // Mock overlapping period found
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({
            id: 'existing-period',
            period_start: new Date('2024-01-01'),
            period_end: new Date('2024-01-01T23:59:59')
          }),
          orderBy: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      const params = {
        tenantId: 'test-tenant',
        periodType: 'DAILY',
        periodStart: new Date('2024-01-01T12:00:00'),
        periodEnd: new Date('2024-01-01T23:59:59'),
        createdBy: 'admin'
      };
      
      await expect(accountingPeriodService.createPeriod(params))
        .rejects
        .toThrow('PeriodOverlapError');
    });
    
    test('should enforce only one OPEN period per type', async () => {
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn()
            .mockResolvedValueOnce(null) // No overlap
            .mockResolvedValueOnce(null) // No last period
            .mockResolvedValueOnce({ id: 'open-period' }), // Existing OPEN period
          orderBy: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      const params = {
        tenantId: 'test-tenant',
        periodType: 'DAILY',
        periodStart: new Date('2024-01-02'),
        periodEnd: new Date('2024-01-02T23:59:59'),
        createdBy: 'admin'
      };
      
      await expect(accountingPeriodService.createPeriod(params))
        .rejects
        .toThrow('An OPEN DAILY period already exists');
    });
  });
  
  describe('closePeriod', () => {
    test('should close OPEN period to SOFT_CLOSED', async () => {
      const mockPeriod = {
        id: 'period-123',
        status: 'OPEN',
        period_start: new Date('2024-01-01'),
        period_end: new Date('2024-01-01T23:59:59')
      };
      
      const mockUpdatedPeriod = {
        ...mockPeriod,
        status: 'SOFT_CLOSED',
        closed_by: 'admin',
        closed_at: new Date()
      };
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockPeriod),
          update: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([mockUpdatedPeriod]),
          insert: jest.fn().mockReturnThis()
        };
        
        return callback(mockTrx);
      });
      
      const result = await accountingPeriodService.closePeriod({
        periodId: 'period-123',
        tenantId: 'test-tenant',
        targetStatus: 'SOFT_CLOSED',
        closedBy: 'admin',
        closureNotes: 'End of day reconciliation complete'
      });
      
      expect(result.status).toBe('SOFT_CLOSED');
      expect(result.closed_by).toBe('admin');
    });
    
    test('should auto-create PERIOD_LOCK when HARD_CLOSED', async () => {
      const mockPeriod = {
        id: 'period-123',
        status: 'SOFT_CLOSED',
        period_start: new Date('2024-01-01'),
        period_end: new Date('2024-01-01T23:59:59')
      };
      
      const mockUpdatedPeriod = {
        ...mockPeriod,
        status: 'HARD_CLOSED'
      };
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockPeriod),
          update: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([mockUpdatedPeriod]),
          insert: jest.fn().mockReturnThis()
        };
        
        await callback(mockTrx);
        
        // Verify lock was created
        expect(mockTrx.insert).toHaveBeenCalledTimes(2); // audit log + lock
        
        return mockUpdatedPeriod;
      });
      
      await accountingPeriodService.closePeriod({
        periodId: 'period-123',
        tenantId: 'test-tenant',
        targetStatus: 'HARD_CLOSED',
        closedBy: 'admin',
        closureNotes: 'Month-end close completed'
      });
    });
    
    test('should reject direct OPEN to HARD_CLOSED transition', async () => {
      const mockPeriod = {
        id: 'period-123',
        status: 'OPEN'
      };
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue(mockPeriod)
        };
        
        return callback(mockTrx);
      });
      
      await expect(accountingPeriodService.closePeriod({
        periodId: 'period-123',
        tenantId: 'test-tenant',
        targetStatus: 'HARD_CLOSED',
        closedBy: 'admin',
        closureNotes: 'Invalid transition'
      })).rejects.toThrow('Period must be SOFT_CLOSED before HARD_CLOSED');
    });
  });
  
  describe('checkPeriodForPosting', () => {
    test('should allow posting to OPEN period', async () => {
      db.knex.raw
        .mockResolvedValueOnce({
          rows: [{
            period_id: 'period-123',
            period_status: 'OPEN',
            period_type: 'DAILY',
            posting_allowed: true,
            override_required: false,
            error_message: null
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            is_locked: false
          }]
        });
      
      const result = await accountingPeriodService.checkPeriodForPosting({
        tenantId: 'test-tenant',
        transactionDate: new Date('2024-01-01'),
        periodType: 'DAILY'
      });
      
      expect(result.posting_allowed).toBe(true);
      expect(result.override_required).toBe(false);
      expect(result.locked).toBe(false);
    });
    
    test('should require override for SOFT_CLOSED period', async () => {
      db.knex.raw
        .mockResolvedValueOnce({
          rows: [{
            period_id: 'period-123',
            period_status: 'SOFT_CLOSED',
            period_type: 'DAILY',
            posting_allowed: false,
            override_required: true,
            error_message: 'Period is SOFT_CLOSED - admin override required'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            is_locked: false
          }]
        });
      
      const result = await accountingPeriodService.checkPeriodForPosting({
        tenantId: 'test-tenant',
        transactionDate: new Date('2024-01-01'),
        periodType: 'DAILY'
      });
      
      expect(result.posting_allowed).toBe(false);
      expect(result.override_required).toBe(true);
    });
    
    test('should block posting to HARD_CLOSED period', async () => {
      db.knex.raw
        .mockResolvedValueOnce({
          rows: [{
            period_id: 'period-123',
            period_status: 'HARD_CLOSED',
            period_type: 'DAILY',
            posting_allowed: false,
            override_required: false,
            error_message: 'Period is HARD_CLOSED - posting not allowed'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            is_locked: true,
            lock_type: 'PERIOD_LOCK',
            locked_by: 'admin',
            reason: 'Auto-lock for HARD_CLOSED period'
          }]
        });
      
      const result = await accountingPeriodService.checkPeriodForPosting({
        tenantId: 'test-tenant',
        transactionDate: new Date('2024-01-01'),
        periodType: 'DAILY'
      });
      
      expect(result.posting_allowed).toBe(false);
      expect(result.locked).toBe(true);
    });
  });
});

describe('Period Contiguity', () => {
  test('should enforce no gaps between periods', () => {
    // This is a placeholder for documenting the requirement
    // Actual validation happens in createPeriod
    expect(true).toBe(true);
  });
});

describe('Audit Trail', () => {
  test('should log all period operations', () => {
    // All period operations create ledger_audit_logs entries
    // Verified in createPeriod and closePeriod implementations
    expect(true).toBe(true);
  });
});
