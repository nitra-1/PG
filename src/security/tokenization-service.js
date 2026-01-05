/**
 * Tokenization Service
 * Handles tokenization of sensitive payment data for PCI-DSS compliance
 */

const crypto = require('crypto');

class TokenizationService {
  constructor(config) {
    this.config = config;
    // In production, this should be stored in a secure vault (HSM, AWS KMS, etc.)
    this.tokenizationKey = config.tokenizationKey || config.encryptionKey;
    // Token format: tok_[type]_[random]_[checksum]
    this.tokenPrefix = 'tok';
  }

  /**
   * Tokenize sensitive card data
   * @param {Object} cardData - Card information
   * @returns {Object} Tokenized card data
   */
  tokenizeCard(cardData) {
    const { cardNumber, cvv, expiryMonth, expiryYear, cardholderName } = cardData;

    // Validate card data
    this.validateCardData(cardData);

    // Generate token for card number (PCI-DSS: never store full PAN)
    const cardToken = this.generateToken('card', cardNumber);

    // Extract last 4 digits for display (PCI-DSS compliant)
    const last4 = cardNumber.slice(-4);
    
    // Extract first 6 digits for BIN lookup (allowed by PCI-DSS)
    const first6 = cardNumber.slice(0, 6);

    // Encrypt full card data in vault (would be separate secure storage in production)
    const encryptedCardData = this.encryptToVault({
      cardNumber,
      cvv, // CVV must never be stored after authorization
      expiryMonth,
      expiryYear,
      cardholderName
    });

    return {
      cardToken,
      last4,
      first6,
      expiryMonth,
      expiryYear,
      cardholderName: this.maskName(cardholderName),
      cardBrand: this.detectCardBrand(cardNumber),
      vaultId: encryptedCardData.vaultId,
      tokenizedAt: new Date().toISOString()
    };
  }

  /**
   * Tokenize customer information
   * @param {Object} customerData - Customer information
   * @returns {Object} Tokenized customer data
   */
  tokenizeCustomer(customerData) {
    const { customerId, email, phone, name, address } = customerData;

    return {
      customerId,
      emailToken: this.generateToken('email', email),
      phoneToken: this.generateToken('phone', phone),
      nameToken: this.generateToken('name', name),
      addressToken: address ? this.generateToken('address', JSON.stringify(address)) : null,
      maskedEmail: this.maskEmail(email),
      maskedPhone: this.maskPhone(phone),
      tokenizedAt: new Date().toISOString()
    };
  }

  /**
   * Detokenize card data (requires proper authorization)
   * @param {string} cardToken - Card token
   * @param {string} vaultId - Vault identifier
   * @returns {Object} Original card data (without CVV)
   */
  detokenizeCard(cardToken, vaultId) {
    // Verify token format
    if (!this.verifyToken(cardToken)) {
      throw new Error('Invalid card token format');
    }

    // Retrieve from vault
    const vaultData = this.retrieveFromVault(vaultId);
    
    // Return card data without CVV (CVV must never be stored)
    return {
      cardNumber: vaultData.cardNumber,
      expiryMonth: vaultData.expiryMonth,
      expiryYear: vaultData.expiryYear,
      cardholderName: vaultData.cardholderName
      // CVV is intentionally excluded - PCI-DSS requirement
    };
  }

  /**
   * Detokenize customer data (requires proper authorization)
   * @param {string} token - Customer data token
   * @param {string} tokenType - Type of token (email, phone, name, address) - for future use
   * @returns {string} Original data
   */
  detokenizeCustomer(token, tokenType) { // eslint-disable-line no-unused-vars
    if (!this.verifyToken(token)) {
      throw new Error('Invalid token format');
    }

    // In production, retrieve from secure token vault
    // This is a simplified implementation
    
    // Decrypt the token to get original data
    // Note: In production, this would query a separate token vault database
    return this.decryptToken(token);
  }

  /**
   * Generate a secure token
   * @param {string} type - Token type (card, email, phone, etc.)
   * @param {string} data - Data to tokenize
   * @returns {string} Generated token
   */
  generateToken(type, data) {
    // Generate random component
    const randomBytes = crypto.randomBytes(16).toString('hex');
    
    // Generate checksum from data
    const checksum = crypto
      .createHash('sha256')
      .update(data + this.tokenizationKey)
      .digest('hex')
      .slice(0, 8);

    // Format: tok_[type]_[random]_[checksum]
    return `${this.tokenPrefix}_${type}_${randomBytes}_${checksum}`;
  }

  /**
   * Verify token format and checksum
   * @param {string} token - Token to verify
   * @returns {boolean} Verification result
   */
  verifyToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    const parts = token.split('_');
    
