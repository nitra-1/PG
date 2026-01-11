# Platform Ops Console - Gap Analysis & Implementation Plan

## 🎯 Document Purpose

This document provides a comprehensive gap analysis of the Platform Ops Console (formerly Platform Admin Console), an internal operational UI for platform administrators. This console is designed to manage platform operations while maintaining **strict isolation from financial authority**.

**Critical Rule**: This console must NEVER have financial authority and must NOT overlap with Finance Admin capabilities.

---

## 📊 Current State Analysis

### Existing Infrastructure

Based on comprehensive repository analysis, the following components exist:

#### ✅ **Merchant Dashboard** (Implemented)
- **Location**: `public/merchant-dashboard.html`, `src/merchant/merchant-dashboard-routes.js`
- **Purpose**: Merchant-facing UI for transaction management, refunds, settlements (read-only), disputes
- **Role**: `MERCHANT`
- **Features**:
  - Transaction listing with filters
  - Refund initiation and tracking
  - Settlement visibility (read-only)
  - Dispute management (read-only in Phase 1)
  - Daily operations view
  - Downloadable statements (CSV/JSON)
  - API key management
  - Webhook configuration
  - Rate limit configuration
  - IP whitelist management

#### ✅ **Finance Admin Infrastructure** (Implemented)
- **Location**: `src/api/ledger-routes.js`, `src/api/settlement-routes.js`, `src/api/accounting-period-routes.js`
- **Purpose**: Finance team controls for ledger, settlements, and accounting periods
- **Role**: `FINANCE_ADMIN`
- **Features**:
  - Ledger entry management
  - Settlement state machine control
  - Accounting period locking
  - Financial reconciliation
  - Money finality controls

#### ✅ **Core Services** (Implemented)
- **Merchant Service**: `src/merchant/merchant-service.js`
  - Merchant registration
  - API key generation/revocation
  - Rate limit configuration
  - IP whitelist management
  - Usage statistics tracking
- **Audit Trail Service**: `src/security/audit-trail-service.js`
  - Comprehensive audit logging
  - Security event tracking
  - Authentication logging
  - Configuration change logging
- **Gateway Health Tracker**: `src/core/routing/gateway-health-tracker.js`
  - Gateway availability monitoring
  - Success/failure rate tracking
- **Circuit Breaker**: `src/core/circuit-breaker/circuit-breaker.js`
  - Gateway failure detection
  - Automatic circuit breaking
- **Smart Router**: `src/core/routing/smart-router.js`
  - Health-based routing
  - Cost optimization
  - Gateway selection

#### ✅ **Database Schema** (Implemented)
- **merchants** table with status, limits, configuration
- **merchant_api_keys** table
- **merchant_rate_limits** table
- **merchant_ip_whitelist** table
- **merchant_webhooks** table
- **merchant_usage_stats** table
- **transactions** table
- **settlements** table
- **refunds** table
- **disputes** table
- **audit_trail** table
- **ledger_entries** table (finance-only)
- **accounting_periods** table (finance-only)

---

## 🔍 Gap Analysis Summary

### 1️⃣ Merchant Management (MANDATORY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| Create merchant | ✅ **Implemented** | `MerchantService.registerMerchant()` | Backend exists, needs Ops Console UI |
| Activate merchant | ⚠️ **Partial** | `MerchantService.updateMerchant()` | Can update status, needs dedicated UI |
| Suspend merchant | ⚠️ **Partial** | `MerchantService.updateMerchant()` | Can update status, needs suspension UI with rules |
| View merchant status | ✅ **Implemented** | `MerchantService.getMerchant()` | Backend exists, needs Ops Console UI |
| View merchant config | ✅ **Implemented** | `MerchantService.getMerchant()` | Returns full config including API keys, webhooks, rate limits |

**Implementation Needed**:
- ❌ Platform Ops Console UI for merchant management
- ❌ Merchant suspension workflow with validation (ensure no financial data impact)
- ❌ Merchant activation/deactivation with audit logging
- ❌ Merchant listing with search and filters
- ✅ Backend API endpoints exist (need Ops Console-specific routes)

