/**
 * Ledger Lock Service
 * 
 * Manages ledger locking for audit freeze and period immutability
 * 
 * Key Features:
 * - PERIOD_LOCK: Auto-applied when period is HARD_CLOSED
 * - AUDIT_LOCK: Manual lock during external audits
 * - RECONCILIATION_LOCK: Applied during reconciliation
 * - Complete audit trail for all lock operations
 * - Admin-only lock/unlock operations
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const { LedgerLockedError } = require('../errors/accounting-errors');

class LedgerLockService {
  constructor() {
    this.LOCK_TYPES = {
      PERIOD_LOCK: 'PERIOD_LOCK',
      AUDIT_LOCK: 'AUDIT_LOCK',
      RECONCILIATION_LOCK: 'RECONCILIATION_LOCK'
    };
    
    this.LOCK_STATUS = {
      ACTIVE: 'ACTIVE',
      RELEASED: 'RELEASED'
    };
  }
  
  /**
   * Apply a ledger lock
   * 
   * @param {Object} params - Lock parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.lockType - PERIOD_LOCK, AUDIT_LOCK, or RECONCILIATION_LOCK
   * @param {Date} params.lockStartDate - Start of locked period
   * @param {Date} params.lockEndDate - End of locked period
   * @param {string} params.reason - Reason for lock (required)
   * @param {string} params.lockedBy - User applying lock
   * @param {string} params.lockedByRole - User's role
   * @param {string} params.referenceNumber - Audit case number, etc. (optional)
   * @param {string} params.accountingPeriodId - Link to accounting period (optional)
   * @returns {Object} Created lock
   */
  async applyLock(params) {
    const {
      tenantId,
      lockType,
      lockStartDate,
      lockEndDate,
      reason,
      lockedBy,
      lockedByRole,
      referenceNumber,
      accountingPeriodId,
      metadata = {}
    } = params;
    
    // Validate parameters
    if (!tenantId || !lockType || !lockStartDate || !lockEndDate || !reason || !lockedBy) {
      throw new Error('Missing required parameters for lock creation');
    }
    
    if (!Object.values(this.LOCK_TYPES).includes(lockType)) {
      throw new Error(`Invalid lock type: ${lockType}`);
    }
    
    if (new Date(lockStartDate) >= new Date(lockEndDate)) {
      throw new Error('Lock start date must be before end date');
    }
    
    return await db.knex.transaction(async (trx) => {
      // Check for overlapping active locks of the same type
      const overlappingLock = await trx('ledger_locks')
        .where('tenant_id', tenantId)
        .where('lock_type', lockType)
        .where('lock_status', this.LOCK_STATUS.ACTIVE)
        .where(function() {
          this.where(function() {
            // New lock starts within existing lock
            this.where('lock_start_date', '<=', lockStartDate)
              .andWhere('lock_end_date', '>=', lockStartDate);
          }).orWhere(function() {
            // New lock ends within existing lock
            this.where('lock_start_date', '<=', lockEndDate)
              .andWhere('lock_end_date', '>=', lockEndDate);
          }).orWhere(function() {
            // New lock encompasses existing lock
            this.where('lock_start_date', '>=', lockStartDate)
              .andWhere('lock_end_date', '<=', lockEndDate);
          });
        })
        .first();
      
      if (overlappingLock) {
        throw new Error(
          `An active ${lockType} already exists for overlapping period. ` +
          `Lock ID: ${overlappingLock.id}`
        );
      }
      
      // Create the lock
      const [lock] = await trx('ledger_locks').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        lock_type: lockType,
        lock_start_date: lockStartDate,
        lock_end_date: lockEndDate,
        accounting_period_id: accountingPeriodId,
        lock_status: this.LOCK_STATUS.ACTIVE,
        reason,
        reference_number: referenceNumber,
        locked_by: lockedBy,
        locked_by_role: lockedByRole,
        metadata: JSON.stringify(metadata)
      }).returning('*');
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'ledger_lock',
        entity_id: lock.id,
        action: 'create',
        user_id: lockedBy,
        user_role: lockedByRole,
        source_system: 'ledger_lock_service',
        after_state: JSON.stringify(lock),
        reason,
        metadata: JSON.stringify({
          lockType,
          lockStartDate,
          lockEndDate,
          referenceNumber
        })
      });
      
      return lock;
    });
  }
  
  /**
   * Release a ledger lock
   * Only FINANCE_ADMIN role can release locks
   * 
   * @param {Object} params - Release parameters
   * @param {string} params.lockId - Lock ID to release
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.releasedBy - User releasing lock
   * @param {string} params.releasedByRole - User's role (must be FINANCE_ADMIN)
   * @param {string} params.releaseNotes - Reason for release
   * @returns {Object} Updated lock
   */
  async releaseLock(params) {
    const {
      lockId,
      tenantId,
      releasedBy,
      releasedByRole,
      releaseNotes
    } = params;
    
    // Validate parameters
    if (!lockId || !tenantId || !releasedBy || !releasedByRole || !releaseNotes) {
      throw new Error('Missing required parameters for lock release');
    }
    
    // Only FINANCE_ADMIN can release locks
    if (releasedByRole !== 'FINANCE_ADMIN') {
      throw new Error('Only FINANCE_ADMIN role can release ledger locks');
    }
    
    return await db.knex.transaction(async (trx) => {
      // Get current lock
      const lock = await trx('ledger_locks')
        .where('id', lockId)
        .where('tenant_id', tenantId)
        .first();
      
      if (!lock) {
        throw new Error('Lock not found');
      }
      
      if (lock.lock_status === this.LOCK_STATUS.RELEASED) {
        throw new Error('Lock is already released');
      }
      
      // Prevent release of PERIOD_LOCK (these are tied to HARD_CLOSED periods)
      if (lock.lock_type === this.LOCK_TYPES.PERIOD_LOCK) {
        throw new Error(
          'PERIOD_LOCK cannot be released. It is tied to HARD_CLOSED accounting period. ' +
          'To unlock, reopen the accounting period first.'
        );
      }
      
      // Get before state for audit
      const beforeState = { ...lock };
      
      // Release the lock
      const [releasedLock] = await trx('ledger_locks')
        .where('id', lockId)
        .update({
          lock_status: this.LOCK_STATUS.RELEASED,
          released_by: releasedBy,
          released_by_role: releasedByRole,
          released_at: new Date(),
          release_notes: releaseNotes
        })
        .returning('*');
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'ledger_lock',
        entity_id: lockId,
        action: 'post', // Using 'post' as proxy for 'release'
        user_id: releasedBy,
        user_role: releasedByRole,
        source_system: 'ledger_lock_service',
        before_state: JSON.stringify(beforeState),
        after_state: JSON.stringify(releasedLock),
        reason: releaseNotes,
        metadata: JSON.stringify({
          action: 'release_lock'
        })
      });
      
      return releasedLock;
    });
  }
  
  /**
   * Check if ledger is locked for a given date
   * 
   * @param {string} tenantId - Tenant ID
   * @param {Date} transactionDate - Transaction date to check
   * @returns {Object} Lock status
   */
  async checkLockStatus(tenantId, transactionDate) {
    const result = await db.knex.raw(
      'SELECT * FROM check_ledger_locks(?, ?)',
      [tenantId, transactionDate]
    );
    
    const lockCheck = result.rows[0];
    
    if (lockCheck && lockCheck.is_locked) {
      return {
        locked: true,
        lock_id: lockCheck.lock_id,
        lock_type: lockCheck.lock_type,
        locked_by: lockCheck.locked_by,
        reason: lockCheck.reason
      };
    }
    
    return {
      locked: false
    };
  }
  
  /**
   * Get all active locks for a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} lockType - Filter by lock type (optional)
   * @returns {Array} Active locks
   */
  async getActiveLocks(tenantId, lockType = null) {
    let query = db.knex('ledger_locks')
      .where('tenant_id', tenantId)
      .where('lock_status', this.LOCK_STATUS.ACTIVE)
      .orderBy('locked_at', 'desc');
    
    if (lockType) {
      query = query.where('lock_type', lockType);
    }
    
    return await query;
  }
  
  /**
   * Get lock by ID
   * 
   * @param {string} lockId - Lock ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Lock
   */
  async getLock(lockId, tenantId) {
    const lock = await db.knex('ledger_locks')
      .where('id', lockId)
      .where('tenant_id', tenantId)
      .first();
    
    if (!lock) {
      throw new Error('Lock not found');
    }
    
    return lock;
  }
  
  /**
   * Get lock history for a period
   * 
   * @param {Object} params - Query parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {Date} params.startDate - Start date
   * @param {Date} params.endDate - End date
   * @returns {Array} Lock history
   */
  async getLockHistory(params) {
    const { tenantId, startDate, endDate } = params;
    
    let query = db.knex('ledger_locks')
      .where('tenant_id', tenantId)
      .orderBy('locked_at', 'desc');
    
    if (startDate) {
      query = query.where('lock_start_date', '>=', startDate);
    }
    
    if (endDate) {
      query = query.where('lock_end_date', '<=', endDate);
    }
    
    return await query;
  }
}

module.exports = new LedgerLockService();
