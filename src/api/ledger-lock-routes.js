/**
 * Ledger Lock API Routes
 * 
 * Internal API endpoints for ledger lock management
 * Security: Requires FINANCE_ADMIN role
 */

const express = require('express');
const router = express.Router();
const { ledgerLockService } = require('../core/ledger');

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
 * GET /api/ledger-locks
 * Get all active locks
 */
router.get('/', requireFinanceAdmin, async (req, res) => {
  try {
    const { tenantId, lockType } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const locks = await ledgerLockService.getActiveLocks(tenantId, lockType);
    
    res.json({
      success: true,
      data: locks
    });
    
  } catch (error) {
    console.error('Error fetching locks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger-locks/history
 * Get lock history for a period
 */
router.get('/history', requireFinanceAdmin, async (req, res) => {
  try {
    const { tenantId, startDate, endDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const locks = await ledgerLockService.getLockHistory({
      tenantId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });
    
    res.json({
      success: true,
      data: locks
    });
    
  } catch (error) {
    console.error('Error fetching lock history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger-locks/:lockId
 * Get specific lock
 */
router.get('/:lockId', requireFinanceAdmin, async (req, res) => {
  try {
    const { lockId } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const lock = await ledgerLockService.getLock(lockId, tenantId);
    
    res.json({
      success: true,
      data: lock
    });
    
  } catch (error) {
    console.error('Error fetching lock:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger-locks
 * Apply a new ledger lock
 */
router.post('/', requireFinanceAdmin, async (req, res) => {
  try {
    const {
      tenantId,
      lockType,
      lockStartDate,
      lockEndDate,
      reason,
      referenceNumber,
      accountingPeriodId,
      metadata
    } = req.body;
    
    const lockedBy = req.headers['x-user-email'] || 'unknown';
    const lockedByRole = req.headers['x-user-role'] || 'unknown';
    
    if (!tenantId || !lockType || !lockStartDate || !lockEndDate || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const lock = await ledgerLockService.applyLock({
      tenantId,
      lockType,
      lockStartDate: new Date(lockStartDate),
      lockEndDate: new Date(lockEndDate),
      reason,
      lockedBy,
      lockedByRole,
      referenceNumber,
      accountingPeriodId,
      metadata
    });
    
    res.status(201).json({
      success: true,
      data: lock,
      message: 'Ledger lock applied successfully'
    });
    
  } catch (error) {
    console.error('Error applying lock:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger-locks/:lockId/release
 * Release a ledger lock
 */
router.post('/:lockId/release', requireFinanceAdmin, async (req, res) => {
  try {
    const { lockId } = req.params;
    const { tenantId, releaseNotes } = req.body;
    
    const releasedBy = req.headers['x-user-email'] || 'unknown';
    const releasedByRole = req.headers['x-user-role'] || 'unknown';
    
    if (!tenantId || !releaseNotes) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const lock = await ledgerLockService.releaseLock({
      lockId,
      tenantId,
      releasedBy,
      releasedByRole,
      releaseNotes
    });
    
    res.json({
      success: true,
      data: lock,
      message: 'Ledger lock released successfully'
    });
    
  } catch (error) {
    console.error('Error releasing lock:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger-locks/check
 * Check if ledger is locked for a transaction date
 */
router.post('/check', async (req, res) => {
  try {
    const { tenantId, transactionDate } = req.body;
    
    if (!tenantId || !transactionDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const result = await ledgerLockService.checkLockStatus(
      tenantId,
      new Date(transactionDate)
    );
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error checking lock status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
