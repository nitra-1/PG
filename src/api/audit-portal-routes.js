/**
 * Audit Portal API Routes
 * 
 * STRICTLY READ-ONLY API for RBI/Bank/Statutory Auditors
 * 
 * Security Model:
 * - AUDITOR role required (enforced by middleware)
 * - Time-boxed access enforced
 * - All requests logged
 * - Zero write capability
 * - No data manipulation
 * 
 * Audit Questions Answered:
 * 1. When were the books closed, and by whom? (Accounting Period History)
 * 2. Was this settlement actually completed? (Settlement Status Viewer)
 * 3. Were overrides approved correctly? (Admin Override Log)
 * 4. Was the ledger frozen during audit? (Ledger Lock History)
 * 5. Who did what, when, and why? (Complete Audit Trail)
 * 6. What are the compliance metrics? (Compliance Reports)
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const ComplianceReportsService = require('../core/compliance-reports-service');
const {
  requireAuditorRole,
  enforceReadOnly,
  logAuditAccess,
  addAuditWatermarkHeaders,
  validateTenantAccess
} = require('./audit-portal-middleware');

// Initialize compliance reports service
const complianceReportsService = new ComplianceReportsService();

// Apply middleware to ALL audit portal routes
router.use(requireAuditorRole);
router.use(enforceReadOnly);
router.use(logAuditAccess);
router.use(addAuditWatermarkHeaders);
router.use(validateTenantAccess);

// ============================================================
// AUDIT PORTAL OVERVIEW
// ============================================================

/**
 * GET /api/audit-portal/overview
 * Dashboard overview for auditor
 */
