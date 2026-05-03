const { v4: uuidv4 } = require('uuid');
const requestContext = require('../context/request-context');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCorrelationId(value) {
  if (value && UUID_REGEX.test(value)) {
    return value;
  }
  return uuidv4();
}

function correlationIdMiddleware(req, res, next) {
  const correlationId = normalizeCorrelationId(req.headers['x-correlation-id']);
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  requestContext.run({
    correlationId,
    tenantId,
    path: req.path,
    method: req.method
  }, next);
}

module.exports = {
  correlationIdMiddleware,
  normalizeCorrelationId
};
