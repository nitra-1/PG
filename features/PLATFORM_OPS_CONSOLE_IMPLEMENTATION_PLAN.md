# Platform Ops Console - Implementation Summary

## 🎯 Document Overview

This document outlines the detailed implementation plan for the Platform Ops Console based on the comprehensive gap analysis. It provides step-by-step guidance for building each module while maintaining **strict financial isolation**.

---

## 📋 Implementation Components

### Component 1: Database Schema

**File**: `src/database/migrations/20240107000000_ops_console_infrastructure.js`

**Tables to Create**:

1. **platform_users** - Platform user management
   ```sql
   - id (UUID, primary key)
   - username (string, unique)
   - email (string, unique)
   - password_hash (string)
   - role (enum: PLATFORM_ADMIN, OPS_ADMIN, FINANCE_ADMIN, MERCHANT)
   - status (enum: active, disabled, pending)
   - last_login_at (timestamp)
   - created_by (UUID, nullable)
   - created_at, updated_at (timestamps)
   ```

2. **system_config** - System configuration management
   ```sql
   - id (UUID, primary key)
   - config_key (string, unique)
   - config_value (jsonb)
   - category (string) - e.g., 'feature_flags', 'timeouts', 'thresholds'
   - is_financial (boolean) - TRUE blocks from Ops Console
   - version (integer) - For rollback support
   - description (text)
   - updated_by (UUID)
   - created_at, updated_at (timestamps)
   ```

3. **config_history** - Configuration change history
   ```sql
   - id (UUID, primary key)
   - config_id (UUID, foreign key → system_config)
   - config_key (string)
   - old_value (jsonb)
   - new_value (jsonb)
   - changed_by (UUID)
   - change_reason (text)
   - changed_at (timestamp)
   ```

4. **approval_requests** - Dual approval workflow
   ```sql
   - id (UUID, primary key)
   - request_type (string) - e.g., 'role_assignment', 'gateway_override'
   - requestor_id (UUID)
   - approver_id (UUID, nullable)
   - status (enum: pending, approved, rejected, cancelled)
   - request_data (jsonb)
   - approval_reason (text, nullable)
   - requested_at (timestamp)
   - approved_at (timestamp, nullable)
   ```

---

### Component 2: Backend API Routes

**Directory**: `src/ops-console/`

#### 2.1 Ops Console Middleware

**File**: `src/ops-console/ops-console-middleware.js`

