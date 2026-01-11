/**
 * Platform Ops Console Middleware
 * Enforces PLATFORM_ADMIN/OPS_ADMIN access and blocks finance operations
 * 
 * CRITICAL: This console must NOT have financial authority
 * An auditor must conclude: "Operations cannot influence money movement."
 */

/**
 * Require PLATFORM_ADMIN or OPS_ADMIN role
 * 
 * NOTE: FINANCE_ADMIN is intentionally excluded to prevent financial authority overlap
 * This ensures clear separation between operational and financial controls
 */
const requireOpsConsoleAccess = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  // Only PLATFORM_ADMIN and OPS_ADMIN can access Ops Console
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
 * 
 * CRITICAL: List of forbidden financial operations
 * These operations require FINANCE_ADMIN role and separate console
 * 
 * FORBIDDEN OPERATIONS:
 * - settlement: Money movement operations
 * - ledger: Financial record access
 * - accounting-period: Period close/lock operations
 * - reconciliation: Financial reconciliation
 * - financial-report: Financial reporting
 * - money-movement: Any money transfer operations
 * - override-approval: Financial override approvals
 * - accounting: Accounting operations
 * - ledger-lock: Ledger locking operations
 */
const blockFinanceOperations = (req, res, next) => {
  // Use regex patterns for more robust matching that can't be bypassed with URL encoding
  const forbiddenPatterns = [
    /\/settlement/i,
    /\/ledger/i,
    /\/accounting-period/i,
    /\/reconciliation/i,
    /\/financial-report/i,
    /\/money-movement/i,
    /\/override-approval/i,
    /\/accounting/i,
    /\/ledger-lock/i
  ];
  
  // Normalize path by decoding and removing duplicate slashes
  const normalizedPath = decodeURIComponent(req.path).replace(/\/+/g, '/').toLowerCase();
  
  const isForbidden = forbiddenPatterns.some(pattern => 
    pattern.test(normalizedPath)
  );
  
  if (isForbidden) {
    // Get audit trail service from app locals
    const auditTrailService = req.app.locals.auditTrailService;
    
    // Log as HIGH severity security event
    if (auditTrailService) {
      auditTrailService.logSecurityEvent({
        eventSubType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        severity: 'HIGH',
        userId: req.opsUser?.userId || 'UNKNOWN',
        description: `Ops Console attempted to access forbidden finance operation: ${req.path}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        affectedResource: req.path,
        mitigationAction: 'Access blocked by blockFinanceOperations middleware'
      }).catch(err => {
        console.error('Failed to log security event:', err);
      });
    }
    
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
 * 
 * Every operation in the Ops Console is logged with:
 * - Who performed the action (userId, role)
 * - What action was performed (method, path)
 * - When it was performed (timestamp)
 * - Why it was performed (logged separately in specific operations)
 * - Whether it succeeded (status code)
 */
const logOpsAction = (action) => {
  return async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;
    
    // Override send to log after response
    res.send = function(data) {
      // Get audit trail service from app locals
      const auditTrailService = req.app.locals.auditTrailService;
      
      // Log the action
      if (auditTrailService) {
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
      }
      
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
