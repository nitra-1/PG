/**
 * Database Utilities
 * Helper functions for common database operations
 */

const db = require('./connection');
const config = require('../config/config');

/**
 * Insert a record with tenant_id
 */
async function insertWithTenant(tableName, data, tenantId) {
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for insert operation');
  }

  const insertData = config.database.multiTenancy.enabled 
    ? { ...data, tenant_id: tenantId }
    : data;

  const query = `
    INSERT INTO ${tableName} 
    (${Object.keys(insertData).join(', ')}) 
    VALUES (${Object.keys(insertData).map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING *
  `;

  const result = await db.query(query, Object.values(insertData));
  return result.rows[0];
}

/**
 * Find records by tenant
 */
async function findByTenant(tableName, tenantId, conditions = {}) {
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for query operation');
  }

  const whereConditions = config.database.multiTenancy.enabled
    ? { tenant_id: tenantId, ...conditions }
    : conditions;

  const whereClause = Object.keys(whereConditions)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(' AND ');

  const query = `SELECT * FROM ${tableName} ${whereClause ? `WHERE ${whereClause}` : ''}`;
  const result = await db.query(query, Object.values(whereConditions));
  return result.rows;
}

/**
 * Update records by tenant
 */
async function updateByTenant(tableName, id, updates, tenantId) {
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for update operation');
  }

  const setClause = Object.keys(updates)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const values = [...Object.values(updates), id];
  
  let query = `UPDATE ${tableName} SET ${setClause} WHERE id = $${values.length}`;
  
  if (config.database.multiTenancy.enabled) {
    values.push(tenantId);
    query += ` AND tenant_id = $${values.length}`;
  }
  
  query += ' RETURNING *';

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Delete records by tenant
 */
async function deleteByTenant(tableName, id, tenantId) {
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for delete operation');
  }

  const values = [id];
  let query = `DELETE FROM ${tableName} WHERE id = $1`;
  
  if (config.database.multiTenancy.enabled) {
    values.push(tenantId);
    query += ` AND tenant_id = $${values.length}`;
  }
  
  query += ' RETURNING *';

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Log audit trail
 */
async function logAudit(params) {
  const {
    tenantId,
    entityType,
    entityId,
    action,
    userId,
    userEmail,
    ipAddress,
    userAgent,
    changesBefore = null,
    changesAfter = null,
    metadata = null
  } = params;

  const query = `
    INSERT INTO audit_logs 
    (tenant_id, entity_type, entity_id, action, user_id, user_email, ip_address, user_agent, changes_before, changes_after, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;

  const values = [
    tenantId || null,
    entityType,
    entityId,
    action,
    userId || null,
    userEmail || null,
    ipAddress || null,
    userAgent || null,
    changesBefore ? JSON.stringify(changesBefore) : null,
    changesAfter ? JSON.stringify(changesAfter) : null,
    metadata ? JSON.stringify(metadata) : null
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Execute a transaction with tenant isolation
 */
async function transactionWithTenant(callback, tenantId) {
  return db.transaction(async (client) => {
    // Set tenant context for the transaction
    if (config.database.multiTenancy.enabled && tenantId) {
      await client.query('SET LOCAL app.current_tenant = $1', [tenantId]);
    }
    
    return callback(client);
  });
}

/**
 * Get merchant by ID
 */
async function getMerchantById(merchantId) {
  const query = 'SELECT * FROM merchants WHERE id = $1 AND status = $2';
  const result = await db.query(query, [merchantId, 'active']);
  return result.rows[0];
}

/**
 * Get merchant by code
 */
async function getMerchantByCode(merchantCode) {
  const query = 'SELECT * FROM merchants WHERE merchant_code = $1 AND status = $2';
  const result = await db.query(query, [merchantCode, 'active']);
  return result.rows[0];
}

/**
 * Paginate results
 */
function paginate(query, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  return {
    query: `${query} LIMIT $limit OFFSET $offset`,
    params: { limit: pageSize, offset }
  };
}

module.exports = {
  insertWithTenant,
  findByTenant,
  updateByTenant,
  deleteByTenant,
  logAudit,
  transactionWithTenant,
  getMerchantById,
  getMerchantByCode,
  paginate
};
