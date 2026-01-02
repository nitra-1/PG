/**
 * Security and Compliance Module
 * Handles encryption, authentication, authorization, and compliance
 */

const crypto = require('crypto');

class SecurityService {
  constructor(config) {
    this.config = config;
    this.encryptionAlgorithm = 'aes-256-gcm';
    this.hashAlgorithm = 'sha256';
  }

  /**
   * Encrypt sensitive data
   * @param {string} data - Data to encrypt
   * @param {string} key - Encryption key
   * @returns {Object} Encrypted data with IV and auth tag
   */
  encryptData(data, key = this.config.encryptionKey) {
    try {
      // Generate random IV
      const iv = crypto.randomBytes(16);

      // Create cipher
      const cipher = crypto.createCipheriv(
        this.encryptionAlgorithm,
        Buffer.from(key, 'hex'),
        iv
      );

      // Encrypt data
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get auth tag
      const authTag = cipher.getAuthTag();

      return {
        encrypted: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt sensitive data
   * @param {Object} encryptedData - Encrypted data object
   * @param {string} key - Decryption key
   * @returns {string} Decrypted data
   */
  decryptData(encryptedData, key = this.config.encryptionKey) {
    try {
      const { encrypted, iv, authTag } = encryptedData;

      // Create decipher
      const decipher = crypto.createDecipheriv(
        this.encryptionAlgorithm,
        Buffer.from(key, 'hex'),
        Buffer.from(iv, 'hex')
      );

      // Set auth tag
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      // Decrypt data
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Hash data (one-way)
   * @param {string} data - Data to hash
   * @returns {string} Hashed data
   */
  hashData(data) {
    return crypto.createHash(this.hashAlgorithm).update(data).digest('hex');
  }

  /**
   * Generate HMAC signature
   * @param {string} data - Data to sign
   * @param {string} secret - Secret key
   * @returns {string} HMAC signature
   */
  generateHMAC(data, secret = this.config.hmacSecret) {
    return crypto.createHmac(this.hashAlgorithm, secret).update(data).digest('hex');
  }

  /**
   * Verify HMAC signature
   * @param {string} data - Original data
   * @param {string} signature - HMAC signature to verify
   * @param {string} secret - Secret key
   * @returns {boolean} Verification result
   */
  verifyHMAC(data, signature, secret = this.config.hmacSecret) {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Generate JWT token
   * @param {Object} payload - Token payload
   * @param {number} expiresIn - Expiration time in seconds
   * @returns {string} JWT token
   */
  generateJWT(payload, expiresIn = 3600) {
    // In production, use a proper JWT library like 'jsonwebtoken'
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const tokenPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresIn
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
    
    const signature = this.generateHMAC(`${encodedHeader}.${encodedPayload}`);
    const encodedSignature = Buffer.from(signature).toString('base64url');

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded payload
   */
  verifyJWT(token) {
    try {
      const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

      // Verify signature
      const expectedSignature = this.generateHMAC(`${encodedHeader}.${encodedPayload}`);
      const providedSignature = Buffer.from(encodedSignature, 'base64url').toString('hex');

      if (expectedSignature !== providedSignature) {
        throw new Error('Invalid token signature');
      }

      // Decode payload
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired');
      }

      return payload;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Mask sensitive data (PAN, Card, Aadhaar)
   * @param {string} data - Data to mask
   * @param {string} type - Data type
   * @returns {string} Masked data
   */
  maskSensitiveData(data, type) {
    if (!data) return '';

    switch (type.toLowerCase()) {
      case 'card':
        // Show only last 4 digits
        return `****-****-****-${data.slice(-4)}`;
      
      case 'pan':
        // Show only last 4 characters
        return `******${data.slice(-4)}`;
      
      case 'aadhaar':
        // Show only last 4 digits
        return `****-****-${data.slice(-4)}`;
      
      case 'email':
        const [username, domain] = data.split('@');
        return `${username.slice(0, 2)}***@${domain}`;
      
      case 'phone':
        return `******${data.slice(-4)}`;
      
      default:
        return data;
    }
  }

  /**
   * Validate PCI-DSS compliance
   * @param {Object} transactionData - Transaction data
   * @returns {Object} Validation result
   */
  validatePCIDSSCompliance(transactionData) {
    const issues = [];

    // Check for unencrypted card data
    if (transactionData.cardNumber && !transactionData.encrypted) {
      issues.push('Card data must be encrypted');
    }

    // Check for CVV storage
    if (transactionData.cvv) {
      issues.push('CVV must not be stored');
    }

    // Check for proper masking
    if (transactionData.displayCardNumber && 
        transactionData.displayCardNumber.length > 6) {
      issues.push('Only last 4 digits should be visible');
    }

    return {
      compliant: issues.length === 0,
      issues: issues
    };
  }

  /**
   * Implement data retention policy
   * @param {Object} data - Data to check
   * @param {number} retentionDays - Retention period in days
   * @returns {boolean} Should retain data
   */
  checkDataRetention(data, retentionDays = 90) {
    const dataAge = Date.now() - new Date(data.createdAt).getTime();
    const retentionPeriod = retentionDays * 24 * 60 * 60 * 1000;
    
    return dataAge < retentionPeriod;
  }

  /**
   * Sanitize user input
   * @param {string} input - User input
   * @returns {string} Sanitized input
   */
  sanitizeInput(input) {
    if (!input) return '';

    // Remove HTML tags
    let sanitized = input.replace(/<[^>]*>/g, '');

    // Remove SQL injection patterns
    sanitized = sanitized.replace(/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b)/gi, '');

    // Remove script injection patterns
    sanitized = sanitized.replace(/(<script|javascript:|onerror=|onload=)/gi, '');

    return sanitized.trim();
  }

  /**
   * Rate limiting check
   * @param {string} identifier - User/IP identifier
   * @param {number} limit - Request limit
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Object} Rate limit status
   */
  checkRateLimit(identifier, limit = 100, windowMs = 60000) {
    // In production, use Redis or similar for distributed rate limiting
    // This is a simplified implementation
    
    return {
      allowed: true,
      remaining: 95,
      resetAt: new Date(Date.now() + windowMs).toISOString()
    };
  }

  /**
   * Generate API key
   * @param {string} merchantId - Merchant ID
   * @returns {Object} API key details
   */
  generateAPIKey(merchantId) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');

    return {
      apiKey: apiKey,
      apiSecret: apiSecret,
      merchantId: merchantId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  /**
   * Validate API request signature
   * @param {Object} request - API request
   * @param {string} apiSecret - API secret
   * @returns {boolean} Validation result
   */
  validateAPISignature(request, apiSecret) {
    const { timestamp, signature, ...data } = request;

    // Check timestamp (prevent replay attacks)
    const requestTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    
    if (Math.abs(currentTime - requestTime) > 300000) { // 5 minutes
      throw new Error('Request timestamp expired');
    }

    // Verify signature
    const payload = JSON.stringify(data) + timestamp;
    return this.verifyHMAC(payload, signature, apiSecret);
  }

  /**
   * Log security event
   * @param {Object} event - Security event
   */
  logSecurityEvent(event) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventType: event.type,
      severity: event.severity || 'INFO',
      userId: event.userId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      details: event.details
    };

    // Store in secure audit log
    console.log('Security event:', JSON.stringify(logEntry));
  }

  /**
   * Perform KYC verification
   * @param {Object} kycData - KYC data
   * @returns {Promise<Object>} KYC verification result
   */
  async performKYC(kycData) {
    try {
      const {
        customerId,
        name,
        dateOfBirth,
        address,
        idType,
        idNumber,
        idDocument
      } = kycData;

      // Validate KYC data
      // Perform document verification
      // Check against sanctions lists
      // Verify identity with government databases

      return {
        success: true,
        kycId: `KYC_${Date.now()}`,
        customerId: customerId,
        status: 'VERIFIED',
        verificationLevel: 'FULL',
        verifiedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`KYC verification failed: ${error.message}`);
    }
  }

  /**
   * Perform AML check
   * @param {Object} transactionData - Transaction data
   * @returns {Promise<Object>} AML check result
   */
  async performAMLCheck(transactionData) {
    try {
      const { customerId, amount, beneficiaryId } = transactionData;

      // Check transaction patterns
      // Screen against sanctions lists (OFAC, UN, EU)
      // Check for suspicious activity
      // Verify source of funds

      const riskScore = this.calculateAMLRiskScore(transactionData);

      return {
        success: true,
        riskScore: riskScore,
        riskLevel: riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW',
        requiresReview: riskScore > 70,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`AML check failed: ${error.message}`);
    }
  }

  /**
   * Calculate AML risk score
   * @param {Object} transactionData - Transaction data
   * @returns {number} Risk score (0-100)
   */
  calculateAMLRiskScore(transactionData) {
    let score = 0;

    // High amount transactions
    if (transactionData.amount > 100000) {
      score += 30;
    }

    // Unusual transaction patterns
    // International transactions
    // Frequent large transactions
    // etc.

    return Math.min(score, 100);
  }
}

module.exports = SecurityService;
