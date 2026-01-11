/**
 * Finance Admin API Routes
 * 
 * CRITICAL: This is the consolidated API router for Finance Admin Dashboard
 * RBI-Compliant | Audit-First | Zero Ledger Mutation via UI
 * 
 * Security: Requires FINANCE_ADMIN or COMPLIANCE_ADMIN role
 * Access Control: Role boundaries strictly enforced
 * Audit: All actions logged with user, timestamp, and justification
 */

const express = require('express');
const router = express.Router();
const { 
  accountingPeriodService,
  settlementService,
  ledgerLockService,
  ledgerService,
  reconciliationService
} = require('../core/ledger');
const db = require('../database');

/**
 * Validate UUID format
 */
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Role-based authentication middleware
 */
const requireFinanceRole = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  
  if (!userRole || !userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  
  if (!['FINANCE_ADMIN', 'COMPLIANCE_ADMIN'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: FINANCE_ADMIN or COMPLIANCE_ADMIN role required'
    });
  }
  
  // Store for later use
  req.financeUser = {
    userId,
    userRole,
    userEmail: req.headers['x-user-email'] || 'unknown'
  };
  
  next();
};

/**
 * Compliance admin only (for approvals)
 */
const requireComplianceAdmin = (req, res, next) => {
  if (req.financeUser.userRole !== 'COMPLIANCE_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: COMPLIANCE_ADMIN role required for approvals'
    });
  }
  next();
};

// ============================================================
// DASHBOARD OVERVIEW
// ============================================================

/**
 * GET /api/finance-admin/dashboard
 * Finance dashboard overview
 */
