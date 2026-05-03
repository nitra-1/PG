const express = require('express');

const reconciliationService = require('../core/ledger/reconciliation-service');
const reconciliationExceptionService = require('../core/ledger/reconciliation-exception-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const READ_ROLES = [
  'FINANCE_ADMIN',
  'COMPLIANCE_ADMIN',
  'AUDITOR',
  'finance_admin',
  'compliance_admin',
  'auditor'
];

const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];
const WRITE_ROLES = [
  'FINANCE_ADMIN',
  'COMPLIANCE_ADMIN',
  'OPS_ADMIN',
  'finance_admin',
  'compliance_admin',
  'ops_admin'
];
const ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function userId(req) {
  return req.user?.userId || req.user?.id || 'system';
}

function canReadCrossTenant(req) {
  return CROSS_TENANT_ROLES.includes(req.user?.role);
}

function ensureTenantAccess(req, tenantId) {
  if (tenantId !== req.tenantId && !canReadCrossTenant(req)) {
    const error = new Error('Forbidden: cannot access reconciliation exception records for another tenant');
    error.statusCode = 403;
    throw error;
  }
}

function handleRouteError(res, req, error) {
  const status = error.statusCode || (error.message?.includes('not found') ? 404 : 400);
  return res.status(status).json({
    success: false,
    error: error.message,
    correlationId: req.correlationId
  });
}

module.exports = function createReconciliationRoutes(config) {
  const router = express.Router();

  router.get(
    '/transactions',
    authenticateJWT(config),
    requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res, next) => {
      try {
        const requestedTenantId = req.query.tenantId || req.tenantId;
        const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);

        if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: cannot read reconciliation records for another tenant',
            correlationId: req.correlationId
          });
        }

        const records = await reconciliationService.listTransactionReconciliations({
          tenantId: requestedTenantId,
          status: req.query.status,
          from: req.query.from,
          to: req.query.to,
          limit: req.query.limit,
          offset: req.query.offset
        });

        res.json({
          success: true,
          records,
          count: records.length,
          correlationId: req.correlationId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/settlements',
    authenticateJWT(config),
    requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res, next) => {
      try {
        const requestedTenantId = req.query.tenantId || req.tenantId;
        const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);

        if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: cannot read reconciliation records for another tenant',
            correlationId: req.correlationId
          });
        }

        const records = await reconciliationService.listSettlementReconciliations({
          tenantId: requestedTenantId,
          status: req.query.status,
          settlementRef: req.query.settlementRef,
          from: req.query.from,
          to: req.query.to,
          limit: req.query.limit,
          offset: req.query.offset
        });

        res.json({
          success: true,
          records,
          count: records.length,
          correlationId: req.correlationId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/bank-settlements',
    authenticateJWT(config),
    requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res, next) => {
      try {
        const requestedTenantId = req.query.tenantId || req.tenantId;
        const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);

        if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: cannot read reconciliation records for another tenant',
            correlationId: req.correlationId
          });
        }

        const records = await reconciliationService.listBankSettlementReconciliations({
          tenantId: requestedTenantId,
          status: req.query.status,
          settlementRef: req.query.settlementRef,
          payoutInstructionId: req.query.payoutInstructionId,
          bankStatementLineId: req.query.bankStatementLineId,
          utr_number: req.query.utr_number,
          bank_reference_number: req.query.bank_reference_number,
          bank_transaction_id: req.query.bank_transaction_id,
          from: req.query.from,
          to: req.query.to,
          limit: req.query.limit,
          offset: req.query.offset
        });

        res.json({
          success: true,
          records,
          count: records.length,
          correlationId: req.correlationId
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/exceptions',
    authenticateJWT(config),
    requireRoles([...READ_ROLES, ...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const requestedTenantId = req.query.tenantId || req.tenantId;
        ensureTenantAccess(req, requestedTenantId);

        const records = await reconciliationExceptionService.listExceptionCases({
          tenantId: requestedTenantId,
          sourceType: req.query.sourceType,
          sourceStatus: req.query.sourceStatus,
          caseStatus: req.query.caseStatus,
          severity: req.query.severity,
          priority: req.query.priority,
          assignedTo: req.query.assignedTo,
          from: req.query.from,
          to: req.query.to,
          limit: req.query.limit,
          offset: req.query.offset
        });

        res.json({
          success: true,
          records,
          count: records.length,
          correlationId: req.correlationId
        });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/generate',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const requestedTenantId = req.body.tenantId || req.tenantId;
        ensureTenantAccess(req, requestedTenantId);

        const result = await reconciliationExceptionService.createCasesForAllOpenMismatches({
          tenantId: requestedTenantId,
          sourceType: req.body.sourceType || 'ALL',
          limit: req.body.limit,
          correlationId: req.correlationId
        });

        res.status(201).json({
          success: true,
          ...result,
          correlationId: req.correlationId
        });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.get(
    '/exceptions/:id',
    authenticateJWT(config),
    requireRoles([...READ_ROLES, ...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const record = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, record.case.tenant_id);

        res.json({
          success: true,
          record,
          correlationId: req.correlationId
        });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/assign',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.assignCase({
          caseId: req.params.id,
          assignedTo: req.body.assignedTo,
          assignedBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/unassign',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.unassignCase({
          caseId: req.params.id,
          performedBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/comment',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const comment = await reconciliationExceptionService.addComment({
          caseId: req.params.id,
          commentText: req.body.commentText,
          commentType: req.body.commentType || 'NOTE',
          createdBy: userId(req),
          correlationId: req.correlationId
        });
        res.status(201).json({ success: true, comment, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/escalate',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.escalateCase({
          caseId: req.params.id,
          reason: req.body.reason,
          performedBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/request-approval',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.requestApprovalForResolution({
          caseId: req.params.id,
          resolutionType: req.body.resolutionType,
          resolutionReason: req.body.resolutionReason,
          resolutionNotes: req.body.resolutionNotes,
          requestedBy: userId(req),
          correlationId: req.correlationId
        });
        res.status(202).json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/resolve',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.resolveCase({
          caseId: req.params.id,
          resolutionType: req.body.resolutionType,
          resolutionReason: req.body.resolutionReason,
          resolutionNotes: req.body.resolutionNotes,
          resolvedBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/ignore',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.ignoreCase({
          caseId: req.params.id,
          reason: req.body.reason,
          ignoredBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/reopen',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.reopenCase({
          caseId: req.params.id,
          reason: req.body.reason,
          reopenedBy: userId(req),
          correlationId: req.correlationId,
          isPlatformAdmin: ADMIN_ROLES.includes(req.user?.role)
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  router.post(
    '/exceptions/:id/close',
    authenticateJWT(config),
    requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES]),
    async (req, res) => {
      try {
        const existing = await reconciliationExceptionService.getExceptionCase(req.params.id);
        ensureTenantAccess(req, existing.case.tenant_id);
        const record = await reconciliationExceptionService.closeCase({
          caseId: req.params.id,
          reason: req.body.reason,
          closedBy: userId(req),
          correlationId: req.correlationId
        });
        res.json({ success: true, record, correlationId: req.correlationId });
      } catch (error) {
        handleRouteError(res, req, error);
      }
    }
  );

  return router;
};
