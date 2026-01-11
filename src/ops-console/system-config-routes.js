/**
 * System Configuration Routes - Platform Ops Console
 * 
 * CRITICAL: Financial configs are FORBIDDEN
 * - Configs marked with is_financial=true are blocked
 * - Only non-financial configs can be modified
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireOpsConsoleAccess, logOpsAction } = require('./ops-console-middleware');

/**
 * GET /api/ops/system-config
 * List system configurations (non-financial only)
 */
router.get('/', requireOpsConsoleAccess, logOpsAction('LIST_CONFIGS'), async (req, res) => {
  try {
    const { category } = req.query;
    
    let query = `
      SELECT id, config_key, config_value, category, version, description, updated_at 
      FROM system_config 
      WHERE is_financial = false
    `;
    const params = [];
    
    if (category) {
      query += ' AND category = $1';
      params.push(category);
    }
    
    query += ' ORDER BY category, config_key';
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      configs: result.rows,
      note: 'Financial configurations are not accessible via Ops Console'
    });
  } catch (error) {
    console.error('Error listing configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list configurations'
    });
  }
});

/**
 * GET /api/ops/system-config/:key
 * Get specific configuration
 */
router.get('/:key', requireOpsConsoleAccess, logOpsAction('GET_CONFIG'), async (req, res) => {
  try {
    const { key } = req.params;
    
    // Filter financial configs at query level to prevent timing attacks
    const result = await db.query(
      `SELECT id, config_key, config_value, category, is_financial, version, description, updated_at 
       FROM system_config 
       WHERE config_key = $1 AND is_financial = false`,
      [key]
    );
    
    if (result.rows.length === 0) {
      // Return same error whether config doesn't exist or is financial
      // This prevents information leakage about financial config existence
      return res.status(404).json({
        success: false,
        error: 'Configuration not found or not accessible'
      });
    }
    
    const config = result.rows[0];
    
    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get configuration'
    });
  }
});

/**
 * PUT /api/ops/system-config/:key
 * Update system configuration (non-financial only)
 */
router.put('/:key', requireOpsConsoleAccess, logOpsAction('UPDATE_CONFIG'), async (req, res) => {
  try {
    const { key } = req.params;
    const { value, reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Change reason is required for audit compliance'
      });
    }
    
    // Check if config exists and is not financial
    const configResult = await db.query(
      'SELECT * FROM system_config WHERE config_key = $1',
      [key]
    );
    
    if (configResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }
    
    const config = configResult.rows[0];
    
    // CRITICAL: Block financial configuration updates
    if (config.is_financial) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify financial configuration',
        message: 'Financial configs require FINANCE_ADMIN role'
      });
    }
    
    // Store old value for history
    const oldValue = config.config_value;
    
    // Update the configuration
    const updateResult = await db.query(
      `UPDATE system_config 
       SET config_value = $1, version = version + 1, updated_by = $2, updated_at = NOW() 
       WHERE config_key = $3 
       RETURNING id, config_key, config_value, category, version, updated_at`,
      [JSON.stringify(value), req.opsUser.userId, key]
    );
    
    // Create history entry
    await db.query(
      `INSERT INTO config_history (config_id, config_key, old_value, new_value, changed_by, change_reason) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [config.id, key, oldValue, JSON.stringify(value), req.opsUser.userId, reason]
    );
    
    res.json({
      success: true,
      config: updateResult.rows[0],
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

/**
 * GET /api/ops/system-config/:key/history
 * Get configuration change history
 */
router.get('/:key/history', requireOpsConsoleAccess, logOpsAction('GET_CONFIG_HISTORY'), async (req, res) => {
  try {
    const { key } = req.params;
    const { limit = 50 } = req.query;
    
    // Check if config exists and is not financial
    const configResult = await db.query(
      'SELECT id, is_financial FROM system_config WHERE config_key = $1',
      [key]
    );
    
    if (configResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }
    
    const config = configResult.rows[0];
    
    // Block access to financial config history
    if (config.is_financial) {
      return res.status(403).json({
        success: false,
        error: 'Cannot access financial configuration history',
        message: 'Financial configs require FINANCE_ADMIN role'
      });
    }
    
    const result = await db.query(
      `SELECT 
        ch.id, ch.config_key, ch.old_value, ch.new_value, 
        ch.change_reason, ch.changed_at,
        pu.username as changed_by_username
       FROM config_history ch
       LEFT JOIN platform_users pu ON ch.changed_by = pu.id
       WHERE ch.config_id = $1
       ORDER BY ch.changed_at DESC
       LIMIT $2`,
      [config.id, limit]
    );
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error('Error getting config history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get configuration history'
    });
  }
});

/**
 * GET /api/ops/system-config/categories
 * Get all configuration categories
 */
router.get('/categories/list', requireOpsConsoleAccess, logOpsAction('LIST_CONFIG_CATEGORIES'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT category 
       FROM system_config 
       WHERE is_financial = false
       ORDER BY category`
    );
    
    res.json({
      success: true,
      categories: result.rows.map(r => r.category)
    });
  } catch (error) {
    console.error('Error listing categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list categories'
    });
  }
});

module.exports = router;
