/**
 * HTTPS/TLS Enforcement Middleware
 * Enforces HTTPS connections and TLS 1.3 for PCI-DSS compliance
 * PCI-DSS Requirement 4: Encrypt transmission of cardholder data across open, public networks
 */

/**
 * Middleware to enforce HTTPS connections
 * Redirects HTTP requests to HTTPS in production
 */
function enforceHTTPS(req, res, next) {
  // Check if request is secure
  const isSecure = req.secure || 
                   req.headers['x-forwarded-proto'] === 'https' ||
                   req.connection.encrypted;

  // In production, enforce HTTPS
  if (process.env.NODE_ENV === 'production' && !isSecure) {
    // Redirect to HTTPS
    return res.status(301).redirect(`https://${req.headers.host}${req.url}`);
  }

  next();
}

/**
 * Middleware to enforce TLS 1.3 (or minimum TLS 1.2)
 * Rejects connections using older TLS versions
 */
function enforceTLSVersion(req, res, next) {
  // Check TLS version if available
  if (req.connection && req.connection.encrypted) {
    const tlsVersion = req.connection.getProtocol?.();
    
    if (tlsVersion) {
      // Allow TLS 1.3 and TLS 1.2 (minimum for PCI-DSS 3.2.1)
      // TLS 1.0 and 1.1 are deprecated and not PCI-DSS compliant
      const allowedVersions = ['TLSv1.3', 'TLSv1.2'];
      
      if (!allowedVersions.includes(tlsVersion)) {
        return res.status(426).json({
          error: 'TLS version not supported',
          message: `TLS version ${tlsVersion} is not allowed. Please use TLS 1.2 or TLS 1.3.`,
          requiredVersions: allowedVersions
        });
      }
    }
  }

  next();
}

/**
 * Middleware to add security headers for HTTPS/TLS
 */
function addSecurityHeaders(req, res, next) {
  // Strict-Transport-Security (HSTS)
  // Tells browsers to only use HTTPS for this domain for the next 2 years
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Content-Security-Policy
  // Prevents loading resources from untrusted sources
  res.setHeader('Content-Security-Policy', 'default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: https:; connect-src \'self\' https:');

  // X-Content-Type-Options
  // Prevents MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // X-Frame-Options
  // Prevents clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');

  // X-XSS-Protection
  // Enables XSS filter in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer-Policy
  // Controls how much referrer information is sent
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy
  // Controls which browser features can be used
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
}

/**
 * Middleware to block insecure endpoints
 * Prevents access to sensitive endpoints over non-HTTPS connections
 */
function blockInsecureEndpoints(sensitiveEndpoints) {
  return (req, res, next) => {
    const isSecure = req.secure || 
                     req.headers['x-forwarded-proto'] === 'https' ||
                     req.connection.encrypted;

    // Check if current endpoint is sensitive
    const isSensitive = sensitiveEndpoints.some(endpoint => {
      if (typeof endpoint === 'string') {
        return req.path.startsWith(endpoint);
      }
      if (endpoint instanceof RegExp) {
        return endpoint.test(req.path);
      }
      return false;
    });

    if (isSensitive && !isSecure && process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Secure connection required',
        message: 'This endpoint requires an HTTPS connection.',
        endpoint: req.path
      });
    }

    next();
  };
}

/**
 * Middleware to log non-secure requests (for monitoring)
 */
function logInsecureRequests(auditService) {
  return async (req, res, next) => {
    const isSecure = req.secure || 
                     req.headers['x-forwarded-proto'] === 'https' ||
                     req.connection.encrypted;

    if (!isSecure && process.env.NODE_ENV === 'production') {
      // Log the insecure request attempt
      if (auditService) {
        await auditService.logSecurityEvent({
          eventSubType: 'INSECURE_CONNECTION',
          severity: 'MEDIUM',
          description: `Insecure HTTP request to ${req.method} ${req.path}`,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.headers['user-agent'],
          affectedResource: req.path
        }).catch(err => {
          console.error('Failed to log insecure request:', err);
        });
      }
    }

    next();
  };
}

/**
 * Get TLS configuration for HTTPS server
 * Returns TLS options for creating HTTPS server
 */
function getTLSConfig() {
  return {
    // Minimum TLS version (PCI-DSS compliant)
    minVersion: 'TLSv1.2',
    
    // Preferred TLS version
    maxVersion: 'TLSv1.3',
    
    // Cipher suites (PCI-DSS compliant, TLS 1.2 and 1.3)
    ciphers: [
      // TLS 1.3 cipher suites (recommended)
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      
      // TLS 1.2 cipher suites (for backward compatibility)
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES256-SHA384',
      'ECDHE-RSA-AES128-SHA256'
    ].join(':'),
    
    // Honor cipher order (server preference)
    honorCipherOrder: true,
    
    // Secure renegotiation
    secureOptions: require('constants').SSL_OP_NO_SSLv2 | 
                   require('constants').SSL_OP_NO_SSLv3 |
                   require('constants').SSL_OP_NO_TLSv1 |
                   require('constants').SSL_OP_NO_TLSv1_1
  };
}

/**
 * Validate HTTPS configuration
 * Checks if HTTPS is properly configured in the environment
 */
function validateHTTPSConfig() {
  const issues = [];

  // Check if in production mode
  if (process.env.NODE_ENV === 'production') {
    // Check if SSL certificate paths are configured
    if (!process.env.SSL_CERT_PATH && !process.env.SSL_KEY_PATH) {
      issues.push('SSL certificate and key paths not configured');
    }

    // Check if HTTPS port is configured
    if (!process.env.HTTPS_PORT) {
      issues.push('HTTPS port not configured');
    }

    // Check if HSTS is enabled
    if (process.env.HSTS_ENABLED === 'false') {
      issues.push('HSTS (HTTP Strict Transport Security) is disabled');
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Create HTTPS redirect middleware
 * Redirects all HTTP traffic to HTTPS
 */
function createHTTPSRedirect(httpsPort = 443) {
  return (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    const isSecure = req.secure || 
                     req.headers['x-forwarded-proto'] === 'https' ||
                     req.connection.encrypted;

    if (!isSecure) {
      const httpsUrl = `https://${req.hostname}${httpsPort !== 443 ? ':' + httpsPort : ''}${req.url}`;
      return res.redirect(301, httpsUrl);
    }

    next();
  };
}

module.exports = {
  enforceHTTPS,
  enforceTLSVersion,
  addSecurityHeaders,
  blockInsecureEndpoints,
  logInsecureRequests,
  getTLSConfig,
  validateHTTPSConfig,
  createHTTPSRedirect
};