---

### 2️⃣ Transaction Monitoring (READ-ONLY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| View transaction flow | ✅ **Implemented** | Merchant dashboard routes exist | Need Ops Console access (cross-merchant) |
| Filter by merchant | ⚠️ **Partial** | Currently scoped to single merchant | Need multi-merchant view |
| Filter by gateway | ⚠️ **Partial** | Database has gateway field | Need UI with gateway filter |
| Filter by status | ✅ **Implemented** | Merchant dashboard has status filter | Need Ops Console view |
| Filter by time range | ✅ **Implemented** | Merchant dashboard has date filters | Need Ops Console view |
| View transaction metadata | ✅ **Implemented** | Transaction detail endpoint exists | Need Ops Console access |

**Implementation Needed**:
- ❌ Ops Console transaction monitoring UI (READ-ONLY)
- ❌ Cross-merchant transaction view (with merchant filter)
- ❌ Gateway filter option
- ❌ Ops Console routes with PLATFORM_ADMIN role check
- ✅ Backend transaction queries exist

**Forbidden** (✅ Correctly NOT Implemented):
- 🚫 Transaction edits
- 🚫 Refund initiation (merchant-only capability)
- 🚫 Settlement actions
- 🚫 Ledger drill-down

---

### 3️⃣ Gateway Health Dashboard (MANDATORY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| View gateway availability | ✅ **Implemented** | `GatewayHealthTracker` | Backend tracking exists, needs UI |
| Success/failure rates | ✅ **Implemented** | `GatewayHealthTracker.calculateSuccessRate()` | Backend exists, needs UI |
| Latency metrics | ⚠️ **Partial** | `GatewayHealthTracker` tracks response times | Needs metric aggregation |
| Circuit breaker state | ✅ **Implemented** | `CircuitBreaker.getStatus()` | Backend exists, needs UI dashboard |
| Last failure timestamp | ✅ **Implemented** | `GatewayHealthTracker` tracks failures | Backend exists, needs UI |
| Manual routing override | ❌ **Missing** | Not implemented | Need with approval logging |

**Implementation Needed**:
- ❌ Gateway Health Dashboard UI
- ❌ Real-time or near-real-time health metrics display
- ❌ Circuit breaker status visualization
- ❌ Gateway comparison view
- ❌ Manual routing override feature (with approval workflow)
- ❌ API endpoint to expose gateway health to Ops Console
- ✅ Backend health tracking fully functional

---

### 4️⃣ Rate Limit Management (MANDATORY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| View rate limits per merchant | ✅ **Implemented** | `MerchantService.getMerchant()` includes rate limits | Backend exists, needs Ops Console UI |
| Modify rate limits | ✅ **Implemented** | `MerchantService.configureRateLimit()` | Backend exists, needs Ops Console UI |
| Enable/disable throttling | ⚠️ **Partial** | Rate limits have status field | Need enable/disable UI and audit |
| Audit all changes | ⚠️ **Partial** | Audit logging exists | Need to ensure all rate limit changes logged |

**Implementation Needed**:
- ❌ Ops Console UI for rate limit management
- ❌ Merchant search and select for rate limit editing
- ❌ Bulk rate limit updates (with audit trail)
- ❌ Rate limit defaults visibility
- ⚠️ Enhanced audit logging for rate limit changes
- ✅ Backend rate limit CRUD operations exist

---

### 5️⃣ IP Whitelist Management (MANDATORY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| Add IP address/CIDR | ✅ **Implemented** | `MerchantService.addIPToWhitelist()` | Backend exists, needs Ops Console UI |
| Remove IP | ✅ **Implemented** | `MerchantService.removeIPFromWhitelist()` | Backend exists, needs Ops Console UI |
| View whitelist history | ⚠️ **Partial** | Current IPs visible, no history table | Need audit trail view |
| Enable/disable per merchant | ⚠️ **Partial** | IPs have status field | Need enable/disable UI |
| Changes logged (Who/When/Why) | ⚠️ **Partial** | Audit logging exists | Need enhanced logging with "Why" field |