router.get('/dashboard', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    // Get current accounting period
    const openPeriod = await accountingPeriodService.getOpenPeriod(tenantId, 'DAILY')
      .catch(() => null);
    
    // Get active locks
    const activeLocks = await ledgerLockService.getActiveLocks(tenantId);
    
    // Get pending settlements
    const pendingSettlements = await settlementService.getSettlementsByStatus({
      tenantId,
      status: 'CREATED',
      limit: 10
    });
    
    // Get recent overrides
    const recentOverrides = await db.knex('admin_overrides_log')
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .limit(5);
    
    // Get pending approval requests
    const pendingApprovals = await db.knex('approval_requests')
      .where('status', 'pending')
      .whereIn('request_type', ['SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION'])
      .orderBy('requested_at', 'desc')
      .limit(10);
    
    res.json({
      success: true,
      dashboard: {
        currentPeriod: openPeriod,
        activeLocks: activeLocks || [],
        pendingSettlements: pendingSettlements || [],
        recentOverrides: recentOverrides || [],
        pendingApprovals: pendingApprovals || []
      }
    });
    
  } catch (error) {
    console.error('Error loading finance dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// ACCOUNTING PERIODS (delegate to existing routes)
// ============================================================

// Import and mount existing accounting period routes
const accountingPeriodRoutes = require('./accounting-period-routes');
router.use('/accounting-periods', accountingPeriodRoutes);

// ============================================================
// SETTLEMENTS (delegate to existing routes)
// ============================================================

// Import and mount existing settlement routes
const settlementRoutes = require('./settlement-routes');
router.use('/settlements', settlementRoutes);

// ============================================================
// LEDGER LOCKS (delegate to existing routes)
// ============================================================

// Import and mount existing ledger lock routes
const ledgerLockRoutes = require('./ledger-lock-routes');
router.use('/ledger-locks', ledgerLockRoutes);

// ============================================================
// LEDGER EXPLORER (READ-ONLY)
// ============================================================

/**
 * GET /api/finance-admin/ledger/transactions
 * Get ledger transactions (read-only)
 */
router.get('/ledger/transactions', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, fromDate, toDate, accountCode, eventType, limit = 100, offset = 0 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    let query = db.knex('ledger_transactions as lt')
      .select(
        'lt.*',
        db.knex.raw('json_agg(le.*) as entries')
      )
      .leftJoin('ledger_entries as le', 'lt.id', 'le.transaction_id')
      .where('lt.tenant_id', tenantId)
      .groupBy('lt.id')
      .orderBy('lt.created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    if (fromDate) {
      query = query.where('lt.created_at', '>=', new Date(fromDate));
    }
    
    if (toDate) {
      query = query.where('lt.created_at', '<=', new Date(toDate));
    }
    
    if (eventType) {
      query = query.where('lt.event_type', eventType);
    }
    
    const transactions = await query;
    
    // Count total
    const countQuery = db.knex('ledger_transactions')
      .where('tenant_id', tenantId)
      .count('* as count');
    
    if (fromDate) countQuery.where('created_at', '>=', new Date(fromDate));
    if (toDate) countQuery.where('created_at', '<=', new Date(toDate));
    if (eventType) countQuery.where('event_type', eventType);
    
    const [{ count }] = await countQuery;
    
    res.json({
      success: true,
      data: {
        transactions,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Error fetching ledger transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/ledger/accounts
 * Get ledger accounts with current balances (read-only)
 */
router.get('/ledger/accounts', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, accountType } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    // Get accounts from account_balances view
    let query = db.knex('account_balances')
      .select('*')
      .where('tenant_id', tenantId)
      .orderBy('account_code');
    
    if (accountType) {
      query = query.where('account_type', accountType);
    }
    
    const accounts = await query;
    
    res.json({
      success: true,
      data: accounts
    });
    
  } catch (error) {
    console.error('Error fetching ledger accounts:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/ledger/export
 * Export ledger transactions as CSV (read-only)
 */
router.get('/ledger/export', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, fromDate, toDate } = req.query;
    
    if (!tenantId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: 'tenantId, fromDate, and toDate are required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    const transactions = await db.knex('ledger_entries as le')
      .select(
        'le.created_at as transaction_date',
        'lt.transaction_ref',
        'lt.event_type',
        'le.account_id',
        'la.account_code',
        'la.account_name',
        'le.entry_type',
        'le.amount',
        'le.description',
        'lt.created_by'
      )
      .join('ledger_transactions as lt', 'le.transaction_id', 'lt.id')
      .leftJoin('ledger_accounts as la', 'le.account_id', 'la.id')
      .where('le.tenant_id', tenantId)
      .whereBetween('le.created_at', [new Date(fromDate), new Date(toDate)])
      .orderBy('le.created_at', 'asc');
    
    // Convert to CSV
    const csvHeader = 'Date,Transaction Ref,Event Type,Account Code,Account Name,Entry Type,Amount,Description,Created By\n';
    const csvRows = transactions.map(t => 
      `${t.transaction_date},${t.transaction_ref},${t.event_type},${t.account_code},${t.account_name || ''},${t.entry_type},${t.amount},${t.description || ''},${t.created_by}`
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=ledger_export_${fromDate}_${toDate}.csv`);
    res.send(csvHeader + csvRows);
    
  } catch (error) {
    console.error('Error exporting ledger:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// OVERRIDE APPROVAL WORKFLOW (DUAL-CONFIRMATION)
// ============================================================

/**
 * POST /api/finance-admin/overrides/request
 * Request an admin override (Finance Admin only)
 */
router.post('/overrides/request', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, overrideType, justification, affectedTransactionIds, metadata } = req.body;
    
    if (!tenantId || !overrideType || !justification) {
      return res.status(400).json({
        success: false,
        error: 'tenantId, overrideType, and justification are required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    // Finance Admin cannot be Compliance Admin (prevent self-approval)
    if (req.financeUser.userRole === 'COMPLIANCE_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'COMPLIANCE_ADMIN cannot request overrides - only approve them'
      });
    }
    
    // Create approval request
    const [approvalRequest] = await db.knex('approval_requests')
      .insert({
        request_type: overrideType,
        requestor_id: req.financeUser.userId,
        status: 'pending',
        request_data: JSON.stringify({
          tenantId,
          overrideType,
          justification,
          affectedTransactionIds: affectedTransactionIds || [],
          metadata: metadata || {},
          requestedBy: req.financeUser.userEmail,
          requestedAt: new Date()
        })
      })
      .returning('*');
    
    res.status(201).json({
      success: true,
      data: approvalRequest,
      message: 'Override request submitted for approval'
    });
    
  } catch (error) {
    console.error('Error creating override request:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/overrides/pending
 * Get pending override requests
 */
router.get('/overrides/pending', requireFinanceRole, async (req, res) => {
  try {
    const approvalRequests = await db.knex('approval_requests as ar')
      .select(
        'ar.*',
        'pu.username as requestor_username',
        'pu.email as requestor_email'
      )
      .leftJoin('platform_users as pu', 'ar.requestor_id', 'pu.id')
      .where('ar.status', 'pending')
      .whereIn('ar.request_type', ['SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION'])
      .orderBy('ar.requested_at', 'desc');
    
    res.json({
      success: true,
      data: approvalRequests
    });
    
  } catch (error) {
    console.error('Error fetching pending overrides:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/finance-admin/overrides/:requestId/approve
 * Approve an override request (Compliance Admin only)
 */
router.post('/overrides/:requestId/approve', requireFinanceRole, requireComplianceAdmin, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approvalReason } = req.body;
    
    if (!approvalReason) {
      return res.status(400).json({
        success: false,
        error: 'approvalReason is required'
      });
    }
    
    // Get the request
    const request = await db.knex('approval_requests')
      .where('id', requestId)
      .first();
    
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Override request not found'
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Request is not pending'
      });
    }
    
    // Prevent self-approval
    if (request.requestor_id === req.financeUser.userId) {
      return res.status(403).json({
        success: false,
        error: 'Self-approval is forbidden'
      });
    }
    
    // Update request
    const [updatedRequest] = await db.knex('approval_requests')
      .where('id', requestId)
      .update({
        status: 'approved',
        approver_id: req.financeUser.userId,
        approval_reason: approvalReason,
        approved_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
    
    // Log the approval in admin_overrides_log
    const requestData = JSON.parse(request.request_data);
    await db.knex('admin_overrides_log').insert({
      tenant_id: requestData.tenantId,
      override_type: request.request_type,
      justification: requestData.justification,
      approval_reason: approvalReason,
      override_by: requestData.requestedBy,
      override_by_role: 'FINANCE_ADMIN',
      approved_by: req.financeUser.userEmail,
      approved_by_role: 'COMPLIANCE_ADMIN',
      affected_transaction_ids: JSON.stringify(requestData.affectedTransactionIds || []),
      metadata: JSON.stringify(requestData.metadata || {})
    });
    
    res.json({
      success: true,
      data: updatedRequest,
      message: 'Override request approved'
    });
    
  } catch (error) {
    console.error('Error approving override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/finance-admin/overrides/:requestId/reject
 * Reject an override request (Compliance Admin only)
 */
router.post('/overrides/:requestId/reject', requireFinanceRole, requireComplianceAdmin, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        error: 'rejectionReason is required'
      });
    }
    
    // Get the request
    const request = await db.knex('approval_requests')
      .where('id', requestId)
      .first();
    
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Override request not found'
      });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Request is not pending'
      });
    }
    
    // Update request
    const [updatedRequest] = await db.knex('approval_requests')
      .where('id', requestId)
      .update({
        status: 'rejected',
        approver_id: req.financeUser.userId,
        approval_reason: rejectionReason,
        approved_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
    
    res.json({
      success: true,
      data: updatedRequest,
      message: 'Override request rejected'
    });
    
  } catch (error) {
    console.error('Error rejecting override:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/overrides/history
 * Get override history
 */
router.get('/overrides/history', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, limit = 50 } = req.query;
    
    let query = db.knex('admin_overrides_log')
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));
    
    if (tenantId) {
      query = query.where('tenant_id', tenantId);
    }
    
    const overrides = await query;
    
    res.json({
      success: true,
      data: overrides
    });
    
  } catch (error) {
    console.error('Error fetching override history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// RECONCILIATION CONSOLE
// ============================================================

/**
 * GET /api/finance-admin/reconciliation/batches
 * Get reconciliation batches
 */
router.get('/reconciliation/batches', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, reconciliationType, status, limit = 50 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    let query = db.knex('reconciliation_batches')
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));
    
    if (reconciliationType) {
      query = query.where('reconciliation_type', reconciliationType);
    }
    
    if (status) {
      query = query.where('status', status);
    }
    
    const batches = await query;
    
    res.json({
      success: true,
      data: batches
    });
    
  } catch (error) {
    console.error('Error fetching reconciliation batches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/reconciliation/batches/:batchId/items
 * Get reconciliation items for a batch
 */
router.get('/reconciliation/batches/:batchId/items', requireFinanceRole, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { matchStatus } = req.query;
    
    let query = db.knex('reconciliation_items')
      .where('batch_id', batchId)
      .orderBy('created_at', 'desc');
    
    if (matchStatus) {
      query = query.where('match_status', matchStatus);
    }
    
    const items = await query;
    
    res.json({
      success: true,
      data: items
    });
    
  } catch (error) {
    console.error('Error fetching reconciliation items:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/finance-admin/reconciliation/batches/:batchId/complete
 * Mark reconciliation batch as completed
 */
router.post('/reconciliation/batches/:batchId/complete', requireFinanceRole, async (req, res) => {
  try {
    const { batchId } = req.params;
    const { completionNotes } = req.body;
    
    const [batch] = await db.knex('reconciliation_batches')
      .where('id', batchId)
      .update({
        status: 'completed',
        completed_at: new Date(),
        completed_by: req.financeUser.userEmail,
        completion_notes: completionNotes
      })
      .returning('*');
    
    res.json({
      success: true,
      data: batch,
      message: 'Reconciliation batch marked as completed'
    });
    
  } catch (error) {
    console.error('Error completing reconciliation batch:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delegate to existing reconciliation routes for creation
const ledgerRoutes = require('./ledger-routes');
router.use('/reconciliation', ledgerRoutes);

// ============================================================
// FINANCIAL REPORTS
// ============================================================

/**
 * GET /api/finance-admin/reports/daily-escrow-balance
 * Daily escrow balance report
 */
router.get('/reports/daily-escrow-balance', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, reportDate } = req.query;
    
    if (!tenantId || !reportDate) {
      return res.status(400).json({
        success: false,
        error: 'tenantId and reportDate are required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    const balance = await ledgerService.getAccountBalance({
      tenantId,
      accountCode: 'ESC-001',
      asOfDate: new Date(reportDate)
    });
    
    const liability = await ledgerService.getAccountBalance({
      tenantId,
      accountCode: 'ESC-002',
      asOfDate: new Date(reportDate)
    });
    
    res.json({
      success: true,
      report: {
        reportType: 'daily_escrow_balance',
        reportDate: reportDate,
        escrowBalance: balance,
        customerLiability: liability,
        reconciled: Math.abs(balance.balance - liability.balance) < 0.01
      }
    });
    
  } catch (error) {
    console.error('Error generating daily escrow balance report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/reports/merchant-payables
 * Merchant outstanding/payable report
 */
router.get('/reports/merchant-payables', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, asOfDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    const payables = await db.knex('account_balances')
      .where('tenant_id', tenantId)
      .where('account_type', 'merchant')
      .where('account_code', 'like', 'MER-002%')
      .orderBy('balance', 'desc');
    
    res.json({
      success: true,
      report: {
        reportType: 'merchant_payables',
        reportDate: asOfDate || new Date(),
        payables
      }
    });
    
  } catch (error) {
    console.error('Error generating merchant payables report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/reports/platform-revenue
 * Platform revenue report
 */
router.get('/reports/platform-revenue', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId, fromDate, toDate } = req.query;
    
    if (!tenantId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: 'tenantId, fromDate, and toDate are required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    const revenue = await db.knex('ledger_entries as le')
      .join('ledger_accounts as la', 'le.account_id', 'la.id')
      .where('le.tenant_id', tenantId)
      .where('la.account_code', 'like', 'REV-%')
      .whereBetween('le.created_at', [new Date(fromDate), new Date(toDate)])
      .where('le.entry_type', 'credit')
      .sum('le.amount as total_revenue')
      .groupBy('la.account_code')
      .select('la.account_code');
    
    res.json({
      success: true,
      report: {
        reportType: 'platform_revenue',
        fromDate,
        toDate,
        revenue
      }
    });
    
  } catch (error) {
    console.error('Error generating platform revenue report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/finance-admin/reports/settlement-aging
 * Settlement aging report
 */
router.get('/reports/settlement-aging', requireFinanceRole, async (req, res) => {
  try {
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!isValidUUID(tenantId)) {
      return res.status(400).json({
        success: false,
        error: 'tenantId must be a valid UUID'
      });
    }
    
    const settlements = await db.knex('settlements')
      .where('tenant_id', tenantId)
      .whereIn('status', ['CREATED', 'FUNDS_RESERVED', 'SENT_TO_BANK', 'BANK_CONFIRMED'])
      .select(
        'status',
        db.knex.raw('count(*) as count'),
        db.knex.raw('sum(net_amount) as total_amount'),
        db.knex.raw('min(created_at) as oldest')
      )
      .groupBy('status');
    
    res.json({
      success: true,
      report: {
        reportType: 'settlement_aging',
        reportDate: new Date(),
        settlements
      }
    });
    
  } catch (error) {
    console.error('Error generating settlement aging report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// MERCHANT/TENANT MANAGEMENT
// ============================================================

/**
 * GET /api/finance-admin/merchants
 * List all merchants/tenants for FINANCE_ADMIN to select from
 */
router.get('/merchants', requireFinanceRole, async (req, res) => {
  try {
    const merchants = await db.knex('merchants')
      .select('id', 'merchant_code', 'merchant_name', 'status', 'email')
      .orderBy('merchant_name', 'asc');
    
    res.json({
      success: true,
      merchants
    });
  } catch (error) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
