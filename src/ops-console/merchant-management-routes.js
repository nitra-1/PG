/**
 * Merchant Management Routes - Platform Ops Console
 * Operations console for managing merchants
 * 
 * CRITICAL: Merchant suspension affects operational access only
 * - Does NOT affect settlements (those continue as scheduled)
 * - Does NOT modify ledger entries
 * - Only affects: Checkout, API access, Webhooks
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireOpsConsoleAccess, logOpsAction } = require('./ops-console-middleware');

/**
 * GET /api/ops/merchants
 * List all merchants with search/filter
 */
router.get('/', requireOpsConsoleAccess, logOpsAction('LIST_MERCHANTS'), async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT id, business_name, email, status, created_at, last_active_at FROM merchants WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      query += ` AND (business_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM merchants WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (search) {
      countQuery += ` AND (business_name ILIKE $${countIndex} OR email ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
      countIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countIndex}`;
      countParams.push(status);
    }
    
    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    
    res.json({
      success: true,
      merchants: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error listing merchants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list merchants'
    });
  }
});

/**
 * POST /api/ops/merchants
 * Create new merchant
 */
router.post('/', requireOpsConsoleAccess, logOpsAction('CREATE_MERCHANT'), async (req, res) => {
  try {
    const { business_name, email, contact_name, contact_phone } = req.body;
    
    if (!business_name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Business name and email are required'
      });
    }
    
    const result = await db.query(
      `INSERT INTO merchants (business_name, email, contact_name, contact_phone, status) 
       VALUES ($1, $2, $3, $4, 'pending') 
       RETURNING id, business_name, email, status, created_at`,
      [business_name, email, contact_name, contact_phone]
    );
    
    res.json({
      success: true,
      merchant: result.rows[0],
      message: 'Merchant created successfully'
    });
  } catch (error) {
    console.error('Error creating merchant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create merchant'
    });
  }
});

/**
 * GET /api/ops/merchants/:id
 * Get merchant details
 */
router.get('/:id', requireOpsConsoleAccess, logOpsAction('GET_MERCHANT'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      'SELECT * FROM merchants WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Merchant not found'
      });
    }
    
    res.json({
      success: true,
      merchant: result.rows[0]
    });
  } catch (error) {
    console.error('Error getting merchant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get merchant'
    });
  }
});

/**
 * PUT /api/ops/merchants/:id/activate
 * Activate merchant
 */
router.put('/:id/activate', requireOpsConsoleAccess, logOpsAction('ACTIVATE_MERCHANT'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      `UPDATE merchants SET status = 'active', updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, business_name, status`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Merchant not found'
      });
    }
    
    res.json({
      success: true,
      merchant: result.rows[0],
      message: 'Merchant activated successfully'
    });
  } catch (error) {
    console.error('Error activating merchant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to activate merchant'
    });
  }
});

/**
 * PUT /api/ops/merchants/:id/suspend
 * Suspend merchant - affects operational access only
 * 
 * CRITICAL: Suspension must NOT alter financial data
 * - Does NOT affect settlements (those continue as scheduled)
 * - Does NOT modify ledger entries
 * - Only affects: Checkout, API access, Webhooks
 */
router.put('/:id/suspend', requireOpsConsoleAccess, logOpsAction('SUSPEND_MERCHANT'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // RULE: Suspension reason is required for audit compliance
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Suspension reason is required for audit compliance'
      });
    }
    
    // Update merchant status to suspended
    // NOTE: This only affects operational access, not financial data
    const result = await db.query(
      `UPDATE merchants SET status = 'suspended', updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, business_name, status`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Merchant not found'
      });
    }
    
    // Log the suspension with reason
    const auditTrailService = req.app.locals.auditTrailService;
    if (auditTrailService) {
      await auditTrailService.logDataAccess({
        userId: req.opsUser.userId,
        action: 'SUSPEND',
        resource: 'MERCHANT',
        resourceId: id,
        dataType: 'OPERATIONAL',
        ipAddress: req.opsUser.ipAddress,
        success: true,
        metadata: {
          reason,
          note: 'Suspension affects operational access only, not financial data'
        }
      });
    }
    
    res.json({
      success: true,
      merchant: result.rows[0],
      message: 'Merchant suspended successfully',
      note: 'Suspension affects checkout and API access. Scheduled settlements will continue.'
    });
  } catch (error) {
    console.error('Error suspending merchant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to suspend merchant'
    });
  }
});

/**
 * GET /api/ops/merchants/:id/config
 * View merchant configuration (non-financial)
 */
router.get('/:id/config', requireOpsConsoleAccess, logOpsAction('GET_MERCHANT_CONFIG'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get merchant webhooks, rate limits, and IP whitelist
    const [webhooks, rateLimits, ipWhitelist] = await Promise.all([
      db.query('SELECT * FROM merchant_webhooks WHERE merchant_id = $1', [id]),
      db.query('SELECT * FROM merchant_rate_limits WHERE merchant_id = $1', [id]),
      db.query('SELECT * FROM merchant_ip_whitelist WHERE merchant_id = $1', [id])
    ]);
    
    res.json({
      success: true,
      config: {
        webhooks: webhooks.rows,
        rateLimits: rateLimits.rows,
        ipWhitelist: ipWhitelist.rows
      }
    });
  } catch (error) {
    console.error('Error getting merchant config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get merchant configuration'
    });
  }
});

module.exports = router;
