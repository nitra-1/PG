/**
 * Tests for Tokenization Service
 */

const TokenizationService = require('../src/security/tokenization-service');

describe('TokenizationService', () => {
  let tokenizationService;
  const config = {
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    tokenizationKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };

  beforeEach(() => {
    tokenizationService = new TokenizationService(config);
  });

  describe('Card Tokenization', () => {
    test('should tokenize valid card data', () => {
      const cardData = {
        cardNumber: '4111111111111111',
        cvv: '123',
        expiryMonth: 12,
        expiryYear: 2027,
        cardholderName: 'John Doe'
      };

      const result = tokenizationService.tokenizeCard(cardData);

      expect(result.cardToken).toBeDefined();
      expect(result.cardToken).toMatch(/^tok_card_/);
      expect(result.last4).toBe('1111');
      expect(result.first6).toBe('411111');
      expect(result.cardBrand).toBe('visa');
      expect(result.vaultId).toBeDefined();
    });

    test('should detect card brand correctly', () => {
      const visaCard = { cardNumber: '4111111111111111', cvv: '123', expiryMonth: 12, expiryYear: 2027 };
      const mastercardCard = { cardNumber: '5555555555554444', cvv: '123', expiryMonth: 12, expiryYear: 2027 };
      
      expect(tokenizationService.tokenizeCard(visaCard).cardBrand).toBe('visa');
      expect(tokenizationService.tokenizeCard(mastercardCard).cardBrand).toBe('mastercard');
    });

    test('should reject invalid card number format', () => {
      const invalidCardData = {
        cardNumber: '1234',
        cvv: '123',
        expiryMonth: 12,
        expiryYear: 2027
      };

      expect(() => tokenizationService.tokenizeCard(invalidCardData)).toThrow('Invalid card number format');
    });

    test('should reject invalid CVV', () => {
      const invalidCardData = {
        cardNumber: '4111111111111111',
        cvv: '12',
        expiryMonth: 12,
        expiryYear: 2027
      };

      expect(() => tokenizationService.tokenizeCard(invalidCardData)).toThrow('Invalid CVV format');
    });

    test('should reject expired card', () => {
      const expiredCardData = {
        cardNumber: '4111111111111111',
        cvv: '123',
        expiryMonth: 12,
        expiryYear: 2020
      };

      expect(() => tokenizationService.tokenizeCard(expiredCardData)).toThrow('Card expired');
    });

    test('should mask cardholder name', () => {
      const cardData = {
        cardNumber: '4111111111111111',
        cvv: '123',
        expiryMonth: 12,
        expiryYear: 2027,
        cardholderName: 'John Doe'
      };

      const result = tokenizationService.tokenizeCard(cardData);
      expect(result.cardholderName).toContain('*');
    });
  });

  describe('Customer Tokenization', () => {
    test('should tokenize customer information', () => {
      const customerData = {
        customerId: 'CUST_001',
        email: 'john.doe@example.com',
        phone: '1234567890',
        name: 'John Doe',
        address: { street: '123 Main St', city: 'Springfield' }
      };

      const result = tokenizationService.tokenizeCustomer(customerData);

      expect(result.emailToken).toBeDefined();
      expect(result.emailToken).toMatch(/^tok_email_/);
      expect(result.phoneToken).toMatch(/^tok_phone_/);
      expect(result.nameToken).toMatch(/^tok_name_/);
      expect(result.maskedEmail).toContain('***@');
      expect(result.maskedPhone).toContain('******');
    });
  });

  describe('Token Validation', () => {
    test('should validate correctly formatted tokens', () => {
      const token = tokenizationService.generateToken('card', '4111111111111111');
      expect(tokenizationService.verifyToken(token)).toBe(true);
    });

    test('should reject invalid token format', () => {
      expect(tokenizationService.verifyToken('invalid_token')).toBe(false);
      expect(tokenizationService.verifyToken('tok_card_short')).toBe(false);
      expect(tokenizationService.verifyToken('')).toBe(false);
      expect(tokenizationService.verifyToken(null)).toBe(false);
    });

    test('should reject tokens with wrong prefix', () => {
      const fakeToken = 'fake_card_0123456789abcdef0123456789abcdef_12345678';
      expect(tokenizationService.verifyToken(fakeToken)).toBe(false);
    });
  });

  describe('Luhn Algorithm', () => {
    test('should validate correct card numbers', () => {
      expect(tokenizationService.validateLuhn('4111111111111111')).toBe(true);
      expect(tokenizationService.validateLuhn('5555555555554444')).toBe(true);
      expect(tokenizationService.validateLuhn('378282246310005')).toBe(true);
    });

    test('should reject incorrect card numbers', () => {
      expect(tokenizationService.validateLuhn('4111111111111112')).toBe(false);
      expect(tokenizationService.validateLuhn('1234567890123456')).toBe(false);
    });
  });

  describe('Data Masking', () => {
    test('should mask email correctly', () => {
      const email = 'john.doe@example.com';
      const masked = tokenizationService.maskEmail(email);
      expect(masked).toMatch(/joh\*\*\*@example\.com/);
    });

    test('should mask phone correctly', () => {
      const phone = '1234567890';
      const masked = tokenizationService.maskPhone(phone);
      expect(masked).toBe('******7890');
    });

    test('should mask name correctly', () => {
      const name = 'John Doe Smith';
      const masked = tokenizationService.maskName(name);
      expect(masked).toContain('John');
      expect(masked).toContain('*');
    });
  });

  describe('Sensitive Data Redaction', () => {
    test('should redact sensitive fields', () => {
      const data = {
        cardNumber: '4111111111111111',
        cvv: '123',
        password: 'secret',
        apiKey: 'key123',
        username: 'john',
        amount: 100
      };

      const redacted = tokenizationService.redactSensitiveData(data);

      expect(redacted.cardNumber).toBe('[REDACTED]');
      expect(redacted.cvv).toBe('[REDACTED]');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.username).toBe('john');
      expect(redacted.amount).toBe(100);
    });

    test('should redact nested sensitive fields', () => {
      const data = {
        user: {
          name: 'John',
          password: 'secret'
        },
        payment: {
          cardNumber: '4111111111111111',
          amount: 100
        }
      };

      const redacted = tokenizationService.redactSensitiveData(data);

      expect(redacted.user.password).toBe('[REDACTED]');
      expect(redacted.payment.cardNumber).toBe('[REDACTED]');
      expect(redacted.user.name).toBe('John');
      expect(redacted.payment.amount).toBe(100);
    });
  });

  describe('Vault Operations', () => {
    test('should encrypt data to vault', () => {
      const data = {
        cardNumber: '4111111111111111',
        cvv: '123',
        expiryMonth: 12,
        expiryYear: 2027
      };

      const vaultEntry = tokenizationService.encryptToVault(data);

      expect(vaultEntry.vaultId).toBeDefined();
      expect(vaultEntry.encrypted).toBeDefined();
      expect(vaultEntry.iv).toBeDefined();
      expect(vaultEntry.authTag).toBeDefined();
      expect(vaultEntry.createdAt).toBeDefined();
    });
  });
});
