/**
 * Merchant Middleware
 * Authentication, rate limiting, and IP whitelisting for merchants
 */

const db = require('../database');
const MerchantService = require('./merchant-service');

/**
 * Authenticate merchant using API key
 */
const authenticateMerchant = (config) => {
  const merchantService = new MerchantService(config);

  return async (req, res, next) => {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;

      if (!apiKey) {
        return res.status(401).json({
          error: 'API key required',
          message: 'Please provide API key in X-API-Key header'
        });
      }

      // Verify API key and get merchant details
      const merchantData = await merchantService.verifyAPIKey(apiKey);

      // Attach merchant data to request
      req.merchant = merchantData;
      req.user = {
        userId: merchantData.merchantId,
        merchantCode: merchantData.merchantCode,
        role: 'merchant'
      };

      next();
    } catch (error) {
      res.status(401).json({
        error: 'Authentication failed',
        message: error.message
      });
    }
  };
};

/**
 * Check IP whitelist
 */
const checkIPWhitelist = async (req, res, next) => {
  try {
    // Skip if no merchant authenticated
    if (!req.merchant) {
      return next();
    }

    const merchantId = req.merchant.merchantId;
    
    // Get client IP - use req.ip which respects proxy trust settings
    // Fallback to x-forwarded-for only if properly configured
    let clientIP = req.ip;
    
    // If behind a proxy and trust proxy is configured, use the first IP from x-forwarded-for
    if (!clientIP && req.headers['x-forwarded-for']) {
      clientIP = req.headers['x-forwarded-for'].split(',')[0].trim();
    }
    
    // Final fallback to connection IP
    if (!clientIP) {
      clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
    }

    // Check if merchant has IP whitelist configured
    const whitelistResult = await db.query(
      `SELECT COUNT(*) as count FROM merchant_ip_whitelist 
       WHERE merchant_id = $1 AND status = 'active'`,
      [merchantId]
    );

    const whitelistCount = parseInt(whitelistResult.rows[0].count);

    // If whitelist is configured, check if IP is allowed
    if (whitelistCount > 0) {
      const ipCheckResult = await db.query(
        `SELECT id FROM merchant_ip_whitelist 
         WHERE merchant_id = $1 AND ip_address = $2 AND status = 'active'`,
        [merchantId, clientIP]
      );

      if (ipCheckResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Your IP address is not whitelisted',
          clientIP: clientIP
        });
      }

      // Update last used timestamp
      await db.query(
        `UPDATE merchant_ip_whitelist 
         SET last_used_at = NOW() 
         WHERE merchant_id = $1 AND ip_address = $2`,
        [merchantId, clientIP]
      );
    }

    next();
  } catch (error) {
    console.error('IP whitelist check error:', error);
    res.status(500).json({
      error: 'IP whitelist check failed',
      message: error.message
    });
  }
};

/**
 * Rate limiting middleware with per-merchant configuration
 */
const merchantRateLimit = (redis) => {
  // In-memory fallback if Redis is not available
  const rateLimitStore = new Map();

  return async (req, res, next) => {
    try {
      // Skip if no merchant authenticated
      if (!req.merchant) {
        return next();
      }

      const merchantId = req.merchant.merchantId;
      const endpoint = req.path;

      // Get rate limit configuration for merchant
      const rateLimitResult = await db.query(
        `SELECT max_requests, window_ms 
         FROM merchant_rate_limits 
         WHERE merchant_id = $1 
         AND status = 'active'
         AND $2 LIKE endpoint_pattern
         ORDER BY LENGTH(endpoint_pattern) DESC
         LIMIT 1`,
        [merchantId, endpoint]
      );

      let maxRequests = 100; // Default
      let windowMs = 60000; // Default 1 minute

      if (rateLimitResult.rows.length > 0) {
        maxRequests = rateLimitResult.rows[0].max_requests;
        windowMs = rateLimitResult.rows[0].window_ms;
      }

      // Rate limit key
      const key = `ratelimit:${merchantId}:${endpoint}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis if available, otherwise in-memory
      if (redis && redis.isReady) {
        // Redis-based rate limiting
        const requests = await redis.zRangeByScore(key, windowStart, now);
        const requestCount = requests.length;

        if (requestCount >= maxRequests) {
          const oldestRequest = requests[0];
          const retryAfter = Math.ceil((parseInt(oldestRequest) + windowMs - now) / 1000);

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Please try again after ${retryAfter} seconds.`,
            limit: maxRequests,
            remaining: 0,
            retryAfter: retryAfter
          });
        }

        // Add current request
        await redis.zAdd(key, { score: now, value: now.toString() });
        await redis.expire(key, Math.ceil(windowMs / 1000));

        // Remove old entries
        await redis.zRemRangeByScore(key, 0, windowStart);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - requestCount - 1);
        res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      } else {
        // In-memory fallback
        if (!rateLimitStore.has(key)) {
          rateLimitStore.set(key, []);
        }

        const requests = rateLimitStore.get(key);
        
        // Remove old requests
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        
        if (validRequests.length >= maxRequests) {
          const oldestRequest = validRequests[0];
          const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Please try again after ${retryAfter} seconds.`,
            limit: maxRequests,
            remaining: 0,
            retryAfter: retryAfter
          });
        }

        // Add current request
        validRequests.push(now);
        rateLimitStore.set(key, validRequests);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - validRequests.length);
        res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      }

      next();
    } catch (error) {
      console.error('Rate limit check error:', error);
      // Don't block request on rate limit check error
      next();
    }
  };
};

/**
 * Track merchant usage
 */
const trackMerchantUsage = (config) => {
  const merchantService = new MerchantService(config);

  return async (req, res, next) => {
    // Capture the original res.json to track success/failure
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      // Track usage after response
      if (req.merchant) {
        const success = res.statusCode >= 200 && res.statusCode < 300;
        const amount = req.body?.amount || 0;
        
        // Determine if it's a payment transaction based on explicit payment endpoints
        const paymentEndpoints = ['/api/payments/process', '/api/payin/orders', '/api/upi/collect'];
        const isPaymentTransaction = success && paymentEndpoints.some(endpoint => req.path.startsWith(endpoint));
        const transactionCount = isPaymentTransaction ? 1 : 0;

        merchantService.trackUsage(req.merchant.merchantId, {
          endpoint: req.path,
          success,
          amount,
          transactionCount
        }).catch(err => {
          console.error('Failed to track usage:', err);
        });
      }

      return originalJson(data);
    };

    next();
  };
};

module.exports = {
  authenticateMerchant,
  checkIPWhitelist,
  merchantRateLimit,
  trackMerchantUsage
};
