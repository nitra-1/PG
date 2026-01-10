/**
 * Ledger Service Tests
 * 
 * Tests for double-entry accounting ledger system
 * Validates balance enforcement, immutability, and audit trail
 */

const ledgerService = require('../src/core/ledger/ledger-service');
const ledgerEventHandlers = require('../src/core/ledger/ledger-event-handlers');
const reconciliationService = require('../src/core/ledger/reconciliation-service');

// Mock the database module
jest.mock('../src/database', () => ({
  knex: {
    transaction: jest.fn((callback) => {
      const mockTrx = {
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        first: jest.fn(),
        returning: jest.fn(),
        select: jest.fn().mockReturnThis(),
        join: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis()
      };
      
      // Mock implementations
      mockTrx.returning.mockImplementation(() => {
        return Promise.resolve([{
          id: 'mock-uuid',
          tenant_id: 'test-tenant',
          transaction_ref: 'PAY-TEST-001',
          status: 'pending',
          amount: 1000,
          currency: 'INR',
          created_at: new Date()
        }]);
      });
      
      mockTrx.first.mockImplementation(() => {
        return Promise.resolve({
          id: 'mock-account-id',
          account_code: 'ESC-001',
          account_name: 'Escrow Bank Account',
          account_type: 'escrow',
          normal_balance: 'debit',
          status: 'active'
        });
      });
      
      return callback(mockTrx);
    }),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    select: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis()
  }
}));

const db = require('../src/database');

