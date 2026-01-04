/**
 * Multi-Tenancy Middleware
 * Extracts and validates tenant information from requests
 */

const config = require('../config/config');

/**
 * Middleware to extract tenant ID from request
 */
function extractTenant(req, res, next) {
  if (!config.database.multiTenancy.enabled) {
    return next();
  }

  // Extract tenant ID from header
  const tenantId = req.headers[config.database.multiTenancy.tenantHeader.toLowerCase()] || 
                   req.headers['x-tenant-id'] || 
                   req.query.tenant_id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Missing tenant identifier',
      message: `Please provide tenant ID in ${config.database.multiTenancy.tenantHeader} header`
    });
  }

  // Validate tenant ID format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    return res.status(400).json({
      error: 'Invalid tenant identifier',
      message: 'Tenant ID must be a valid UUID'
    });
  }

  // Attach tenant ID to request object
  req.tenantId = tenantId;
  next();
}

/**
 * Optional tenant middleware - doesn't fail if tenant is missing
 */
function optionalTenant(req, res, next) {
  if (!config.database.multiTenancy.enabled) {
    return next();
  }

  const tenantId = req.headers[config.database.multiTenancy.tenantHeader.toLowerCase()] || 
                   req.headers['x-tenant-id'] || 
                   req.query.tenant_id;

  if (tenantId) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(tenantId)) {
      req.tenantId = tenantId;
    }
  }

  next();
}

/**
 * Get tenant-aware query builder
 * For use with Knex.js query builders
 */
function getTenantQuery(baseQuery, tenantId) {
  if (!config.database.multiTenancy.enabled || !tenantId) {
    return baseQuery;
  }
  
  // For Knex query builder objects
  if (typeof baseQuery === 'object' && typeof baseQuery.where === 'function') {
    return baseQuery.where('tenant_id', tenantId);
  }
  
  // For raw SQL strings - use db.getTenantQuery from connection.js module
  console.warn('Using getTenantQuery with raw SQL string. Use the connection module\'s getTenantQuery for raw SQL queries.');
  return baseQuery;
}

module.exports = {
  extractTenant,
  optionalTenant,
  getTenantQuery
};
