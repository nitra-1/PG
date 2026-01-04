/**
 * Merchant Service
 * Handles merchant onboarding, configuration, and management
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

class MerchantService {
  constructor(config) {
    this.config = config;
    this.SecurityService = require('../security/security-service');
    this.securityService = new this.SecurityService(config);
  }

  /**
   * Normalize and validate UUID
   * @param {string} uuid - UUID to validate and normalize
   * @param {string} fieldName - Name of the field for error messages
   * @returns {string} Normalized UUID
   * @private
   */
  _normalizeUUID(uuid, fieldName = 'ID') {
    if (!uuid) {
      throw new Error(`${fieldName} is required`);
    }
    
    // Normalize: trim and convert to lowercase
    const normalized = uuid.toString().trim().toLowerCase();
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(normalized)) {
      throw new Error(`Invalid ${fieldName} format: ${uuid}`);
    }
    
    return normalized;
  }

  /**
   * Register a new merchant
   * @param {Object} merchantData - Merchant registration data
   * @returns {Promise<Object>} Created merchant
   */
  async registerMerchant(merchantData) {
    try {
      const {
        merchantName,
        merchantCode,
        email,
        phone,
        businessType,
        address,
        websiteUrl,
        callbackUrl,
        businessDetails
      } = merchantData;

      // Validate required fields
      if (!merchantName || !email || !merchantCode) {
        throw new Error('Merchant name, email, and code are required');
      }

      // Check if merchant code already exists
      const existingMerchant = await db.query(
        'SELECT id FROM merchants WHERE merchant_code = $1',
        [merchantCode]
      );

      if (existingMerchant.rows.length > 0) {
        throw new Error('Merchant code already exists');
      }

      // Create merchant
      const merchantId = uuidv4();
      const result = await db.query(
        `INSERT INTO merchants (
          id, merchant_code, merchant_name, business_type, email, phone, 
          address, website_url, callback_url, business_details, status, 
          daily_limit, monthly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *`,
        [
          merchantId,
          merchantCode,
          merchantName,
          businessType || null,
          email,
          phone || null,
          JSON.stringify(address || {}),
          websiteUrl || null,
          callbackUrl || null,
          JSON.stringify(businessDetails || {}),
          'active',
          merchantData.dailyLimit || this.config.limits.dailyLimit,
          merchantData.monthlyLimit || this.config.limits.monthlyLimit
        ]
      );

      // Generate initial API key
      const apiKeyData = await this.generateAPIKey(merchantId, 'Primary Key', ['all']);

      // Log audit
      await db.logAudit({
        tenantId: merchantId,
        entityType: 'merchant',
        entityId: merchantId,
        action: 'create',
        userId: merchantData.createdBy || 'system',
        metadata: { merchantCode, email }
      });

      return {
        merchant: result.rows[0],
        apiKey: apiKeyData
      };
    } catch (error) {
      throw new Error(`Failed to register merchant: ${error.message}`);
    }
  }

  /**
   * Get merchant by ID
   * @param {string} merchantId - Merchant ID
   * @returns {Promise<Object>} Merchant details
   */
  async getMerchant(merchantId) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const result = await db.query(
        'SELECT * FROM merchants WHERE id::text = $1',
        [normalizedId]
      );

      if (result.rows.length === 0) {
        throw new Error('Merchant not found');
      }

      const merchant = result.rows[0];

      // Get API keys (excluding secrets)
      const apiKeysResult = await db.query(
        `SELECT id, key_name, api_key, status, last_used_at, expires_at, permissions, created_at
         FROM merchant_api_keys WHERE merchant_id::text = $1 ORDER BY created_at DESC`,
        [normalizedId]
      );

      // Get webhooks
      const webhooksResult = await db.query(
        `SELECT * FROM merchant_webhooks WHERE merchant_id::text = $1 ORDER BY created_at DESC`,
        [normalizedId]
      );

      // Get rate limits
      const rateLimitsResult = await db.query(
        `SELECT * FROM merchant_rate_limits WHERE merchant_id::text = $1 ORDER BY created_at DESC`,
        [normalizedId]
      );

      // Get IP whitelist
      const ipWhitelistResult = await db.query(
        `SELECT * FROM merchant_ip_whitelist WHERE merchant_id::text = $1 ORDER BY created_at DESC`,
        [merchantId]
      );

      return {
        ...merchant,
        apiKeys: apiKeysResult.rows,
        webhooks: webhooksResult.rows,
        rateLimits: rateLimitsResult.rows,
        ipWhitelist: ipWhitelistResult.rows
      };
    } catch (error) {
      throw new Error(`Failed to get merchant: ${error.message}`);
    }
  }

  /**
   * Update merchant settings
   * @param {string} merchantId - Merchant ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated merchant
   */
  async updateMerchant(merchantId, updates) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const allowedFields = [
        'merchant_name', 'business_type', 'email', 'phone', 'address',
        'website_url', 'callback_url', 'business_details', 'status',
        'daily_limit', 'monthly_limit', 'logo_url'
      ];

      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${paramIndex}`);
          
          // Handle JSON fields
          if (['address', 'business_details'].includes(key)) {
            values.push(JSON.stringify(updates[key]));
          } else {
            values.push(updates[key]);
          }
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(normalizedId);
      const query = `
        UPDATE merchants 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id::text = $${paramIndex}
        RETURNING *
      `;

      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        throw new Error('Merchant not found');
      }

      // Log audit
      await db.logAudit({
        tenantId: merchantId,
        entityType: 'merchant',
        entityId: merchantId,
        action: 'update',
        changesAfter: updates
      });

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to update merchant: ${error.message}`);
    }
  }

  /**
   * Delete merchant
   * @param {string} merchantId - Merchant ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteMerchant(merchantId) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      // Check if merchant exists
      const merchant = await this.getMerchant(normalizedId);

      // Soft delete - update status to inactive
      await db.query(
        'UPDATE merchants SET status = $1, updated_at = NOW() WHERE id::text = $2',
        ['inactive', normalizedId]
      );

      // Revoke all API keys
      await db.query(
        'UPDATE merchant_api_keys SET status = $1, updated_at = NOW() WHERE merchant_id::text = $2',
        ['revoked', normalizedId]
      );

      // Log audit
      await db.logAudit({
        tenantId: normalizedId,
        entityType: 'merchant',
        entityId: normalizedId,
        action: 'delete'
      });

      return {
        success: true,
        message: 'Merchant deleted successfully'
      };
    } catch (error) {
      throw new Error(`Failed to delete merchant: ${error.message}`);
    }
  }

  /**
   * Generate API key for merchant
   * @param {string} merchantId - Merchant ID
   * @param {string} keyName - Name for the API key
   * @param {Array} permissions - API permissions
   * @returns {Promise<Object>} API key details
   */
  async generateAPIKey(merchantId, keyName = 'API Key', permissions = ['all']) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const apiKey = `pk_${crypto.randomBytes(32).toString('hex')}`;
      const apiSecret = `sk_${crypto.randomBytes(32).toString('hex')}`;
      
      // Hash the secret for verification
      const apiSecretHash = this.securityService.hashData(apiSecret);
      
      // Encrypt the secret for storage
      const encryptedSecret = this.securityService.encryptData(apiSecret);

      const keyId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year expiration

      await db.query(
        `INSERT INTO merchant_api_keys (
          id, merchant_id, key_name, api_key, api_secret_encrypted, 
          api_secret_iv, api_secret_auth_tag, api_secret_hash, 
          status, expires_at, permissions, created_at, updated_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
        [
          keyId,
          normalizedId,
          keyName,
          apiKey,
          encryptedSecret.encrypted,
          encryptedSecret.iv,
          encryptedSecret.authTag,
          apiSecretHash,
          'active',
          expiresAt,
          JSON.stringify(permissions)
        ]
      );

      // Log audit
      await db.logAudit({
        tenantId: merchantId,
        entityType: 'api_key',
        entityId: keyId,
        action: 'create',
        metadata: { keyName }
      });

      return {
        keyId,
        apiKey,
        apiSecret, // Only returned on creation
        keyName,
        expiresAt: expiresAt.toISOString(),
        message: 'Store the API secret securely. It will not be shown again.'
      };
    } catch (error) {
      throw new Error(`Failed to generate API key: ${error.message}`);
    }
  }

  /**
   * Revoke API key
   * @param {string} merchantId - Merchant ID
   * @param {string} keyId - API key ID
   * @returns {Promise<Object>} Revocation result
   */
  async revokeAPIKey(merchantId, keyId) {
    try {
      // Normalize and validate UUIDs
      const normalizedMerchantId = this._normalizeUUID(merchantId, 'Merchant ID');
      const normalizedKeyId = this._normalizeUUID(keyId, 'Key ID');
      
      const result = await db.query(
        `UPDATE merchant_api_keys 
         SET status = $1, updated_at = NOW()
         WHERE id::text = $2 AND merchant_id::text = $3
         RETURNING *`,
        ['revoked', normalizedKeyId, normalizedMerchantId]
      );

      if (result.rows.length === 0) {
        throw new Error('API key not found');
      }

      // Log audit
      await db.logAudit({
        tenantId: normalizedMerchantId,
        entityType: 'api_key',
        entityId: normalizedKeyId,
        action: 'update',
        metadata: { status: 'revoked' }
      });

      return {
        success: true,
        message: 'API key revoked successfully'
      };
    } catch (error) {
      throw new Error(`Failed to revoke API key: ${error.message}`);
    }
  }

  /**
   * Configure webhook for merchant
   * @param {string} merchantId - Merchant ID
   * @param {Object} webhookData - Webhook configuration
   * @returns {Promise<Object>} Webhook details
   */
  async configureWebhook(merchantId, webhookData) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const {
        webhookUrl,
        events = ['payment.success', 'payment.failed', 'refund.processed'],
        retryAttempts = 3,
        retryDelay = 5000,
        timeout = 30000
      } = webhookData;

      if (!webhookUrl) {
        throw new Error('Webhook URL is required');
      }

      // Generate webhook secret
      const webhookSecret = crypto.randomBytes(32).toString('hex');

      const webhookId = uuidv4();
      await db.query(
        `INSERT INTO merchant_webhooks (
          id, merchant_id, webhook_url, webhook_secret, status, events,
          retry_attempts, retry_delay, timeout, created_at, updated_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *`,
        [
          webhookId,
          normalizedId,
          webhookUrl,
          webhookSecret,
          'active',
          JSON.stringify(events),
          retryAttempts,
          retryDelay,
          timeout
        ]
      );

      // Log audit
      await db.logAudit({
        tenantId: normalizedId,
        entityType: 'webhook',
        entityId: webhookId,
        action: 'create',
        metadata: { webhookUrl, events }
      });

      return {
        webhookId,
        webhookUrl,
        webhookSecret,
        events,
        message: 'Webhook configured successfully. Store the secret securely.'
      };
    } catch (error) {
      throw new Error(`Failed to configure webhook: ${error.message}`);
    }
  }

  /**
   * Update webhook configuration
   * @param {string} merchantId - Merchant ID
   * @param {string} webhookId - Webhook ID
   * @param {Object} updates - Webhook updates
   * @returns {Promise<Object>} Updated webhook
   */
  async updateWebhook(merchantId, webhookId, updates) {
    try {
      // Normalize and validate UUIDs
      const normalizedMerchantId = this._normalizeUUID(merchantId, 'Merchant ID');
      const normalizedWebhookId = this._normalizeUUID(webhookId, 'Webhook ID');
      
      const allowedFields = ['webhook_url', 'status', 'events', 'retry_attempts', 'retry_delay', 'timeout'];
      
      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${paramIndex}`);
          
          if (key === 'events') {
            values.push(JSON.stringify(updates[key]));
          } else {
            values.push(updates[key]);
          }
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(normalizedWebhookId);
      values.push(normalizedMerchantId);
      
      const query = `
        UPDATE merchant_webhooks 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id::text = $${paramIndex} AND merchant_id::text = $${paramIndex + 1}
        RETURNING *
      `;

      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        throw new Error('Webhook not found');
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to update webhook: ${error.message}`);
    }
  }

  /**
   * Configure rate limit for merchant
   * @param {string} merchantId - Merchant ID
   * @param {Object} rateLimitData - Rate limit configuration
   * @returns {Promise<Object>} Rate limit details
   */
  async configureRateLimit(merchantId, rateLimitData) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const {
        endpointPattern = '/api/*',
        maxRequests = 100,
        windowMs = 60000 // 1 minute
      } = rateLimitData;

      // Check if rate limit already exists for this endpoint
      const existing = await db.query(
        'SELECT id FROM merchant_rate_limits WHERE merchant_id::text = $1 AND endpoint_pattern = $2',
        [normalizedId, endpointPattern]
      );

      if (existing.rows.length > 0) {
        // Update existing
        const result = await db.query(
          `UPDATE merchant_rate_limits 
           SET max_requests = $1, window_ms = $2, updated_at = NOW()
           WHERE merchant_id::text = $3 AND endpoint_pattern = $4
           RETURNING *`,
          [maxRequests, windowMs, normalizedId, endpointPattern]
        );
        
        return result.rows[0];
      } else {
        // Create new
        const rateLimitId = uuidv4();
        const result = await db.query(
          `INSERT INTO merchant_rate_limits (
            id, merchant_id, endpoint_pattern, max_requests, window_ms, status, created_at, updated_at
          ) VALUES ($1, $2::uuid, $3, $4, $5, $6, NOW(), NOW())
          RETURNING *`,
          [rateLimitId, normalizedId, endpointPattern, maxRequests, windowMs, 'active']
        );

        // Log audit
        await db.logAudit({
          tenantId: normalizedId,
          entityType: 'rate_limit',
          entityId: rateLimitId,
          action: 'create',
          metadata: { endpointPattern, maxRequests, windowMs }
        });

        return result.rows[0];
      }
    } catch (error) {
      throw new Error(`Failed to configure rate limit: ${error.message}`);
    }
  }

  /**
   * Add IP to whitelist
   * @param {string} merchantId - Merchant ID
   * @param {Object} ipData - IP whitelist data
   * @returns {Promise<Object>} IP whitelist entry
   */
  async addIPToWhitelist(merchantId, ipData) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const { ipAddress, description } = ipData;

      if (!ipAddress) {
        throw new Error('IP address is required');
      }

      // Validate IPv4 format
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipv4Match = ipAddress.match(ipv4Regex);
      
      if (ipv4Match) {
        // Validate each octet is between 0-255
        const octets = ipv4Match.slice(1);
        const validOctets = octets.every(octet => {
          const num = parseInt(octet, 10);
          return num >= 0 && num <= 255;
        });
        
        if (!validOctets) {
          throw new Error('Invalid IPv4 address: octets must be between 0-255');
        }
      } else {
        // Validate IPv6 format (basic validation)
        const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
        
        if (!ipv6Regex.test(ipAddress)) {
          throw new Error('Invalid IP address format');
        }
      }

      // Check if IP already exists
      const existing = await db.query(
        'SELECT id FROM merchant_ip_whitelist WHERE merchant_id::text = $1 AND ip_address = $2',
        [normalizedId, ipAddress]
      );

      if (existing.rows.length > 0) {
        throw new Error('IP address already in whitelist');
      }

      const ipId = uuidv4();
      const result = await db.query(
        `INSERT INTO merchant_ip_whitelist (
          id, merchant_id, ip_address, description, status, created_at, updated_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, NOW(), NOW())
        RETURNING *`,
        [ipId, normalizedId, ipAddress, description || null, 'active']
      );

      // Log audit
      await db.logAudit({
        tenantId: normalizedId,
        entityType: 'ip_whitelist',
        entityId: ipId,
        action: 'create',
        metadata: { ipAddress, description }
      });

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to add IP to whitelist: ${error.message}`);
    }
  }

  /**
   * Remove IP from whitelist
   * @param {string} merchantId - Merchant ID
   * @param {string} ipId - IP whitelist entry ID
   * @returns {Promise<Object>} Deletion result
   */
  async removeIPFromWhitelist(merchantId, ipId) {
    try {
      // Normalize and validate UUIDs
      const normalizedMerchantId = this._normalizeUUID(merchantId, 'Merchant ID');
      const normalizedIpId = this._normalizeUUID(ipId, 'IP Entry ID');
      
      const result = await db.query(
        'DELETE FROM merchant_ip_whitelist WHERE id::text = $1 AND merchant_id::text = $2 RETURNING *',
        [normalizedIpId, normalizedMerchantId]
      );

      if (result.rows.length === 0) {
        throw new Error('IP whitelist entry not found');
      }

      // Log audit
      await db.logAudit({
        tenantId: normalizedMerchantId,
        entityType: 'ip_whitelist',
        entityId: normalizedIpId,
        action: 'delete'
      });

      return {
        success: true,
        message: 'IP removed from whitelist'
      };
    } catch (error) {
      throw new Error(`Failed to remove IP from whitelist: ${error.message}`);
    }
  }

  /**
   * Get merchant usage statistics
   * @param {string} merchantId - Merchant ID
   * @param {Object} filters - Date filters
   * @returns {Promise<Object>} Usage statistics
   */
  async getUsageStatistics(merchantId, filters = {}) {
    try {
      // Normalize and validate UUID
      const normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      
      const { startDate, endDate } = filters;
      
      let query = `
        SELECT 
          date,
          endpoint,
          SUM(request_count) as total_requests,
          SUM(success_count) as successful_requests,
          SUM(error_count) as failed_requests,
          SUM(total_amount) as total_amount,
          SUM(transaction_count) as total_transactions
        FROM merchant_usage_stats
        WHERE merchant_id::text = $1
      `;
      
      const values = [normalizedId];
      let paramIndex = 2;

      if (startDate) {
        query += ` AND date >= $${paramIndex}`;
        values.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        query += ` AND date <= $${paramIndex}`;
        values.push(endDate);
        paramIndex++;
      }

      query += ' GROUP BY date, endpoint ORDER BY date DESC, endpoint';

      const result = await db.query(query, values);

      // Calculate totals
      const totals = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalAmount: 0,
        totalTransactions: 0
      };

      result.rows.forEach(row => {
        totals.totalRequests += parseInt(row.total_requests);
        totals.successfulRequests += parseInt(row.successful_requests);
        totals.failedRequests += parseInt(row.failed_requests);
        totals.totalAmount += parseFloat(row.total_amount);
        totals.totalTransactions += parseInt(row.total_transactions);
      });

      return {
        statistics: result.rows,
        summary: totals
      };
    } catch (error) {
      throw new Error(`Failed to get usage statistics: ${error.message}`);
    }
  }

  /**
   * Track API usage
   * @param {string} merchantId - Merchant ID
   * @param {Object} usageData - Usage data
   * @returns {Promise<void>}
   */
  async trackUsage(merchantId, usageData) {
    try {
      // Normalize and validate UUID - but don't fail if invalid (just log)
      let normalizedId;
      try {
        normalizedId = this._normalizeUUID(merchantId, 'Merchant ID');
      } catch (error) {
        console.error(`Invalid merchant ID in trackUsage: ${merchantId}`, error.message);
        return; // Silent return to avoid disrupting main request
      }
      
      const {
        endpoint,
        success = true,
        amount = 0,
        transactionCount = 0
      } = usageData;

      const today = new Date().toISOString().split('T')[0];
      const usageId = require('uuid').v4();

      // Upsert usage statistics
      await db.query(
        `INSERT INTO merchant_usage_stats (
          id, merchant_id, date, endpoint, request_count, success_count, 
          error_count, total_amount, transaction_count, created_at, updated_at
        ) VALUES (
          $1, $2::uuid, $3, $4, 1, $5, $6, $7, $8, NOW(), NOW()
        )
        ON CONFLICT (merchant_id, date, endpoint)
        DO UPDATE SET
          request_count = merchant_usage_stats.request_count + 1,
          success_count = merchant_usage_stats.success_count + $5,
          error_count = merchant_usage_stats.error_count + $6,
          total_amount = merchant_usage_stats.total_amount + $7,
          transaction_count = merchant_usage_stats.transaction_count + $8,
          updated_at = NOW()`,
        [
          usageId,
          normalizedId,
          today,
          endpoint,
          success ? 1 : 0,
          success ? 0 : 1,
          amount,
          transactionCount
        ]
      );

      // Update merchant's last_active_at
      await db.query(
        'UPDATE merchants SET last_active_at = NOW() WHERE id::text = $1',
        [normalizedId]
      );
    } catch (error) {
      console.error(`Failed to track usage for merchant ${merchantId} on endpoint ${usageData.endpoint}:`, error.message);
      // Don't throw error to avoid disrupting the main request
    }
  }

  /**
   * Verify API key
   * @param {string} apiKey - API key to verify
   * @returns {Promise<Object>} Merchant and key details
   */
  async verifyAPIKey(apiKey) {
    try {
      const result = await db.query(
        `SELECT 
          k.*, 
          m.id as merchant_id, 
          m.merchant_code, 
          m.merchant_name, 
          m.status as merchant_status,
          m.daily_limit,
          m.monthly_limit
         FROM merchant_api_keys k
         JOIN merchants m ON k.merchant_id = m.id
         WHERE k.api_key = $1 AND k.status = 'active' AND m.status = 'active'`,
        [apiKey]
      );

      if (result.rows.length === 0) {
        throw new Error('Invalid or inactive API key');
      }

      const keyData = result.rows[0];

      // Check expiration
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        throw new Error('API key has expired');
      }

      // Update last used
      await db.query(
        'UPDATE merchant_api_keys SET last_used_at = NOW() WHERE id = $1',
        [keyData.id]
      );

      return {
        merchantId: keyData.merchant_id,
        merchantCode: keyData.merchant_code,
        merchantName: keyData.merchant_name,
        permissions: keyData.permissions,
        dailyLimit: keyData.daily_limit,
        monthlyLimit: keyData.monthly_limit
      };
    } catch (error) {
      throw new Error(`API key verification failed: ${error.message}`);
    }
  }
}

module.exports = MerchantService;
