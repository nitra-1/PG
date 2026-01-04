/**
 * Database Utilities
 * Helper functions for common database operations
 */

const db = require('./connection');
const config = require('../config/config');

/**
 * Validate table name against allowed tables
 */
const ALLOWED_TABLES = [
  'transactions',
  'payment_orders',
  'audit_logs',
  'merchants',
  'beneficiaries'
];

function validateTableName(tableName) {
  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

/**
 * Insert a record with tenant_id
 */
async function insertWithTenant(tableName, data, tenantId) {
  validateTableName(tableName);
  
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for insert operation');
  }

  const insertData = config.database.multiTenancy.enabled 
    ? { ...data, tenant_id: tenantId }
    : data;

  const columns = Object.keys(insertData);
  const values = Object.values(insertData);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  const query = `
    INSERT INTO ${tableName} 
    (${columns.join(', ')}) 
    VALUES (${placeholders})
    RETURNING *
  `;

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Get schema for a table - returns allowed columns
 */
const TABLE_SCHEMAS = {
  transactions: ['id', 'tenant_id', 'order_id', 'transaction_ref', 'payment_method', 'gateway', 'amount', 'currency', 'status', 'customer_email', 'customer_phone', 'customer_name', 'metadata', 'gateway_transaction_id', 'gateway_response_code', 'gateway_response_message', 'initiated_at', 'completed_at', 'created_at', 'updated_at'],
  payment_orders: ['id', 'tenant_id', 'order_id', 'amount', 'currency', 'status', 'customer_id', 'customer_email', 'customer_phone', 'customer_details', 'billing_address', 'shipping_address', 'line_items', 'payment_method', 'gateway', 'gateway_order_id', 'callback_url', 'webhook_url', 'metadata', 'expires_at', 'created_at', 'updated_at'],
  audit_logs: ['id', 'tenant_id', 'entity_type', 'entity_id', 'action', 'user_id', 'user_email', 'ip_address', 'user_agent', 'changes_before', 'changes_after', 'metadata', 'created_at'],
  merchants: ['id', 'merchant_code', 'merchant_name', 'business_type', 'email', 'phone', 'address', 'status', 'settings', 'api_credentials', 'balance', 'created_at', 'updated_at'],
  beneficiaries: ['id', 'tenant_id', 'beneficiary_name', 'account_number', 'ifsc_code', 'bank_name', 'branch_name', 'email', 'phone', 'status', 'metadata', 'created_at', 'updated_at']
};

function validateColumns(tableName, columns) {
  const allowedColumns = TABLE_SCHEMAS[tableName];
  if (!allowedColumns) {
    throw new Error(`Unknown table: ${tableName}`);
  }
  
  for (const column of columns) {
    if (!allowedColumns.includes(column)) {
      throw new Error(`Invalid column '${column}' for table '${tableName}'`);
    }
  }
}

/**
 * Find records by tenant
 */
async function findByTenant(tableName, tenantId, conditions = {}) {
  validateTableName(tableName);
  
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for query operation');
  }

  const whereConditions = config.database.multiTenancy.enabled
    ? { tenant_id: tenantId, ...conditions }
    : conditions;

  // Validate column names
  validateColumns(tableName, Object.keys(whereConditions));

  const columns = Object.keys(whereConditions);
  const values = Object.values(whereConditions);
  const whereClause = columns.map((key, i) => `${key} = $${i + 1}`).join(' AND ');

  const query = `SELECT * FROM ${tableName} ${whereClause ? `WHERE ${whereClause}` : ''}`;
  const result = await db.query(query, values);
  return result.rows;
}

/**
 * Update records by tenant
 */
async function updateByTenant(tableName, id, updates, tenantId) {
  validateTableName(tableName);
  
  if (config.database.multiTenancy.enabled && !tenantId) {
    throw new Error('Tenant ID is required for update operation');
  }

  // Validate column names
  validateColumns(tableName, Object.keys(updates));

  const columns = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = columns.map((key, i) => `${key} = $${i + 1}`).join(', ');

  const allValues = [...values, id];
  
  let query = `UPDATE ${tableName} SET ${setClause} WHERE id = $${allValues.length}`;
  
  if (config.database.multiTenancy.enabled) {
    allValues.push(tenantId);
    query += ` AND tenant_id = $${allValues.length}`;
  }
  
  query += ' RETURNING *';

  const result = await db.query(query, allValues);
  return result.rows[0];
}

/**
 * Delete records by tenant
 */
async function deleteByTenant(tableName, id, tenantId) {
  validateTableName(tableName);
  
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
    query: `${query} LIMIT $1 OFFSET $2`,
    params: [pageSize, offset]
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
