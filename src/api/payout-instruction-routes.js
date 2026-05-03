const express = require('express');

const payoutInstructionService = require('../core/bank/payout-instruction-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const READ_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'AUDITOR', 'finance_admin', 'compliance_admin', 'ops_admin', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const requestedTenantId = req.query.tenantId || req.tenantId;
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access payout instructions for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

module.exports = function createPayoutInstructionRoutes(config) {
  const router = express.Router();
  const auth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];

  router.get('/', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await payoutInstructionService.listPayoutInstructions({
        tenantId,
        settlementRef: req.query.settlementRef,
        status: req.query.status,
        utr_number: req.query.utr_number,
        bank_reference_number: req.query.bank_reference_number,
        bank_transaction_id: req.query.bank_transaction_id,
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

  router.get('/:id', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const instruction = await payoutInstructionService.getPayoutInstruction(req.params.id, tenantId);
      res.json({ success: true, instruction, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  return router;
};
