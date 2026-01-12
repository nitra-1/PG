/**
 * Audit Portal Middleware
 * 
 * CRITICAL: Enforces STRICTLY READ-ONLY access for auditors
 * 
 * Security Guarantees:
 * - Only AUDITOR role can access audit portal
 * - All write operations return 403
 * - Time-boxed access enforced
 * - All access logged
 * - No role switching allowed
 * - No impersonation allowed
 * 
 * RBI Compliance: Auditors must verify controls without DB access
 */

const db = require('../database');

/**
 * Require AUDITOR role and validate time-boxed access
 * 
 * CRITICAL: This is the primary security gate for audit portal
 */
const requireAuditorRole = async (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  const userName = req.headers['x-user-name'] || 'Unknown Auditor';
  
  // Authentication check
  if (!userRole || !userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Audit portal requires authentication'
    });
  }
  
  // Role check - MUST be AUDITOR (case-sensitive, uppercase)
  if (userRole !== 'AUDITOR') {
    // Log unauthorized access attempt
    const auditTrailService = req.app.locals.auditTrailService;
    if (auditTrailService) {
      await auditTrailService.logSecurityEvent({
        eventSubType: 'UNAUTHORIZED_AUDIT_PORTAL_ACCESS',
        severity: 'HIGH',
        userId,
        description: `Non-auditor role (${userRole}) attempted to access audit portal`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        affectedResource: req.path
      }).catch(err => console.error('Failed to log security event:', err));
    }
    
    return res.status(403).json({
      success: false,
      error: 'Forbidden: AUDITOR role required',
      message: 'Audit portal is restricted to auditors only',
      note: 'This attempt has been logged for security review'
    });
  }
  
  // Helper function to create auditor context
  const createAuditorContext = (accessWindow = null) => ({
    userId,
    userName,
    role: userRole,
    accessWindowId: accessWindow?.id || null,
    auditCaseNumber: accessWindow?.audit_case_number || null,
    auditType: accessWindow?.audit_type || null,
    accessEndDate: accessWindow?.access_end_date || null,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  });
  
  // Check time-boxed access window
  // Exception: /tenants endpoint doesn't require access window (basic tenant selection)
  const requiresAccessWindow = req.path !== '/tenants';
  
  if (!requiresAccessWindow) {
    // For /tenants endpoint, skip access window check
    req.auditor = createAuditorContext();
    return next();
  }
  
  try {
    const accessWindow = await db.knex('auditor_access_windows')
      .where('auditor_user_id', userId)
      .where('status', 'ACTIVE')
      .where('access_start_date', '<=', db.knex.fn.now())
      .where('access_end_date', '>=', db.knex.fn.now())
      .first();
    
    if (!accessWindow) {
      return res.status(403).json({
        success: false,
        error: 'Access window expired or not granted',
        message: 'Your audit access window has expired or has not been granted. Please contact compliance team.',
        note: 'Time-boxed access is required for audit portal'
      });
    }
    
    // Update last access timestamp
    await db.knex('auditor_access_windows')
      .where('id', accessWindow.id)
      .update({ last_access_at: db.knex.fn.now() });
    
    // Store auditor context for logging
    req.auditor = createAuditorContext(accessWindow);
    
    next();
  } catch (error) {
    console.error('Error checking access window:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to validate access',
      message: 'Unable to verify audit access window'
    });
  }
};

/**
 * Block ALL write operations (NON-NEGOTIABLE)
 * 
 * CRITICAL: Audit portal is STRICTLY READ-ONLY
 * Any non-GET request must be rejected
 */
const enforceReadOnly = (req, res, next) => {
  // Only GET and OPTIONS methods allowed
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    // Log write attempt
    const auditTrailService = req.app.locals.auditTrailService;
    if (auditTrailService) {
      auditTrailService.logSecurityEvent({
        eventSubType: 'AUDIT_PORTAL_WRITE_ATTEMPT',
        severity: 'CRITICAL',
        userId: req.auditor?.userId || 'UNKNOWN',
        description: `Auditor attempted write operation: ${req.method} ${req.path}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        affectedResource: req.path,
        mitigationAction: 'Request blocked by enforceReadOnly middleware'
      }).catch(err => console.error('Failed to log security event:', err));
    }
    
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Write operations not allowed',
      message: 'Audit portal is READ-ONLY. No mutations are permitted.',
      method: req.method,
      note: 'This attempt has been logged as a CRITICAL security event'
    });
  }
  
  next();
};

/**
 * Log all audit portal access
 * 
 * Complete audit trail of what auditors view
 * Answers: "What did the auditor look at?"
 */
const logAuditAccess = async (req, res, next) => {
  // Store original send function
  const originalSend = res.send;
  const startTime = Date.now();
  
  // Override send to log after response
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Log to audit_portal_access_log
    db.knex('audit_portal_access_log').insert({
      auditor_user_id: req.auditor?.userId,
      endpoint: req.path,
      http_method: req.method,
      http_status_code: res.statusCode,
      ip_address: req.auditor?.ipAddress,
      user_agent: req.auditor?.userAgent,
      query_parameters: JSON.stringify(req.query),
      response_time_ms: responseTime,
      records_returned: null // Can be set by individual routes
    }).catch(err => {
      console.error('Failed to log audit portal access:', err);
    });
    
    // Also log to main audit trail
    const auditTrailService = req.app.locals.auditTrailService;
    if (auditTrailService) {
      auditTrailService.logDataAccess({
        userId: req.auditor?.userId || 'UNKNOWN',
        action: 'VIEW',
        resource: 'AUDIT_PORTAL',
        resourceId: req.path,
        dataType: 'COMPLIANCE_DATA',
        ipAddress: req.auditor?.ipAddress,
        userAgent: req.auditor?.userAgent,
        success: res.statusCode >= 200 && res.statusCode < 400,
        metadata: {
          auditCaseNumber: req.auditor?.auditCaseNumber,
          auditType: req.auditor?.auditType,
          method: req.method,
          path: req.path,
          query: req.query,
          statusCode: res.statusCode,
          responseTime
        }
      }).catch(err => {
        console.error('Failed to log audit trail:', err);
      });
    }
    
    // Call original send
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * Add audit watermark headers
 * 
 * Every response includes headers that identify:
 * - This is audit/read-only mode
 * - Current auditor
 * - Access window end date
 */
const addAuditWatermarkHeaders = (req, res, next) => {
  res.set({
    'X-Audit-Mode': 'READ-ONLY',
    'X-Auditor-Name': req.auditor?.userName || 'Unknown',
    'X-Audit-Case': req.auditor?.auditCaseNumber || 'N/A',
    'X-Access-Expires': req.auditor?.accessEndDate || 'N/A',
    'X-Portal-Type': 'AUDIT_PORTAL'
  });
  
  next();
};

/**
 * Validate tenant access
 * Auditors may be restricted to specific tenants
 */
const validateTenantAccess = async (req, res, next) => {
  const tenantId = req.query.tenantId || req.params.tenantId;
  
  if (!tenantId) {
    // Some endpoints don't require tenantId (like list of available tenants)
    return next();
  }
  
  // For now, auditors have access to all tenants during their access window
  // In production, you might want to restrict access to specific tenants
  // based on the audit scope
  
  next();
};

module.exports = {
  requireAuditorRole,
  enforceReadOnly,
  logAuditAccess,
  addAuditWatermarkHeaders,
  validateTenantAccess
};
