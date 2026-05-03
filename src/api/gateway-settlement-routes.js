const express = require('express');

const gatewaySettlementImportService = require('../core/gateway-settlements/gateway-settlement-import-service');
const gatewaySettlementSignalService = require('../core/gateway-settlements/gateway-settlement-signal-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const ADMIN_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const READ_ROLES = [...ADMIN_ROLES, 'AUDITOR', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access gateway settlement records for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

module.exports = function createGatewaySettlementRoutes(config) {
  const router = express.Router();
  const readAuth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];
  const writeAuth = [authenticateJWT(config), requireRoles([...ADMIN_ROLES, ...CROSS_TENANT_ROLES])];

  router.post('/import', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await gatewaySettlementImportService.importGatewaySettlementBatch({
        tenantId,
        gatewayName: req.body.gatewayName,
        sourceType: req.body.sourceType,
        sourceFilename: req.body.sourceFilename,
        sourceReference: req.body.sourceReference,
        gatewaySettlementId: req.body.gatewaySettlementId,
        settlementId: req.body.settlementId,
        settlementCycleStart: req.body.settlementCycleStart,
        settlementCycleEnd: req.body.settlementCycleEnd,
        expectedSettlementDate: req.body.expectedSettlementDate,
        actualSettlementDate: req.body.actualSettlementDate,
        settlementUtr: req.body.settlementUtr,
        bankReferenceNumber: req.body.bankReferenceNumber,
        grossAmount: req.body.grossAmount,
        totalGatewayFee: req.body.totalGatewayFee,
        totalGstAmount: req.body.totalGstAmount,
        totalAdjustmentAmount: req.body.totalAdjustmentAmount,
        netSettlementAmount: req.body.netSettlementAmount,
        lines: req.body.lines || [],
        importedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.status(result.idempotent ? 200 : 201).json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/batches', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await gatewaySettlementImportService.listBatches({
        tenantId,
        gatewayName: req.query.gatewayName,
        importStatus: req.query.importStatus,
        settlementUtr: req.query.settlementUtr,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/batches/:id', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const data = await gatewaySettlementImportService.getBatch(req.params.id, tenantId);
      res.json({ success: true, ...data, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/lines', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await gatewaySettlementImportService.listLines({
        tenantId,
        batchId: req.query.batchId,
        gatewayName: req.query.gatewayName,
        transactionRef: req.query.transactionRef,
        gatewayTransactionId: req.query.gatewayTransactionId,
        gatewayPaymentId: req.query.gatewayPaymentId,
        reconciliationStatus: req.query.reconciliationStatus,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/signals', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await gatewaySettlementSignalService.listSignals({
        tenantId,
        signalType: req.query.signalType,
        severity: req.query.severity,
        signalStatus: req.query.signalStatus || req.query.status,
        gatewayName: req.query.gatewayName,
        transactionRef: req.query.transactionRef,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/signals/:id/acknowledge', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const signal = await gatewaySettlementSignalService.acknowledgeSignal({
        signalId: req.params.id,
        tenantId,
        correlationId: req.correlationId
      });
      res.json({ success: true, signal, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/signals/:id/resolve', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const signal = await gatewaySettlementSignalService.resolveSignal({
        signalId: req.params.id,
        tenantId,
        correlationId: req.correlationId
      });
      res.json({ success: true, signal, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  return router;
};
