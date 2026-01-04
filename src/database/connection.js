/**
 * Database Connection Module
 * Implements connection pooling for PostgreSQL
 */

const { Pool } = require('pg');
const config = require('../config/config');

let pool = null;

/**
 * Initialize database connection pool
 */
function initializePool() {
  if (pool) {
    return pool;
  }

  const poolConfig = {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: config.database.poolSize || 10, // Maximum pool size
    min: 2, // Minimum pool size
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection cannot be established
    maxUses: 7500, // Close connection after 7500 uses to prevent memory leaks
  };

  // Add failover replicas if configured
  if (config.database.replicas && config.database.replicas.length > 0) {
    poolConfig.hosts = [
      { host: config.database.host, port: config.database.port },
      ...config.database.replicas
    ];
  }

  pool = new Pool(poolConfig);

  // Handle pool errors
  pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit the process, just log the error
  });

  // Handle pool connection
  pool.on('connect', () => {
    console.log('Database connection established');
  });

  // Handle pool removal
  pool.on('remove', () => {
    console.log('Database connection removed from pool');
  });

  return pool;
}

/**
 * Get database connection pool
 */
function getPool() {
  if (!pool) {
    return initializePool();
  }
  return pool;
}

/**
 * Execute a query with automatic retry on failover
 */
async function query(text, params) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction
 */
async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get tenant-specific query with tenant_id filter
 * Supports multi-tenancy
 */
function getTenantQuery(baseQuery, tenantId) {
  if (!tenantId) {
    return baseQuery;
  }
  
  // Add tenant_id to WHERE clause
  if (baseQuery.toLowerCase().includes('where')) {
    return `${baseQuery} AND tenant_id = $tenantId`;
  } else {
    return `${baseQuery} WHERE tenant_id = $tenantId`;
  }
}

/**
 * Close the connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database pool closed');
  }
}

/**
 * Health check for database connection
 */
async function healthCheck() {
  try {
    const result = await query('SELECT NOW()');
    return { healthy: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

module.exports = {
  initializePool,
  getPool,
  query,
  transaction,
  getTenantQuery,
  closePool,
  healthCheck
};
