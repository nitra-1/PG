# Database Usage Examples

This document provides practical examples of using the database infrastructure in the Payment Gateway application.

## Table of Contents
1. [Basic Connection Usage](#basic-connection-usage)
2. [Multi-Tenancy Examples](#multi-tenancy-examples)
3. [Transaction Management](#transaction-management)
4. [Common Queries](#common-queries)
5. [Audit Logging](#audit-logging)

## Basic Connection Usage

### Simple Query

```javascript
const db = require('./database');

// Execute a simple query
async function getTransactionById(id) {
  const result = await db.query(
    'SELECT * FROM transactions WHERE id = $1',
    [id]
  );
  return result.rows[0];
}
```

### Using Connection Pool

```javascript
const db = require('./database');

// Get pool for advanced usage
const pool = db.getPool();

async function complexQuery() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM transactions LIMIT 10');
    return result.rows;
  } finally {
    client.release();
  }
}
```

## Multi-Tenancy Examples

### Using Tenant Middleware

```javascript
const express = require('express');
const { extractTenant } = require('./database/tenant-middleware');

const app = express();

// Apply tenant middleware to all API routes
app.use('/api', extractTenant);

// Now all requests must include X-Tenant-ID header
app.get('/api/transactions', async (req, res) => {
  // req.tenantId is automatically available
  const transactions = await db.findByTenant('transactions', req.tenantId);
  res.json(transactions);
});
```

### Inserting Data with Tenant

```javascript
const db = require('./database');

async function createTransaction(data, tenantId) {
  const transaction = await db.insertWithTenant('transactions', {
    order_id: data.orderId,
    amount: data.amount,
    currency: 'INR',
    payment_method: data.paymentMethod,
    gateway: data.gateway,
    status: 'pending',
    customer_email: data.customerEmail,
    customer_phone: data.customerPhone,
    metadata: JSON.stringify(data.metadata)
  }, tenantId);
  
  return transaction;
}

// Usage
const newTransaction = await createTransaction({
  orderId: 'ORD123',
  amount: 1000.00,
  paymentMethod: 'upi',
  gateway: 'razorpay',
  customerEmail: 'customer@example.com',
  customerPhone: '+919876543210',
  metadata: { source: 'mobile_app' }
}, '550e8400-e29b-41d4-a716-446655440000');
```

### Querying by Tenant

```javascript
const db = require('./database');

async function getCustomerTransactions(tenantId, customerEmail) {
  const transactions = await db.findByTenant('transactions', tenantId, {
    customer_email: customerEmail
  });
  return transactions;
}

// Usage
const transactions = await getCustomerTransactions(
  '550e8400-e29b-41d4-a716-446655440000',
  'customer@example.com'
);
```

### Updating with Tenant Isolation

```javascript
const db = require('./database');

async function updateTransactionStatus(transactionId, status, tenantId) {
  const updated = await db.updateByTenant('transactions', transactionId, {
    status,
    completed_at: new Date()
  }, tenantId);
  
  return updated;
}

// Usage
const updated = await updateTransactionStatus(
  'trans-uuid-123',
  'success',
  '550e8400-e29b-41d4-a716-446655440000'
);
```

## Transaction Management

### Using Database Transactions

```javascript
const db = require('./database');

async function processPayment(orderId, amount, tenantId) {
  return await db.transaction(async (client) => {
    // Create payment order
    const orderResult = await client.query(
      `INSERT INTO payment_orders (tenant_id, order_id, amount, status) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, orderId, amount, 'created']
    );
    
    const order = orderResult.rows[0];
    
    // Create transaction record
    const transResult = await client.query(
      `INSERT INTO transactions (tenant_id, order_id, amount, status, payment_method, gateway) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, orderId, amount, 'pending', 'upi', 'razorpay']
    );
    
    return {
      order: order,
      transaction: transResult.rows[0]
    };
  });
}

// Usage
const result = await processPayment('ORD456', 2500.00, 'tenant-uuid');
```

### Transaction with Tenant Context

```javascript
const db = require('./database');

async function transferFunds(fromAccount, toAccount, amount, tenantId) {
  return await db.transactionWithTenant(async (client) => {
    // Debit from source
    await client.query(
      'UPDATE merchants SET balance = balance - $1 WHERE id = $2',
      [amount, fromAccount]
    );
    
    // Credit to destination
    await client.query(
      'UPDATE merchants SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );
    
    // Log the transfer
    await client.query(
      `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, metadata) 
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, 'transfer', fromAccount, 'payment', 
       JSON.stringify({ to: toAccount, amount })]
    );
  }, tenantId);
}
```

## Common Queries

### Get Merchant Information

```javascript
const db = require('./database');

