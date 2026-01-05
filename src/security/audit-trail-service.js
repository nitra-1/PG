/**
 * Audit Trail Service
 * Comprehensive audit logging for sensitive data access and actions
 * Ensures compliance with PCI-DSS requirement 10: Track and monitor all access to network resources and cardholder data
 */

const crypto = require('crypto');

class AuditTrailService {
  constructor(config, database) {
    this.config = config;
    this.database = database;
    this.hashAlgorithm = 'sha256';
  }

  /**
   * Log sensitive data access
   * @param {Object} accessDetails - Access details
   */
  async logDataAccess(accessDetails) {
    const {
      userId,
      action,
      resource,
      resourceId,
      dataType,
      ipAddress,
      userAgent,
      success,
      reason,
      metadata
    } = accessDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'DATA_ACCESS',
      userId: userId || 'SYSTEM',
      action, // READ, WRITE, UPDATE, DELETE, EXPORT
      resource, // CARD_DATA, CUSTOMER_INFO, TRANSACTION, etc.
      resourceId,
      dataType, // PCI_DATA, PII, FINANCIAL, etc.
      ipAddress,
      userAgent,
      success: success !== false,
      reason: reason || null,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
      hash: null // Will be set below
    };

    // Generate hash for tamper detection
    auditEntry.hash = this.generateAuditHash(auditEntry);

    // Store audit entry
    await this.storeAuditEntry(auditEntry);

    // Check for suspicious activity
    await this.checkSuspiciousActivity(auditEntry);

