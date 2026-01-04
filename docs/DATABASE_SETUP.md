# Database Setup and Management

This document provides instructions for setting up and managing the PostgreSQL database for the Payment Gateway system.

## Prerequisites

- PostgreSQL 12 or higher
- Node.js 14 or higher
- npm 6 or higher

## Initial Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Database Connection

Copy `.env.example` to `.env` and update the database configuration:

```bash
cp .env.example .env
```

Update the following variables in `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_gateway
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false
DB_POOL_SIZE=10
```

### 3. Create Database

Create the database using PostgreSQL:

```bash
createdb payment_gateway
```

Or using psql:

```sql
CREATE DATABASE payment_gateway;
```

### 4. Run Migrations

Run the database migrations to create all necessary tables:

```bash
npm run migrate:latest
```

### 5. Seed Initial Data (Optional)

Seed the database with initial merchant data:

```bash
npm run seed:run
```

Or run both migrations and seeds in one command:

```bash
npm run db:setup
```

## Database Schema

### Core Tables

#### 1. transactions
Stores all payment transaction records with multi-tenancy support.

**Key columns:**
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Not Null) - For multi-tenancy
- `order_id` (String, Not Null) - Merchant order reference
- `transaction_ref` (String, Unique) - Internal transaction reference
- `amount` (Decimal) - Transaction amount
- `status` (Enum) - Transaction status (pending, processing, success, failed, refunded)
- `gateway` (String) - Payment gateway used
- `payment_method` (String) - Payment method (UPI, card, etc.)

#### 2. payment_orders
Stores payment order information before transaction processing.

**Key columns:**
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Not Null)
- `order_id` (String, Unique)
- `amount` (Decimal)
- `status` (Enum) - Order status
- `customer_details` (JSONB)
- `line_items` (JSONB)

#### 3. audit_logs
Tracks all system activities for compliance and debugging.

**Key columns:**
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Not Null)
- `entity_type` (String) - Type of entity (transaction, order, etc.)
- `entity_id` (UUID) - ID of the entity
- `action` (Enum) - Action performed
- `user_id` (String)
- `changes_before` (JSONB)
- `changes_after` (JSONB)

#### 4. merchants
Stores merchant/tenant information for multi-tenancy.

**Key columns:**
- `id` (UUID, Primary Key)
- `merchant_code` (String, Unique)
- `merchant_name` (String)
- `status` (Enum) - Merchant status
- `settings` (JSONB) - Merchant-specific settings
- `balance` (Decimal)

#### 5. beneficiaries
Stores beneficiary information for payout operations.

**Key columns:**
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Not Null)
- `beneficiary_name` (String)
- `account_number` (String)
- `ifsc_code` (String)
- `status` (Enum)

## Connection Pooling

The application uses `pg-pool` for efficient database connection management:

- **Minimum pool size:** 2 connections
- **Maximum pool size:** 10 connections (configurable via `DB_POOL_SIZE`)
- **Idle timeout:** 30 seconds
- **Connection timeout:** 10 seconds
- **Max uses per connection:** 7500 queries

## Multi-Tenancy

The system supports multi-tenancy using column-based separation:

### Configuration

Enable multi-tenancy in `.env`:

```env
MULTI_TENANCY_ENABLED=true
TENANT_STRATEGY=column
```

### Using Multi-Tenancy

All API requests must include the tenant ID in the `X-Tenant-ID` header:

```bash
curl -H "X-Tenant-ID: 550e8400-e29b-41d4-a716-446655440000" \
     http://localhost:3000/api/transactions
```

### Middleware

Use the tenant middleware in your routes:

```javascript
const { extractTenant } = require('./database/tenant-middleware');

// Required tenant
app.use('/api', extractTenant);

// Optional tenant
app.use('/public', optionalTenant);
```

## Database Failover

The system supports read replicas for high availability:

### Configuration

Add replica hosts in `.env`:

```env
DB_REPLICAS=[{"host":"replica1.example.com","port":5432},{"host":"replica2.example.com","port":5432}]
```

The connection pool will automatically distribute read queries across replicas.

## Backup Strategy

### Recommended Backup Practices

1. **Automated Daily Backups**
   ```bash
   pg_dump -U postgres payment_gateway > backup_$(date +%Y%m%d).sql
   ```

2. **Point-in-Time Recovery (PITR)**
   - Enable WAL archiving in PostgreSQL
   - Configure continuous archiving to cloud storage (S3, Azure Blob)

3. **Backup Retention**
   - Daily backups: Retain for 7 days
   - Weekly backups: Retain for 4 weeks
   - Monthly backups: Retain for 12 months

### Cloud Database Solutions

For production environments, consider managed database services:

- **AWS RDS PostgreSQL** - Automated backups, Multi-AZ deployment
- **Azure Database for PostgreSQL** - Built-in HA and backup
- **Google Cloud SQL** - Automated backups and failover

## Migration Management

### Create a New Migration

```bash
npm run migrate:make migration_name
```

This creates a new migration file in `src/database/migrations/`.

### Run Migrations

```bash
npm run migrate:latest
```

### Rollback Last Migration

```bash
npm run migrate:rollback
```

### Check Migration Status

```bash
npx knex migrate:status
```

## Seed Management

### Create a New Seed

```bash
npm run seed:make seed_name
```

### Run Seeds

```bash
npm run seed:run
```

## Database Health Check

The application provides a health check endpoint:

```bash
curl http://localhost:3000/health
```

Or use the database-specific health check:

```javascript
const db = require('./database/connection');

const health = await db.healthCheck();
console.log(health);
```

## Troubleshooting

### Connection Issues

1. Verify PostgreSQL is running:
   ```bash
   pg_isready -h localhost -p 5432
   ```

2. Check connection parameters in `.env`

3. Verify firewall rules allow connections to port 5432

### Migration Issues

1. Check migration status:
   ```bash
   npx knex migrate:status
   ```

2. View detailed error logs

3. Rollback and retry if needed:
   ```bash
   npm run migrate:rollback
   npm run migrate:latest
   ```

### Performance Issues

1. Check pool statistics
2. Increase pool size if needed
3. Add indexes for frequently queried columns
4. Use `EXPLAIN ANALYZE` to optimize queries

## Security Best Practices

1. **Never commit `.env` file** - Contains sensitive credentials
2. **Use SSL in production** - Set `DB_SSL=true`
3. **Rotate database credentials** regularly
4. **Use least privilege** - Grant only necessary permissions
5. **Enable audit logging** - Track all database operations
6. **Encrypt backups** - Use encryption for backup storage
7. **Use prepared statements** - Prevent SQL injection (handled by Knex)

## Additional Resources

- [Knex.js Documentation](http://knexjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [pg (node-postgres) Documentation](https://node-postgres.com/)
