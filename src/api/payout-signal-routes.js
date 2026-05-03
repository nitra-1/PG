const express = require('express');

const payoutSignalService = require('../core/payouts/payout-signal-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const ADMIN_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const READ_ROLES = [...ADMIN_ROLES, 'AUDITOR', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access payout signals for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

module.exports = function createPayoutSignalRoutes(config) {
  const router = express.Router();
  const readAuth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];
  const writeAuth = [authenticateJWT(config), requireRoles([...ADMIN_ROLES, ...CROSS_TENANT_ROLES])];

  router.get('/', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await payoutSignalService.listSignals({
        tenantId,
        signalType: req.query.signalType,
        severity: req.query.severity,
        signalStatus: req.query.signalStatus || req.query.status,
        payoutInstructionId: req.query.payoutInstructionId,
        settlementBatchId: req.query.settlementBatchId,
        merchantId: req.query.merchantId,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.post('/:id/acknowledge', writeAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const signal = await payoutSignalService.acknowledgeSignal({
        signalId: req.params.id,
        tenantId,
        correlationId: req.correlationId
      });
      res.json({ success: true, signal, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.post('/:id/resolve', writeAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const signal = await payoutSignalService.resolveSignal({
        signalId: req.params.id,
        tenantId,
        correlationId: req.correlationId
      });
      res.json({ success: true, signal, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  return router;
};
