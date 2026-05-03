const express = require('express');

const reconciliationService = require('../core/ledger/reconciliation-service');
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

  return router;
};