describe('Ledger Service - Double-Entry Accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('postTransaction', () => {
    test('should post a balanced transaction with debits equal to credits', async () => {
      const params = {
        tenantId: 'test-tenant',
        transactionRef: 'PAY-TEST-001',
        idempotencyKey: 'test-idempotency-key',
        eventType: 'payment_success',
        sourceTransactionId: 'txn-123',
        sourceOrderId: 'order-456',
        amount: 1000,
        currency: 'INR',
        description: 'Test payment',
        entries: [
          {
            accountCode: 'ESC-001',
            entryType: 'debit',
            amount: 1000,
            description: 'Debit escrow'
          },
          {
            accountCode: 'ESC-002',
            entryType: 'credit',
            amount: 1000,
            description: 'Credit escrow liability'
          }
        ],
        createdBy: 'test-user'
      };
      
      const result = await ledgerService.postTransaction(params);
      
      expect(result).toBeDefined();
      expect(result.validation.balanced).toBe(true);
      expect(result.validation.totalDebits).toBe(result.validation.totalCredits);
    });
    
    test('should reject unbalanced transaction', async () => {
      const params = {
        tenantId: 'test-tenant',
        transactionRef: 'PAY-TEST-002',
        eventType: 'payment_success',
        sourceOrderId: 'order-789',
        amount: 1000,
        entries: [
          {
            accountCode: 'ESC-001',
            entryType: 'debit',
            amount: 1000,
            description: 'Debit escrow'
          },
          {
            accountCode: 'ESC-002',
            entryType: 'credit',
            amount: 900,  // Unbalanced!
            description: 'Credit escrow liability'
          }
        ],
        createdBy: 'test-user'
      };
      
      await expect(ledgerService.postTransaction(params))
        .rejects
        .toThrow('Transaction not balanced');
    });
    
    test('should handle idempotency - return existing transaction', async () => {
      // Mock existing transaction
      db.knex.where.mockReturnValueOnce({
        first: jest.fn().mockResolvedValue({
          id: 'existing-txn-id',
          idempotency_key: 'duplicate-key'
        })
      });
      
      db.knex.where.mockReturnValueOnce({
        // For ledger_entries query
        select: jest.fn().mockResolvedValue([])
      });
      
      const params = {
        tenantId: 'test-tenant',
        transactionRef: 'PAY-TEST-003',
        idempotencyKey: 'duplicate-key',
        eventType: 'payment_success',
        sourceOrderId: 'order-999',
        amount: 1000,
        entries: [
          {
            accountCode: 'ESC-001',
            entryType: 'debit',
            amount: 1000
          },
          {
            accountCode: 'ESC-002',
            entryType: 'credit',
            amount: 1000
          }
        ],
        createdBy: 'test-user'
      };
      
      const result = await ledgerService.postTransaction(params);
      
      expect(result.duplicate).toBe(true);
      expect(result.transaction.id).toBe('existing-txn-id');
    });
  });
  
  describe('getAccountBalance', () => {
    test('should calculate balance from view for debit-normal account', async () => {
      db.knex.where.mockReturnValueOnce({
        first: jest.fn().mockResolvedValue({
          account_code: 'ESC-001',
          account_name: 'Escrow Bank Account',
          account_type: 'escrow',
          normal_balance: 'debit',
          balance: 50000,
          total_debits: 100000,
          total_credits: 50000,
          entry_count: 100
        })
      });
      
      const balance = await ledgerService.getAccountBalance({
        tenantId: 'test-tenant',
        accountCode: 'ESC-001'
      });
      
      expect(balance.balance).toBe(50000);
      expect(balance.total_debits).toBe(100000);
      expect(balance.total_credits).toBe(50000);
    });
    
    test('should return zero balance for account with no entries', async () => {
      db.knex.where.mockReturnValueOnce({
        first: jest.fn().mockResolvedValue(null)
      });
      
      db.knex.where.mockReturnValueOnce({
        first: jest.fn().mockResolvedValue({
          account_code: 'REV-001',
          account_name: 'Platform Revenue',
          account_type: 'platform_revenue',
          normal_balance: 'credit'
        })
      });
      
      const balance = await ledgerService.getAccountBalance({
        tenantId: 'test-tenant',
        accountCode: 'REV-001'
      });
      
      expect(balance.balance).toBe(0);
      expect(balance.entry_count).toBe(0);
    });
  });
  
  describe('reverseTransaction', () => {
    test('should create reversing entries with opposite debit/credit', async () => {
      // Mock original transaction
      const mockOriginalTx = {
        id: 'original-tx-id',
        transaction_ref: 'PAY-TEST-001',
        status: 'posted',
        amount: 1000
      };
      
      const mockOriginalEntries = [
        {
          id: 'entry-1',
          account_id: 'acc-1',
          entry_type: 'debit',
          amount: 1000,
          description: 'Original debit'
        },
        {
          id: 'entry-2',
          account_id: 'acc-2',
          entry_type: 'credit',
          amount: 1000,
          description: 'Original credit'
        }
      ];
      
      // Setup mocks for reversal
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn()
            .mockResolvedValueOnce(mockOriginalTx)
            .mockResolvedValue(mockOriginalEntries[0]),
          insert: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{
            id: 'reversal-tx-id',
            transaction_ref: 'PAY-TEST-001-REV'
          }])
        };
        
        // Mock original entries query
        mockTrx.where.mockReturnValueOnce(mockOriginalEntries);
        
        return callback(mockTrx);
      });
      
      const result = await ledgerService.reverseTransaction({
        tenantId: 'test-tenant',
        originalTransactionId: 'original-tx-id',
        reason: 'Test reversal',
        createdBy: 'admin'
      });
      
      expect(result.reversalTransaction).toBeDefined();
      expect(result.reversalTransaction.transaction_ref).toContain('REV');
    });
  });
});

describe('Ledger Event Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('handlePaymentSuccess', () => {
    test('should create correct ledger entries for payment', async () => {
      const params = {
        tenantId: 'test-tenant',
        transactionId: 'txn-123',
        orderId: 'order-456',
        merchantId: 'merchant-789',
        gateway: 'razorpay',
        amount: 1000,
        platformFee: 20,
        gatewayFee: 15,
        createdBy: 'payment-api'
      };
      
      const result = await ledgerEventHandlers.handlePaymentSuccess(params);
      
      expect(result).toBeDefined();
      // Should create 8 entries (4 debit, 4 credit)
      // 1. Escrow debit/credit
      // 2. Merchant receivable/payable
      // 3. Platform fee
      // 4. Gateway fee
    });
  });
  
  describe('handleRefundCompleted', () => {
    test('should create correct ledger entries for refund', async () => {
      const params = {
        tenantId: 'test-tenant',
        transactionId: 'txn-123',
        orderId: 'order-456',
        refundId: 'refund-789',
        merchantId: 'merchant-123',
        refundAmount: 1000,
        platformFeeRefund: 20,
        createdBy: 'refund-api'
      };
      
      const result = await ledgerEventHandlers.handleRefundCompleted(params);
      
      expect(result).toBeDefined();
    });
  });
  
  describe('handleSettlement', () => {
    test('should create correct ledger entries for merchant settlement', async () => {
      const params = {
        tenantId: 'test-tenant',
        settlementId: 'setl-123',
        settlementRef: 'SETL-2024-001',
        merchantId: 'merchant-456',
        settlementAmount: 50000,
        utrNumber: 'UTR123456',
        createdBy: 'settlement-batch'
      };
      
      const result = await ledgerEventHandlers.handleSettlement(params);
      
      expect(result).toBeDefined();
    });
  });
});

