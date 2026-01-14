/**
 * Compliance Admin API Routes
 * 
 * CRITICAL: RBI Maker-Checker Control - CHECKER ROLE
 * 
 * This portal implements the "Checker" in a maker-checker (dual control) model.
 * 
 * Security Rules (NON-NEGOTIABLE):
 * 1. COMPLIANCE_ADMIN role required for ALL endpoints
 * 2. NO financial operations allowed (no ledger edits, settlements, etc.)
 * 3. NO override requests (only approvals/rejections)
 * 4. All actions require timestamp + reason + audit log
 * 5. Cannot be combined with FINANCE_ADMIN role
 * 
 * Functional Scope:
 * - Review override requests (READ)
 * - Approve/reject overrides (WRITE - approval only)
 * - View high-risk actions (READ-ONLY)
 * - View control breaches (READ-ONLY)
 * - View audit history (READ-ONLY)
 */

const express = require('express');
const router = express.Router();
const db = require('../database');

// Dummy UUID for audit logs when no specific entity is being acted upon
const AUDIT_DUMMY_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Validate UUID format
 */
const isValidUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * COMPLIANCE_ADMIN role enforcement - CRITICAL SECURITY
 */
const requireComplianceAdmin = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  
  if (!userRole || !userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  
  // CRITICAL: Only COMPLIANCE_ADMIN allowed
  if (userRole !== 'COMPLIANCE_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: COMPLIANCE_ADMIN role required',
      message: 'This portal is restricted to compliance administrators only'
    });
  }
  
  // Store for audit logging
  req.complianceUser = {
    userId,
    userRole,
    userEmail: req.headers['x-user-email'] || 'unknown',
    ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown'
  };
  
  next();
};

/**
 * Audit logging middleware - logs all compliance actions
 */
const logComplianceAction = (action) => {
  return async (req, res, next) => {
    try {
      // Use a dummy UUID for entity_id when no specific resource is being acted upon
      const entityId = req.params.requestId || AUDIT_DUMMY_ENTITY_ID;
      
      // For approval/reject endpoints, we need to fetch the request to get tenant_id
      let tenantId = req.query.tenantId || req.body.tenantId;
      
      if (!tenantId && req.params.requestId) {
        // Validate requestId is a valid UUID before querying database
        if (isValidUUID(req.params.requestId)) {
          // Fetch the approval request to extract tenant_id from request_data
          const approvalRequest = await db.knex('approval_requests')
            .where('id', req.params.requestId)
            .first();
          
          if (approvalRequest && approvalRequest.request_data) {
            // request_data is a JSONB column, already parsed by Knex
            const requestData = typeof approvalRequest.request_data === 'string' 
              ? JSON.parse(approvalRequest.request_data) 
              : approvalRequest.request_data;
            // Extract tenantId if available
            if (requestData && requestData.tenantId) {
              tenantId = requestData.tenantId;
            }
          }
        }
      }
      
      await db.knex('audit_logs').insert({
        tenant_id: tenantId,
        entity_type: 'compliance_action',
        entity_id: entityId,
        action: 'read',
        user_id: req.complianceUser.userId,
        user_role: req.complianceUser.userRole,
        action_type: action,
        action_category: 'COMPLIANCE_ADMIN',
        resource_type: 'approval_workflow',
        resource_id: req.params.requestId || null,
        details: JSON.stringify({
          method: req.method,
          path: req.path,
          query: req.query,
          body: req.body
        }),
        ip_address: req.complianceUser.ipAddress,
        user_agent: req.headers['user-agent']
      });
    } catch (error) {
      console.error('Error logging compliance action:', error);
    }
    next();
  };
};

// ============================================================
// DASHBOARD / OVERVIEW
// ============================================================

/**
 * GET /api/compliance-admin/dashboard
 * Compliance dashboard overview
 */