```javascript
/**
 * Platform Ops Console Middleware
 * Enforces PLATFORM_ADMIN/OPS_ADMIN access and blocks finance operations
 * 
 * CRITICAL: This console must NOT have financial authority
 */

const { auditTrailService } = require('../security/audit-trail-service');

/**
 * Require PLATFORM_ADMIN or OPS_ADMIN role
 */
const requireOpsConsoleAccess = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  
  // Only PLATFORM_ADMIN and OPS_ADMIN can access Ops Console
  // NOTE: FINANCE_ADMIN is intentionally excluded to prevent financial authority overlap
  if (!userRole || !['PLATFORM_ADMIN', 'OPS_ADMIN'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: PLATFORM_ADMIN or OPS_ADMIN role required',
      message: 'This is an operational admin console. Finance operations are managed separately.'
    });
  }
  
  // Store user info for audit logging
  req.opsUser = {
    userId,
    role: userRole,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  };
  
  next();
};

/**
 * Block finance operations (NON-NEGOTIABLE)
 * Prevents Ops Console from accessing financial authority
 */
const blockFinanceOperations = (req, res, next) => {
  // CRITICAL: List of forbidden financial operations
  // These operations require FINANCE_ADMIN role and separate console
  const forbiddenOperations = [
    'settlement', 'ledger', 'accounting-period', 
    'reconciliation', 'financial-report', 'money-movement',
    'override-approval', 'accounting', 'ledger-lock'
  ];
  
  const isForbidden = forbiddenOperations.some(op => 
    req.path.toLowerCase().includes(op)
  );
  
  if (isForbidden) {
    // Log as HIGH severity security event
    auditTrailService.logSecurityEvent({
      eventSubType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      severity: 'HIGH',
      userId: req.opsUser?.userId || 'UNKNOWN',
      description: `Ops Console attempted to access forbidden finance operation: ${req.path}`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      affectedResource: req.path,
      mitigationAction: 'Access blocked by blockFinanceOperations middleware'
    });
    
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Finance operations not allowed in Ops Console',
      message: 'Operations cannot influence money movement. Contact Finance Admin.',
      note: 'This attempt has been logged for security review.'
    });
  }
  
  next();
};

/**
 * Log all Ops Console actions for audit trail
 */
const logOpsAction = (action) => {
  return async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;
    
    // Override send to log after response
    res.send = function(data) {
      // Log the action
      auditTrailService.logDataAccess({
        userId: req.opsUser?.userId || 'UNKNOWN',
        action,
        resource: 'OPS_CONSOLE',
        resourceId: req.params.id || null,
        dataType: 'OPERATIONAL',
        ipAddress: req.opsUser?.ipAddress,
        userAgent: req.opsUser?.userAgent,
        success: res.statusCode >= 200 && res.statusCode < 400,
        metadata: {
          method: req.method,
          path: req.path,
          query: req.query,
          body: req.body,
          statusCode: res.statusCode
        }
      }).catch(err => {
        console.error('Failed to log ops action:', err);
      });
      
      // Call original send
      originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = {
  requireOpsConsoleAccess,
  blockFinanceOperations,
  logOpsAction
};
```

#### 2.2 Merchant Management Routes

**File**: `src/ops-console/merchant-management-routes.js`

**Key Endpoints**:
- `GET /api/ops/merchants` - List all merchants with search/filter
- `POST /api/ops/merchants` - Create new merchant
- `GET /api/ops/merchants/:id` - Get merchant details
- `PUT /api/ops/merchants/:id/activate` - Activate merchant
- `PUT /api/ops/merchants/:id/suspend` - Suspend merchant (no financial data impact)
- `GET /api/ops/merchants/:id/config` - View merchant configuration

**Key Implementation Notes**:
```javascript
/**
 * PUT /api/ops/merchants/:id/suspend
 * Suspend merchant - affects operational access only
 * 
 * CRITICAL: Suspension must NOT alter financial data
 * - Does NOT affect settlements (those continue as scheduled)
 * - Does NOT modify ledger entries
 * - Only affects: Checkout, API access, Webhooks
 */
router.put('/:id/suspend', requireOpsConsoleAccess, logOpsAction('SUSPEND_MERCHANT'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  if (!reason) {
    return res.status(400).json({
      success: false,
      error: 'Suspension reason is required for audit compliance'
    });
  }
  
  // Update merchant status to suspended
  // NOTE: This only affects operational access, not financial data
  await merchantService.updateMerchant(id, { status: 'suspended' });
  
  // Log the suspension with reason
  await auditTrailService.logDataAccess({
    userId: req.opsUser.userId,
    action: 'SUSPEND',
    resource: 'MERCHANT',
    resourceId: id,
    dataType: 'OPERATIONAL',
    ipAddress: req.opsUser.ipAddress,
    success: true,
    metadata: {
      reason,
      note: 'Suspension affects operational access only, not financial data'
    }
  });
  
  res.json({
    success: true,
    message: 'Merchant suspended successfully',
    note: 'Suspension affects checkout and API access. Scheduled settlements will continue.'
  });
});
```

#### 2.3 Transaction Monitoring Routes (READ-ONLY)

**File**: `src/ops-console/transaction-monitoring-routes.js`

