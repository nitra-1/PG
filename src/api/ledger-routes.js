/**
 * Ledger API Routes
 * 
 * Internal API endpoints for ledger queries and operations
 * These are NOT public merchant APIs - they're for internal use only
 * 
 * Security: Requires admin/finance role authorization
 */

const express = require('express');
const router = express.Router();
const { ledgerService, reconciliationService } = require('../core/ledger');

/**
 * Authentication middleware (placeholder - implement based on your auth system)
 */
const requireFinanceRole = (req, res, next) => {
  // TODO: Implement proper role-based authentication
  // Check if user has 'finance' or 'admin' role
  const userRole = req.headers['x-user-role']; // Example
  
  if (!userRole || !['finance', 'admin', 'auditor'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Finance role required'
    });
  }
  
  next();
};

/**
 * GET /api/ledger/accounts/:accountCode/balance
 * Get account balance
 */
router.get('/accounts/:accountCode/balance', requireFinanceRole, async (req, res) => {
  try {
    const { accountCode } = req.params;
    const { tenantId, asOfDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const balance = await ledgerService.getAccountBalance({
      tenantId,
      accountCode,
      asOfDate: asOfDate ? new Date(asOfDate) : null
    });
    
    res.json({
      success: true,
      data: balance
    });
    
  } catch (error) {
    console.error('Error fetching account balance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger/transactions/:transactionId
 * Get ledger transaction details
 */
router.get('/transactions/:transactionId', requireFinanceRole, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const transaction = await ledgerService.getTransaction(transactionId, tenantId);
    
    res.json({
      success: true,
      data: transaction
    });
    
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger/summary
 * Get ledger summary for reporting
 */
router.get('/summary', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, fromDate, toDate, accountType } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const summary = await ledgerService.getLedgerSummary({
      tenantId,
      fromDate: fromDate ? new Date(fromDate) : null,
      toDate: toDate ? new Date(toDate) : null,
      accountType
    });
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    console.error('Error fetching ledger summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger/transactions/reverse
 * Reverse a ledger transaction (admin only)
 */
router.post('/transactions/reverse', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, originalTransactionId, reason } = req.body;
    const createdBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !originalTransactionId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'tenantId, originalTransactionId, and reason are required'
      });
    }
    
    // Additional approval check
    const approvalRequired = true; // Set based on business rules
    if (approvalRequired && !req.body.approvedBy) {
      return res.status(400).json({
        success: false,
        error: 'Approval required for transaction reversal'
      });
    }
    
    const result = await ledgerService.reverseTransaction({
      tenantId,
      originalTransactionId,
      reason,
      createdBy
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error reversing transaction:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger/reconciliation/batch
 * Create a new reconciliation batch
 */
router.post('/reconciliation/batch', requireFinanceRole, async (req, res) => {
  try {
    const {
      tenantId,
      reconciliationType,
      gatewayName,
      gatewaySettlementId,
      periodFrom,
      periodTo
    } = req.body;
    
    const createdBy = req.headers['x-user-email'] || 'unknown';
    
    if (!tenantId || !reconciliationType || !periodFrom || !periodTo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const batch = await reconciliationService.createReconciliationBatch({
      tenantId,
      reconciliationType,
      gatewayName,
      gatewaySettlementId,
      periodFrom: new Date(periodFrom),
      periodTo: new Date(periodTo),
      createdBy
    });
    
    res.json({
      success: true,
      data: batch
    });
    
  } catch (error) {
    console.error('Error creating reconciliation batch:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger/reconciliation/gateway
 * Reconcile gateway settlement
 */
router.post('/reconciliation/gateway', requireFinanceRole, async (req, res) => {
  try {
    const { batchId, externalTransactions } = req.body;
    
    if (!batchId || !externalTransactions || !Array.isArray(externalTransactions)) {
      return res.status(400).json({
        success: false,
        error: 'batchId and externalTransactions array are required'
      });
    }
    
    const result = await reconciliationService.reconcileGatewaySettlement({
      batchId,
      externalTransactions
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error performing gateway reconciliation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/ledger/reconciliation/escrow
 * Reconcile bank escrow statement
 */
router.post('/reconciliation/escrow', requireFinanceRole, async (req, res) => {
  try {
    const { batchId, bankTransactions } = req.body;
    
    if (!batchId || !bankTransactions || !Array.isArray(bankTransactions)) {
      return res.status(400).json({
        success: false,
        error: 'batchId and bankTransactions array are required'
      });
    }
    
    const result = await reconciliationService.reconcileBankEscrowStatement({
      batchId,
      bankTransactions
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error performing escrow reconciliation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger/reconciliation/:batchId
 * Get reconciliation batch details
 */
router.get('/reconciliation/:batchId', requireFinanceRole, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const batch = await reconciliationService.getReconciliationBatch(batchId, tenantId);
    
    res.json({
      success: true,
      data: batch
    });
    
  } catch (error) {
    console.error('Error fetching reconciliation batch:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/ledger/reconciliation/items/:itemId/resolve
 * Resolve a reconciliation discrepancy
 */
router.put('/reconciliation/items/:itemId/resolve', requireFinanceRole, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { resolution, notes } = req.body;
    const resolvedBy = req.headers['x-user-email'] || 'unknown';
    
    if (!resolution || !notes) {
      return res.status(400).json({
        success: false,
        error: 'resolution and notes are required'
      });
    }
    
    const result = await reconciliationService.resolveReconciliationItem({
      itemId,
      resolution,
      notes,
      resolvedBy
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error resolving reconciliation item:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ledger/health
 * Health check for ledger system
 */
router.get('/health', async (req, res) => {
  try {
    // Check if we can query the database
    const db = require('../database');
    await db.knex.raw('SELECT 1');
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Ledger health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