**Implementation Needed**:
- ❌ Ops Console UI for IP whitelist management
- ❌ IP whitelist history view (from audit logs)
- ❌ Enable/disable IP whitelist UI
- ❌ "Reason" field for IP whitelist changes
- ⚠️ Enhanced audit logging with "Why" reasoning
- ✅ Backend IP whitelist CRUD operations exist

---

### 6️⃣ User Access Management (MANDATORY)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| Create platform users | ❌ **Missing** | No user management system | Need full implementation |
| Assign roles | ❌ **Missing** | No role assignment system | Need full implementation |
| Disable users | ❌ **Missing** | No user management system | Need full implementation |
| View access history | ⚠️ **Partial** | Audit trail tracks user actions | Need user-centric view |
| No self-role escalation | ❌ **Missing** | No role system exists | Need with validation |
| Finance roles blocked | ❌ **Missing** | No role system exists | Need explicit blocking |
| Dual confirmation for sensitive roles | ❌ **Missing** | No approval workflow | Need approval system |

**Implementation Needed**:
- ❌ **FULL USER MANAGEMENT SYSTEM**
  - User table/model
  - User authentication
  - Role assignment (PLATFORM_ADMIN, OPS_ADMIN, MERCHANT, etc.)
  - User creation/disable UI
  - User listing with filters
  - Access history per user
  - Self-role escalation prevention
  - Finance role blocking in Ops Console
  - Dual approval workflow for sensitive roles
- This is the **largest gap** and requires significant implementation

---

### 7️⃣ System Configuration (LIMITED)

| Capability | Status | Location | Notes |
|------------|--------|----------|-------|
| View system flags | ❌ **Missing** | No system configuration table | Need implementation |
| Modify non-financial configs | ❌ **Missing** | No config management UI | Need implementation |
| Feature toggles | ❌ **Missing** | No feature flag system | Need implementation |
| Timeout settings | ⚠️ **Partial** | Hardcoded in code | Need config table |
| Non-monetary thresholds | ⚠️ **Partial** | Some in merchant limits | Need config system |
| Changes auditable | ⚠️ **Partial** | Audit service exists | Need config change tracking |
| Rollback support | ❌ **Missing** | No config versioning | Need implementation |

**Implementation Needed**:
- ❌ **System Configuration Management**
  - System config table (key-value store)
  - Config categories (financial vs non-financial)
  - Feature flag system
  - Config change UI
  - Config change history
  - Config rollback mechanism
  - Financial config blocking (explicit)
- This is a **significant gap** requiring full feature implementation

---

## 🚫 Forbidden Features - Compliance Check

The following features are **correctly NOT implemented** and must remain blocked:

| Forbidden Feature | Status | Notes |
|-------------------|--------|-------|
| 🚫 Accounting period management | ✅ **Correctly Blocked** | `FINANCE_ADMIN` role required in `accounting-period-routes.js` |
| 🚫 Ledger access/explorer | ✅ **Correctly Blocked** | `FINANCE_ADMIN` role required in `ledger-routes.js` |
| 🚫 Settlement confirmation | ✅ **Correctly Blocked** | Settlement routes require `FINANCE_ADMIN` or `FINANCE` role |
| 🚫 Override approval | ✅ **Correctly Blocked** | Not implemented anywhere |
| 🚫 Reconciliation | ✅ **Correctly Blocked** | Finance-only feature |
| 🚫 Financial report generation | ✅ **Correctly Blocked** | Finance-only feature |

**Compliance**: ✅ The platform correctly isolates financial operations from operational controls.

---

## 📋 Summary: What Needs to be Built

### High Priority (MANDATORY)

1. **Platform Ops Console UI** (HTML/JavaScript)
   - Navigation structure
   - Role-based authentication (PLATFORM_ADMIN/OPS_ADMIN)
   - Dashboard/home view

