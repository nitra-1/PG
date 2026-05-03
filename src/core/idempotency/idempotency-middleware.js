const { idempotencyService } = require('./idempotency-service');

function requireIdempotency(scope) {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['idempotency-key'];
    const tenantId = req.tenantId || req.user?.tenantId || req.user?.merchantId;

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: 'Idempotency-Key header is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Tenant context is required for idempotent operations'
      });
    }

    try {
      const result = await idempotencyService.begin({
        tenantId,
        scope,
        idempotencyKey,
        requestBody: req.body,
        correlationId: req.correlationId
      });

      if (result.replay) {
        res.setHeader('Idempotency-Replayed', 'true');
        return res.json(result.responseBody);
      }

      req.idempotency = {
        tenantId,
        scope,
        key: idempotencyKey
      };

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return idempotencyService.complete({
            tenantId,
            scope,
            idempotencyKey,
            responseBody: body
          })
            .then(() => originalJson(body))
            .catch(() => originalJson(body));
        }
        return originalJson(body);
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  requireIdempotency
};
