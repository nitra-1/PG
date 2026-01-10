/**
 * Accounting Period API Routes
 * 
 * Internal API endpoints for accounting period management
 * Security: Requires FINANCE_ADMIN role for most operations
 */

const express = require('express');
const router = express.Router();
const { accountingPeriodService } = require('../core/ledger');

/**
 * Authentication middleware - requires FINANCE_ADMIN role
 */
const requireFinanceAdmin = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  
  if (!userRole || userRole !== 'FINANCE_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: FINANCE_ADMIN role required'
    });
  }
  
  next();
};

/**
 * GET /api/accounting-periods
 * Get all accounting periods
 */
router.get('/', requireFinanceAdmin, async (req, res) => {
  try {
    const { tenantId, periodType, status, limit } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const periods = await accountingPeriodService.getPeriods({
      tenantId,
      periodType,
      status,
      limit: limit ? parseInt(limit) : undefined
    });
    
    res.json({
      success: true,
      data: periods
    });
    
  } catch (error) {
    console.error('Error fetching accounting periods:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/accounting-periods/open
 * Get current open period
 */
router.get('/open', requireFinanceAdmin, async (req, res) => {
  try {
    const { tenantId, periodType } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const period = await accountingPeriodService.getOpenPeriod(
      tenantId,
      periodType || 'DAILY'
    );
    
    res.json({
      success: true,
      data: period
    });
    
  } catch (error) {
    console.error('Error fetching open period:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/accounting-periods/:periodId
 * Get specific accounting period
 */
router.get('/:periodId', requireFinanceAdmin, async (req, res) => {
  try {
    const { periodId } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const period = await accountingPeriodService.getPeriod(periodId, tenantId);
    
    res.json({
      success: true,
      data: period
    });
    
  } catch (error) {
    console.error('Error fetching period:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/accounting-periods
 * Create new accounting period
 */
router.post('/', requireFinanceAdmin, async (req, res) => {
  try {
    const {
      tenantId,
      periodType,
      periodStart,
      periodEnd
    } = req.body;
    
    const createdBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !periodType || !periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const period = await accountingPeriodService.createPeriod({
      tenantId,
      periodType,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      createdBy
    });
    
    res.status(201).json({
      success: true,
      data: period
    });
    
  } catch (error) {
    console.error('Error creating period:', error);
    
    // Return appropriate status code based on error type
    const statusCode = error.name === 'PeriodOverlapError' || 
                      error.name === 'PeriodGapError' ? 409 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/accounting-periods/:periodId/close
 * Close an accounting period (OPEN -> SOFT_CLOSED or SOFT_CLOSED -> HARD_CLOSED)
 */
router.post('/:periodId/close', requireFinanceAdmin, async (req, res) => {
  try {
    const { periodId } = req.params;
    const { tenantId, targetStatus, closureNotes } = req.body;
    
    const closedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !targetStatus || !closureNotes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const period = await accountingPeriodService.closePeriod({
      periodId,
      tenantId,
      targetStatus,
      closedBy,
      closureNotes
    });
    
    res.json({
      success: true,
      data: period,
      message: `Period closed to ${targetStatus}`
    });
    
  } catch (error) {
    console.error('Error closing period:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/accounting-periods/check
 * Check if posting is allowed for a transaction date
 */
router.post('/check', async (req, res) => {
  try {
    const { tenantId, transactionDate, periodType } = req.body;
    
    if (!tenantId || !transactionDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const result = await accountingPeriodService.checkPeriodForPosting({
      tenantId,
      transactionDate: new Date(transactionDate),
      periodType: periodType || 'DAILY'
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error checking period:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
