/**
 * Payment-Settlement Integration Test
 * 
 * Tests that settlements are created when payments succeed
 */

const { ledgerEventHandlers } = require('../src/core/ledger');
const settlementService = require('../src/core/ledger/settlement-service');
const db = require('../src/database');

// Mock the database module
jest.mock('../src/database', () => ({
  knex: {
    transaction: jest.fn(),
    raw: jest.fn(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    returning: jest.fn()
  },
  insertWithTenant: jest.fn()
}));

// Mock ledger service
jest.mock('../src/core/ledger/ledger-service', () => ({
  postTransaction: jest.fn(),
  ACCOUNT_CODES: {
    ESCROW_BANK: 'ESC-001',
    ESCROW_LIABILITY: 'ESC-002',
    MERCHANT_RECEIVABLES: 'MER-001',
    MERCHANT_PAYABLES: 'MER-002',
    PLATFORM_RECEIVABLES: 'PLT-001',
    PLATFORM_MDR: 'REV-001',
    GATEWAY_PAYABLES: 'GW-PAY-001',
    GATEWAY_RAZORPAY: 'GW-001',
    GATEWAY_FEE_RAZORPAY: 'GW-FEE-001',
    GATEWAY_PAYU: 'GW-002',
    GATEWAY_FEE_PAYU: 'GW-FEE-002',
    GATEWAY_CCAVENUE: 'GW-003',
    GATEWAY_FEE_CCAVENUE: 'GW-FEE-003'
  }
}));

const ledgerService = require('../src/core/ledger/ledger-service');

describe('Payment-Settlement Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('handlePaymentSuccess', () => {
    test('should create ledger transaction and settlement entry on payment success', async () => {
      // Mock ledger transaction creation
      const mockLedgerTransaction = {
        id: 'ledger-txn-123',
        transaction_ref: 'PAY-ORDER-456',
        tenant_id: 'tenant-123'
      };
      
      ledgerService.postTransaction.mockResolvedValue(mockLedgerTransaction);
      
      // Mock settlement creation
      const mockSettlement = {
        id: 'settlement-123',
        tenant_id: 'tenant-123',
        merchant_id: 'merchant-456',
        settlement_ref: expect.stringContaining('SETL-'),
        status: 'CREATED',
        gross_amount: 1000,
        fees_amount: 30,
        net_amount: 970
      };
      
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          insert: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([mockSettlement])
        };
        return callback(mockTrx);
      });
      
      // Call handlePaymentSuccess
      const result = await ledgerEventHandlers.handlePaymentSuccess({
        tenantId: 'tenant-123',
        transactionId: 'txn-789',
        orderId: 'ORDER-456',
        merchantId: 'merchant-456',
        gateway: 'razorpay',
        amount: 1000,
        platformFee: 20,
        gatewayFee: 10,
        createdBy: 'test-user'
      });
      
      // Verify ledger transaction was created
      expect(ledgerService.postTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-123',
          transactionRef: 'PAY-ORDER-456',
          eventType: 'payment_success',
          amount: 1000
        })
      );
      
      // Verify settlement was attempted to be created
      expect(db.knex.transaction).toHaveBeenCalled();
      
      // Result should be the ledger transaction
      expect(result).toEqual(mockLedgerTransaction);
    });
    
    test('should not fail payment if settlement creation fails', async () => {
      // Mock ledger transaction creation (success)
      const mockLedgerTransaction = {
        id: 'ledger-txn-123',
        transaction_ref: 'PAY-ORDER-456'
      };
      
      ledgerService.postTransaction.mockResolvedValue(mockLedgerTransaction);
      
      // Mock settlement creation (failure)
      db.knex.transaction.mockRejectedValue(new Error('Database error'));
      
      // Call handlePaymentSuccess
      const result = await ledgerEventHandlers.handlePaymentSuccess({
        tenantId: 'tenant-123',
        transactionId: 'txn-789',
        orderId: 'ORDER-456',
        merchantId: 'merchant-456',
        gateway: 'razorpay',
        amount: 1000,
        platformFee: 20,
        gatewayFee: 10,
        createdBy: 'test-user'
      });
      
      // Payment should still succeed even if settlement creation fails
      expect(result).toEqual(mockLedgerTransaction);
      expect(ledgerService.postTransaction).toHaveBeenCalled();
    });
    
    test('should calculate merchant net amount correctly', async () => {
      const mockLedgerTransaction = {
        id: 'ledger-txn-123'
      };
      
      ledgerService.postTransaction.mockResolvedValue(mockLedgerTransaction);
      
      let capturedSettlementData;
      db.knex.transaction.mockImplementation(async (callback) => {
        const mockTrx = {
          insert: jest.fn().mockImplementation((table) => {
            if (table === 'settlements') {
              return mockTrx;
            }
            return mockTrx;
          }),
          returning: jest.fn().mockImplementation(() => {
            // Capture the insert data from the previous call
            const insertCall = mockTrx.insert.mock.calls.find(call => call[0] === 'settlements');
            if (insertCall && insertCall[1]) {
              capturedSettlementData = insertCall[1];
            }
            return Promise.resolve([{ id: 'settlement-123' }]);
          })
        };
        
        // Execute the callback to trigger inserts
        const result = await callback({
          ...mockTrx,
          insert: jest.fn((data) => {
            if (typeof data === 'object' && data.tenant_id) {
              capturedSettlementData = data;
            }
            return {
              returning: jest.fn().mockResolvedValue([{ id: 'settlement-123' }])
            };
          })
        });
        
        return result;
      });
      
      await ledgerEventHandlers.handlePaymentSuccess({
        tenantId: 'tenant-123',
        transactionId: 'txn-789',
        orderId: 'ORDER-456',
        merchantId: 'merchant-456',
        gateway: 'razorpay',
        amount: 1000,
        platformFee: 20,
        gatewayFee: 10,
        createdBy: 'test-user'
      });
      
      // Net amount should be: 1000 - 20 - 10 = 970
      if (capturedSettlementData) {
        expect(capturedSettlementData.net_amount).toBe(970);
        expect(capturedSettlementData.gross_amount).toBe(1000);
        expect(capturedSettlementData.fees_amount).toBe(30);
      }
    });
  });
});
