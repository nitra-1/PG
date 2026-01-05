/**
 * Tests for HTTPS/TLS Enforcement Middleware
 */

const {
  enforceHTTPS,
  enforceTLSVersion,
  addSecurityHeaders,
  blockInsecureEndpoints,
  validateHTTPSConfig,
  getTLSConfig
} = require('../src/security/https-middleware');

describe('HTTPS Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      secure: false,
      headers: {},
      connection: {},
      url: '/test',
      path: '/api/payments'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };
    next = jest.fn();
  });

  describe('enforceHTTPS', () => {
    test('should allow secure requests', () => {
      req.secure = true;
      enforceHTTPS(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('should allow requests with x-forwarded-proto header', () => {
      req.headers['x-forwarded-proto'] = 'https';
      enforceHTTPS(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('should allow requests with encrypted connection', () => {
      req.connection.encrypted = true;
      enforceHTTPS(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('should redirect HTTP to HTTPS in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      req.headers.host = 'example.com';
      req.url = '/api/test';

      enforceHTTPS(req, res, next);

      expect(res.status).toHaveBeenCalledWith(301);
      expect(res.redirect).toHaveBeenCalledWith('https://example.com/api/test');
      expect(next).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    test('should allow HTTP in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      enforceHTTPS(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('enforceTLSVersion', () => {
    test('should allow TLS 1.3 connections', () => {
      req.connection.encrypted = true;
      req.connection.getProtocol = jest.fn().mockReturnValue('TLSv1.3');

      enforceTLSVersion(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should allow TLS 1.2 connections', () => {
      req.connection.encrypted = true;
      req.connection.getProtocol = jest.fn().mockReturnValue('TLSv1.2');

      enforceTLSVersion(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should reject TLS 1.1 connections', () => {
      req.connection.encrypted = true;
      req.connection.getProtocol = jest.fn().mockReturnValue('TLSv1.1');

      enforceTLSVersion(req, res, next);

      expect(res.status).toHaveBeenCalledWith(426);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'TLS version not supported'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('should reject TLS 1.0 connections', () => {
      req.connection.encrypted = true;
      req.connection.getProtocol = jest.fn().mockReturnValue('TLSv1.0');

      enforceTLSVersion(req, res, next);

      expect(res.status).toHaveBeenCalledWith(426);
    });

    test('should allow non-encrypted connections (handled by enforceHTTPS)', () => {
      req.connection.encrypted = false;

      enforceTLSVersion(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('addSecurityHeaders', () => {
    test('should add all security headers', () => {
      addSecurityHeaders(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.stringContaining('max-age=63072000')
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Frame-Options',
        'DENY'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-XSS-Protection',
        '1; mode=block'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        expect.any(String)
      );
      expect(next).toHaveBeenCalled();
    });

    test('should include HSTS with includeSubDomains and preload', () => {
      addSecurityHeaders(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.stringContaining('includeSubDomains')
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.stringContaining('preload')
      );
    });
  });

  describe('blockInsecureEndpoints', () => {
    test('should block insecure access to sensitive endpoints in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const middleware = blockInsecureEndpoints(['/api/payments', '/api/payout']);
      req.path = '/api/payments';
      req.secure = false;

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Secure connection required'
        })
      );
      expect(next).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    test('should allow secure access to sensitive endpoints', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const middleware = blockInsecureEndpoints(['/api/payments']);
      req.path = '/api/payments';
      req.secure = true;

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    test('should allow access to non-sensitive endpoints', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const middleware = blockInsecureEndpoints(['/api/payments']);
      req.path = '/api/health';
      req.secure = false;

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    test('should support regex patterns for endpoints', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const middleware = blockInsecureEndpoints([/^\/api\/pay/]);
      req.path = '/api/payments';
      req.secure = false;

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('validateHTTPSConfig', () => {
    test('should validate production HTTPS configuration', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.SSL_CERT_PATH;
      delete process.env.SSL_KEY_PATH;

      const result = validateHTTPSConfig();

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('SSL certificate and key paths not configured');

      process.env.NODE_ENV = originalEnv;
    });

    test('should pass validation with proper configuration', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.SSL_CERT_PATH = '/path/to/cert';
      process.env.SSL_KEY_PATH = '/path/to/key';
      process.env.HTTPS_PORT = '443';

      const result = validateHTTPSConfig();

      expect(result.valid).toBe(true);
      expect(result.issues.length).toBe(0);

      process.env.NODE_ENV = originalEnv;
      delete process.env.SSL_CERT_PATH;
      delete process.env.SSL_KEY_PATH;
      delete process.env.HTTPS_PORT;
    });

    test('should not require HTTPS config in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const result = validateHTTPSConfig();

      expect(result.valid).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getTLSConfig', () => {
    test('should return correct TLS configuration', () => {
      const config = getTLSConfig();

      expect(config.minVersion).toBe('TLSv1.2');
      expect(config.maxVersion).toBe('TLSv1.3');
      expect(config.ciphers).toBeDefined();
      expect(config.honorCipherOrder).toBe(true);
    });

    test('should include TLS 1.3 cipher suites', () => {
      const config = getTLSConfig();

      expect(config.ciphers).toContain('TLS_AES_256_GCM_SHA384');
      expect(config.ciphers).toContain('TLS_CHACHA20_POLY1305_SHA256');
    });

    test('should include TLS 1.2 cipher suites', () => {
      const config = getTLSConfig();

      expect(config.ciphers).toContain('ECDHE-RSA-AES256-GCM-SHA384');
      expect(config.ciphers).toContain('ECDHE-RSA-AES128-GCM-SHA256');
    });
  });
});