**Key Implementation Notes**:
```javascript
/**
 * Transaction Monitoring Routes - STRICTLY READ-ONLY
 * 
 * FORBIDDEN OPERATIONS (enforced):
 * - No transaction edits
 * - No refund initiation (merchant-only capability)
 * - No settlement actions
 * - No ledger drill-down
 * 
 * Purpose: Operational visibility only
 */

// Block all non-GET methods
router.all('*', (req, res, next) => {
  if (req.method !== 'GET') {
    return res.status(403).json({
      success: false,
      error: 'Transaction monitoring is read-only',
      message: 'Ops Console cannot modify transactions. Merchants initiate refunds via their dashboard.'
    });
  }
  next();
});
```

#### 2.4 Gateway Health Routes

**File**: `src/ops-console/gateway-health-routes.js`

**Key Endpoints**:
- `GET /api/ops/gateway-health/status` - All gateway statuses
- `GET /api/ops/gateway-health/:gateway/metrics` - Specific gateway metrics
- `POST /api/ops/gateway-health/:gateway/override` - Manual routing override (with approval)
- `GET /api/ops/gateway-health/circuit-breakers` - Circuit breaker states

#### 2.5 User Management Routes

**File**: `src/ops-console/user-management-routes.js`

**Key Implementation Notes**:
```javascript
/**
 * User Management Routes
 * 
 * CRITICAL SECURITY RULES:
 * 1. No self-role escalation
 * 2. Finance roles (FINANCE_ADMIN) cannot be assigned here
 * 3. Dual confirmation required for PLATFORM_ADMIN role assignment
 */

router.put('/:id/role', requireOpsConsoleAccess, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  // RULE 1: Prevent self-role escalation
  if (id === req.opsUser.userId) {
    return res.status(403).json({
      success: false,
      error: 'Cannot modify your own role',
      message: 'Self-role escalation is not allowed for security reasons'
    });
  }
  
  // RULE 2: Finance roles blocked in Ops Console
  if (role === 'FINANCE_ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Cannot assign finance roles',
      message: 'Finance roles can only be assigned by system administrators through secure channels'
    });
  }
  
  // RULE 3: Dual confirmation for PLATFORM_ADMIN
  if (role === 'PLATFORM_ADMIN') {
    // Create approval request
    const approvalRequest = await createApprovalRequest({
      requestType: 'role_assignment',
      requestorId: req.opsUser.userId,
      requestData: { userId: id, role, currentRole: user.role }
    });
    
    return res.json({
      success: true,
      message: 'Role assignment requires dual approval',
      approvalRequestId: approvalRequest.id,
      note: 'Another PLATFORM_ADMIN must approve this request'
    });
  }
  
  // Proceed with role assignment for OPS_ADMIN and MERCHANT
  // ... implementation
});
```

#### 2.6 System Configuration Routes

**File**: `src/ops-console/system-config-routes.js`

**Key Implementation Notes**:
```javascript
/**
 * System Configuration Routes
 * 
 * CRITICAL: Financial configs are FORBIDDEN
 * - Configs marked with is_financial=true are blocked
 * - Only non-financial configs can be modified
 */

router.get('/', requireOpsConsoleAccess, async (req, res) => {
  // ONLY return non-financial configs
  const configs = await db.query(`
    SELECT * FROM system_config 
    WHERE is_financial = false
    ORDER BY category, config_key
  `);
  
  res.json({
    success: true,
    data: configs.rows,
    note: 'Financial configurations are not accessible via Ops Console'
  });
});

router.put('/:key', requireOpsConsoleAccess, logOpsAction('UPDATE_CONFIG'), async (req, res) => {
  const { key } = req.params;
  const { value, reason } = req.body;
  
  // Check if config is financial
  const config = await db.query(
    'SELECT * FROM system_config WHERE config_key = $1',
    [key]
  );
  
  if (config.rows[0].is_financial) {
    return res.status(403).json({
      success: false,
      error: 'Cannot modify financial configuration',
      message: 'Financial configs require FINANCE_ADMIN role'
    });
  }
  
  // Proceed with update and create history entry
  // ... implementation
});
```

---

### Component 3: Frontend UI

**File**: `public/ops-console.html`

