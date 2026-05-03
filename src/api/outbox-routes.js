const express = require('express');
const { outboxService } = require('../core/outbox/outbox-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

module.exports = function createOutboxRoutes(config) {
  const router = express.Router();

  router.use(authenticateJWT(config));
  router.use(requireRoles(['FINANCE_ADMIN', 'OPS_ADMIN', 'PLATFORM_ADMIN']));

  router.get('/dlq', async (req, res, next) => {
    try {
      const events = await outboxService.getDlqEvents({
        tenantId: req.query.tenantId || req.tenantId,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 100
      });

      res.json({
        success: true,
        correlationId: req.correlationId,
        events: events.map(event => ({
          eventId: event.id,
          tenantId: event.tenant_id,
          eventType: event.event_type,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
          idempotencyKey: event.idempotency_key,
          correlationId: event.correlation_id,
          retryCount: event.retry_count,
          maxRetries: event.max_retries,
          lastError: event.last_error,
          dlqAt: event.dlq_at
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/dlq/:eventId/requeue', async (req, res, next) => {
    try {
      const event = await outboxService.requeueDlq(req.params.eventId);

      res.json({
        success: true,
        correlationId: req.correlationId,
        eventId: event.id,
        status: event.status,
        idempotencyKey: event.idempotency_key
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
