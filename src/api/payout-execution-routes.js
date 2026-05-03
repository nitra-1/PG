const express = require('express');

const payoutExecutionService = require('../core/payouts/payout-execution-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const ADMIN_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const READ_ROLES = [...ADMIN_ROLES, 'AUDITOR', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access payout records for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

function handleRouteError(res, req, error) {
  return res.status(error.statusCode || 400).json({
    success: false,
    error: error.message,
    correlationId: req.correlationId
  });
}

module.exports = function createPayoutExecutionRoutes(config) {
  const router = express.Router();
  const readAuth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];
  const writeAuth = [authenticateJWT(config), requireRoles([...ADMIN_ROLES, ...CROSS_TENANT_ROLES])];

  router.post('/from-batch/:batchId', writeAuth, async (req, res) => {
    try {
      const result = await payoutExecutionService.createPayoutInstructionForBatch({
        batchId: req.params.batchId,
        tenantId: resolveTenant(req),
        requestedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      if (result.status === 'PAYOUT_WITHOUT_RESERVATION') {
        return res.status(409).json({ success: false, ...result, correlationId: req.correlationId });
      }
      res.status(result.duplicate ? 200 : 201).json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  router.post('/:id/submit', writeAuth, async (req, res) => {
    try {
      const result = await payoutExecutionService.submitPayout({
        payoutInstructionId: req.params.id,
        tenantId: resolveTenant(req),
        submittedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  router.post('/:id/retry', writeAuth, async (req, res) => {
    try {
      const result = await payoutExecutionService.retryPayout({
        payoutInstructionId: req.params.id,
        tenantId: resolveTenant(req),
        requestedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  router.post('/:id/verify-status', writeAuth, async (req, res) => {
    try {
      const result = await payoutExecutionService.verifyPayoutStatus({
        payoutInstructionId: req.params.id,
        tenantId: resolveTenant(req),
        correlationId: req.correlationId
      });
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  router.get('/', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await payoutExecutionService.listPayoutInstructions({
        tenantId,
        merchantId: req.query.merchantId,
        settlementBatchId: req.query.settlementBatchId,
        reservationId: req.query.reservationId,
        payoutStatus: req.query.payoutStatus || req.query.status,
        providerName: req.query.providerName,
        providerPayoutId: req.query.providerPayoutId,
        utrNumber: req.query.utrNumber || req.query.utr_number,
        bankReferenceNumber: req.query.bankReferenceNumber || req.query.bank_reference_number,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  router.get('/:id', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await payoutExecutionService.getPayoutInstruction(req.params.id, tenantId);
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      handleRouteError(res, req, error);
    }
  });

  return router;
};