**UI Structure**:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Platform Ops Console</title>
  <style>
    /* Modern, clean design similar to merchant dashboard */
    /* Role indicator badge showing PLATFORM_ADMIN/OPS_ADMIN */
    /* Clear separation from finance operations */
  </style>
</head>
<body>
  <nav class="sidebar">
    <h1>Platform Ops Console</h1>
    <div class="role-indicator" id="roleIndicator"></div>
    
    <ul class="nav-menu">
      <li><a href="#" data-tab="dashboard">Dashboard</a></li>
      <li><a href="#" data-tab="merchants">Merchant Management</a></li>
      <li><a href="#" data-tab="transactions">Transaction Monitoring</a></li>
      <li><a href="#" data-tab="gateway-health">Gateway Health</a></li>
      <li><a href="#" data-tab="rate-limits">Rate Limits</a></li>
      <li><a href="#" data-tab="ip-whitelist">IP Whitelist</a></li>
      <li><a href="#" data-tab="users">User Management</a></li>
      <li><a href="#" data-tab="system-config">System Config</a></li>
      <li><a href="#" data-tab="audit-logs">Audit Logs</a></li>
    </ul>
    
    <div class="finance-notice">
      ⚠️ Finance Operations
      <p>This console does not have financial authority.</p>
      <p>For ledger, settlements, and accounting, use Finance Admin Console.</p>
    </div>
  </nav>
  
  <main class="content">
    <!-- Tab content containers -->
    <div id="dashboard-tab" class="tab-content active">
      <!-- Dashboard overview -->
    </div>
    
    <div id="merchants-tab" class="tab-content">
      <!-- Merchant management UI -->
      <div class="action-buttons">
        <button onclick="showCreateMerchantModal()">Create Merchant</button>
      </div>
      <table id="merchantsTable">
        <!-- Merchant listing with search/filter -->
      </table>
    </div>
    
    <div id="transactions-tab" class="tab-content">
      <!-- READ-ONLY transaction monitoring -->
      <div class="readonly-notice">
        ℹ️ This is a read-only view. No edits or refunds can be initiated from Ops Console.
      </div>
      <div class="filters">
        <!-- Merchant, Gateway, Status, Date filters -->
      </div>
      <table id="transactionsTable">
        <!-- Transaction listing -->
      </table>
    </div>
    
    <div id="gateway-health-tab" class="tab-content">
      <!-- Gateway health dashboard -->
      <div class="gateway-grid">
        <!-- Gateway cards with health metrics -->
      </div>
    </div>
    
    <!-- Additional tabs... -->
  </main>
  
  <script>
    // JavaScript for Ops Console
    const API_BASE = '/api/ops';
    
    // Check user role on load
    async function checkAccess() {
      const role = localStorage.getItem('userRole');
      if (!['PLATFORM_ADMIN', 'OPS_ADMIN'].includes(role)) {
        alert('Access denied: Ops Console requires PLATFORM_ADMIN or OPS_ADMIN role');
        window.location.href = '/';
      }
      
      document.getElementById('roleIndicator').textContent = role;
    }
    
    // Load merchant list
    async function loadMerchants() {
      const response = await fetch(`${API_BASE}/merchants`, {
        headers: {
          'x-user-role': localStorage.getItem('userRole'),
          'x-user-id': localStorage.getItem('userId')
        }
      });
      
      const data = await response.json();
      renderMerchantsTable(data.merchants);
    }
    
    // Suspend merchant with reason
    async function suspendMerchant(merchantId) {
      const reason = prompt('Enter suspension reason (required for audit):');
      if (!reason) return;
      
      const response = await fetch(`${API_BASE}/merchants/${merchantId}/suspend`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': localStorage.getItem('userRole'),
          'x-user-id': localStorage.getItem('userId')
        },
        body: JSON.stringify({ reason })
      });
      
      const data = await response.json();
      alert(data.message + '\n\n' + data.note);
      loadMerchants();
    }
    
    // Additional functions...
    
    // Initialize on load
    checkAccess();
  </script>
