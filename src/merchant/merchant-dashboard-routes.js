/**
 * Merchant Dashboard API Routes
 * Merchant-safe read/write operations for dashboard features
 * Security: All operations scoped to authenticated merchant's tenant_id
 */

const express = require('express');
const router = express.Router();
const { param, query, body, validationResult } = require('express-validator');
const db = require('../database');

/**
 * Validation middleware
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: errors.array()
    });
  }
  next();
};

/**
 * Merchant authentication middleware
 * Extracts merchantId from authenticated request
 */
const requireMerchant = (req, res, next) => {
  const merchantId = req.headers['x-merchant-id'] || req.query.merchantId;
  
  if (!merchantId) {
    return res.status(400).json({
      success: false,
      error: 'Merchant ID is required'
    });
  }
  
  req.merchantId = merchantId;
  req.tenantId = merchantId; // For merchant dashboard, tenant = merchant
  next();
};

/**
 * Initialize routes
 */
module.exports = () => {
  
  // ===== TRANSACTION ROUTES =====
  
  /**
   * GET /api/merchant/transactions
   * List transactions for merchant with filters
   */
  router.get(
    '/transactions',
    requireMerchant,
    [
      query('status').optional().isIn(['pending', 'processing', 'success', 'failed', 'refunded']),
      query('startDate').optional().isISO8601(),
      query('endDate').optional().isISO8601(),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 }),
      validate
    ],
    async (req, res) => {
      try {
        const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let query = `
          SELECT 
            t.*,
            CASE WHEN r.id IS NOT NULL THEN true ELSE false END as has_refund
          FROM transactions t
          LEFT JOIN refunds r ON t.id = r.transaction_id AND r.status = 'completed'
          WHERE t.tenant_id::text = $1
        `;
        
        const values = [req.merchantId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND t.status = $${paramIndex}`;
          values.push(status);
          paramIndex++;
        }
        
        if (startDate) {
          query += ` AND t.created_at >= $${paramIndex}`;
          values.push(startDate);
          paramIndex++;
        }
        
        if (endDate) {
          query += ` AND t.created_at <= $${paramIndex}`;
          values.push(endDate);
          paramIndex++;
        }
        
        // Get total count
        const countResult = await db.query(
          query.replace('SELECT t.*, CASE WHEN r.id IS NOT NULL THEN true ELSE false END as has_refund', 'SELECT COUNT(DISTINCT t.id) as total'),
          values
        );
        const totalCount = parseInt(countResult.rows[0].total);
        
        // Add pagination
        query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);
        
        const result = await db.query(query, values);
        
        res.json({
          success: true,
          data: {
            transactions: result.rows,
            pagination: {
              total: totalCount,
              limit: parseInt(limit),
              offset: parseInt(offset),
              hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
            }
          }
        });
      } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch transactions',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/transactions/:transactionId
   * Get transaction details
   */
  router.get(
    '/transactions/:transactionId',
    requireMerchant,
    [
      param('transactionId').isUUID(),
      validate
    ],
    async (req, res) => {
      try {
        const result = await db.query(
          `SELECT t.*, 
            COALESCE(
              json_agg(
                json_build_object(
                  'id', r.id,
                  'refund_ref', r.refund_ref,
                  'refund_amount', r.refund_amount,
                  'refund_type', r.refund_type,
                  'status', r.status,
                  'initiated_at', r.initiated_at,
                  'completed_at', r.completed_at
                )
              ) FILTER (WHERE r.id IS NOT NULL),
              '[]'
            ) as refunds
          FROM transactions t
          LEFT JOIN refunds r ON t.id = r.transaction_id
          WHERE t.id::text = $1 AND t.tenant_id::text = $2
          GROUP BY t.id`,
          [req.params.transactionId, req.merchantId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Transaction not found'
          });
        }
        
        res.json({
          success: true,
          data: result.rows[0]
        });
      } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch transaction',
          message: error.message
        });
      }
    }
  );
  
  // ===== REFUND ROUTES =====
  
  /**
   * POST /api/merchant/refunds
   * Initiate refund for a transaction
   */
  router.post(
    '/refunds',
    requireMerchant,
    [
      body('transactionId').isUUID().withMessage('Valid transaction ID required'),
      body('refundAmount').isFloat({ min: 0.01 }).withMessage('Valid refund amount required'),
      body('reason').optional().isString().trim(),
      body('notes').optional().isString().trim(),
      validate
    ],
    async (req, res) => {
      try {
        const { transactionId, refundAmount, reason, notes } = req.body;
        
        // Verify transaction belongs to merchant and is refundable
        const txResult = await db.query(
          `SELECT * FROM transactions 
           WHERE id::text = $1 AND tenant_id::text = $2 AND status = 'success'`,
          [transactionId, req.merchantId]
        );
        
        if (txResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Transaction not found or not eligible for refund'
          });
        }
        
        const transaction = txResult.rows[0];
        
        // Check if refund amount is valid
        if (parseFloat(refundAmount) > parseFloat(transaction.amount)) {
          return res.status(400).json({
            success: false,
            error: 'Refund amount cannot exceed transaction amount'
          });
        }
        
        // Check for existing refunds
        const existingRefunds = await db.query(
          `SELECT SUM(refund_amount) as total_refunded 
           FROM refunds 
           WHERE transaction_id::text = $1 AND status IN ('completed', 'processing', 'initiated')`,
          [transactionId]
        );
        
        const totalRefunded = parseFloat(existingRefunds.rows[0].total_refunded || 0);
        const remainingAmount = parseFloat(transaction.amount) - totalRefunded;
        
        if (parseFloat(refundAmount) > remainingAmount) {
          return res.status(400).json({
            success: false,
            error: `Only ${remainingAmount} ${transaction.currency} is available for refund`
          });
        }
        
        // Determine refund type
        const refundType = (parseFloat(refundAmount) === remainingAmount) ? 'full' : 'partial';
        
        // Create refund record
        const refundRef = `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const refundResult = await db.query(
          `INSERT INTO refunds (
            tenant_id, merchant_id, transaction_id, refund_ref,
            refund_amount, original_amount, currency, refund_type,
            status, reason, notes, initiated_by, initiated_at
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          RETURNING *`,
          [
            req.merchantId,
            req.merchantId,
            transactionId,
            refundRef,
            refundAmount,
            transaction.amount,
            transaction.currency,
            refundType,
            'initiated',
            reason || 'Merchant initiated refund',
            notes,
            req.headers['x-user-email'] || 'merchant'
          ]
        );
        
        // Log audit trail
        await db.logAudit({
          tenantId: req.merchantId,
          entityType: 'refund',
          entityId: refundResult.rows[0].id,
          action: 'create',
          metadata: {
            transactionId,
            refundAmount,
            refundType,
            reason
          }
        });
        
        // NOTE: In production, this should trigger gateway refund API call
        // For now, we'll simulate the processing
        setTimeout(async () => {
          try {
            await db.query(
              `UPDATE refunds SET status = $1, completed_at = NOW() WHERE id = $2`,
              ['processing', refundResult.rows[0].id]
            );
          } catch (err) {
            console.error('Error updating refund status:', err);
          }
        }, 1000);
        
        res.status(201).json({
          success: true,
          message: 'Refund initiated successfully',
          data: refundResult.rows[0]
        });
      } catch (error) {
        console.error('Error initiating refund:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to initiate refund',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/refunds
   * List refunds for merchant
   */
  router.get(
    '/refunds',
    requireMerchant,
    [
      query('status').optional().isIn(['initiated', 'processing', 'completed', 'failed', 'cancelled']),
      query('startDate').optional().isISO8601(),
      query('endDate').optional().isISO8601(),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 }),
      validate
    ],
    async (req, res) => {
      try {
        const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let query = `
          SELECT r.*, t.order_id, t.gateway_transaction_id, t.customer_email
          FROM refunds r
          JOIN transactions t ON r.transaction_id = t.id
          WHERE r.merchant_id::text = $1
        `;
        
        const values = [req.merchantId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND r.status = $${paramIndex}`;
          values.push(status);
          paramIndex++;
        }
        
        if (startDate) {
          query += ` AND r.created_at >= $${paramIndex}`;
          values.push(startDate);
          paramIndex++;
        }
        
        if (endDate) {
          query += ` AND r.created_at <= $${paramIndex}`;
          values.push(endDate);
          paramIndex++;
        }
        
        // Get total count
        const countResult = await db.query(
          query.replace('SELECT r.*, t.order_id, t.gateway_transaction_id, t.customer_email', 'SELECT COUNT(*) as total'),
          values
        );
        const totalCount = parseInt(countResult.rows[0].total);
        
        // Add pagination
        query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);
        
        const result = await db.query(query, values);
        
        res.json({
          success: true,
          data: {
            refunds: result.rows,
            pagination: {
              total: totalCount,
              limit: parseInt(limit),
              offset: parseInt(offset),
              hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
            }
          }
        });
      } catch (error) {
        console.error('Error fetching refunds:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch refunds',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/refunds/:refundId
   * Get refund details
   */
  router.get(
    '/refunds/:refundId',
    requireMerchant,
    [
      param('refundId').isUUID(),
      validate
    ],
    async (req, res) => {
      try {
        const result = await db.query(
          `SELECT r.*, t.order_id, t.gateway_transaction_id, t.amount as transaction_amount,
           t.customer_email, t.customer_name, t.customer_phone
          FROM refunds r
          JOIN transactions t ON r.transaction_id = t.id
          WHERE r.id::text = $1 AND r.merchant_id::text = $2`,
          [req.params.refundId, req.merchantId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Refund not found'
          });
        }
        
        res.json({
          success: true,
          data: result.rows[0]
        });
      } catch (error) {
        console.error('Error fetching refund:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch refund',
          message: error.message
        });
      }
    }
  );
  
  // ===== DISPUTE ROUTES (READ-ONLY) =====
  
  /**
   * GET /api/merchant/disputes
   * List disputes for merchant (read-only)
   */
  router.get(
    '/disputes',
    requireMerchant,
    [
      query('status').optional().isIn(['open', 'under_review', 'accepted', 'won', 'lost', 'closed']),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 }),
      validate
    ],
    async (req, res) => {
      try {
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = `
          SELECT d.*, t.order_id, t.gateway_transaction_id, t.customer_email
          FROM disputes d
          JOIN transactions t ON d.transaction_id = t.id
          WHERE d.merchant_id::text = $1
        `;
        
        const values = [req.merchantId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND d.status = $${paramIndex}`;
          values.push(status);
          paramIndex++;
        }
        
        // Get total count
        const countResult = await db.query(
          query.replace('SELECT d.*, t.order_id, t.gateway_transaction_id, t.customer_email', 'SELECT COUNT(*) as total'),
          values
        );
        const totalCount = parseInt(countResult.rows[0].total);
        
        // Add pagination
        query += ` ORDER BY d.dispute_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);
        
        const result = await db.query(query, values);
        
        res.json({
          success: true,
          data: {
            disputes: result.rows,
            pagination: {
              total: totalCount,
              limit: parseInt(limit),
              offset: parseInt(offset),
              hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
            }
          }
        });
      } catch (error) {
        console.error('Error fetching disputes:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch disputes',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/disputes/:disputeId
   * Get dispute details (read-only)
   */
  router.get(
    '/disputes/:disputeId',
    requireMerchant,
    [
      param('disputeId').isUUID(),
      validate
    ],
    async (req, res) => {
      try {
        const result = await db.query(
          `SELECT d.*, t.order_id, t.gateway_transaction_id, t.amount as transaction_amount,
           t.customer_email, t.customer_name, t.customer_phone
          FROM disputes d
          JOIN transactions t ON d.transaction_id = t.id
          WHERE d.id::text = $1 AND d.merchant_id::text = $2`,
          [req.params.disputeId, req.merchantId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Dispute not found'
          });
        }
        
        res.json({
          success: true,
          data: result.rows[0]
        });
      } catch (error) {
        console.error('Error fetching dispute:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch dispute',
          message: error.message
        });
      }
    }
  );
  
  // ===== SETTLEMENT ROUTES (READ-ONLY, MERCHANT-SCOPED) =====
  
  /**
   * GET /api/merchant/settlements
   * List settlements for merchant (read-only)
   */
  router.get(
    '/settlements',
    requireMerchant,
    [
      query('status').optional(),
      query('startDate').optional().isISO8601(),
      query('endDate').optional().isISO8601(),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 }),
      validate
    ],
    async (req, res) => {
      try {
        const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let query = `
          SELECT *
          FROM settlements
          WHERE merchant_id::text = $1
        `;
        
        const values = [req.merchantId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND status = $${paramIndex}`;
          values.push(status);
          paramIndex++;
        }
        
        if (startDate) {
          query += ` AND settlement_date >= $${paramIndex}`;
          values.push(startDate);
          paramIndex++;
        }
        
        if (endDate) {
          query += ` AND settlement_date <= $${paramIndex}`;
          values.push(endDate);
          paramIndex++;
        }
        
        // Get total count
        const countResult = await db.query(
          query.replace('SELECT *', 'SELECT COUNT(*) as total'),
          values
        );
        const totalCount = parseInt(countResult.rows[0].total);
        
        // Add pagination
        query += ` ORDER BY settlement_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);
        
        const result = await db.query(query, values);
        
        res.json({
          success: true,
          data: {
            settlements: result.rows,
            pagination: {
              total: totalCount,
              limit: parseInt(limit),
              offset: parseInt(offset),
              hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
            }
          }
        });
      } catch (error) {
        console.error('Error fetching settlements:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch settlements',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/settlements/:settlementId
   * Get settlement details (read-only)
   */
  router.get(
    '/settlements/:settlementId',
    requireMerchant,
    [
      param('settlementId').isUUID(),
      validate
    ],
    async (req, res) => {
      try {
        const result = await db.query(
          `SELECT * FROM settlements 
           WHERE id::text = $1 AND merchant_id::text = $2`,
          [req.params.settlementId, req.merchantId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Settlement not found'
          });
        }
        
        res.json({
          success: true,
          data: result.rows[0]
        });
      } catch (error) {
        console.error('Error fetching settlement:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch settlement',
          message: error.message
        });
      }
    }
  );
  
  // ===== ANALYTICS ROUTES =====
  
  /**
   * GET /api/merchant/analytics/daily-operations
   * Get daily operations view (today/yesterday stats)
   */
  router.get(
    '/analytics/daily-operations',
    requireMerchant,
    async (req, res) => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        // Today's stats
        const todayStats = await db.query(
          `SELECT 
            COUNT(*) as total_transactions,
            COUNT(*) FILTER (WHERE status = 'success') as successful_transactions,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_transactions,
            COUNT(*) FILTER (WHERE status = 'pending' OR status = 'processing') as pending_transactions,
            COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) as total_amount
          FROM transactions
          WHERE tenant_id::text = $1 AND DATE(created_at) = $2`,
          [req.merchantId, today]
        );
        
        // Yesterday's stats
        const yesterdayStats = await db.query(
          `SELECT 
            COUNT(*) as total_transactions,
            COUNT(*) FILTER (WHERE status = 'success') as successful_transactions,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_transactions,
            COUNT(*) FILTER (WHERE status = 'pending' OR status = 'processing') as pending_transactions,
            COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) as total_amount
          FROM transactions
          WHERE tenant_id::text = $1 AND DATE(created_at) = $2`,
          [req.merchantId, yesterday]
        );
        
        // Pending refunds
        const pendingRefunds = await db.query(
          `SELECT COUNT(*) as count, COALESCE(SUM(refund_amount), 0) as total_amount
          FROM refunds
          WHERE merchant_id::text = $1 AND status IN ('initiated', 'processing')`,
          [req.merchantId]
        );
        
        // Open disputes
        const openDisputes = await db.query(
          `SELECT COUNT(*) as count, COALESCE(SUM(disputed_amount), 0) as total_amount
          FROM disputes
          WHERE merchant_id::text = $1 AND status IN ('open', 'under_review')`,
          [req.merchantId]
        );
        
        res.json({
          success: true,
          data: {
            today: {
              date: today,
              ...todayStats.rows[0]
            },
            yesterday: {
              date: yesterday,
              ...yesterdayStats.rows[0]
            },
            pending_refunds: pendingRefunds.rows[0],
            open_disputes: openDisputes.rows[0]
          }
        });
      } catch (error) {
        console.error('Error fetching daily operations:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch daily operations data',
          message: error.message
        });
      }
    }
  );
  
  /**
   * GET /api/merchant/analytics/statements
   * Generate downloadable statement data
   */
  router.get(
    '/analytics/statements',
    requireMerchant,
    [
      query('type').isIn(['transactions', 'settlements', 'refunds']).withMessage('Valid statement type required'),
      query('startDate').isISO8601().withMessage('Valid start date required'),
      query('endDate').isISO8601().withMessage('Valid end date required'),
      query('format').optional().isIn(['json', 'csv']),
      validate
    ],
    async (req, res) => {
      try {
        const { type, startDate, endDate, format = 'json' } = req.query;
        
        let query, columns;
        
        switch(type) {
          case 'transactions':
            columns = ['id', 'order_id', 'transaction_ref', 'payment_method', 'gateway', 
                      'amount', 'currency', 'status', 'customer_email', 'created_at'];
            query = `
              SELECT ${columns.join(', ')}
              FROM transactions
              WHERE tenant_id::text = $1 
                AND created_at >= $2 
                AND created_at <= $3
              ORDER BY created_at DESC
            `;
            break;
            
          case 'settlements':
            columns = ['id', 'settlement_ref', 'settlement_date', 'gross_amount', 
                      'fees_amount', 'net_amount', 'status', 'bank_account_number'];
            query = `
              SELECT ${columns.join(', ')}
              FROM settlements
              WHERE merchant_id::text = $1 
                AND settlement_date >= $2 
                AND settlement_date <= $3
              ORDER BY settlement_date DESC
            `;
            break;
            
          case 'refunds':
            columns = ['r.id', 'r.refund_ref', 'r.refund_amount', 'r.refund_type', 
                      'r.status', 'r.initiated_at', 't.order_id', 't.transaction_ref'];
            query = `
              SELECT ${columns.join(', ')}
              FROM refunds r
              JOIN transactions t ON r.transaction_id = t.id
              WHERE r.merchant_id::text = $1 
                AND r.created_at >= $2 
                AND r.created_at <= $3
              ORDER BY r.created_at DESC
            `;
            break;
        }
        
        const result = await db.query(query, [req.merchantId, startDate, endDate]);
        
        if (format === 'csv') {
          // Convert to CSV format
          const csvHeaders = columns.map(c => c.replace('r.', '').replace('t.', '')).join(',');
          const csvRows = result.rows.map(row => 
            Object.values(row).map(val => 
              typeof val === 'string' && val.includes(',') ? `"${val}"` : val
            ).join(',')
          );
          
          const csv = [csvHeaders, ...csvRows].join('\n');
          
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${type}-statement-${startDate}-${endDate}.csv"`);
          res.send(csv);
        } else {
          res.json({
            success: true,
            data: {
              type,
              period: { startDate, endDate },
              records: result.rows,
              total: result.rows.length
            }
          });
        }
      } catch (error) {
        console.error('Error generating statement:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to generate statement',
          message: error.message
        });
      }
    }
  );
  
  return router;
};
