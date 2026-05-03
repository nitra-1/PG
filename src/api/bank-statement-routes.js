const express = require('express');

const bankStatementImportService = require('../core/bank/bank-statement-import-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const ADMIN_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access bank statement records for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

module.exports = function createBankStatementRoutes(config) {
  const router = express.Router();
  const auth = [authenticateJWT(config), requireRoles([...ADMIN_ROLES, ...CROSS_TENANT_ROLES])];

  router.get('/batches', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await bankStatementImportService.listBatches({
        tenantId,
        status: req.query.status,
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

  router.get('/batches/:id', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const data = await bankStatementImportService.getImportBatch(req.params.id, tenantId);
      res.json({ success: true, ...data, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/lines', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await bankStatementImportService.listBankStatementLines({
        tenantId,
        ...req.query
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/import', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await bankStatementImportService.importBankStatementBatch({
        tenantId,
        bankAccountId: req.body.bankAccountId,
        sourceType: req.body.sourceType,
        sourceFilename: req.body.sourceFilename,
        sourceReference: req.body.sourceReference,
        importedBy: req.user?.userId || req.user?.id,
        lines: req.body.lines,
        correlationId: req.correlationId
      });
      res.status(201).json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  return router;
};