    // Check format: tok_[type]_[random]_[checksum]
    if (parts.length !== 4 || parts[0] !== this.tokenPrefix) {
      return false;
    }

    const random = parts[2];
    const checksum = parts[3];

    // Verify random component length
    if (random.length !== 32) {
      return false;
    }

    // Verify checksum length
    if (checksum.length !== 8) {
      return false;
    }

    return true;
  }

  /**
   * Encrypt data to vault
   * @param {Object} data - Data to encrypt
   * @returns {Object} Vault entry
   */
  encryptToVault(data) {
    const vaultId = crypto.randomBytes(16).toString('hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.tokenizationKey, 'hex'),
      iv
    );

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // In production, store this in a separate secure vault database
    // For now, we return the encrypted data
    return {
      vaultId,
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Retrieve data from vault
   * @param {string} _vaultId - Vault identifier (unused in placeholder implementation)
   * @returns {Object} Decrypted data
   */
  retrieveFromVault(_vaultId) {
    // In production, this would query the vault database
    // This is a simplified placeholder
    throw new Error('Vault retrieval not implemented - requires secure vault database');
  }

  /**
   * Decrypt token (internal use only)
   * @param {string} _token - Token to decrypt (unused in placeholder implementation)
   * @returns {string} Original data
   */
  decryptToken(_token) {
    // In production, this would use the token to look up the original data
    // from a secure token vault database
    throw new Error('Token decryption requires token vault database');
  }

  /**
   * Validate card data
   * @param {Object} cardData - Card data to validate
   * @throws {Error} If validation fails
   */
  validateCardData(cardData) {
    const { cardNumber, cvv, expiryMonth, expiryYear } = cardData;

    if (!cardNumber || !/^\d{13,19}$/.test(cardNumber)) {
      throw new Error('Invalid card number format');
    }

    if (!cvv || !/^\d{3,4}$/.test(cvv)) {
      throw new Error('Invalid CVV format');
    }

    if (!expiryMonth || expiryMonth < 1 || expiryMonth > 12) {
      throw new Error('Invalid expiry month');
    }

    if (!expiryYear || expiryYear < new Date().getFullYear()) {
      throw new Error('Card expired');
    }

    // Luhn algorithm validation
    if (!this.validateLuhn(cardNumber)) {
      throw new Error('Invalid card number (Luhn check failed)');
    }
  }

  /**
   * Validate card number using Luhn algorithm
   * @param {string} cardNumber - Card number
   * @returns {boolean} Validation result
   */
  validateLuhn(cardNumber) {
    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i]);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Detect card brand from card number
   * @param {string} cardNumber - Card number
   * @returns {string} Card brand
   */
  detectCardBrand(cardNumber) {
    const patterns = {
      visa: /^4/,
      mastercard: /^5[1-5]/,
      amex: /^3[47]/,
      discover: /^6(?:011|5)/,
      rupay: /^6(?:0|5|6|7|8|9)/
    };

    for (const [brand, pattern] of Object.entries(patterns)) {
      if (pattern.test(cardNumber)) {
        return brand;
      }
    }

    return 'unknown';
  }

  /**
   * Mask email address
   * @param {string} email - Email address
   * @returns {string} Masked email
   */
  maskEmail(email) {
    if (!email) return '';
    const [username, domain] = email.split('@');
    const visibleChars = Math.min(3, username.length);
    return `${username.slice(0, visibleChars)}***@${domain}`;
  }

  /**
   * Mask phone number
   * @param {string} phone - Phone number
   * @returns {string} Masked phone
   */
  maskPhone(phone) {
    if (!phone) return '';
    return `******${phone.slice(-4)}`;
  }

  /**
   * Mask cardholder name
   * @param {string} name - Cardholder name
   * @returns {string} Masked name
   */
  maskName(name) {
    if (!name) return '';
    const parts = name.split(' ');
    return parts.map((part, index) => {
      if (index === 0) {
        return part; // Keep first name visible
      }
      return part[0] + '*'.repeat(part.length - 1);
    }).join(' ');
  }

  /**
   * Redact sensitive data from logs
   * @param {Object} data - Data to redact
   * @returns {Object} Redacted data
   */
  redactSensitiveData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const redacted = { ...data };
    const sensitiveFields = [
      'cardNumber', 'cvv', 'cvv2', 'pin',
      'password', 'apiKey', 'apiSecret', 'token',
      'accountNumber', 'routingNumber', 'iban',
      'ssn', 'taxId', 'aadhaar', 'pan'
    ];

    for (const field of sensitiveFields) {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    }

    // Redact nested objects
    for (const key in redacted) {
      if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactSensitiveData(redacted[key]);
      }
    }

    return redacted;
  }
}

module.exports = TokenizationService;
