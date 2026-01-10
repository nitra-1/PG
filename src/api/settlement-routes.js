/**
 * Settlement API Routes
 * 
 * Internal API endpoints for settlement management with state machine
 * Security: Requires appropriate roles for different operations
 */

const express = require('express');
const router = express.Router();
const { settlementService } = require('../core/ledger');

/**
 * Authentication middleware - requires finance or operations role
 */
const requireFinanceOrOps = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  
  if (!userRole || !['FINANCE_ADMIN', 'OPERATIONS', 'FINANCE'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Finance or Operations role required'
    });
  }
  
  next();
};

/**
 * GET /api/settlements
 * Get settlements by status
 */
router.get('/', requireFinanceOrOps, async (req, res) => {
  try {
    const { tenantId, status, limit } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlements = await settlementService.getSettlementsByStatus({
      tenantId,
      status,
      limit: limit ? parseInt(limit) : undefined
    });
    
    res.json({
      success: true,
      data: settlements
    });
    
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settlements/retry-queue
 * Get settlements ready for retry
 */
router.get('/retry-queue', requireFinanceOrOps, async (req, res) => {
  try {
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlements = await settlementService.getSettlementsForRetry(tenantId);
    
    res.json({
      success: true,
      data: settlements
    });
    
  } catch (error) {
    console.error('Error fetching retry queue:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/settlements/:settlementId
 * Get specific settlement
 */
router.get('/:settlementId', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await settlementService.getSettlement(settlementId, tenantId);
    
    res.json({
      success: true,
      data: settlement
    });
    
  } catch (error) {
    console.error('Error fetching settlement:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settlements
 * Create new settlement
 */
router.post('/', requireFinanceOrOps, async (req, res) => {
  try {
    const {
      tenantId,
      merchantId,
      settlementRef,
      settlementDate,
      periodFrom,
      periodTo,
      grossAmount,
      feesAmount,
      netAmount,
      bankAccountNumber,
      bankIfsc,
      bankName,
      metadata
    } = req.body;
    
    const createdBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !merchantId || !settlementRef || !netAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const settlement = await settlementService.createSettlement({
      tenantId,
      merchantId,
      settlementRef,
      settlementDate: settlementDate ? new Date(settlementDate) : undefined,
      periodFrom: periodFrom ? new Date(periodFrom) : undefined,
      periodTo: periodTo ? new Date(periodTo) : undefined,
      grossAmount,
      feesAmount,
      netAmount,
      bankAccountNumber,
      bankIfsc,
      bankName,
      metadata,
      createdBy
    });
    
    res.status(201).json({
      success: true,
      data: settlement
    });
    
  } catch (error) {
    console.error('Error creating settlement:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/settlements/:settlementId/reserve-funds
 * Reserve funds for settlement (CREATED -> FUNDS_RESERVED)
 */
router.post('/:settlementId/reserve-funds', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId } = req.body;
    
    const reservedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await settlementService.reserveFunds({
      settlementId,
      tenantId,
      reservedBy
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Funds reserved successfully'
    });
    
  } catch (error) {
    console.error('Error reserving funds:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/settlements/:settlementId/send-to-bank
 * Mark settlement as sent to bank (FUNDS_RESERVED -> SENT_TO_BANK)
 */
router.post('/:settlementId/send-to-bank', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId, bankBatchId } = req.body;
    
    const sentBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await settlementService.sendToBank({
      settlementId,
      tenantId,
      sentBy,
      bankBatchId
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Settlement sent to bank'
    });
    
  } catch (error) {
    console.error('Error sending to bank:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/settlements/:settlementId/confirm-by-bank
 * Confirm bank processed settlement (SENT_TO_BANK -> BANK_CONFIRMED)
 * This is the critical step for finality
 */
router.post('/:settlementId/confirm-by-bank', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const {
      tenantId,
      bankReferenceNumber,
      bankTransactionId,
      utrNumber,
      settlementBatchId
    } = req.body;
    
    const confirmedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !utrNumber) {
      return res.status(400).json({
        success: false,
        error: 'tenantId and utrNumber are required'
      });
    }
    
    const settlement = await settlementService.confirmByBank({
      settlementId,
      tenantId,
      confirmedBy,
      bankReferenceNumber,
      bankTransactionId,
      utrNumber,
      settlementBatchId
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Settlement confirmed by bank'
    });
    
  } catch (error) {
    console.error('Error confirming by bank:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/settlements/:settlementId/mark-settled
 * Mark settlement as fully settled (BANK_CONFIRMED -> SETTLED)
 */
router.post('/:settlementId/mark-settled', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId } = req.body;
    
    const settledBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await settlementService.markSettled({
      settlementId,
      tenantId,
      settledBy
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Settlement marked as settled'
    });
    
  } catch (error) {
    console.error('Error marking settled:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/settlements/:settlementId/mark-failed
 * Mark settlement as failed (Any state -> FAILED)
 */
router.post('/:settlementId/mark-failed', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId, failureReason } = req.body;
    
    const failedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !failureReason) {
      return res.status(400).json({
        success: false,
        error: 'tenantId and failureReason are required'
      });
    }
    
    const settlement = await settlementService.markFailed({
      settlementId,
      tenantId,
      failedBy,
      failureReason
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Settlement marked as failed'
    });
    
  } catch (error) {
    console.error('Error marking failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

/**
 * POST /api/settlements/:settlementId/retry
 * Retry a failed settlement (FAILED -> RETRIED -> FUNDS_RESERVED)
 */
router.post('/:settlementId/retry', requireFinanceOrOps, async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { tenantId } = req.body;
    
    const retriedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await settlementService.retrySettlement({
      settlementId,
      tenantId,
      retriedBy
    });
    
    res.json({
      success: true,
      data: settlement,
      message: 'Settlement retry initiated'
    });
    
  } catch (error) {
    console.error('Error retrying settlement:', error);
    
    // Return appropriate status code for retry exhausted
    const statusCode = error.name === 'SettlementRetryExhaustedError' ? 409 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