router.get('/overview', async (req, res) => {
  try {
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    // Get current auditor's access window info
    const accessWindow = await db.knex('auditor_access_windows')
      .where('auditor_user_id', req.auditor.userId)
      .where('status', 'ACTIVE')
      .first();
    
    // Get tenant info
    const tenant = await db.knex('merchants')
      .where('id', tenantId)
      .first();
    
    // Get summary stats
    const [periodsCount, settlementsCount, locksCount, overridesCount] = await Promise.all([
      db.knex('accounting_periods').where('tenant_id', tenantId).count('* as count').first(),
      db.knex('settlements').where('tenant_id', tenantId).count('* as count').first(),
      db.knex('ledger_locks').where('tenant_id', tenantId).count('* as count').first(),
      db.knex('admin_overrides_log').where('tenant_id', tenantId).count('* as count').first()
    ]);
    
    res.json({
      success: true,
      overview: {
        auditor: {
          name: req.auditor.userName,
          auditCaseNumber: accessWindow?.audit_case_number,
          auditType: accessWindow?.audit_type,
          accessStartDate: accessWindow?.access_start_date,
          accessEndDate: accessWindow?.access_end_date
        },
        tenant: {
          id: tenant?.id,
          name: tenant?.merchant_name || 'Unknown'
        },
        dataSummary: {
          accountingPeriodsCount: parseInt(periodsCount?.count || 0),
          settlementsCount: parseInt(settlementsCount?.count || 0),
          ledgerLocksCount: parseInt(locksCount?.count || 0),
          adminOverridesCount: parseInt(overridesCount?.count || 0)
        },
        mode: 'READ-ONLY',
        watermark: 'AUDIT MODE - READ ONLY ACCESS'
      }
    });
  } catch (error) {
    console.error('Error loading audit portal overview:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 1. ACCOUNTING PERIOD HISTORY (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/accounting-periods
 * View accounting period history
 * Answers: "When were the books closed, and by whom?"
 */
router.get('/accounting-periods', async (req, res) => {
  try {
    const { tenantId, periodType, status, page = 1, limit = 50 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    let query = db.knex('accounting_periods')
      .where('tenant_id', tenantId);
    
    if (periodType) {
      query = query.where('period_type', periodType);
    }
    
    if (status) {
      query = query.where('status', status);
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [periods, totalCount] = await Promise.all([
      query.clone()
        .orderBy('period_start', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      query.clone().count('* as count').first()
    ]);
    
    res.json({
      success: true,
      data: {
        periods: periods.map(p => ({
          id: p.id,
          periodType: p.period_type,
          periodStart: p.period_start,
          periodEnd: p.period_end,
          status: p.status,
          closedBy: p.closed_by,
          closedAt: p.closed_at,
          closureNotes: p.closure_notes,
          createdBy: p.created_by,
          createdAt: p.created_at
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalCount?.count || 0),
          pages: Math.ceil(parseInt(totalCount?.count || 0) / parseInt(limit))
        }
      },
      note: '🚫 READ-ONLY: No create, reopen, or edit operations available'
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
 * GET /api/audit-portal/accounting-periods/:id
 * View specific accounting period details
 */
router.get('/accounting-periods/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const period = await db.knex('accounting_periods')
      .where('id', id)
      .where('tenant_id', tenantId)
      .first();
    
    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Accounting period not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: period.id,
        periodType: period.period_type,
        periodStart: period.period_start,
        periodEnd: period.period_end,
        status: period.status,
        closedBy: period.closed_by,
        closedAt: period.closed_at,
        closureNotes: period.closure_notes,
        createdBy: period.created_by,
        createdAt: period.created_at,
        updatedAt: period.updated_at
      },
      note: '🚫 READ-ONLY: No modifications allowed'
    });
  } catch (error) {
    console.error('Error fetching accounting period:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 2. SETTLEMENT STATUS VIEWER (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/settlements
 * View settlement status with state machine history
 * Answers: "Was this settlement actually completed at the bank?"
 */
router.get('/settlements', async (req, res) => {
  try {
    const { tenantId, merchantId, status, page = 1, limit = 50 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    let query = db.knex('settlements')
      .where('settlements.tenant_id', tenantId)
      .leftJoin('merchants', 'settlements.merchant_id', 'merchants.id')
      .select(
        'settlements.*',
        'merchants.merchant_id as merchant_identifier',
        'merchants.business_name'
      );
    
    if (merchantId) {
      query = query.where('settlements.merchant_id', merchantId);
    }
    
    if (status) {
      query = query.where('settlements.status', status);
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [settlements, totalCount] = await Promise.all([
      query.clone()
        .orderBy('settlements.created_at', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      query.clone().count('* as count').first()
    ]);
    
    res.json({
      success: true,
      data: {
        settlements: settlements.map(s => ({
          id: s.id,
          settlementRef: s.settlement_ref,
          merchantId: s.merchant_identifier,
          merchantName: s.business_name,
          amount: s.net_amount,
          grossAmount: s.gross_amount,
          feesAmount: s.fees_amount,
          currentState: s.status,
          stateFlow: 'CREATED → FUNDS_RESERVED → SENT_TO_BANK → BANK_CONFIRMED → SETTLED',
          bankReferenceNumber: s.bank_reference_number,
          bankTransactionId: s.bank_transaction_id,
          utrNumber: s.utr_number,
          fundsReservedAt: s.funds_reserved_at,
          sentToBankAt: s.sent_to_bank_at,
          bankConfirmedAt: s.bank_confirmed_at,
          settledAt: s.settled_at,
          failedAt: s.failed_at,
          retryCount: s.retry_count,
          stateTransitions: s.state_transitions,
          createdAt: s.created_at
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalCount?.count || 0),
          pages: Math.ceil(parseInt(totalCount?.count || 0) / parseInt(limit))
        }
      },
      note: '🚫 READ-ONLY: No retries, confirmations, or edits allowed'
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
 * GET /api/audit-portal/settlements/:id
 * View specific settlement with complete state history
 */
router.get('/settlements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const settlement = await db.knex('settlements')
      .where('settlements.id', id)
      .where('settlements.tenant_id', tenantId)
      .leftJoin('merchants', 'settlements.merchant_id', 'merchants.id')
      .select('settlements.*', 'merchants.merchant_id as merchant_identifier', 'merchants.business_name')
      .first();
    
    if (!settlement) {
      return res.status(404).json({
        success: false,
        error: 'Settlement not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: settlement.id,
        settlementRef: settlement.settlement_ref,
        merchantId: settlement.merchant_identifier,
        merchantName: settlement.business_name,
        settlementDate: settlement.settlement_date,
        periodFrom: settlement.period_from,
        periodTo: settlement.period_to,
        grossAmount: settlement.gross_amount,
        feesAmount: settlement.fees_amount,
        netAmount: settlement.net_amount,
        bankAccountNumber: settlement.bank_account_number,
        bankIfsc: settlement.bank_ifsc,
        bankName: settlement.bank_name,
        currentState: settlement.status,
        stateTransitions: settlement.state_transitions,
        bankReferenceNumber: settlement.bank_reference_number,
        bankTransactionId: settlement.bank_transaction_id,
        utrNumber: settlement.utr_number,
        retryCount: settlement.retry_count,
        maxRetries: settlement.max_retries,
        retryHistory: settlement.retry_history,
        failureReason: settlement.failure_reason,
        timestamps: {
          created: settlement.created_at,
          fundsReserved: settlement.funds_reserved_at,
          sentToBank: settlement.sent_to_bank_at,
          bankConfirmed: settlement.bank_confirmed_at,
          settled: settlement.settled_at,
          failed: settlement.failed_at
        }
      },
      note: '🚫 READ-ONLY: No modifications allowed'
    });
  } catch (error) {
    console.error('Error fetching settlement:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 3. ADMIN OVERRIDE LOG (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/admin-overrides
 * View admin override log
 * Answers: "Were overrides approved correctly?"
 */
router.get('/admin-overrides', async (req, res) => {
  try {
    const { tenantId, status, page = 1, limit = 50 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    let query = db.knex('admin_overrides_log')
      .where('tenant_id', tenantId);
    
    if (status) {
      query = query.where('override_status', status);
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [overrides, totalCount] = await Promise.all([
      query.clone()
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      query.clone().count('* as count').first()
    ]);
    
    res.json({
      success: true,
      data: {
        overrides: overrides.map(o => ({
          id: o.id,
          overrideRequestId: o.override_request_id,
          requestedBy: o.override_by,
          requestedByRole: o.override_by_role,
          approvedBy: o.approved_by,
          approvedByRole: o.approved_by_role,
          justification: o.override_reason,
          affectedTransactionId: o.transaction_id,
          overrideType: o.override_type,
          status: o.override_status,
          approvedAt: o.approved_at,
          createdAt: o.created_at
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalCount?.count || 0),
          pages: Math.ceil(parseInt(totalCount?.count || 0) / parseInt(limit))
        }
      },
      note: '🚫 READ-ONLY: No approval, rejection, or edits allowed'
    });
  } catch (error) {
    console.error('Error fetching admin overrides:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 4. LEDGER LOCK HISTORY (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/ledger-locks
 * View ledger lock history
 * Answers: "Was the ledger frozen during audit or month close?"
 */
router.get('/ledger-locks', async (req, res) => {
  try {
    const { tenantId, lockType, lockStatus, page = 1, limit = 50 } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    let query = db.knex('ledger_locks')
      .where('tenant_id', tenantId);
    
    if (lockType) {
      query = query.where('lock_type', lockType);
    }
    
    if (lockStatus) {
      query = query.where('lock_status', lockStatus);
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [locks, totalCount] = await Promise.all([
      query.clone()
        .orderBy('locked_at', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      query.clone().count('* as count').first()
    ]);
    
    res.json({
      success: true,
      data: {
        locks: locks.map(l => ({
          id: l.id,
          lockType: l.lock_type,
          lockStatus: l.lock_status,
          lockStartDate: l.lock_start_date,
          lockEndDate: l.lock_end_date,
          reason: l.reason,
          referenceNumber: l.reference_number,
          lockedBy: l.locked_by,
          lockedByRole: l.locked_by_role,
          lockedAt: l.locked_at,
          releasedBy: l.released_by,
          releasedByRole: l.released_by_role,
          releasedAt: l.released_at,
          releaseReason: l.release_reason
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalCount?.count || 0),
          pages: Math.ceil(parseInt(totalCount?.count || 0) / parseInt(limit))
        }
      },
      note: '🚫 READ-ONLY: No lock/unlock operations allowed'
    });
  } catch (error) {
    console.error('Error fetching ledger locks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 5. COMPLETE AUDIT TRAIL (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/audit-trail
 * View complete audit trail
 * Answers: "Who did what, when, and why?"
 */
router.get('/audit-trail', async (req, res) => {
  try {
    const { 
      userId, 
      eventType, 
      resource, 
      startDate, 
      endDate,
      page = 1,
      limit = 100 
    } = req.query;
    
    let query = db.knex('audit_trail');
    
    if (userId) {
      query = query.where('user_id', userId);
    }
    
    if (eventType) {
      query = query.where('event_type', eventType);
    }
    
    if (resource) {
      query = query.where('resource', resource);
    }
    
    if (startDate) {
      query = query.where('timestamp', '>=', startDate);
    }
    
    if (endDate) {
      query = query.where('timestamp', '<=', endDate);
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const [entries, totalCount] = await Promise.all([
      query.clone()
        .orderBy('timestamp', 'desc')
        .limit(parseInt(limit))
        .offset(offset),
      query.clone().count('* as count').first()
    ]);
    
    res.json({
      success: true,
      data: {
        entries: entries.map(e => ({
          eventId: e.event_id,
          eventType: e.event_type,
          userId: e.user_id,
          action: e.action,
          resource: e.resource,
          resourceId: e.resource_id,
          dataType: e.data_type,
          ipAddress: e.ip_address,
          userAgent: e.user_agent,
          success: e.success,
          reason: e.reason,
          metadata: e.metadata,
          timestamp: e.timestamp
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(totalCount?.count || 0),
          pages: Math.ceil(parseInt(totalCount?.count || 0) / parseInt(limit))
        }
      },
      note: '🚫 READ-ONLY: No filtering that hides data, no deletion allowed'
    });
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// 6. COMPLIANCE REPORTS (READ-ONLY)
// ============================================================

/**
 * GET /api/audit-portal/compliance-reports/available
 * List available compliance reports
 */
router.get('/compliance-reports/available', async (req, res) => {
  try {
    const availableReports = complianceReportsService.getAvailableReports();
    
    res.json({
      success: true,
      data: {
        reports: availableReports
      },
      note: 'All reports are derived from ledger, time-bounded, and reproducible'
    });
  } catch (error) {
    console.error('Error listing compliance reports:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/audit-portal/compliance-reports/escrow-balance
 * Generate escrow balance report
 */
router.get('/compliance-reports/escrow-balance', async (req, res) => {
  try {
    const { tenantId, reportDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const report = await complianceReportsService.generateEscrowBalanceReport({
      tenantId,
      reportDate: reportDate ? new Date(reportDate) : new Date(),
      useCache: true
    });
    
    res.json({
      success: true,
      data: report,
      note: '🚫 READ-ONLY: View only, no Excel manipulation required'
    });
  } catch (error) {
    console.error('Error generating escrow balance report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/audit-portal/compliance-reports/merchant-outstanding
 * Generate merchant outstanding report
 */
router.get('/compliance-reports/merchant-outstanding', async (req, res) => {
  try {
    const { tenantId, asOfDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const report = await complianceReportsService.generateMerchantOutstandingReport({
      tenantId,
      asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
      useCache: true
    });
    
    res.json({
      success: true,
      data: report,
      note: '🚫 READ-ONLY: View only, no Excel manipulation required'
    });
  } catch (error) {
    console.error('Error generating merchant outstanding report:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/audit-portal/compliance-reports/platform-revenue
 * Generate platform revenue report
 */
router.get('/compliance-reports/platform-revenue', async (req, res) => {
  try {
    const { tenantId, periodStart, periodEnd } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    if (!periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        error: 'periodStart and periodEnd are required'
      });
    }
    
    const report = await complianceReportsService.generatePlatformRevenueReport({
      tenantId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      useCache: true
    });
    
    res.json({
      success: true,
      data: report,
      note: '🚫 READ-ONLY: View only, no Excel manipulation required'
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
 * GET /api/audit-portal/compliance-reports/settlement-aging
 * Generate settlement aging report
 */
router.get('/compliance-reports/settlement-aging', async (req, res) => {
  try {
    const { tenantId, asOfDate } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }
    
    const report = await complianceReportsService.generateSettlementAgingReport({
      tenantId,
      asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
      useCache: true
    });
    
    res.json({
      success: true,
      data: report,
      note: '🚫 READ-ONLY: View only, no Excel manipulation required'
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
// TENANT LIST (for auditor to select)
// ============================================================

/**
 * GET /api/audit-portal/tenants
 * List available tenants for audit
 */
router.get('/tenants', async (req, res) => {
  try {
    const merchants = await db.knex('merchants')
      .where('status', 'active')
      .select('id', 'merchant_name as name', 'created_at')
      .orderBy('merchant_name', 'asc');
    
    res.json({
      success: true,
      data: {
        tenants: merchants
      }
    });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
