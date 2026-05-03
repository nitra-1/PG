const winston = require('winston');
const requestContext = require('../context/request-context');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => {
      const context = requestContext.getContext();
      const payload = {
        timestamp: info.timestamp,
        level: info.level,
        message: info.message,
        correlation_id: info.correlation_id || context.correlationId,
        tenant_id: info.tenant_id || context.tenantId,
        user_id: info.user_id || context.userId,
        ...info
      };

      delete payload.splat;
      return JSON.stringify(payload);
    })
  ),
  transports: [new winston.transports.Console()]
});

module.exports = logger;