2. **Merchant Management Module**
   - Merchant listing UI
   - Merchant search/filter
   - Merchant activation/suspension UI
   - Merchant detail view

3. **Gateway Health Dashboard Module**
   - Real-time health metrics display
   - Circuit breaker status visualization
   - Gateway comparison view
   - Manual routing override (with approval)

4. **Transaction Monitoring Module** (READ-ONLY)
   - Cross-merchant transaction view
   - Multi-filter support (merchant, gateway, status, time)
   - Transaction detail drill-down (no edit)

5. **Rate Limit Management Module**
   - Rate limit listing per merchant
   - Rate limit edit UI
   - Bulk updates with audit

6. **IP Whitelist Management Module**
   - IP whitelist UI per merchant
   - IP history view
   - Add/remove with reason field

### Medium Priority (Required but can be phased)

7. **User Access Management Module** (FULL SYSTEM)
   - User table and authentication
   - Role assignment system
   - User creation/disable UI
   - Access history view
   - Role escalation prevention
   - Dual approval workflow

8. **System Configuration Module**
   - Config key-value store
   - Feature flag system
   - Config change UI
   - Config history and rollback

### Low Priority (Enhancement)

9. **Audit Log Viewer**
   - Dedicated audit log UI in Ops Console
   - Advanced filtering
   - Export capabilities

10. **Alert/Notification System**
    - Gateway health alerts
    - Suspicious activity alerts
    - System configuration change alerts

---

## 🏗️ Architecture Design

### New Components

```
/src/ops-console/
  ├── ops-console-routes.js          # Main API routes for Ops Console
  ├── ops-console-middleware.js      # Auth middleware (PLATFORM_ADMIN/OPS_ADMIN)
  ├── merchant-management-routes.js  # Merchant CRUD for ops
  ├── transaction-monitoring-routes.js # Cross-merchant transaction view
  ├── gateway-health-routes.js       # Gateway health API for UI
  ├── user-management-routes.js      # User/role management (NEW)
  ├── system-config-routes.js        # System configuration (NEW)
  └── audit-log-routes.js            # Audit log viewer API

/src/database/migrations/
  └── 20240107000000_ops_console_infrastructure.js
      # New tables:
      # - platform_users (id, username, email, role, status, created_at, etc.)
      # - system_config (key, value, category, is_financial, version, updated_at, updated_by)
      # - config_history (id, config_key, old_value, new_value, changed_by, changed_at)
      # - approval_requests (id, request_type, requestor, status, approver, metadata)

/public/
  └── ops-console.html               # Platform Ops Console UI (NEW)
```

### API Route Structure

```
/api/ops/                             # New Ops Console namespace
  ├── /merchants                      # Merchant management
  │   ├── GET /                       # List all merchants
  │   ├── POST /                      # Create merchant
  │   ├── GET /:id                    # Get merchant details
  │   ├── PUT /:id/activate           # Activate merchant
  │   ├── PUT /:id/suspend            # Suspend merchant (no financial impact)
  │   └── GET /:id/config             # View merchant config
  │
  ├── /transactions                   # Transaction monitoring (READ-ONLY)
  │   ├── GET /                       # List all transactions (cross-merchant)
  │   ├── GET /:id                    # Get transaction details
  │   └── No POST/PUT/DELETE          # Strictly read-only
  │
  ├── /gateway-health                 # Gateway health dashboard
  │   ├── GET /status                 # All gateway statuses
  │   ├── GET /:gateway/metrics       # Specific gateway metrics
  │   ├── POST /:gateway/override     # Manual routing override (logged)
  │   └── GET /circuit-breakers       # Circuit breaker states
  │
  ├── /rate-limits                    # Rate limit management
  │   ├── GET /                       # List all rate limits
  │   ├── GET /merchant/:id           # Rate limits for merchant
  │   ├── POST /merchant/:id          # Add rate limit
  │   ├── PUT /:id                    # Update rate limit
  │   └── DELETE /:id                 # Remove rate limit
  │
  ├── /ip-whitelist                   # IP whitelist management
  │   ├── GET /                       # List all IP whitelists
  │   ├── GET /merchant/:id           # IPs for merchant
  │   ├── POST /merchant/:id          # Add IP (with reason)
  │   ├── DELETE /:id                 # Remove IP (with reason)
  │   └── GET /history/:id            # IP whitelist history
  │
  ├── /users                          # User access management (NEW)
  │   ├── GET /                       # List users
  │   ├── POST /                      # Create user
  │   ├── PUT /:id/disable            # Disable user
  │   ├── PUT /:id/role               # Assign role (with validation)
  │   └── GET /:id/access-history     # User access history
  │
  ├── /system-config                  # System configuration (NEW)
  │   ├── GET /                       # List configs (non-financial only)
  │   ├── PUT /:key                   # Update config
  │   ├── GET /:key/history           # Config change history
  │   └── POST /:key/rollback         # Rollback config
  │
  └── /audit-logs                     # Audit log viewer
      ├── GET /                       # Query audit logs
      └── GET /export                 # Export audit logs
```