</body>
</html>
```

---

## 🧪 Testing Implementation

**File**: `tests/ops-console.test.js`

```javascript
const request = require('supertest');
const app = require('../src/index');

describe('Platform Ops Console - Security Tests', () => {
  
  describe('Access Control', () => {
    it('should block access without PLATFORM_ADMIN or OPS_ADMIN role', async () => {
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'MERCHANT');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('PLATFORM_ADMIN or OPS_ADMIN role required');
    });
    
    it('should allow PLATFORM_ADMIN access', async () => {
      const response = await request(app)
        .get('/api/ops/merchants')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'test-admin-id');
      
      expect(response.status).toBe(200);
    });
  });
  
  describe('Finance Isolation', () => {
    it('should block Ops Console from ledger access', async () => {
      const response = await request(app)
        .get('/api/ledger/entries')
        .set('x-user-role', 'PLATFORM_ADMIN');
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('FINANCE_ADMIN role required');
    });
    
    it('should block Ops Console from settlement confirmation', async () => {
      const response = await request(app)
        .post('/api/settlements/confirm')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .send({ settlementId: 'test-id' });
      
      expect(response.status).toBe(403);
    });
    
    it('should block Ops Console from accounting period lock', async () => {
      const response = await request(app)
        .post('/api/accounting-periods/lock')
        .set('x-user-role', 'OPS_ADMIN')
        .send({ periodId: 'test-id' });
      
      expect(response.status).toBe(403);
    });
    
    it('should log security event when finance access attempted', async () => {
      await request(app)
        .get('/api/ledger/entries')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'test-admin-id');
      
      // Verify security event was logged
      const auditLogs = await auditTrailService.queryAuditTrail({
        eventType: 'SECURITY_EVENT',
        userId: 'test-admin-id'
      });
      
      expect(auditLogs).toContainEqual(
        expect.objectContaining({
          eventSubType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
          severity: 'HIGH'
        })
      );
    });
  });
  
  describe('Transaction Monitoring', () => {
    it('should allow GET requests for transaction monitoring', async () => {
      const response = await request(app)
        .get('/api/ops/transactions')
        .set('x-user-role', 'PLATFORM_ADMIN');
      
      expect(response.status).toBe(200);
    });
    
    it('should block POST/PUT/DELETE on transaction monitoring', async () => {
      const response = await request(app)
        .post('/api/ops/transactions/test-id/refund')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .send({ amount: 100 });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('read-only');
    });
  });
  
  describe('Merchant Management', () => {
    it('should allow merchant suspension with reason', async () => {
      const response = await request(app)
        .put('/api/ops/merchants/test-id/suspend')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'test-admin-id')
        .send({ reason: 'Compliance review' });
      
      expect(response.status).toBe(200);
      expect(response.body.note).toContain('Scheduled settlements will continue');
    });
    
    it('should reject suspension without reason', async () => {
      const response = await request(app)
        .put('/api/ops/merchants/test-id/suspend')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reason is required');
    });
  });
  
  describe('User Management', () => {
    it('should block self-role escalation', async () => {
      const response = await request(app)
        .put('/api/ops/users/admin-123/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'PLATFORM_ADMIN' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot modify your own role');
    });
    
    it('should block FINANCE_ADMIN role assignment', async () => {
      const response = await request(app)
        .put('/api/ops/users/user-456/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'FINANCE_ADMIN' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot assign finance roles');
    });
    
    it('should require approval for PLATFORM_ADMIN role', async () => {
      const response = await request(app)
        .put('/api/ops/users/user-456/role')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'admin-123')
        .send({ role: 'PLATFORM_ADMIN' });
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('requires dual approval');
      expect(response.body).toHaveProperty('approvalRequestId');
    });
  });
  
  describe('System Configuration', () => {
    it('should block financial configuration access', async () => {
      const response = await request(app)
        .put('/api/ops/system-config/settlement_timing')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .send({ value: '2d' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Cannot modify financial configuration');
    });
    
    it('should allow non-financial configuration', async () => {
      const response = await request(app)
        .put('/api/ops/system-config/feature_flag_qr')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .send({ value: true, reason: 'Enable QR payments' });
      
      expect(response.status).toBe(200);
    });
  });
  
  describe('Audit Logging', () => {
    it('should log all ops console actions', async () => {
      await request(app)
        .put('/api/ops/merchants/test-id/activate')
        .set('x-user-role', 'PLATFORM_ADMIN')
        .set('x-user-id', 'test-admin-id');
      
      const auditLogs = await auditTrailService.queryAuditTrail({
        userId: 'test-admin-id',
        resource: 'OPS_CONSOLE'
      });
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0]).toHaveProperty('action');
      expect(auditLogs[0]).toHaveProperty('ipAddress');
    });
  });
});
```

---

## 📝 Inline Comments for Finance Isolation

All critical areas must have inline comments explaining why finance access is blocked:

```javascript
// CRITICAL: Ops Console must NOT have financial authority
// This middleware blocks access to ledger, settlements, and accounting periods
// to maintain strict separation between operational and financial controls.
// An auditor must conclude: "Operations cannot influence money movement."

