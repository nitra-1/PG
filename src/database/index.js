/**
 * Database Module Index
 * Central export for all database functionality
 */

const connection = require('./connection');
const utils = require('./utils');
const tenantMiddleware = require('./tenant-middleware');
const knexConfig = require('../../knexfile');
const environment = process.env.NODE_ENV || 'development';
const knex = require('knex')(knexConfig[environment]);

module.exports = {
  // Knex query builder (for ledger system and migrations)
  knex,
  
  // Connection management (legacy pg pool)
  initializePool: connection.initializePool,
  getPool: connection.getPool,
  query: connection.query,
  transaction: connection.transaction,
  getTenantQuery: connection.getTenantQuery,
  closePool: connection.closePool,
  healthCheck: connection.healthCheck,

  // Utility functions
  insertWithTenant: utils.insertWithTenant,
  findByTenant: utils.findByTenant,
  updateByTenant: utils.updateByTenant,
  deleteByTenant: utils.deleteByTenant,
  logAudit: utils.logAudit,
  transactionWithTenant: utils.transactionWithTenant,
  getMerchantById: utils.getMerchantById,
  getMerchantByCode: utils.getMerchantByCode,
  paginate: utils.paginate,

  // Tenant middleware
  extractTenant: tenantMiddleware.extractTenant,
  optionalTenant: tenantMiddleware.optionalTenant
};
