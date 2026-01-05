/**
 * Tests for Audit Trail Service
 */

const AuditTrailService = require('../src/security/audit-trail-service');

describe('AuditTrailService', () => {
  let auditTrailService;
  let mockDatabase;
  const config = {
    hmacSecret: 'test-hmac-secret'
  };

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };
    auditTrailService = new AuditTrailService(config, mockDatabase);
  });

  describe('logDataAccess', () => {
    test('should log data access event', async () => {
      const accessDetails = {
        userId: 'USER_123',
        action: 'READ',
        resource: 'CARD_DATA',
        resourceId: 'tok_card_123',
        dataType: 'PCI_DATA',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        success: true
      };

      const result = await auditTrailService.logDataAccess(accessDetails);

      expect(result.eventId).toBeDefined();
      expect(result.eventType).toBe('DATA_ACCESS');
      expect(result.userId).toBe('USER_123');
      expect(result.action).toBe('READ');
      expect(result.hash).toBeDefined();
      expect(mockDatabase.query).toHaveBeenCalled();
    });

    test('should generate unique event IDs', async () => {
      const accessDetails = {
        userId: 'USER_123',
        action: 'READ',
        resource: 'CARD_DATA',
        dataType: 'PCI_DATA',
        ipAddress: '192.168.1.1'
      };

      const result1 = await auditTrailService.logDataAccess(accessDetails);
      const result2 = await auditTrailService.logDataAccess(accessDetails);

      expect(result1.eventId).not.toBe(result2.eventId);
    });

    test('should include timestamp', async () => {
      const accessDetails = {
        userId: 'USER_123',
        action: 'WRITE',
        resource: 'TRANSACTION',
        dataType: 'FINANCIAL'
      };

      const result = await auditTrailService.logDataAccess(accessDetails);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('logAuthentication', () => {
    test('should log successful authentication', async () => {
      const authDetails = {
        userId: 'USER_123',
        method: 'JWT',
        success: true,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        mfaUsed: true
      };

      const result = await auditTrailService.logAuthentication(authDetails);

      expect(result.eventType).toBe('AUTHENTICATION');
      expect(result.method).toBe('JWT');
      expect(result.success).toBe(true);
      expect(result.mfaUsed).toBe(true);
    });

    test('should log failed authentication with reason', async () => {
      const authDetails = {
        userId: 'USER_123',
        method: 'PASSWORD',
        success: false,
        failureReason: 'Invalid password',
        ipAddress: '192.168.1.1'
      };

      const result = await auditTrailService.logAuthentication(authDetails);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('Invalid password');
    });
  });

  describe('logTransaction', () => {
    test('should log payment transaction', async () => {
      const transactionDetails = {
        transactionId: 'TXN_123',
        userId: 'USER_123',
        merchantId: 'MERCHANT_001',
        amount: 1000,
        currency: 'INR',
        paymentMethod: 'CARD',
        status: 'SUCCESS',
        ipAddress: '192.168.1.1'
      };

      const result = await auditTrailService.logTransaction(transactionDetails);

      expect(result.eventType).toBe('TRANSACTION');
      expect(result.transactionId).toBe('TXN_123');
      expect(result.amount).toBe(1000);
      expect(result.status).toBe('SUCCESS');
    });

    test('should redact sensitive gateway response data', async () => {
      const transactionDetails = {
        transactionId: 'TXN_123',
        userId: 'USER_123',
        merchantId: 'MERCHANT_001',
        amount: 1000,
        currency: 'INR',
        paymentMethod: 'CARD',
        status: 'SUCCESS',
        gatewayResponse: {
          cardNumber: '4111111111111111',
          token: 'secret_token',
          status: 'approved'
        }
      };

      const result = await auditTrailService.logTransaction(transactionDetails);

      expect(result.gatewayResponse.cardNumber).toBe('[REDACTED]');
      expect(result.gatewayResponse.token).toBe('[REDACTED]');
      expect(result.gatewayResponse.status).toBe('approved');
    });
  });

  describe('logSecurityEvent', () => {
    test('should log security event', async () => {
      const securityDetails = {
        eventSubType: 'SUSPICIOUS_ACTIVITY',
        severity: 'HIGH',
        userId: 'USER_123',
        description: 'Multiple failed login attempts',
        ipAddress: '192.168.1.1'
      };

      const result = await auditTrailService.logSecurityEvent(securityDetails);

      expect(result.eventType).toBe('SECURITY_EVENT');
      expect(result.eventSubType).toBe('SUSPICIOUS_ACTIVITY');
      expect(result.severity).toBe('HIGH');
    });

    test('should default to MEDIUM severity if not specified', async () => {
      const securityDetails = {
        eventSubType: 'SUSPICIOUS_ACTIVITY',
        userId: 'USER_123',
        description: 'Unusual activity detected'
      };

      const result = await auditTrailService.logSecurityEvent(securityDetails);

      expect(result.severity).toBe('MEDIUM');
    });
  });

  describe('generateAuditHash', () => {
    test('should generate consistent hash for same data', () => {
      const entry = {
        eventId: 'AUD_123',
        eventType: 'DATA_ACCESS',
        userId: 'USER_123'
      };

      const hash1 = auditTrailService.generateAuditHash(entry);
      const hash2 = auditTrailService.generateAuditHash(entry);

      expect(hash1).toBe(hash2);
    });

    test('should generate different hash for different data', () => {
      const entry1 = {
        eventId: 'AUD_123',
        eventType: 'DATA_ACCESS',
        userId: 'USER_123'
      };

      const entry2 = {
        eventId: 'AUD_123',
        eventType: 'DATA_ACCESS',
        userId: 'USER_456'
      };

      const hash1 = auditTrailService.generateAuditHash(entry1);
      const hash2 = auditTrailService.generateAuditHash(entry2);

      expect(hash1).not.toBe(hash2);
    });

    test('should generate 64-character SHA-256 hash', () => {
      const entry = {
        eventId: 'AUD_123',
        eventType: 'DATA_ACCESS'
      };

      const hash = auditTrailService.generateAuditHash(entry);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyAuditIntegrity', () => {
    test('should verify valid audit entry', async () => {
      const accessDetails = {
        userId: 'USER_123',
        action: 'READ',
        resource: 'CARD_DATA',
        dataType: 'PCI_DATA'
      };

      const entry = await auditTrailService.logDataAccess(accessDetails);
      const isValid = auditTrailService.verifyAuditIntegrity(entry);

      expect(isValid).toBe(true);
    });

    test('should detect tampered audit entry', async () => {
      const accessDetails = {
        userId: 'USER_123',
        action: 'READ',
        resource: 'CARD_DATA',
        dataType: 'PCI_DATA'
      };

      const entry = await auditTrailService.logDataAccess(accessDetails);
      
      // Tamper with the entry
      entry.userId = 'TAMPERED_USER';

      const isValid = auditTrailService.verifyAuditIntegrity(entry);

      expect(isValid).toBe(false);
    });
  });

  describe('generateEventId', () => {
    test('should generate event ID with correct format', () => {
      const eventId = auditTrailService.generateEventId();

      expect(eventId).toMatch(/^AUD_\d+_[a-f0-9]{16}$/);
    });

    test('should generate unique event IDs', () => {
      const id1 = auditTrailService.generateEventId();
      const id2 = auditTrailService.generateEventId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('queryAuditTrail', () => {
    test('should query with user ID filter', async () => {
      await auditTrailService.queryAuditTrail({
        userId: 'USER_123',
        limit: 50
      });

      expect(mockDatabase.query).toHaveBeenCalled();
      const queryCall = mockDatabase.query.mock.calls[0];
      expect(queryCall[0]).toContain('user_id = $1');
      expect(queryCall[1]).toContain('USER_123');
    });

    test('should query with event type filter', async () => {
      await auditTrailService.queryAuditTrail({
        eventType: 'AUTHENTICATION',
        limit: 100
      });

      expect(mockDatabase.query).toHaveBeenCalled();
      const queryCall = mockDatabase.query.mock.calls[0];
      expect(queryCall[0]).toContain('event_type = $1');
      expect(queryCall[1]).toContain('AUTHENTICATION');
    });

    test('should query with date range', async () => {
      await auditTrailService.queryAuditTrail({
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      });

      expect(mockDatabase.query).toHaveBeenCalled();
      const queryCall = mockDatabase.query.mock.calls[0];
      expect(queryCall[0]).toContain('timestamp >=');
      expect(queryCall[0]).toContain('timestamp <=');
    });

    test('should use default limit and offset', async () => {
      await auditTrailService.queryAuditTrail({});

      const queryCall = mockDatabase.query.mock.calls[0];
      expect(queryCall[1]).toContain(100); // default limit
      expect(queryCall[1]).toContain(0);   // default offset
    });
  });

  describe('generateAuditReport', () => {
    test('should generate report with statistics', async () => {
      mockDatabase.query.mockResolvedValue({
        rows: [
          {
            event_type: 'DATA_ACCESS',
            success: true,
            user_id: 'USER_123',
            ip_address: '192.168.1.1'
          },
          {
            event_type: 'AUTHENTICATION',
            success: false,
            user_id: 'USER_456',
            ip_address: '192.168.1.2'
          }
        ]
      });

      const report = await auditTrailService.generateAuditReport({
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      });

      expect(report.statistics).toBeDefined();
      expect(report.statistics.totalEvents).toBe(2);
      expect(report.statistics.successfulActions).toBe(1);
      expect(report.statistics.failedActions).toBe(1);
      expect(report.statistics.uniqueUsers).toBe(2);
      expect(report.statistics.uniqueIPs).toBe(2);
    });
  });

  describe('checkSuspiciousActivity', () => {
    test('should detect excessive PCI data access', async () => {
      mockDatabase.query.mockResolvedValue({
        rows: [{ count: '15' }]
      });

      const entry = {
        eventType: 'DATA_ACCESS',
        dataType: 'PCI_DATA',
        userId: 'USER_123',
        resource: 'CARD_DATA',
        ipAddress: '192.168.1.1'
      };

      await auditTrailService.checkSuspiciousActivity(entry);

      // Should log a security event for suspicious activity
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_trail'),
        expect.arrayContaining([
          expect.any(String),
          'SECURITY_EVENT'
        ])
      );
    });
  });

  describe('redactGatewayResponse', () => {
    test('should redact sensitive fields', () => {
      const response = {
        cardNumber: '4111111111111111',
        cvv: '123',
        token: 'secret_token',
        status: 'approved',
        transactionId: 'TXN_123'
      };

      const redacted = auditTrailService.redactGatewayResponse(response);

      expect(redacted.cardNumber).toBe('[REDACTED]');
      expect(redacted.cvv).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.status).toBe('approved');
      expect(redacted.transactionId).toBe('TXN_123');
    });
  });

  describe('getRecentAccessCount', () => {
    test('should return access count', async () => {
      mockDatabase.query.mockResolvedValue({
        rows: [{ count: '5' }]
      });

      const count = await auditTrailService.getRecentAccessCount(
        'USER_123',
        'PCI_DATA',
        60000
      );

      expect(count).toBe(5);
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.arrayContaining(['USER_123', 'PCI_DATA'])
      );
    });
  });

  describe('getRecentAuthFailures', () => {
    test('should return authentication failure count', async () => {
      mockDatabase.query.mockResolvedValue({
        rows: [{ count: '3' }]
      });

      const count = await auditTrailService.getRecentAuthFailures(
        'USER_123',
        '192.168.1.1',
        300000
      );

      expect(count).toBe(3);
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('success = false'),
        expect.arrayContaining(['USER_123', '192.168.1.1'])
      );
    });
  });
});