router.get('/dashboard', requireComplianceAdmin, logComplianceAction('VIEW_DASHBOARD'), async (req, res) => {
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
    
    // Get pending approvals count
    const pendingApprovals = await db.knex('approval_requests')
      .where('status', 'pending')
      .whereIn('request_type', ['SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION'])
      .count('* as count')
      .first();
    
    // Get recent overrides
    const recentOverrides = await db.knex('admin_overrides_log')
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .limit(10);
    
    // Get high-risk actions count (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const highRiskActions = await db.knex.raw(`
      SELECT 
        'PERIOD_CLOSURE' as action_type,
        COUNT(*) as count
      FROM accounting_periods
      WHERE tenant_id = ? AND status = 'HARD_CLOSED' AND closed_at >= ?
      UNION ALL
      SELECT 
        'LEDGER_LOCK' as action_type,
        COUNT(*) as count
      FROM ledger_locks
      WHERE tenant_id = ? AND lock_status = 'ACTIVE' AND locked_at >= ?
      UNION ALL
      SELECT 
        'SETTLEMENT_RETRY' as action_type,
        COUNT(*) as count
      FROM settlements
      WHERE tenant_id = ? AND retry_count > 0 AND created_at >= ?
    `, [tenantId, thirtyDaysAgo, tenantId, thirtyDaysAgo, tenantId, thirtyDaysAgo]);
    
    // Get control breaches (attempted violations)
    // Note: Control breach tracking via audit_logs.status is not implemented
    // Returning 0 until a proper control breach mechanism is added
    const controlBreaches = { count: 0 };
    
    res.json({
      success: true,
      data: {
        pendingApprovalsCount: parseInt(pendingApprovals?.count || 0),
        recentOverrides: recentOverrides.slice(0, 5),
        highRiskActionsCount: highRiskActions.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
        controlBreachesCount: parseInt(controlBreaches?.count || 0)
      }
    });
    
  } catch (error) {
    console.error('Error fetching compliance dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// OVERRIDE APPROVAL CONSOLE (CORE FEATURE)
// ============================================================

/**
 * GET /api/compliance-admin/overrides/pending
 * Get pending override requests for approval
 * 
 * Security Note: COMPLIANCE_ADMIN role has platform-wide access to all tenants
 * by design (financial compliance oversight). The tenantId filtering is for
 * UI organization and operational clarity, not access control.
 */
router.get('/overrides/pending', requireComplianceAdmin, logComplianceAction('VIEW_PENDING_OVERRIDES'), async (req, res) => {
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
    
    // Query with JSONB filter for tenantId
    const approvalRequests = await db.knex('approval_requests as ar')
      .select(
        'ar.*',
        'pu.username as requestor_username',
        'pu.email as requestor_email',
        'pu.role as requestor_role'
      )
      .leftJoin('platform_users as pu', 'ar.requestor_id', 'pu.id')
      .where('ar.status', 'pending')
      .whereIn('ar.request_type', ['SOFT_CLOSE_POSTING', 'EXCEPTIONAL_CORRECTION'])
      .whereRaw("ar.request_data->>'tenantId' = ?", [tenantId])
      .orderBy('ar.requested_at', 'desc');
    
    // Parse request_data JSON for each request
    const enrichedRequests = approvalRequests.map(req => ({
      ...req,
      request_data: typeof req.request_data === 'string' ? JSON.parse(req.request_data) : req.request_data
    }));
    
    res.json({
      success: true,
      data: enrichedRequests
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
 * GET /api/compliance-admin/overrides/history
 * Get override approval history
 */
router.get('/overrides/history', requireComplianceAdmin, logComplianceAction('VIEW_OVERRIDE_HISTORY'), async (req, res) => {
  try {
    const { tenantId, limit = 50, offset = 0 } = req.query;
    
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
    
    const overrideHistory = await db.knex('admin_overrides_log')
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    // Get total count
    const [{ count }] = await db.knex('admin_overrides_log')
      .where('tenant_id', tenantId)
      .count('* as count');
    
    res.json({
      success: true,
      data: {
        overrides: overrideHistory,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Error fetching override history:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/compliance-admin/overrides/:requestId/approve
 * Approve an override request
 * 
 * CRITICAL: This is the ONLY write operation allowed for Compliance Admin
 */
router.post('/overrides/:requestId/approve', requireComplianceAdmin, logComplianceAction('APPROVE_OVERRIDE'), async (req, res) => {
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
    
    // CRITICAL: Prevent self-approval
    if (request.requestor_id === req.complianceUser.userId) {
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
        approver_id: req.complianceUser.userId,
        approval_reason: approvalReason,
        approved_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
    
    // Log the approval in admin_overrides_log
    // request_data is a JSONB column, already parsed by Knex
    const requestData = typeof request.request_data === 'string' 
      ? JSON.parse(request.request_data) 
      : request.request_data;
    
    // Validate requestData has required fields before inserting
    if (!requestData || !requestData.tenantId) {
      throw new Error('Invalid request data: missing tenantId');
    }
    
    await db.knex('admin_overrides_log').insert({
      tenant_id: requestData.tenantId,
      override_type: request.request_type,
      justification: requestData.justification,
      approval_reason: approvalReason,
      override_by: requestData.requestedBy,
      override_by_role: 'FINANCE_ADMIN',
      approved_by: req.complianceUser.userEmail,
      approved_by_role: 'COMPLIANCE_ADMIN',
      affected_entities: JSON.stringify(requestData.affectedTransactionIds || []),
      metadata: JSON.stringify(requestData.metadata || {})
    });
    
    res.json({
      success: true,
      data: updatedRequest,
      message: 'Override request approved successfully'
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
 * POST /api/compliance-admin/overrides/:requestId/reject
 * Reject an override request
 */
router.post('/overrides/:requestId/reject', requireComplianceAdmin, logComplianceAction('REJECT_OVERRIDE'), async (req, res) => {
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
        approver_id: req.complianceUser.userId,
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

// ============================================================
// HIGH-RISK ACTION MONITOR (READ-ONLY)
// ============================================================

/**
 * GET /api/compliance-admin/high-risk-actions
 * View high-risk actions (accounting closures, locks, retries, etc.)
 */
router.get('/high-risk-actions', requireComplianceAdmin, logComplianceAction('VIEW_HIGH_RISK_ACTIONS'), async (req, res) => {
  try {
    const { tenantId, fromDate, toDate, limit = 100, offset = 0 } = req.query;
    
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
    
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const to = toDate ? new Date(toDate) : new Date();
    
    // Get accounting period closures
    const periodClosures = await db.knex('accounting_periods')
      .select('*')
      .where('tenant_id', tenantId)
      .whereIn('status', ['SOFT_CLOSED', 'HARD_CLOSED'])
      .whereBetween('closed_at', [from, to])
      .orderBy('closed_at', 'desc');
    
    // Get ledger locks
    const ledgerLocks = await db.knex('ledger_locks')
      .select('*')
      .where('tenant_id', tenantId)
      .whereBetween('locked_at', [from, to])
      .orderBy('locked_at', 'desc');
    
    // Get settlement retries (after failure)
    const settlementRetries = await db.knex('settlements')
      .select('*')
      .where('tenant_id', tenantId)
      .where('retry_count', '>', 0)
      .whereBetween('created_at', [from, to])
      .orderBy('created_at', 'desc');
    
    // Get emergency overrides
    const emergencyOverrides = await db.knex('admin_overrides_log')
      .select('*')
      .where('tenant_id', tenantId)
      .where('override_type', 'EXCEPTIONAL_CORRECTION')
      .whereBetween('created_at', [from, to])
      .orderBy('created_at', 'desc');
    
    res.json({
      success: true,
      data: {
        periodClosures,
        ledgerLocks,
        settlementRetries,
        emergencyOverrides,
        summary: {
          totalPeriodClosures: periodClosures.length,
          totalLedgerLocks: ledgerLocks.length,
          totalSettlementRetries: settlementRetries.length,
          totalEmergencyOverrides: emergencyOverrides.length
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching high-risk actions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// CONTROL BREACH & VIOLATION VIEWER (READ-ONLY)
// ============================================================

/**
 * GET /api/compliance-admin/control-breaches
 * View control breaches and attempted violations
 */
router.get('/control-breaches', requireComplianceAdmin, logComplianceAction('VIEW_CONTROL_BREACHES'), async (req, res) => {
  try {
    const { tenantId, fromDate, toDate, limit = 100, offset = 0 } = req.query;
    
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
    
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toDate ? new Date(toDate) : new Date();
    
    // Get blocked audit log entries
    // Note: Control breach tracking via audit_logs.status is not implemented
    // Returning empty array until a proper control breach mechanism is added
    const blockedActions = [];
    
    // Get failed override attempts (rejected approvals are considered control breaches)
    const failedOverrides = await db.knex('approval_requests')
      .select('*')
      .where('status', 'rejected')
      .whereBetween('updated_at', [from, to])
      .orderBy('updated_at', 'desc');
    
    // Count total breaches (only counting failed overrides for now)
    const count = failedOverrides.length;
    
    res.json({
      success: true,
      data: {
        blockedActions,
        failedOverrides,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Error fetching control breaches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// AUDIT SUPPORT VIEW (READ-ONLY)
// ============================================================

/**
 * GET /api/compliance-admin/audit-support
 * Complete audit trail with internal annotations
 */
router.get('/audit-support', requireComplianceAdmin, logComplianceAction('VIEW_AUDIT_SUPPORT'), async (req, res) => {
  try {
    const { tenantId, actionType, fromDate, toDate, limit = 50, offset = 0 } = req.query;
    
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
    
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
    const to = toDate ? new Date(toDate) : new Date();
    
    let query = db.knex('audit_logs')
      .select('*')
      .where('tenant_id', tenantId)
      .whereBetween('created_at', [from, to])
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    if (actionType) {
      query = query.where('action_type', actionType);
    }
    
    const auditLogs = await query;
    
    // Get total count
    let countQuery = db.knex('audit_logs')
      .where('tenant_id', tenantId)
      .whereBetween('created_at', [from, to])
      .count('* as count');
    
    if (actionType) {
      countQuery = countQuery.where('action_type', actionType);
    }
    
    const [{ count }] = await countQuery;
    
    res.json({
      success: true,
      data: {
        auditLogs,
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
    
  } catch (error) {
    console.error('Error fetching audit support data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
