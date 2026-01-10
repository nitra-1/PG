/**
 * Accounting Period Service
 * 
 * Manages financial posting windows and period close discipline for RBI compliance
 * 
 * Key Features:
 * - Period creation with contiguity validation
 * - Graduated period closure (OPEN -> SOFT_CLOSED -> HARD_CLOSED)
 * - Single open period enforcement per period type
 * - Admin override workflow for SOFT_CLOSED periods
 * - Complete audit trail for all period operations
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const {
  PeriodClosedError,
  PeriodNotFoundError,
  PeriodOverlapError,
  PeriodGapError
} = require('../errors/accounting-errors');

class AccountingPeriodService {
  constructor() {
    this.PERIOD_TYPES = {
      DAILY: 'DAILY',
      MONTHLY: 'MONTHLY'
    };
    
    this.PERIOD_STATUS = {
      OPEN: 'OPEN',
      SOFT_CLOSED: 'SOFT_CLOSED',
      HARD_CLOSED: 'HARD_CLOSED'
    };
  }
  
  /**
   * Create a new accounting period
   * Validates contiguity and prevents overlaps
   * 
   * @param {Object} params - Period parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.periodType - DAILY or MONTHLY
   * @param {Date} params.periodStart - Period start date/time
   * @param {Date} params.periodEnd - Period end date/time
   * @param {string} params.createdBy - User creating the period
   * @returns {Object} Created period
   */
  async createPeriod(params) {
    const {
      tenantId,
      periodType,
      periodStart,
      periodEnd,
      createdBy
    } = params;
    
    // Validate parameters
    if (!tenantId || !periodType || !periodStart || !periodEnd) {
      throw new Error('Missing required parameters for period creation');
    }
    
    if (!Object.values(this.PERIOD_TYPES).includes(periodType)) {
      throw new Error(`Invalid period type: ${periodType}`);
    }
    
    if (new Date(periodStart) >= new Date(periodEnd)) {
      throw new Error('Period start must be before period end');
    }
    
    return await db.knex.transaction(async (trx) => {
      // Check for overlapping periods
      const overlapping = await trx('accounting_periods')
        .where('tenant_id', tenantId)
        .where('period_type', periodType)
        .where(function() {
          this.where(function() {
            // New period starts within existing period
            this.where('period_start', '<=', periodStart)
              .andWhere('period_end', '>=', periodStart);
          }).orWhere(function() {
            // New period ends within existing period
            this.where('period_start', '<=', periodEnd)
              .andWhere('period_end', '>=', periodEnd);
          }).orWhere(function() {
            // New period encompasses existing period
            this.where('period_start', '>=', periodStart)
              .andWhere('period_end', '<=', periodEnd);
          });
        })
        .first();
      
      if (overlapping) {
        throw new PeriodOverlapError(periodStart, periodEnd, overlapping);
      }
      
      // Check contiguity - find the last period before this one
      const lastPeriod = await trx('accounting_periods')
        .where('tenant_id', tenantId)
        .where('period_type', periodType)
        .where('period_end', '<', periodStart)
        .orderBy('period_end', 'desc')
        .first();
      
      // If there's a previous period, ensure no gap
      if (lastPeriod) {
        const lastEnd = new Date(lastPeriod.period_end);
        const newStart = new Date(periodStart);
        
        // For DAILY periods, next period should start the next day (or same second for timestamps)
        // For MONTHLY periods, check for gaps
        const timeDiff = newStart - lastEnd;
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        // Allow small gaps (less than 2 days) for operational flexibility
        // In production, this should be stricter based on business rules
        if (timeDiff > (oneDayMs * 2)) {
          throw new PeriodGapError(
            lastPeriod.period_end,
            periodStart,
            periodType
          );
        }
      }
      
      // Check if there's already an OPEN period of this type
      const openPeriod = await trx('accounting_periods')
        .where('tenant_id', tenantId)
        .where('period_type', periodType)
        .where('status', this.PERIOD_STATUS.OPEN)
        .first();
      
      if (openPeriod) {
        throw new Error(
          `An OPEN ${periodType} period already exists (${openPeriod.id}). ` +
          `Close it before creating a new period.`
        );
      }
      
      // Create the period
      const [period] = await trx('accounting_periods').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        status: this.PERIOD_STATUS.OPEN,
        created_by: createdBy
      }).returning('*');
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'accounting_period',
        entity_id: period.id,
        action: 'create',
        user_id: createdBy,
        source_system: 'accounting_period_service',
        after_state: JSON.stringify(period),
        metadata: JSON.stringify({
          periodType,
          periodStart,
          periodEnd
        })
      });
      
      return period;
    });
  }
  
  /**
   * Close an accounting period (OPEN -> SOFT_CLOSED or SOFT_CLOSED -> HARD_CLOSED)
   * 
   * @param {Object} params - Closure parameters
   * @param {string} params.periodId - Period ID to close
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.targetStatus - SOFT_CLOSED or HARD_CLOSED
   * @param {string} params.closedBy - User closing the period
   * @param {string} params.closureNotes - Reason for closure
   * @returns {Object} Updated period
   */
  async closePeriod(params) {
    const {
      periodId,
      tenantId,
      targetStatus,
      closedBy,
      closureNotes
    } = params;
    
    // Validate parameters
    if (!periodId || !tenantId || !targetStatus || !closedBy) {
      throw new Error('Missing required parameters for period closure');
    }
    
    if (![this.PERIOD_STATUS.SOFT_CLOSED, this.PERIOD_STATUS.HARD_CLOSED].includes(targetStatus)) {
      throw new Error(`Invalid target status: ${targetStatus}`);
    }
    
    return await db.knex.transaction(async (trx) => {
      // Get current period
      const period = await trx('accounting_periods')
        .where('id', periodId)
        .where('tenant_id', tenantId)
        .first();
      
      if (!period) {
        throw new PeriodNotFoundError(periodId);
      }
      
      // Validate state transition
      if (period.status === this.PERIOD_STATUS.HARD_CLOSED) {
        throw new Error('Cannot modify HARD_CLOSED period');
      }
      
      if (targetStatus === this.PERIOD_STATUS.HARD_CLOSED && 
          period.status === this.PERIOD_STATUS.OPEN) {
        throw new Error('Period must be SOFT_CLOSED before HARD_CLOSED');
      }
      
      // Get before state for audit
      const beforeState = { ...period };
      
      // Update period status
      const [updatedPeriod] = await trx('accounting_periods')
        .where('id', periodId)
        .update({
          status: targetStatus,
          closed_by: closedBy,
          closed_at: new Date(),
          closure_notes: closureNotes,
          updated_at: new Date()
        })
        .returning('*');
      
      // If HARD_CLOSED, create PERIOD_LOCK automatically
      if (targetStatus === this.PERIOD_STATUS.HARD_CLOSED) {
        await trx('ledger_locks').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          lock_type: 'PERIOD_LOCK',
          lock_start_date: period.period_start,
          lock_end_date: period.period_end,
          accounting_period_id: periodId,
          lock_status: 'ACTIVE',
          reason: `Auto-lock for HARD_CLOSED ${period.period_type} period`,
          locked_by: closedBy,
          locked_by_role: 'FINANCE_ADMIN'
        });
      }
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'accounting_period',
        entity_id: periodId,
        action: 'post', // Using 'post' as proxy for 'close'
        user_id: closedBy,
        source_system: 'accounting_period_service',
        before_state: JSON.stringify(beforeState),
        after_state: JSON.stringify(updatedPeriod),
        reason: closureNotes,
        metadata: JSON.stringify({
          action: 'close_period',
          oldStatus: period.status,
          newStatus: targetStatus
        })
      });
      
      return updatedPeriod;
    });
  }
  
  /**
   * Check if posting is allowed for a given date
   * Returns period info and posting rules
   * 
   * @param {Object} params - Check parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {Date} params.transactionDate - Transaction date to check
   * @param {string} params.periodType - DAILY or MONTHLY (default: DAILY)
   * @returns {Object} Period check result
   */
  async checkPeriodForPosting(params) {
    const {
      tenantId,
      transactionDate,
      periodType = this.PERIOD_TYPES.DAILY
    } = params;
    
    // Use database function for period check
    const result = await db.knex.raw(
      'SELECT * FROM check_accounting_period_for_posting(?, ?)',
      [tenantId, transactionDate]
    );
    
    const periodCheck = result.rows[0];
    
    if (!periodCheck) {
      throw new PeriodNotFoundError(transactionDate, periodType);
    }
    
    // Also check for ledger locks
    const lockResult = await db.knex.raw(
      'SELECT * FROM check_ledger_locks(?, ?)',
      [tenantId, transactionDate]
    );
    
    const lockCheck = lockResult.rows[0];
    
    return {
      period: {
        id: periodCheck.period_id,
        status: periodCheck.period_status,
        type: periodCheck.period_type
      },
      posting_allowed: periodCheck.posting_allowed && !lockCheck.is_locked,
      override_required: periodCheck.override_required,
      locked: lockCheck.is_locked,
      lock_info: lockCheck.is_locked ? {
        lock_id: lockCheck.lock_id,
        lock_type: lockCheck.lock_type,
        locked_by: lockCheck.locked_by,
        reason: lockCheck.reason
      } : null,
      error_message: periodCheck.error_message || 
        (lockCheck.is_locked ? `Ledger locked: ${lockCheck.reason}` : null)
    };
  }
  
  /**
   * Get open period for a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @param {string} periodType - DAILY or MONTHLY
   * @returns {Object|null} Open period or null
   */
  async getOpenPeriod(tenantId, periodType = this.PERIOD_TYPES.DAILY) {
    return await db.knex('accounting_periods')
      .where('tenant_id', tenantId)
      .where('period_type', periodType)
      .where('status', this.PERIOD_STATUS.OPEN)
      .first();
  }
  
  /**
   * Get all periods for a tenant
   * 
   * @param {Object} params - Query parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.periodType - Filter by period type (optional)
   * @param {string} params.status - Filter by status (optional)
   * @param {number} params.limit - Limit results (default: 100)
   * @returns {Array} Periods
   */
  async getPeriods(params) {
    const {
      tenantId,
      periodType,
      status,
      limit = 100
    } = params;
    
    let query = db.knex('accounting_periods')
      .where('tenant_id', tenantId)
      .orderBy('period_start', 'desc')
      .limit(limit);
    
    if (periodType) {
      query = query.where('period_type', periodType);
    }
    
    if (status) {
      query = query.where('status', status);
    }
    
    return await query;
  }
  
  /**
   * Get period by ID
   * 
   * @param {string} periodId - Period ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Period
   */
  async getPeriod(periodId, tenantId) {
    const period = await db.knex('accounting_periods')
      .where('id', periodId)
      .where('tenant_id', tenantId)
      .first();
    
    if (!period) {
      throw new PeriodNotFoundError(periodId);
    }
    
    return period;
  }
}

module.exports = new AccountingPeriodService();