---

## 🔒 Security & Access Control

### Role Hierarchy

```
Platform Roles:
1. FINANCE_ADMIN      → Full financial authority (ledger, settlements, accounting)
2. PLATFORM_ADMIN     → Full platform operations (NOT finance)
3. OPS_ADMIN          → Platform operations (subset of PLATFORM_ADMIN)
4. MERCHANT           → Merchant dashboard access only
5. CUSTOMER           → Customer-facing checkout only
```

### Ops Console Access Rules

```javascript
// Middleware: ops-console-middleware.js
const requireOpsConsoleAccess = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  
  // Only PLATFORM_ADMIN and OPS_ADMIN can access Ops Console
  if (!userRole || !['PLATFORM_ADMIN', 'OPS_ADMIN'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: PLATFORM_ADMIN or OPS_ADMIN role required',
      message: 'This is an operational admin console. Finance operations are managed separately.'
    });
  }
  
  // Explicitly block access to finance routes
  if (req.path.includes('/ledger') || 
      req.path.includes('/settlement') || 
      req.path.includes('/accounting-period')) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Finance operations not allowed in Ops Console',
      message: 'Financial operations require FINANCE_ADMIN role and separate console.'
    });
  }
  
  next();
};
```

### Finance Isolation Enforcement

```javascript
// Block finance operations in Ops Console routes
const blockFinanceOperations = (req, res, next) => {
  // List of forbidden operations
  const forbiddenOperations = [
    'settlement', 'ledger', 'accounting-period', 
    'reconciliation', 'financial-report', 'money-movement'
  ];
  
  const isForbidden = forbiddenOperations.some(op => 
    req.path.toLowerCase().includes(op)
  );
  
  if (isForbidden) {
    // Log as security event
    auditTrailService.logSecurityEvent({
      eventSubType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      severity: 'HIGH',
      userId: req.headers['x-user-id'],
      description: `Attempted access to forbidden finance operation: ${req.path}`,
      ipAddress: req.ip,
      affectedResource: req.path
    });
    
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Finance operations not allowed',
      message: 'Operations cannot influence money movement. Contact Finance Admin.'
    });
  }
  
  next();
};
```

---

## 🧪 Testing Requirements

### Role Boundary Validation

```javascript
// Test: Ops Console cannot access finance routes
describe('Ops Console - Finance Isolation', () => {
  it('should block PLATFORM_ADMIN from accessing ledger', async () => {
    const response = await request(app)
      .get('/api/ledger/entries')
      .set('x-user-role', 'PLATFORM_ADMIN');
    
    expect(response.status).toBe(403);
    expect(response.body.error).toContain('FINANCE_ADMIN role required');
  });
  
  it('should block OPS_ADMIN from settlement confirmation', async () => {
    const response = await request(app)
      .post('/api/settlements/confirm')
      .set('x-user-role', 'OPS_ADMIN')
      .send({ settlementId: 'test-id' });
    
    expect(response.status).toBe(403);
  });
  
  it('should allow PLATFORM_ADMIN to view gateway health', async () => {
    const response = await request(app)
      .get('/api/ops/gateway-health/status')
      .set('x-user-role', 'PLATFORM_ADMIN');
    
    expect(response.status).toBe(200);
  });
});
```

