const express = require('express');

const paymentWebhookIngestionService = require('../core/payment/payment-webhook-ingestion-service');
const paymentSignalService = require('../core/payment/payment-signal-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const READ_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'AUDITOR', 'finance_admin', 'compliance_admin', 'ops_admin', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  if (canReadCrossTenant) {
    return req.query.tenantId || null;
  }

  const requestedTenantId = req.query.tenantId || req.tenantId;
  if (requestedTenantId !== req.tenantId) {
    const error = new Error('Forbidden: cannot access payment webhook records for another tenant');
    error.statusCode = 403;
    throw error;
  }

  return req.tenantId;
}

function parsedBody(req) {
  if (Buffer.isBuffer(req.body)) return undefined;
  return req.body || {};
}

function rawBody(req) {
  if (req.rawBody) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(JSON.stringify(req.body || {}));
}

module.exports = function createPaymentWebhookRoutes(config) {
  const router = express.Router();
  const auth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];

  router.post('/webhooks/:gatewayName', async (req, res, next) => {
    try {
      const result = await paymentWebhookIngestionService.ingestWebhook({
        gatewayName: req.params.gatewayName,
        rawBody: rawBody(req),
        parsedBody: parsedBody(req),
        headers: req.headers,
        correlationId: req.correlationId
      });

      res.status(202).json({
        success: result.processed !== false,
        webhookEventId: result.webhookEvent?.id,
        processingStatus: result.status || result.webhookEvent?.processing_status,
        duplicate: Boolean(result.duplicate),
        correlationId: req.correlationId
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/webhooks/events', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await paymentWebhookIngestionService.listWebhookEvents({
        tenantId,
        gatewayName: req.query.gatewayName,
        gatewayEventType: req.query.gatewayEventType,
        processingStatus: req.query.processingStatus,
        verificationStatus: req.query.verificationStatus,
        transactionRef: req.query.transactionRef,
        gatewayPaymentId: req.query.gatewayPaymentId,
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

  router.get('/payments/signals', auth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await paymentSignalService.listSignals({
        tenantId,
        signalType: req.query.signalType,
        severity: req.query.severity,
        signalStatus: req.query.signalStatus || req.query.status,
        transactionRef: req.query.transactionRef,
        gatewayPaymentId: req.query.gatewayPaymentId,
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

  return router;
};
