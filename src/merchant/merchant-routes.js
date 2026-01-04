/**
 * Merchant API Routes
 * RESTful endpoints for merchant onboarding and configuration
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

/**
 * Validation middleware
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation error',
      details: errors.array()
    });
  }
  next();
};

/**
 * Initialize routes with config and services
 */
module.exports = (config, securityService) => {
  const MerchantService = require('./merchant-service');
  const merchantService = new MerchantService(config);

  /**
   * POST /api/merchants
   * Register a new merchant
   */
  router.post(
    '/',
    [
      body('merchantName').notEmpty().trim().withMessage('Merchant name is required'),
      body('merchantCode').notEmpty().trim().matches(/^[A-Z0-9_]+$/).withMessage('Merchant code must be alphanumeric and uppercase'),
      body('email').isEmail().withMessage('Valid email is required'),
      body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
      body('businessType').optional().trim(),
      body('websiteUrl').optional().isURL().withMessage('Valid URL required'),
      body('callbackUrl').optional().isURL().withMessage('Valid callback URL required'),
      validate
    ],
    async (req, res) => {
      try {
        const result = await merchantService.registerMerchant(req.body);
        
        res.status(201).json({
          success: true,
          message: 'Merchant registered successfully',
          data: {
            merchant: result.merchant,
            apiKey: result.apiKey
          }
        });
      } catch (error) {
        res.status(400).json({
          error: 'Merchant registration failed',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/merchants/:id
   * Get merchant details
   */
  router.get(
    '/:id',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      validate
    ],
    async (req, res) => {
      try {
        const merchant = await merchantService.getMerchant(req.params.id);
        
        res.json({
          success: true,
          data: merchant
        });
      } catch (error) {
        res.status(404).json({
          error: 'Merchant not found',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/merchants/:id
   * Update merchant settings
   */
  router.put(
    '/:id',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      body('merchantName').optional().trim(),
      body('email').optional().isEmail(),
      body('phone').optional().isMobilePhone(),
      body('businessType').optional().trim(),
      body('websiteUrl').optional().isURL(),
      body('callbackUrl').optional().isURL(),
      body('status').optional().isIn(['active', 'inactive', 'suspended']),
      validate
    ],
    async (req, res) => {
      try {
        const merchant = await merchantService.updateMerchant(req.params.id, req.body);
        
        res.json({
          success: true,
          message: 'Merchant updated successfully',
          data: merchant
        });
      } catch (error) {
        res.status(400).json({
          error: 'Merchant update failed',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/merchants/:id
   * Delete merchant (soft delete)
   */
  router.delete(
    '/:id',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      validate
    ],
    async (req, res) => {
      try {
        const result = await merchantService.deleteMerchant(req.params.id);
        
        res.json(result);
      } catch (error) {
        res.status(400).json({
          error: 'Merchant deletion failed',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/merchants/:id/api-keys
   * Generate new API key for merchant
   */
  router.post(
    '/:id/api-keys',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      body('keyName').notEmpty().trim().withMessage('Key name is required'),
      body('permissions').optional().isArray().withMessage('Permissions must be an array'),
      validate
    ],
    async (req, res) => {
      try {
        const { keyName, permissions = ['all'] } = req.body;
        const apiKey = await merchantService.generateAPIKey(req.params.id, keyName, permissions);
        
        res.status(201).json({
          success: true,
          message: 'API key generated successfully',
          data: apiKey
        });
      } catch (error) {
        res.status(400).json({
          error: 'API key generation failed',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/merchants/:id/api-keys/:keyId
   * Revoke API key
   */
  router.delete(
    '/:id/api-keys/:keyId',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      param('keyId').isUUID().withMessage('Valid key ID required'),
      validate
    ],
    async (req, res) => {
      try {
        const result = await merchantService.revokeAPIKey(req.params.id, req.params.keyId);
        
        res.json(result);
      } catch (error) {
        res.status(400).json({
          error: 'API key revocation failed',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/merchants/:id/webhooks
   * Configure webhook for merchant
   */
  router.post(
    '/:id/webhooks',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      body('webhookUrl').isURL().withMessage('Valid webhook URL is required'),
      body('events').optional().isArray().withMessage('Events must be an array'),
      body('retryAttempts').optional().isInt({ min: 0, max: 10 }),
      body('retryDelay').optional().isInt({ min: 1000 }),
      body('timeout').optional().isInt({ min: 1000, max: 60000 }),
      validate
    ],
    async (req, res) => {
      try {
        const webhook = await merchantService.configureWebhook(req.params.id, req.body);
        
        res.status(201).json({
          success: true,
          message: 'Webhook configured successfully',
          data: webhook
        });
      } catch (error) {
        res.status(400).json({
          error: 'Webhook configuration failed',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/merchants/:id/webhooks/:webhookId
   * Update webhook configuration
   */
  router.put(
    '/:id/webhooks/:webhookId',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      param('webhookId').isUUID().withMessage('Valid webhook ID required'),
      body('webhookUrl').optional().isURL(),
      body('status').optional().isIn(['active', 'inactive']),
      body('events').optional().isArray(),
      validate
    ],
    async (req, res) => {
      try {
        const webhook = await merchantService.updateWebhook(req.params.id, req.params.webhookId, req.body);
        
        res.json({
          success: true,
          message: 'Webhook updated successfully',
          data: webhook
        });
      } catch (error) {
        res.status(400).json({
          error: 'Webhook update failed',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/merchants/:id/rate-limits
   * Configure rate limit for merchant
   */
  router.post(
    '/:id/rate-limits',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      body('endpointPattern').notEmpty().trim().withMessage('Endpoint pattern is required'),
      body('maxRequests').isInt({ min: 1 }).withMessage('Max requests must be a positive integer'),
      body('windowMs').isInt({ min: 1000 }).withMessage('Window must be at least 1000ms'),
      validate
    ],
    async (req, res) => {
      try {
        const rateLimit = await merchantService.configureRateLimit(req.params.id, req.body);
        
        res.status(201).json({
          success: true,
          message: 'Rate limit configured successfully',
          data: rateLimit
        });
      } catch (error) {
        res.status(400).json({
          error: 'Rate limit configuration failed',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/merchants/:id/ip-whitelist
   * Add IP to whitelist
   */
  router.post(
    '/:id/ip-whitelist',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      body('ipAddress').notEmpty().trim().withMessage('IP address is required'),
      body('description').optional().trim(),
      validate
    ],
    async (req, res) => {
      try {
        const ipEntry = await merchantService.addIPToWhitelist(req.params.id, req.body);
        
        res.status(201).json({
          success: true,
          message: 'IP added to whitelist successfully',
          data: ipEntry
        });
      } catch (error) {
        res.status(400).json({
          error: 'IP whitelist addition failed',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/merchants/:id/ip-whitelist/:ipId
   * Remove IP from whitelist
   */
  router.delete(
    '/:id/ip-whitelist/:ipId',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      param('ipId').isUUID().withMessage('Valid IP entry ID required'),
      validate
    ],
    async (req, res) => {
      try {
        const result = await merchantService.removeIPFromWhitelist(req.params.id, req.params.ipId);
        
        res.json(result);
      } catch (error) {
        res.status(400).json({
          error: 'IP whitelist removal failed',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/merchants/:id/usage
   * Get merchant usage statistics
   */
  router.get(
    '/:id/usage',
    [
      param('id').isUUID().withMessage('Valid merchant ID required'),
      query('startDate').optional().isISO8601().withMessage('Valid start date required'),
      query('endDate').optional().isISO8601().withMessage('Valid end date required'),
      validate
    ],
    async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const usage = await merchantService.getUsageStatistics(req.params.id, { startDate, endDate });
        
        res.json({
          success: true,
          data: usage
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to get usage statistics',
          message: error.message
        });
      }
    }
  );

  return router;
};
