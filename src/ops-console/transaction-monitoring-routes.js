/**
 * Transaction Monitoring Routes - Platform Ops Console
 * STRICTLY READ-ONLY transaction monitoring
 * 
 * FORBIDDEN OPERATIONS (enforced):
 * - No transaction edits
 * - No refund initiation (merchant-only capability)
 * - No settlement actions
 * - No ledger drill-down
 * 
 * Purpose: Operational visibility only
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireOpsConsoleAccess, logOpsAction } = require('./ops-console-middleware');

/**
 * Block all non-GET methods on transaction monitoring
 * Transaction monitoring is READ-ONLY
 */
router.all('*', (req, res, next) => {
  if (req.method !== 'GET') {
    return res.status(403).json({
      success: false,
      error: 'Transaction monitoring is read-only',
      message: 'Ops Console cannot modify transactions. Merchants initiate refunds via their dashboard.'
    });
  }
  next();
});

/**
 * GET /api/ops/transactions
 * List transactions with filters
 */
router.get('/', requireOpsConsoleAccess, logOpsAction('LIST_TRANSACTIONS'), async (req, res) => {
  try {
    const { 
      merchantId, 
      gateway, 
      status, 
      dateFrom, 
      dateTo, 
      page = 1, 
      limit = 50 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        id, merchant_id, amount, currency, status, 
        payment_method, gateway, created_at 
      FROM transactions 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (merchantId) {
      query += ` AND merchant_id = $${paramIndex}`;
      params.push(merchantId);
      paramIndex++;
    }
    
    if (gateway) {
      query += ` AND gateway = $${paramIndex}`;
      params.push(gateway);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (dateFrom) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    if (dateTo) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM transactions WHERE 1=1';
    const countParams = [];
    let countIndex = 1;
    
    if (merchantId) {
      countQuery += ` AND merchant_id = $${countIndex}`;
      countParams.push(merchantId);
      countIndex++;
    }
    
    if (gateway) {
      countQuery += ` AND gateway = $${countIndex}`;
      countParams.push(gateway);
      countIndex++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countIndex}`;
      countParams.push(status);
      countIndex++;
    }
    
    if (dateFrom) {
      countQuery += ` AND created_at >= $${countIndex}`;
      countParams.push(dateFrom);
      countIndex++;
    }
    
    if (dateTo) {
      countQuery += ` AND created_at <= $${countIndex}`;
      countParams.push(dateTo);
    }
    
    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    
    res.json({
      success: true,
      transactions: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      },
      note: 'This is a read-only view. No edits or refunds can be initiated from Ops Console.'
    });
  } catch (error) {
    console.error('Error listing transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list transactions'
    });
  }
});

/**
 * GET /api/ops/transactions/:id
 * Get transaction details (READ-ONLY)
 */
router.get('/:id', requireOpsConsoleAccess, logOpsAction('GET_TRANSACTION'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      `SELECT 
        id, merchant_id, amount, currency, status, 
        payment_method, gateway, created_at, updated_at,
        gateway_transaction_id, description
      FROM transactions 
      WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }
    
    res.json({
      success: true,
      transaction: result.rows[0],
      note: 'This is a read-only view. To initiate refunds, use the merchant dashboard.'
    });
  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transaction'
    });
  }
});

/**
 * GET /api/ops/transactions/stats/summary
 * Get transaction statistics
 */
router.get('/stats/summary', requireOpsConsoleAccess, logOpsAction('GET_TRANSACTION_STATS'), async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    let query = `
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM transactions
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (dateFrom) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    if (dateTo) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(dateTo);
    }
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      stats: result.rows[0]
    });
  } catch (error) {
    console.error('Error getting transaction stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get transaction statistics'
    });
  }
});

module.exports = router;
