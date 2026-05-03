const express = require('express');

const financialReportingService = require('../core/reporting/financial-reporting-service');
const opsHealthReportingService = require('../core/reporting/ops-health-reporting-service');
const signalRegistryService = require('../core/reporting/signal-registry-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const READ_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'AUDITOR', 'finance_admin', 'compliance_admin', 'ops_admin', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];
const SNAPSHOT_REPORT_TYPES = new Set([
  'ESCROW_BALANCE',
  'GATEWAY_RECEIVABLE',
  'MERCHANT_PAYABLE',
  'MERCHANT_PAYABLE_AGING',
  'SETTLEMENT_AGING',
  'PAYOUT_AGING',
  'AMOUNT_AT_RISK',
  'OUTBOX_HEALTH',
  'SIGNAL_SUMMARY',
  'RECONCILIATION_EXCEPTION_SUMMARY'
]);

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (canReadCrossTenant) {
    return req.query.tenantId || req.body?.tenantId || null;
  }
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access reports for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId || null;
}

function handleError(res, req, error) {
  return res.status(error.statusCode || 400).json({ success: false, error: error.message, correlationId: req.correlationId });
}

module.exports = function createReportRoutes(config) {
  const router = express.Router();
  const auth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];

  router.get('/finance/summary', auth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const report = await financialReportingService.getFinanceDashboardSummary({
        tenantId,
        from: req.query.from,
        to: req.query.to,
        currency: req.query.currency
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/finance/escrow-balance', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getEscrowBalance({
        tenantId: resolveTenant(req),
        currency: req.query.currency,
        asOf: req.query.asOf
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/finance/gateway-receivable', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getGatewayReceivableBalance({
        tenantId: resolveTenant(req),
        gatewayName: req.query.gatewayName,
        currency: req.query.currency,
        asOf: req.query.asOf
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/finance/merchant-payable', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getMerchantPayableBalance({
        tenantId: resolveTenant(req),
        merchantId: req.query.merchantId,
        currency: req.query.currency,
        asOf: req.query.asOf
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/finance/merchant-payable-aging', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getMerchantPayableAging({
        tenantId: resolveTenant(req),
        merchantId: req.query.merchantId,
        currency: req.query.currency,
        asOf: req.query.asOf || new Date()
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/finance/amount-at-risk', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getAmountAtRisk({
        tenantId: resolveTenant(req),
        from: req.query.from,
        to: req.query.to,
        currency: req.query.currency
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.post('/finance/snapshots', auth, async (req, res) => {
    try {
      const tenantId = resolveTenant(req);
      const reportType = req.body.reportType;
      if (!SNAPSHOT_REPORT_TYPES.has(reportType)) {
        const error = new Error(`Unsupported reportType: ${reportType}`);
        error.statusCode = 400;
        throw error;
      }

      let payload;
      if (reportType === 'ESCROW_BALANCE') {
        payload = await financialReportingService.getEscrowBalance({ tenantId, currency: req.body.currency, asOf: req.body.to });
      } else if (reportType === 'GATEWAY_RECEIVABLE') {
        payload = await financialReportingService.getGatewayReceivableBalance({ tenantId, currency: req.body.currency, asOf: req.body.to });
      } else if (reportType === 'MERCHANT_PAYABLE') {
        payload = await financialReportingService.getMerchantPayableBalance({ tenantId, currency: req.body.currency, asOf: req.body.to });
      } else if (reportType === 'MERCHANT_PAYABLE_AGING') {
        payload = await financialReportingService.getMerchantPayableAging({ tenantId, currency: req.body.currency, asOf: req.body.to || new Date() });
      } else if (reportType === 'SETTLEMENT_AGING') {
        payload = await financialReportingService.getSettlementAging({ tenantId, from: req.body.from, to: req.body.to });
      } else if (reportType === 'PAYOUT_AGING') {
        payload = await financialReportingService.getPayoutAging({ tenantId, from: req.body.from, to: req.body.to });
      } else if (reportType === 'AMOUNT_AT_RISK') {
        payload = await financialReportingService.getAmountAtRisk({ tenantId, from: req.body.from, to: req.body.to, currency: req.body.currency });
      } else if (reportType === 'OUTBOX_HEALTH') {
        payload = await opsHealthReportingService.getOutboxHealth({ tenantId, from: req.body.from, to: req.body.to });
      } else if (reportType === 'SIGNAL_SUMMARY') {
        payload = await signalRegistryService.getSignalSummary({ tenantId, from: req.body.from, to: req.body.to });
      } else if (reportType === 'RECONCILIATION_EXCEPTION_SUMMARY') {
        payload = await opsHealthReportingService.getReconciliationExceptionSummary({ tenantId, from: req.body.from, to: req.body.to });
      } else {
        throw new Error(`Unsupported reportType: ${reportType}`);
      }
      const snapshot = await financialReportingService.createReportSnapshot({
        tenantId,
        reportType,
        payload,
        generatedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId,
        from: req.body.from,
        to: req.body.to,
        currency: req.body.currency
      });
      res.status(201).json({ success: true, snapshot, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/settlements/aging', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getSettlementAging({
        tenantId: resolveTenant(req),
        merchantId: req.query.merchantId,
        from: req.query.from,
        to: req.query.to
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/payouts/aging', auth, async (req, res) => {
    try {
      const report = await financialReportingService.getPayoutAging({
        tenantId: resolveTenant(req),
        merchantId: req.query.merchantId,
        payoutStatus: req.query.payoutStatus || req.query.status,
        from: req.query.from,
        to: req.query.to
      });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/ops/outbox-health', auth, async (req, res) => {
    try {
      const report = await opsHealthReportingService.getOutboxHealth({ tenantId: resolveTenant(req), from: req.query.from, to: req.query.to });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/ops/dlq', auth, async (req, res) => {
    try {
      const report = await opsHealthReportingService.getDLQReport({ tenantId: resolveTenant(req), from: req.query.from, to: req.query.to });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/ops/webhook-health', auth, async (req, res) => {
    try {
      const report = await opsHealthReportingService.getWebhookHealth({ tenantId: resolveTenant(req), from: req.query.from, to: req.query.to });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  router.get('/ops/reconciliation-exceptions', auth, async (req, res) => {
    try {
      const report = await opsHealthReportingService.getReconciliationExceptionSummary({ tenantId: resolveTenant(req), from: req.query.from, to: req.query.to });
      res.json({ success: true, report, correlationId: req.correlationId });
    } catch (error) {
      handleError(res, req, error);
    }
  });

  return router;
};