async function getMerchant(merchantCode) {
  const merchant = await db.getMerchantByCode(merchantCode);
  return merchant;
}

// Or by ID
async function getMerchantById(merchantId) {
  const merchant = await db.getMerchantById(merchantId);
  return merchant;
}
```

### Search Transactions with Filters

```javascript
const db = require('./database');

async function searchTransactions(filters, tenantId) {
  let query = 'SELECT * FROM transactions WHERE tenant_id = $1';
  const params = [tenantId];
  let paramIndex = 2;
  
  if (filters.status) {
    query += ` AND status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }
  
  if (filters.paymentMethod) {
    query += ` AND payment_method = $${paramIndex}`;
    params.push(filters.paymentMethod);
    paramIndex++;
  }
  
  if (filters.fromDate) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(filters.fromDate);
    paramIndex++;
  }
  
  if (filters.toDate) {
    query += ` AND created_at <= $${paramIndex}`;
    params.push(filters.toDate);
    paramIndex++;
  }
  
  query += ' ORDER BY created_at DESC LIMIT 100';
  
  const result = await db.query(query, params);
  return result.rows;
}

// Usage
const transactions = await searchTransactions({
  status: 'success',
  paymentMethod: 'upi',
  fromDate: '2024-01-01',
  toDate: '2024-12-31'
}, 'tenant-uuid');
```

### Get Transaction Statistics

```javascript
const db = require('./database');

async function getTransactionStats(tenantId, startDate, endDate) {
  const query = `
    SELECT 
      COUNT(*) as total_count,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END) as total_amount,
      AVG(CASE WHEN status = 'success' THEN amount ELSE NULL END) as avg_amount
    FROM transactions
    WHERE tenant_id = $1 
      AND created_at BETWEEN $2 AND $3
  `;
  
  const result = await db.query(query, [tenantId, startDate, endDate]);
  return result.rows[0];
}
```

## Audit Logging

### Log User Actions

```javascript
const db = require('./database');

async function logPaymentAction(transactionId, tenantId, userId, req) {
  await db.logAudit({
    tenantId,
    entityType: 'transaction',
    entityId: transactionId,
    action: 'payment',
    userId,
    userEmail: req.user?.email,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    metadata: {
      endpoint: req.path,
      method: req.method
    }
  });
}
```

### Log Data Changes

```javascript
const db = require('./database');

async function updateOrderWithAudit(orderId, updates, tenantId, userId) {
  return await db.transaction(async (client) => {
    // Get current data
    const beforeResult = await client.query(
      'SELECT * FROM payment_orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId]
    );
    const before = beforeResult.rows[0];
    
    // Update the order
    const updateResult = await client.query(
      'UPDATE payment_orders SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [updates.status, orderId, tenantId]
    );
    const after = updateResult.rows[0];
    
    // Log the change
    await db.logAudit({
      tenantId,
      entityType: 'payment_order',
      entityId: orderId,
      action: 'update',
      userId,
      changesBefore: before,
      changesAfter: after
    });
    
    return after;
  });
}
```

### Query Audit Logs

```javascript
const db = require('./database');

async function getAuditTrail(entityType, entityId, tenantId) {
  const result = await db.query(
    `SELECT * FROM audit_logs 
     WHERE tenant_id = $1 
       AND entity_type = $2 
       AND entity_id = $3 
     ORDER BY created_at DESC`,
    [tenantId, entityType, entityId]
  );
  return result.rows;
}

// Usage
const auditTrail = await getAuditTrail(
  'transaction',
  'trans-uuid-123',
  'tenant-uuid'
);
```

## Beneficiary Management

### Add Beneficiary

```javascript
const db = require('./database');

async function addBeneficiary(data, tenantId) {
  const beneficiary = await db.insertWithTenant('beneficiaries', {
    beneficiary_name: data.name,
    account_number: data.accountNumber,
    ifsc_code: data.ifscCode,
    bank_name: data.bankName,
    branch_name: data.branchName,
    email: data.email,
    phone: data.phone,
    status: 'active',
    metadata: JSON.stringify(data.metadata || {})
  }, tenantId);
  
  return beneficiary;
}
```

### Get Beneficiaries by Tenant

```javascript
const db = require('./database');

async function getBeneficiaries(tenantId) {
  const beneficiaries = await db.findByTenant('beneficiaries', tenantId, {
    status: 'active'
  });
  return beneficiaries;
}
```

## Database Health Monitoring

### Check Database Health

```javascript
const db = require('./database');

async function checkHealth() {
  const health = await db.healthCheck();
  
  if (!health.healthy) {
    console.error('Database health check failed:', health.error);
    // Send alert or take action
  }
  
  return health;
}
```

### Monitor Connection Pool

```javascript
const db = require('./database');

function getPoolStats() {
  const pool = db.getPool();
  
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

// Log pool stats periodically
setInterval(() => {
  const stats = getPoolStats();
  console.log('Pool stats:', stats);
}, 60000); // Every minute
```

## Best Practices

1. **Always use parameterized queries** to prevent SQL injection
   ```javascript
   // Good
   await db.query('SELECT * FROM users WHERE email = $1', [email]);
   
   // Bad - vulnerable to SQL injection
   await db.query(`SELECT * FROM users WHERE email = '${email}'`);
   ```

2. **Use transactions for related operations**
   ```javascript
   // Ensure atomicity for related changes
   await db.transaction(async (client) => {
     await client.query('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
     await client.query('UPDATE accounts SET balance = balance + 100 WHERE id = 2');
   });
   ```

3. **Always include tenant_id in multi-tenant queries**
   ```javascript
   // Use helper functions that automatically add tenant_id
   await db.findByTenant('transactions', tenantId);
   ```

4. **Log important operations for audit trail**
   ```javascript
   await db.logAudit({
     tenantId,
     entityType: 'payment',
     entityId: paymentId,
     action: 'create',
     userId
   });
   ```

5. **Handle connection pool cleanup on shutdown**
   ```javascript
   process.on('SIGTERM', async () => {
     await db.closePool();
     process.exit(0);
   });
   ```

## Error Handling

```javascript
const db = require('./database');

async function safeQuery(tenantId) {
  try {
    const result = await db.findByTenant('transactions', tenantId);
    return { success: true, data: result };
  } catch (error) {
    console.error('Database query error:', error);
    
    // Check for specific error types
    if (error.code === '23505') {
      return { success: false, error: 'Duplicate entry' };
    }
    
    return { success: false, error: 'Database error occurred' };
  }
}
```

## Performance Optimization

### Use Indexes for Common Queries

All tables include indexes on commonly queried fields. When adding custom queries, ensure you're using indexed columns:

- `tenant_id` (all tables)
- `status` (transactions, payment_orders, merchants)
- `created_at` (transactions, payment_orders, audit_logs)
- `order_id` (transactions)

### Pagination

```javascript
async function getPaginatedTransactions(tenantId, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  
  const result = await db.query(
    `SELECT * FROM transactions 
     WHERE tenant_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [tenantId, pageSize, offset]
  );
  
  return result.rows;
}
```

## Additional Resources

- [DATABASE_SETUP.md](DATABASE_SETUP.md) - Setup and configuration guide
- [Knex.js Documentation](http://knexjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
