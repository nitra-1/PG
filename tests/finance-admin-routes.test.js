/**
 * Finance Admin Routes Tests
 * Tests for UUID validation and column references
 */

const request = require('supertest');
const express = require('express');
const financeAdminRoutes = require('../src/api/finance-admin-routes');

// Mock dependencies
jest.mock('../src/core/ledger', () => ({
  accountingPeriodService: {
    getOpenPeriod: jest.fn()
  },
  settlementService: {
    getSettlementsByStatus: jest.fn()
  },
  ledgerLockService: {
    getActiveLocks: jest.fn()
  },
  ledgerService: {
    getAccountBalance: jest.fn()
  },
  reconciliationService: {}
}));

jest.mock('../src/database', () => {
  const mockKnex = jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    whereBetween: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    sum: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
    then: jest.fn((cb) => cb([]))
  }));
  
  mockKnex.raw = jest.fn();
  
  return {
    knex: mockKnex
  };
});

describe('Finance Admin Routes - UUID Validation', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/finance-admin', financeAdminRoutes);
  });

  const validUUID = '123e4567-e89b-12d3-a456-426614174000';
  const invalidUUID = 'default';
  
  const authHeaders = {
    'x-user-role': 'FINANCE_ADMIN',
    'x-user-id': validUUID,
    'x-user-email': 'finance@test.com'
  };

  describe('Dashboard endpoint', () => {
    test('should reject invalid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/dashboard?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });

    test('should accept valid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/dashboard?tenantId=${validUUID}`)
        .set(authHeaders);

      // May return 500 due to mocked services, but should pass UUID validation
      expect(response.status).not.toBe(400);
    });

    test('should require tenantId parameter', async () => {
      const response = await request(app)
        .get('/api/finance-admin/dashboard')
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('tenantId is required');
    });
  });

  describe('Ledger transactions endpoint', () => {
    test('should reject invalid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/ledger/transactions?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });

    test('should accept valid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/ledger/transactions?tenantId=${validUUID}`)
        .set(authHeaders);

      // Should pass UUID validation
      expect(response.status).not.toBe(400);
    });
  });

  describe('Ledger accounts endpoint', () => {
    test('should reject invalid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/ledger/accounts?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });
  });

  describe('Reconciliation batches endpoint', () => {
    test('should reject invalid UUID for tenantId', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/reconciliation/batches?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });
  });

  describe('Reports endpoints', () => {
    test('daily-escrow-balance should reject invalid UUID', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/reports/daily-escrow-balance?tenantId=${invalidUUID}&reportDate=2024-01-01`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });

    test('merchant-payables should reject invalid UUID', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/reports/merchant-payables?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });

    test('platform-revenue should reject invalid UUID', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/reports/platform-revenue?tenantId=${invalidUUID}&fromDate=2024-01-01&toDate=2024-01-31`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });

    test('settlement-aging should reject invalid UUID', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/reports/settlement-aging?tenantId=${invalidUUID}`)
        .set(authHeaders);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('valid UUID');
    });
  });

  describe('Authentication', () => {
    test('should require authentication headers', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/dashboard?tenantId=${validUUID}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Authentication required');
    });

    test('should require FINANCE_ADMIN or COMPLIANCE_ADMIN role', async () => {
      const response = await request(app)
        .get(`/api/finance-admin/dashboard?tenantId=${validUUID}`)
        .set({
          'x-user-role': 'CUSTOMER',
          'x-user-id': validUUID
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('FINANCE_ADMIN or COMPLIANCE_ADMIN role required');
    });
  });
});

describe('UUID Validation Function', () => {
  // Test the UUID validation regex pattern
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  test('should accept valid UUIDs', () => {
    const validUUIDs = [
      '123e4567-e89b-12d3-a456-426614174000',
      '00000000-0000-0000-0000-000000000000',
      'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    ];

    validUUIDs.forEach(uuid => {
      expect(uuidRegex.test(uuid)).toBe(true);
    });
  });

  test('should reject invalid UUIDs', () => {
    const invalidUUIDs = [
      'default',
      'default-tenant',
      'not-a-uuid',
      '123',
      '',
      'g1b2c3d4-e5f6-7890-abcd-ef1234567890', // invalid character 'g'
      '123e4567-e89b-12d3-a456-42661417400', // too short
      '123e4567-e89b-12d3-a456-4266141740000', // too long
      '123e4567e89b12d3a456426614174000' // missing hyphens
    ];

    invalidUUIDs.forEach(uuid => {
      expect(uuidRegex.test(uuid)).toBe(false);
    });
  });
});