    return auditEntry;
  }

  /**
   * Log authentication events
   * @param {Object} authDetails - Authentication details
   */
  async logAuthentication(authDetails) {
    const {
      userId,
      method, // PASSWORD, BIOMETRIC, API_KEY, JWT
      success,
      failureReason,
      ipAddress,
      userAgent,
      mfaUsed
    } = authDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'AUTHENTICATION',
      userId: userId || 'UNKNOWN',
      method,
      success: success !== false,
      failureReason: failureReason || null,
      ipAddress,
      userAgent,
      mfaUsed: mfaUsed || false,
      timestamp: new Date().toISOString(),
      hash: null
    };

    auditEntry.hash = this.generateAuditHash(auditEntry);
    await this.storeAuditEntry(auditEntry);

    // Check for brute force attempts
    if (!success) {
      await this.checkBruteForceAttempts(userId, ipAddress);
    }

    return auditEntry;
  }

  /**
   * Log payment transaction
   * @param {Object} transactionDetails - Transaction details
   */
  async logTransaction(transactionDetails) {
    const {
      transactionId,
      userId,
      merchantId,
      amount,
      currency,
      paymentMethod,
      status,
      gatewayResponse,
      ipAddress,
      userAgent
    } = transactionDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'TRANSACTION',
      transactionId,
      userId: userId || 'GUEST',
      merchantId,
      amount,
      currency,
      paymentMethod,
      status,
      gatewayResponse: this.redactGatewayResponse(gatewayResponse),
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString(),
      hash: null
    };

    auditEntry.hash = this.generateAuditHash(auditEntry);
    await this.storeAuditEntry(auditEntry);

    return auditEntry;
  }

  /**
   * Log configuration changes
   * @param {Object} changeDetails - Configuration change details
   */
  async logConfigurationChange(changeDetails) {
    const {
      userId,
      configKey,
      oldValue,
      newValue,
      changeReason,
      ipAddress,
      userAgent
    } = changeDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'CONFIGURATION_CHANGE',
      userId,
      configKey,
      oldValue: this.redactIfSensitive(oldValue),
      newValue: this.redactIfSensitive(newValue),
      changeReason,
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString(),
      hash: null
    };

    auditEntry.hash = this.generateAuditHash(auditEntry);
    await this.storeAuditEntry(auditEntry);

    return auditEntry;
  }

  /**
   * Log security event
   * @param {Object} securityDetails - Security event details
   */
  async logSecurityEvent(securityDetails) {
    const {
      eventSubType,
      severity, // LOW, MEDIUM, HIGH, CRITICAL
      userId,
      description,
      ipAddress,
      userAgent,
      affectedResource,
      mitigationAction
    } = securityDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'SECURITY_EVENT',
      eventSubType, // BREACH_ATTEMPT, UNAUTHORIZED_ACCESS, SUSPICIOUS_ACTIVITY, etc.
      severity: severity || 'MEDIUM',
      userId: userId || 'UNKNOWN',
      description,
      ipAddress,
      userAgent,
      affectedResource,
      mitigationAction: mitigationAction || null,
      timestamp: new Date().toISOString(),
      hash: null
    };

    auditEntry.hash = this.generateAuditHash(auditEntry);
    await this.storeAuditEntry(auditEntry);

    // Alert on high severity events
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      await this.triggerSecurityAlert(auditEntry);
    }

    return auditEntry;
  }

  /**
   * Log API request
   * @param {Object} requestDetails - API request details
   */
  async logAPIRequest(requestDetails) {
    const {
      userId,
      merchantId,
      endpoint,
      method,
      statusCode,
      responseTime,
      ipAddress,
      userAgent,
      requestId
    } = requestDetails;

    const auditEntry = {
      eventId: this.generateEventId(),
      eventType: 'API_REQUEST',
      userId: userId || 'ANONYMOUS',
      merchantId,
      endpoint,
      method,
      statusCode,
      responseTime,
      ipAddress,
      userAgent,
      requestId,
      timestamp: new Date().toISOString(),
      hash: null
    };

    auditEntry.hash = this.generateAuditHash(auditEntry);
    await this.storeAuditEntry(auditEntry);

    return auditEntry;
  }

  /**
   * Generate unique event ID
   * @returns {string} Event ID
   */
  generateEventId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `AUD_${timestamp}_${random}`;
  }

  /**
   * Generate audit hash for tamper detection
   * @param {Object} entry - Audit entry
   * @returns {string} Hash
   */
  generateAuditHash(entry) {
    // Create a copy without the hash field
    const entryWithoutHash = { ...entry };
    delete entryWithoutHash.hash;

    // Include a secret key to prevent hash forgery
    const dataToHash = JSON.stringify(entryWithoutHash) + this.config.hmacSecret;
    
    return crypto
      .createHash(this.hashAlgorithm)
      .update(dataToHash)
      .digest('hex');
  }

  /**
   * Verify audit entry integrity
   * @param {Object} entry - Audit entry
   * @returns {boolean} Verification result
   */
  verifyAuditIntegrity(entry) {
    const storedHash = entry.hash;
    const calculatedHash = this.generateAuditHash(entry);
    
    return storedHash === calculatedHash;
  }

  /**
   * Store audit entry in database
   * @param {Object} entry - Audit entry
   */
  async storeAuditEntry(entry) {
    try {
      if (this.database && this.database.query) {
        await this.database.query(
          `INSERT INTO audit_trail (
            event_id, event_type, user_id, action, resource, 
            resource_id, data_type, ip_address, user_agent, 
            success, reason, metadata, timestamp, hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            entry.eventId,
            entry.eventType,
            entry.userId,
            entry.action || null,
            entry.resource || null,
            entry.resourceId || null,
            entry.dataType || null,
            entry.ipAddress || null,
            entry.userAgent || null,
            entry.success !== false,
            entry.reason || null,
            JSON.stringify(entry.metadata || {}),
            entry.timestamp,
            entry.hash
          ]
        );
      } else {
        // Fallback to console logging if database is not available
        console.log('[AUDIT]', JSON.stringify(entry));
      }
    } catch (error) {
      // Critical: audit logging failure should be logged
      console.error('[AUDIT ERROR]', error.message, entry);
      // In production, send to separate audit log system
    }
  }

  /**
   * Query audit trail
   * @param {Object} filters - Query filters
   * @returns {Array} Audit entries
   */
  async queryAuditTrail(filters) {
    const {
      userId,
      eventType,
      resource,
      startDate,
      endDate,
      ipAddress,
      limit = 100,
      offset = 0
    } = filters;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(userId);
    }

    if (eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      params.push(eventType);
    }

    if (resource) {
      conditions.push(`resource = $${paramIndex++}`);
      params.push(resource);
    }

    if (startDate) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(endDate);
    }

    if (ipAddress) {
      conditions.push(`ip_address = $${paramIndex++}`);
      params.push(ipAddress);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    params.push(limit, offset);

    const query = `
      SELECT * FROM audit_trail 
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    try {
      if (this.database && this.database.query) {
        const result = await this.database.query(query, params);
        return result.rows || [];
      }
      return [];
    } catch (error) {
      console.error('[AUDIT QUERY ERROR]', error.message);
      return [];
    }
  }

  /**
   * Check for suspicious activity patterns
   * @param {Object} entry - Audit entry
   */
  async checkSuspiciousActivity(entry) {
    // Check for unusual access patterns
    if (entry.eventType === 'DATA_ACCESS' && entry.dataType === 'PCI_DATA') {
      const recentAccesses = await this.getRecentAccessCount(entry.userId, 'PCI_DATA', 60000); // Last minute
      
      if (recentAccesses > 10) {
        await this.logSecurityEvent({
          eventSubType: 'SUSPICIOUS_ACTIVITY',
          severity: 'HIGH',
          userId: entry.userId,
          description: `Unusual number of PCI data accesses: ${recentAccesses} in last minute`,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          affectedResource: entry.resource
        });
      }
    }
  }

  /**
   * Check for brute force authentication attempts
   * @param {string} userId - User ID
   * @param {string} ipAddress - IP address
   */
  async checkBruteForceAttempts(userId, ipAddress) {
    const recentFailures = await this.getRecentAuthFailures(userId, ipAddress, 300000); // Last 5 minutes
    
    if (recentFailures > 5) {
      await this.logSecurityEvent({
        eventSubType: 'BRUTE_FORCE_ATTEMPT',
        severity: 'HIGH',
        userId,
        description: `Possible brute force attack: ${recentFailures} failed login attempts`,
        ipAddress,
        affectedResource: 'AUTHENTICATION'
      });
    }
  }

  /**
   * Get recent access count for a user
   * @param {string} userId - User ID
   * @param {string} dataType - Data type
   * @param {number} timeWindow - Time window in milliseconds
   * @returns {number} Access count
   */
  async getRecentAccessCount(userId, dataType, timeWindow) {
    const startTime = new Date(Date.now() - timeWindow).toISOString();
    
    try {
      if (this.database && this.database.query) {
        const result = await this.database.query(
          `SELECT COUNT(*) as count FROM audit_trail 
           WHERE user_id = $1 AND data_type = $2 AND timestamp >= $3`,
          [userId, dataType, startTime]
        );
        return parseInt(result.rows[0]?.count || 0);
      }
      return 0;
    } catch (error) {
      console.error('[AUDIT COUNT ERROR]', error.message);
      return 0;
    }
  }

  /**
   * Get recent authentication failures
   * @param {string} userId - User ID
   * @param {string} ipAddress - IP address
   * @param {number} timeWindow - Time window in milliseconds
   * @returns {number} Failure count
   */
  async getRecentAuthFailures(userId, ipAddress, timeWindow) {
    const startTime = new Date(Date.now() - timeWindow).toISOString();
    
    try {
      if (this.database && this.database.query) {
        const result = await this.database.query(
          `SELECT COUNT(*) as count FROM audit_trail 
           WHERE event_type = 'AUTHENTICATION' 
           AND (user_id = $1 OR ip_address = $2)
           AND success = false 
           AND timestamp >= $3`,
          [userId, ipAddress, startTime]
        );
        return parseInt(result.rows[0]?.count || 0);
      }
      return 0;
    } catch (error) {
      console.error('[AUDIT AUTH FAILURES ERROR]', error.message);
      return 0;
    }
  }

  /**
   * Trigger security alert
   * @param {Object} entry - Audit entry
   */
  async triggerSecurityAlert(entry) {
    // In production, this would:
    // 1. Send email to security team
    // 2. Send SMS to on-call engineer
    // 3. Create incident in monitoring system
    // 4. Trigger automated response if configured
    
    console.error('[SECURITY ALERT]', {
      severity: entry.severity,
      eventType: entry.eventSubType,
      description: entry.description,
      userId: entry.userId,
      timestamp: entry.timestamp
    });
  }

  /**
   * Redact gateway response sensitive data
   * @param {Object} response - Gateway response
   * @returns {Object} Redacted response
   */
  redactGatewayResponse(response) {
    if (!response || typeof response !== 'object') {
      return response;
    }

    const redacted = { ...response };
    const sensitiveFields = ['cardNumber', 'cvv', 'token', 'apiKey'];

    for (const field of sensitiveFields) {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    }

    return redacted;
  }

  /**
   * Redact sensitive configuration values
   * @param {any} value - Configuration value
   * @returns {any} Redacted value
   */
  redactIfSensitive(value) {
    if (typeof value === 'string') {
      const sensitivePatterns = [
        /key/i,
        /secret/i,
        /password/i,
        /token/i,
        /api/i
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(value)) {
          return '[REDACTED]';
        }
      }
    }

    return value;
  }

  /**
   * Generate audit report
   * @param {Object} reportParams - Report parameters
   * @returns {Object} Audit report
   */
  async generateAuditReport(reportParams) {
    const { startDate, endDate, eventTypes, userId } = reportParams;

    const entries = await this.queryAuditTrail({
      startDate,
      endDate,
      userId
    });

    // Aggregate statistics
    const stats = {
      totalEvents: entries.length,
      eventsByType: {},
      successfulActions: 0,
      failedActions: 0,
      uniqueUsers: new Set(),
      uniqueIPs: new Set()
    };

    entries.forEach(entry => {
      // Count by event type
      stats.eventsByType[entry.event_type] = (stats.eventsByType[entry.event_type] || 0) + 1;
      
      // Count success/failure
      if (entry.success) {
        stats.successfulActions++;
      } else {
        stats.failedActions++;
      }

      // Track unique users and IPs
      if (entry.user_id) stats.uniqueUsers.add(entry.user_id);
      if (entry.ip_address) stats.uniqueIPs.add(entry.ip_address);
    });

    stats.uniqueUsers = stats.uniqueUsers.size;
    stats.uniqueIPs = stats.uniqueIPs.size;

    return {
      reportPeriod: { startDate, endDate },
      statistics: stats,
      entries: entries.slice(0, 100), // Limit for report
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = AuditTrailService;
