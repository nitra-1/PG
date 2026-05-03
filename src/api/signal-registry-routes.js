const express = require('express');

const signalRegistryService = require('../core/reporting/signal-registry-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const READ_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'AUDITOR', 'finance_admin', 'compliance_admin', 'ops_admin', 'auditor'];
const WRITE_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (canReadCrossTenant) {
    return req.query.tenantId || req.body?.tenantId || null;
  }
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access signals for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId || null;
}

function filters(req) {
  return {
    tenantId: resolveTenant(req),
    signalSource: req.query.signalSource,
    signalType: req.query.signalType,
    severity: req.query.severity,
    signalStatus: req.query.signalStatus || req.query.status,
    merchantId: req.query.merchantId,
    gatewayName: req.query.gatewayName,
    transactionRef: req.query.transactionRef,
    settlementBatchId: req.query.settlementBatchId,
    payoutInstructionId: req.query.payoutInstructionId,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
    offset: req.query.offset
  };
}

module.exports = function createSignalRegistryRoutes(config) {
  const router = express.Router();
  const readAuth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];
  const writeAuth = [authenticateJWT(config), requireRoles([...WRITE_ROLES, ...CROSS_TENANT_ROLES])];

  router.get('/', readAuth, async (req, res) => {
    try {
      const result = await signalRegistryService.listUnifiedSignals(filters(req));
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.get('/summary', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const summary = await signalRegistryService.getSignalSummary({ tenantId, from: req.query.from, to: req.query.to });
      res.json({ success: true, summary, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.get('/aging', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const aging = await signalRegistryService.getSignalAging({ tenantId, severity: req.query.severity, signalStatus: req.query.signalStatus || req.query.status });
      res.json({ success: true, aging, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.get('/top-risk-merchants', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await signalRegistryService.getTopRiskMerchants({ tenantId, from: req.query.from, to: req.query.to, limit: req.query.limit });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.get('/top-risk-gateways', readAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await signalRegistryService.getTopRiskGateways({ tenantId, from: req.query.from, to: req.query.to, limit: req.query.limit });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.post('/:source/:sourceId/acknowledge', writeAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await signalRegistryService.acknowledgeUnifiedSignal({
        source: req.params.source,
        sourceId: req.params.sourceId,
        tenantId,
        acknowledgedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.json({ success: true, result, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  router.post('/:source/:sourceId/resolve', writeAuth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await signalRegistryService.resolveUnifiedSignal({
        source: req.params.source,
        sourceId: req.params.sourceId,
        tenantId,
        resolvedBy: req.user?.userId || req.user?.id,
        reason: req.body.reason,
        correlationId: req.correlationId
      });
      res.json({ success: true, result, correlationId: req.correlationId });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  return router;
};