// FORBIDDEN: Settlement confirmation
// Ops Console users cannot confirm settlements as this would give them
// financial authority. Only FINANCE_ADMIN can confirm money movement.

// NOTE: Merchant suspension affects operational access only
// Suspending a merchant does NOT alter financial data, ledger entries,
// or scheduled settlements. It only affects: Checkout, API access, Webhooks.

// RULE: Finance roles cannot be assigned via Ops Console
// FINANCE_ADMIN role assignment is blocked to prevent authority confusion
// and ensure finance teams are managed through secure, separate channels.

// SECURITY: Self-role escalation prevention
// Users cannot modify their own roles to prevent privilege escalation attacks.
// Role changes require a different administrator to approve.
```

---

## ✅ Implementation Checklist

- [ ] Database migration with new tables (platform_users, system_config, config_history, approval_requests)
- [ ] Ops Console middleware (requireOpsConsoleAccess, blockFinanceOperations, logOpsAction)
- [ ] Merchant Management routes and UI
- [ ] Transaction Monitoring routes (READ-ONLY) and UI
- [ ] Gateway Health Dashboard routes and UI
- [ ] Rate Limit Management routes and UI
- [ ] IP Whitelist Management routes and UI
- [ ] User Access Management routes (full system) and UI
- [ ] System Configuration routes and UI
- [ ] Audit Log viewer routes and UI
- [ ] Frontend UI (ops-console.html) with all modules
- [ ] Comprehensive test suite with role boundary tests
- [ ] Security validation tests (finance isolation)
- [ ] Inline comments explaining finance blocking
- [ ] Documentation (API docs, user guide)

---

## 🎯 Success Validation

Before marking implementation complete, validate:

1. ✅ PLATFORM_ADMIN can access all Ops Console features
2. ✅ OPS_ADMIN can access all Ops Console features
3. ✅ FINANCE_ADMIN **cannot** access Ops Console without explicit permission
4. ✅ Ops Console **cannot** access finance routes (ledger, settlements, accounting periods)
5. ✅ All forbidden endpoints return 403 with security logging
6. ✅ Merchant suspension does not affect financial data
7. ✅ Transaction monitoring is strictly read-only
8. ✅ All ops actions are logged with Who/When/What/Why
9. ✅ Self-role escalation is blocked
10. ✅ Finance role assignment is blocked in Ops Console

---

## 📌 Final Notes

**The Platform Ops Console is designed to:**
- ✅ Support platform operations and stability
- ✅ Manage access and configuration
- ✅ Provide operational visibility
- ❌ **NEVER** touch money or financial authority

**An auditor should conclude:**
> "Operations cannot influence money movement."

This implementation plan ensures clear separation between operational control and financial authority, maintaining compliance and preventing authority confusion.
