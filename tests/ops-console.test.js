/**
 * Tests for Platform Ops Console
 * Comprehensive security and functionality tests
 */

const request = require('supertest');
const express = require('express');
const opsConsoleRoutes = require('../src/ops-console');
const db = require('../src/database');
const AuditTrailService = require('../src/security/audit-trail-service');

// Mock database
jest.mock('../src/database');

describe('Platform Ops Console - Security Tests', () => {
  let app;
  let mockAuditTrailService;
  
  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mock audit trail service
    mockAuditTrailService = {
      logDataAccess: jest.fn().mockResolvedValue({}),
      logSecurityEvent: jest.fn().mockResolvedValue({})
    };
    
    app.locals.auditTrailService = mockAuditTrailService;
    
    // Mount routes
    app.use('/api/ops', opsConsoleRoutes);
    
    // Mock database responses
    db.query = jest.fn().mockResolvedValue({ rows: [] });
  });
  
  describe('Access Control', () => {
    test('should block access without role header', async () => {
      const response = await request(app)
        .get('/api/ops/merchants');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('PLATFORM_ADMIN or OPS_ADMIN role required');
    });
    
    test('should block MERCHANT role', async () => {
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'MERCHANT')
        .set('x-user-id', 'merchant-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('PLATFORM_ADMIN or OPS_ADMIN role required');
    });
    
    test('should block FINANCE_ADMIN role from ops console', async () => {
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'FINANCE_ADMIN')
        .set('x-user-id', 'finance-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('PLATFORM_ADMIN or OPS_ADMIN role required');
      expect(response.body.message).toContain('Finance operations are managed separately');
    });
    
    test('should allow PLATFORM_ADMIN access', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
    });
    
    test('should allow OPS_ADMIN access', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'OPS_ADMIN')
        .set('x-user-id', 'ops-admin-123');
      
      expect(response.status).toBe(200);
    });
  });
  
  describe('Finance Isolation', () => {
    test('should block access to paths containing "ledger"', async () => {
      const response = await request(app)
        .get('/api/ops/ledger/entries')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Finance operations not allowed');
      expect(response.body.message).toContain('cannot influence money movement');
    });
    
    test('should block access to paths containing "settlement"', async () => {
      const response = await request(app)
        .get('/api/ops/settlement/confirm')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Finance operations not allowed');
    });
    
    test('should block access to paths containing "accounting-period"', async () => {
      const response = await request(app)
        .post('/api/ops/accounting-period/lock')
        .set('x-user-role', 'OPS_ADMIN')
        .set('x-user-id', 'ops-123');
      
      expect(response.status).toBe(403);
    });
    
    test('should log security event when finance access attempted', async () => {
      await request(app)
        .get('/api/ops/ledger/entries')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(mockAuditTrailService.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventSubType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
          severity: 'HIGH',
          userId: 'admin-123'
        })
      );
    });
  });
  
  describe('Transaction Monitoring', () => {
    test('should allow GET requests for transaction monitoring', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })
               .mockResolvedValueOnce({ rows: [{ count: '0' }] });
      
      const response = await request(app)
        .get('/api/ops/transactions')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('note');
      expect(response.body.note).toContain('read-only');
    });
    
    test('should block POST requests on transaction monitoring', async () => {
      const response = await request(app)
        .post('/api/ops/transactions/test-id/refund')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ amount: 100 });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('read-only');
      expect(response.body.message).toContain('Merchants initiate refunds');
    });
    
    test('should block PUT requests on transaction monitoring', async () => {
      const response = await request(app)
        .put('/api/ops/transactions/test-id')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ status: 'cancelled' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('read-only');
    });
    
    test('should block DELETE requests on transaction monitoring', async () => {
      const response = await request(app)
        .delete('/api/ops/transactions/test-id')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('read-only');
    });
  });
  
  describe('Merchant Management', () => {
    test('should allow merchant suspension with reason', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ id: 'merchant-123', business_name: 'Test Merchant', status: 'suspended' }] 
      });
      
      const response = await request(app)
        .put('/api/ops/merchants/merchant-123/suspend')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ reason: 'Compliance review' });
      
      expect(response.status).toBe(200);
      expect(response.body.note).toContain('Scheduled settlements will continue');
      expect(response.body.message).toContain('suspended successfully');
    });
    
    test('should reject suspension without reason', async () => {
      const response = await request(app)
        .put('/api/ops/merchants/merchant-123/suspend')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reason is required');
      expect(response.body.error).toContain('audit compliance');
    });
    
    test('should log suspension with audit trail', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ id: 'merchant-123', business_name: 'Test Merchant', status: 'suspended' }] 
      });
      
      await request(app)
        .put('/api/ops/merchants/merchant-123/suspend')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ reason: 'Security issue' });
      
      expect(mockAuditTrailService.logDataAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-123',
          action: 'SUSPEND',
          resource: 'MERCHANT',
          resourceId: 'merchant-123',
          metadata: expect.objectContaining({
            reason: 'Security issue',
            note: expect.stringContaining('not financial data')
          })
        })
      );
    });
  });
  
  describe('User Management', () => {
    test('should block self-role escalation', async () => {
      const response = await request(app)
        .put('/api/ops/users/admin-123/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'PLATFORM_ADMIN' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot modify your own role');
      expect(response.body.message).toContain('Self-role escalation is not allowed');
    });
    
    test('should block FINANCE_ADMIN role assignment', async () => {
      const response = await request(app)
        .put('/api/ops/users/user-456/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'FINANCE_ADMIN' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot assign finance roles');
      expect(response.body.message).toContain('system administrators through secure channels');
    });
    
    test('should require approval for PLATFORM_ADMIN role', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ id: 'user-456', username: 'testuser', role: 'OPS_ADMIN' }] 
      }).mockResolvedValueOnce({
        rows: [{ id: 'approval-123' }]
      });
      
      const response = await request(app)
        .put('/api/ops/users/user-456/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'PLATFORM_ADMIN' });
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('requires dual approval');
      expect(response.body).toHaveProperty('approvalRequestId');
      expect(response.body.note).toContain('Another PLATFORM_ADMIN must approve');
    });
    
    test('should allow OPS_ADMIN role assignment without approval', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ id: 'user-456', username: 'testuser', role: 'MERCHANT' }] 
      }).mockResolvedValueOnce({
        rows: [{ id: 'user-456', username: 'testuser', role: 'OPS_ADMIN' }]
      });
      
      const response = await request(app)
        .put('/api/ops/users/user-456/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'OPS_ADMIN' });
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated successfully');
      expect(response.body).not.toHaveProperty('approvalRequestId');
    });
    
    test('should block FINANCE_ADMIN role creation', async () => {
      const response = await request(app)
        .post('/api/ops/users')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({
          username: 'financeuser',
          email: 'finance@test.com',
          password: 'password123',
          role: 'FINANCE_ADMIN'
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot assign finance roles');
    });
    
    test('should prevent self-disable', async () => {
      const response = await request(app)
        .put('/api/ops/users/admin-123/status')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ status: 'disabled' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot modify your own status');
    });
  });
  
  describe('System Configuration', () => {
    test('should block financial configuration access', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ 
          id: 'config-123', 
          config_key: 'settlement_timing', 
          is_financial: true 
        }] 
      });
      
      const response = await request(app)
        .get('/api/ops/system-config/settlement_timing')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot access financial configuration');
      expect(response.body.message).toContain('FINANCE_ADMIN role');
    });
    
    test('should block financial configuration update', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ 
          id: 'config-123', 
          config_key: 'settlement_timing', 
          is_financial: true,
          config_value: '2d'
        }] 
      });
      
      const response = await request(app)
        .put('/api/ops/system-config/settlement_timing')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ value: '1d', reason: 'Speed up settlements' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot modify financial configuration');
      expect(response.body.message).toContain('FINANCE_ADMIN role');
    });
    
    test('should allow non-financial configuration access', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ 
          id: 'config-123', 
          config_key: 'feature_flag_qr', 
          config_value: true,
          is_financial: false,
          category: 'feature_flags',
          description: 'Enable QR payments'
        }] 
      });
      
      const response = await request(app)
        .get('/api/ops/system-config/feature_flag_qr')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body.config.config_key).toBe('feature_flag_qr');
    });
    
    test('should allow non-financial configuration update with reason', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ 
          id: 'config-123', 
          config_key: 'feature_flag_qr', 
          is_financial: false,
          config_value: false
        }] 
      }).mockResolvedValueOnce({
        rows: [{ 
          id: 'config-123', 
          config_key: 'feature_flag_qr', 
          config_value: true,
          version: 2
        }]
      }).mockResolvedValueOnce({ rows: [] });
      
      const response = await request(app)
        .put('/api/ops/system-config/feature_flag_qr')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ value: true, reason: 'Enable QR payments for merchants' });
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated successfully');
    });
    
    test('should require reason for configuration update', async () => {
      const response = await request(app)
        .put('/api/ops/system-config/some_config')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ value: 'new_value' });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reason is required');
      expect(response.body.error).toContain('audit compliance');
    });
    
    test('should only list non-financial configs', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [
          { config_key: 'feature_flag_qr', is_financial: false },
          { config_key: 'max_retry_attempts', is_financial: false }
        ] 
      });
      
      const response = await request(app)
        .get('/api/ops/system-config')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body.note).toContain('Financial configurations are not accessible');
      expect(response.body.configs).toHaveLength(2);
    });
  });
  
  describe('Audit Logging', () => {
    test('should log all ops console actions', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      
      await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      // Wait for async logging
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(mockAuditTrailService.logDataAccess).toHaveBeenCalled();
    });
  });
  
  describe('Gateway Health', () => {
    test('should allow gateway health status check', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [
          { gateway: 'razorpay', state: 'closed', failure_count: 0 },
          { gateway: 'stripe', state: 'open', failure_count: 5 }
        ] 
      });
      
      const response = await request(app)
        .get('/api/ops/gateway-health/status')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body.gateways).toHaveLength(2);
    });
    
    test('should allow gateway metrics access', async () => {
      db.query.mockResolvedValueOnce({ 
        rows: [{ 
          total_requests: 1000, 
          success_count: 950, 
          failed_count: 50,
          success_rate: 95.0
        }] 
      });
      
      const response = await request(app)
        .get('/api/ops/gateway-health/razorpay/metrics')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body.metrics).toHaveProperty('success_rate');
    });
  });
  
  describe('Dashboard', () => {
    test('should provide dashboard summary data', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: '50' }] })
               .mockResolvedValueOnce({ rows: [{ total: 1000, success: 950, last_24h: 100 }] })
               .mockResolvedValueOnce({ rows: [] });
      
      const response = await request(app)
        .get('/api/ops/dashboard')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123');
      
      expect(response.status).toBe(200);
      expect(response.body.dashboard).toHaveProperty('merchants');
      expect(response.body.dashboard).toHaveProperty('transactions');
      expect(response.body.dashboard).toHaveProperty('gateways');
    });
  });
});