### Audit Log Verification

```javascript
// Test: All ops actions are audited
describe('Ops Console - Audit Logging', () => {
  it('should log merchant suspension', async () => {
    await request(app)
      .put('/api/ops/merchants/test-id/suspend')
      .set('x-user-role', 'PLATFORM_ADMIN')
      .send({ reason: 'Compliance review' });
    
    const auditLogs = await auditTrailService.queryAuditTrail({
      eventType: 'MERCHANT_SUSPENSION',
      resourceId: 'test-id'
    });
    
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].metadata.reason).toBe('Compliance review');
  });
});
```

---

## 📦 Deliverables Checklist

- [ ] **Gap Analysis Document** (this document) in `/features/PLATFORM_OPS_CONSOLE_GAP_ANALYSIS.md`
- [ ] **Database Migration**: `20240107000000_ops_console_infrastructure.js`
- [ ] **Backend Routes**: `/src/ops-console/*` modules
- [ ] **Middleware**: `ops-console-middleware.js` with role checks
- [ ] **UI**: `public/ops-console.html` with all modules
- [ ] **Audit Logging**: Enhanced logging for all ops actions
- [ ] **Finance Isolation**: Explicit blocking with inline comments
- [ ] **Testing**: Role boundary tests, audit verification
- [ ] **Documentation**: API documentation, user guide

---

## ✅ Success Criteria

An auditor should conclude:

> **"Operations cannot influence money movement."**

### Specific Success Criteria:

1. ✅ All operational controls (merchant, gateway, rate limits, IP whitelist) accessible via Ops Console
2. ✅ Zero financial authority in Ops Console (no ledger, settlement, or accounting access)
3. ✅ All ops actions logged with Who/When/What/Why
4. ✅ PLATFORM_ADMIN and OPS_ADMIN roles cannot access FINANCE_ADMIN routes
5. ✅ Attempted access to forbidden finance routes is blocked and logged as security event
6. ✅ Merchant suspension does NOT alter financial data (only operational access)
7. ✅ Transaction monitoring is strictly read-only (no edit/refund capabilities)
8. ✅ Gateway health dashboard provides visibility without direct transaction manipulation
9. ✅ Clear separation: Ops Console ≠ Finance Console

---

## 🚀 Implementation Priority

### Phase 1 (Week 1): Foundation
- Database migration (users, system config tables)
- Ops Console middleware and authentication
- Basic UI shell

### Phase 2 (Week 2): Core Modules
- Merchant Management UI + API
- Gateway Health Dashboard UI + API
- Transaction Monitoring (read-only) UI + API

### Phase 3 (Week 3): Configuration
- Rate Limit Management UI + API
- IP Whitelist Management UI + API

### Phase 4 (Week 4): User Management
- User Management System (full implementation)
- Role assignment and validation
- Access history viewer

### Phase 5 (Week 5): System Configuration
- System Config Management
- Feature flags
- Config history and rollback

### Phase 6 (Week 6): Testing & Documentation
- Comprehensive testing
- Security validation
- Audit log verification
- Documentation finalization

---

## 📌 Final Notes

**If unsure whether a feature belongs in Ops Console, exclude it and flag for review.**

**Finance Operations List (FORBIDDEN in Ops Console)**:
- Accounting period management
- Ledger access or explorer
- Settlement confirmation
- Override approval
- Reconciliation
- Financial report generation

**Operational vs Financial Boundary**:
- **Operational**: Platform stability, access control, configuration, monitoring
- **Financial**: Money movement, ledger entries, settlement timing, accounting periods

This gap analysis serves as the foundation for implementing the Platform Ops Console with clear boundaries and compliance with the "no financial authority" rule.