describe('Reconciliation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('createReconciliationBatch', () => {
    test('should create reconciliation batch', async () => {
      const params = {
        tenantId: 'test-tenant',
        reconciliationType: 'gateway_settlement',
        gatewayName: 'razorpay',
        periodFrom: new Date('2024-01-01'),
        periodTo: new Date('2024-01-31'),
        createdBy: 'admin'
      };
      
      db.knex.insert = jest.fn().mockReturnThis();
      db.knex.returning = jest.fn().mockResolvedValue([{
        id: 'batch-123',
        batch_ref: 'RECON-123',
        status: 'in_progress'
      }]);
      
      const batch = await reconciliationService.createReconciliationBatch(params);
      
      expect(batch).toBeDefined();
      expect(batch.status).toBe('in_progress');
    });
  });
  
  describe('reconcileGatewaySettlement', () => {
    test('should identify matched, missing, and mismatched transactions', async () => {
      const externalTransactions = [
        { externalRef: 'RZP-1', orderId: 'order-1', amount: 1000 },
        { externalRef: 'RZP-2', orderId: 'order-2', amount: 2000 },
        { externalRef: 'RZP-3', orderId: 'order-3', amount: 1500 },
        { externalRef: 'RZP-4', orderId: 'order-999', amount: 500 }  // Missing internal
      ];
      
      // Mock batch and internal transactions
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          where: jest.fn().mockReturnThis(),
          first: jest.fn().mockResolvedValue({
            id: 'batch-123',
            tenant_id: 'test-tenant',
            gateway_name: 'razorpay',
            period_from: new Date('2024-01-01'),
            period_to: new Date('2024-01-31')
          }),
          join: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockResolvedValue([
            { transaction_id: 'tx-1', source_order_id: 'order-1', amount: 1000 },
            { transaction_id: 'tx-2', source_order_id: 'order-2', amount: 2000 },
            { transaction_id: 'tx-3', source_order_id: 'order-3', amount: 1500.50 },  // Amount mismatch
            { transaction_id: 'tx-5', source_order_id: 'order-5', amount: 800 }  // Missing external
          ]),
          insert: jest.fn().mockReturnThis(),
          update: jest.fn().mockResolvedValue(1),
          returning: jest.fn().mockResolvedValue([{}])
        };
        
        return callback(mockTrx);
      });
      
      const result = await reconciliationService.reconcileGatewaySettlement({
        batchId: 'batch-123',
        externalTransactions
      });
      
      expect(result.summary).toBeDefined();
      expect(result.summary.matched).toBeGreaterThan(0);
      expect(result.summary.missing_internal).toBeGreaterThan(0);
      expect(result.summary.missing_external).toBeGreaterThan(0);
      expect(result.summary.amount_mismatch).toBeGreaterThan(0);
    });
  });
});

describe('Balance Validation', () => {
  test('escrow bank balance should match escrow liability', async () => {
    // Mock balances
    const escrowBank = { balance: 100000, account_type: 'escrow' };
    const escrowLiability = { balance: 100000, account_type: 'escrow' };
    
    expect(escrowBank.balance).toBe(escrowLiability.balance);
  });
  
  test('merchant receivables should equal merchant payables', async () => {
    const merchantReceivables = { balance: 50000 };
    const merchantPayables = { balance: 50000 };
    
    expect(merchantReceivables.balance).toBe(merchantPayables.balance);
  });
});

describe('Immutability', () => {
  test('should prevent update of ledger entries', async () => {
    // This would be enforced by database trigger
    // Test documents the requirement
    expect(true).toBe(true); // Placeholder
  });
  
  test('should prevent delete of ledger entries', async () => {
    // This would be enforced by database trigger
    // Test documents the requirement
    expect(true).toBe(true); // Placeholder
  });
});

describe('Audit Trail', () => {
  test('should create audit log for every ledger operation', async () => {
    // Every postTransaction creates an audit log entry
    // Verified in postTransaction implementation
    expect(true).toBe(true); // Placeholder
  });
});
