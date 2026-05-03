const SecurityService = require('../../security/security-service');
const requestContext = require('../context/request-context');

function authenticateJWT(config) {
  const securityService = new SecurityService(config);

  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication token required',
          correlationId: req.correlationId
        });
      }

      const decoded = securityService.verifyJWT(token);
      req.user = decoded;
      req.tenantId = decoded.tenantId || decoded.merchantId || config.defaultTenantId;

      requestContext.setContextValue('tenantId', req.tenantId);
      requestContext.setContextValue('userId', decoded.userId || decoded.id);

      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Invalid authentication token',
        correlationId: req.correlationId
      });
    }
  };
}

function requireRoles(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: one of roles required: ${roles.join(', ')}`,
        correlationId: req.correlationId
      });
    }

    next();
  };
}

function requirePermissions(requiredPermissions) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return (req, res, next) => {
    const userPermissions = req.user?.permissions || [];
    const hasAllPermissions = permissions.every(permission => userPermissions.includes(permission));

    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: permissions required: ${permissions.join(', ')}`,
        correlationId: req.correlationId
      });
    }

    next();
  };
}

module.exports = {
  authenticateJWT,
  requireRoles,
  requirePermissions
};
