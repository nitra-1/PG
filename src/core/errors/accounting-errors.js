/**
 * Accounting Error Classes
 * 
 * Specialized error classes for RBI-compliant accounting and audit controls
 * These provide explicit, audit-friendly error messages for period locks,
 * settlement state violations, and ledger lock enforcement
 */

/**
 * Base Accounting Error
 * All accounting errors extend this for consistent handling
 */
class AccountingError extends Error {
  constructor(message, code, metadata = {}) {
    super(message);
    this.name = 'AccountingError';
    this.code = code;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
    this.retryable = false; // Accounting errors are typically not retryable
    Error.captureStackTrace(this, this.constructor);
  }

  toResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp,
        metadata: this.metadata,
        retryable: this.retryable
      }
    };
  }
}

/**
 * Period Closed Error
 * Thrown when attempting to post to a closed accounting period
 */
class PeriodClosedError extends AccountingError {
  constructor(periodType, periodStart, periodEnd, status, requiredAction) {
    const message = `Cannot post to ${status} accounting period. ` +
      `Period: ${periodType} (${periodStart} to ${periodEnd}). ` +
      `Required action: ${requiredAction}`;
    
    super(message, 'PERIOD_CLOSED', {
      periodType,
      periodStart,
      periodEnd,
      status,
      requiredAction
    });
    
    this.name = 'PeriodClosedError';
  }
}

/**
 * Period Not Found Error
 * Thrown when no open period exists for a transaction date
 */
class PeriodNotFoundError extends AccountingError {
  constructor(transactionDate, periodType = 'DAILY') {
    const message = `No open ${periodType} accounting period found for date: ${transactionDate}. ` +
      `Required action: Create or open an accounting period for this date.`;
    
    super(message, 'PERIOD_NOT_FOUND', {
      transactionDate,
      periodType,
      requiredAction: 'CREATE_PERIOD'
    });
    
    this.name = 'PeriodNotFoundError';
  }
}

/**
 * Period Overlap Error
 * Thrown when attempting to create overlapping periods
 */
class PeriodOverlapError extends AccountingError {
  constructor(newPeriodStart, newPeriodEnd, conflictingPeriod) {
    const message = `Cannot create accounting period (${newPeriodStart} to ${newPeriodEnd}). ` +
      `Overlaps with existing period: ${conflictingPeriod.id}`;
    
    super(message, 'PERIOD_OVERLAP', {
      newPeriodStart,
      newPeriodEnd,
      conflictingPeriod
    });
    
    this.name = 'PeriodOverlapError';
  }
}

/**
 * Period Gap Error
 * Thrown when periods are not contiguous
 */
class PeriodGapError extends AccountingError {
  constructor(lastPeriodEnd, newPeriodStart, periodType) {
    const message = `Cannot create non-contiguous ${periodType} period. ` +
      `Gap detected between ${lastPeriodEnd} and ${newPeriodStart}. ` +
      `Required action: Ensure periods are consecutive without gaps.`;
    
    super(message, 'PERIOD_GAP', {
      lastPeriodEnd,
      newPeriodStart,
      periodType
    });
    
    this.name = 'PeriodGapError';
  }
}

/**
 * Ledger Locked Error
 * Thrown when attempting to post to a locked ledger
 */
class LedgerLockedError extends AccountingError {
  constructor(lockType, lockedBy, lockedAt, reason) {
    const message = `Ledger is locked (${lockType}). ` +
      `Locked by: ${lockedBy} at ${lockedAt}. ` +
      `Reason: ${reason}. ` +
      `Required action: Wait for lock release or contact administrator.`;
    
    super(message, 'LEDGER_LOCKED', {
      lockType,
      lockedBy,
      lockedAt,
      reason
    });
    
    this.name = 'LedgerLockedError';
  }
}

/**
 * Settlement State Error
 * Thrown when attempting invalid settlement state transitions
 */
class SettlementStateError extends AccountingError {
  constructor(currentState, attemptedState, settlementId) {
    const message = `Invalid settlement state transition from ${currentState} to ${attemptedState} ` +
      `for settlement: ${settlementId}. ` +
      `Required action: Follow valid state machine transitions.`;
    
    super(message, 'INVALID_SETTLEMENT_STATE', {
      currentState,
      attemptedState,
      settlementId,
      validTransitions: getValidTransitions(currentState)
    });
    
    this.name = 'SettlementStateError';
  }
}

/**
 * Settlement Retry Exhausted Error
 * Thrown when settlement retry limit is reached
 */
class SettlementRetryExhaustedError extends AccountingError {
  constructor(settlementId, retryCount, maxRetries) {
    const message = `Settlement ${settlementId} has exhausted retry attempts ` +
      `(${retryCount}/${maxRetries}). ` +
      `Required action: Manual intervention required.`;
    
    super(message, 'SETTLEMENT_RETRY_EXHAUSTED', {
      settlementId,
      retryCount,
      maxRetries
    });
    
    this.name = 'SettlementRetryExhaustedError';
  }
}

/**
 * Admin Override Required Error
 * Thrown when operation requires admin override
 */
class AdminOverrideRequiredError extends AccountingError {
  constructor(operation, reason) {
    const message = `Operation '${operation}' requires FINANCE_ADMIN override. ` +
      `Reason: ${reason}. ` +
      `Required action: Provide override=true with justification and FINANCE_ADMIN role.`;
    
    super(message, 'ADMIN_OVERRIDE_REQUIRED', {
      operation,
      reason,
      requiredRole: 'FINANCE_ADMIN'
    });
    
    this.name = 'AdminOverrideRequiredError';
  }
}

/**
 * Insufficient Override Privileges Error
 * Thrown when user lacks required role for override
 */
class InsufficientOverridePrivilegesError extends AccountingError {
  constructor(userRole, requiredRole, operation) {
    const message = `User with role '${userRole}' cannot override operation '${operation}'. ` +
      `Required role: ${requiredRole}`;
    
    super(message, 'INSUFFICIENT_OVERRIDE_PRIVILEGES', {
      userRole,
      requiredRole,
      operation
    });
    
    this.name = 'InsufficientOverridePrivilegesError';
  }
}

/**
 * Helper function to get valid state transitions
 * @param {string} currentState - Current settlement state
 * @returns {Array<string>} Valid next states
 */
function getValidTransitions(currentState) {
  const transitions = {
    'CREATED': ['FUNDS_RESERVED', 'FAILED'],
    'FUNDS_RESERVED': ['SENT_TO_BANK', 'FAILED'],
    'SENT_TO_BANK': ['BANK_CONFIRMED', 'FAILED'],
    'BANK_CONFIRMED': ['SETTLED'],
    'SETTLED': [], // Terminal state
    'FAILED': ['RETRIED'],
    'RETRIED': ['FUNDS_RESERVED', 'FAILED'] // Retry goes back to FUNDS_RESERVED
  };
  
  return transitions[currentState] || [];
}

module.exports = {
  AccountingError,
  PeriodClosedError,
  PeriodNotFoundError,
  PeriodOverlapError,
  PeriodGapError,
  LedgerLockedError,
  SettlementStateError,
  SettlementRetryExhaustedError,
  AdminOverrideRequiredError,
  InsufficientOverridePrivilegesError,
  getValidTransitions
};
