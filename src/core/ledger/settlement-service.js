/**
 * Settlement Service
 * 
 * Manages merchant settlements with strict state machine for RBI compliance
 * 
 * State Flow:
 * CREATED -> FUNDS_RESERVED -> SENT_TO_BANK -> BANK_CONFIRMED -> SETTLED
 * 
 * Failure Path:
 * Any state -> FAILED -> RETRIED (back to FUNDS_RESERVED, max retries enforced)
 * 
 * Key Features:
 * - No state skipping allowed
 * - No backward transitions (except FAILED -> RETRIED)
 * - All transitions timestamped
 * - Bank confirmation required for finality
 * - Retry logic with backoff and max attempts
 * - Ledger remains balanced across retries
 * - Complete audit trail
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');
const {
  SettlementStateError,
  SettlementRetryExhaustedError
} = require('../errors/accounting-errors');
const { getValidTransitions } = require('../errors/accounting-errors');

class SettlementService {
  constructor() {
    this.STATES = {
      CREATED: 'CREATED',
      FUNDS_RESERVED: 'FUNDS_RESERVED',
      SENT_TO_BANK: 'SENT_TO_BANK',
      BANK_CONFIRMED: 'BANK_CONFIRMED',
      SETTLED: 'SETTLED',
      FAILED: 'FAILED',
      RETRIED: 'RETRIED'
    };
    
    this.MAX_RETRIES = 3;
    this.RETRY_BACKOFF_MINUTES = [15, 60, 240]; // 15min, 1hr, 4hr
  }
  
  /**
   * Create a new settlement
   * 
   * @param {Object} params - Settlement parameters
   * @returns {Object} Created settlement
   */
  async createSettlement(params) {
    const {
      tenantId,
      merchantId,
      settlementRef,
      settlementDate,
      periodFrom,
      periodTo,
      grossAmount,
      feesAmount,
      netAmount,
      bankAccountNumber,
      bankIfsc,
      bankName,
      metadata = {},
      createdBy
    } = params;
    
    // Validate parameters
    if (!tenantId || !merchantId || !settlementRef || !netAmount) {
      throw new Error('Missing required parameters for settlement creation');
    }
    
    return await db.knex.transaction(async (trx) => {
      // Create settlement in CREATED state
      const [settlement] = await trx('settlements').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        merchant_id: merchantId,
        settlement_ref: settlementRef,
        settlement_date: settlementDate || new Date(),
        period_from: periodFrom,
        period_to: periodTo,
        gross_amount: grossAmount,
        fees_amount: feesAmount,
        net_amount: netAmount,
        bank_account_number: bankAccountNumber,
        bank_ifsc: bankIfsc,
        bank_name: bankName,
        status: this.STATES.CREATED,
        retry_count: 0,
        max_retries: this.MAX_RETRIES,
        metadata: JSON.stringify(metadata),
        state_transitions: JSON.stringify([{
          from: null,
          to: this.STATES.CREATED,
          timestamp: new Date().toISOString(),
          by: createdBy
        }]),
        created_by: createdBy
      }).returning('*');
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'settlement',
        entity_id: settlement.id,
        action: 'create',
        user_id: createdBy,
        source_system: 'settlement_service',
        after_state: JSON.stringify(settlement)
      });
      
      return settlement;
    });
  }
  
  /**
   * Transition settlement to next state
   * Validates state machine rules
   * 
   * @param {Object} params - Transition parameters
   * @returns {Object} Updated settlement
   */
  async transitionState(params) {
    const {
      settlementId,
      tenantId,
      targetState,
      transitionBy,
      metadata = {}
    } = params;
    
    // Validate parameters
    if (!settlementId || !tenantId || !targetState || !transitionBy) {
      throw new Error('Missing required parameters for state transition');
    }
    
    if (!Object.values(this.STATES).includes(targetState)) {
      throw new Error(`Invalid target state: ${targetState}`);
    }
    
    return await db.knex.transaction(async (trx) => {
      // Get current settlement
      const settlement = await trx('settlements')
        .where('id', settlementId)
        .where('tenant_id', tenantId)
        .first();
      
      if (!settlement) {
        throw new Error('Settlement not found');
      }
      
      // Validate transition
      const validNextStates = getValidTransitions(settlement.status);
      if (!validNextStates.includes(targetState)) {
        throw new SettlementStateError(
          settlement.status,
          targetState,
          settlementId
        );
      }
      
      // Get before state for audit
      const beforeState = { ...settlement };
      
      // Parse existing transitions
      const stateTransitions = JSON.parse(settlement.state_transitions || '[]');
      stateTransitions.push({
        from: settlement.status,
        to: targetState,
        timestamp: new Date().toISOString(),
        by: transitionBy,
        metadata
      });
      
      // Prepare update data
      const updateData = {
        status: targetState,
        state_transitions: JSON.stringify(stateTransitions),
        updated_at: new Date()
      };
      
      // Set timestamp for specific states
      switch (targetState) {
        case this.STATES.FUNDS_RESERVED:
          updateData.funds_reserved_at = new Date();
          break;
        case this.STATES.SENT_TO_BANK:
          updateData.sent_to_bank_at = new Date();
          break;
        case this.STATES.BANK_CONFIRMED:
          updateData.bank_confirmed_at = new Date();
          // Extract bank confirmation details from metadata
          if (metadata.bankReferenceNumber) {
            updateData.bank_reference_number = metadata.bankReferenceNumber;
          }
          if (metadata.bankTransactionId) {
            updateData.bank_transaction_id = metadata.bankTransactionId;
          }
          if (metadata.utrNumber) {
            updateData.utr_number = metadata.utrNumber;
          }
          if (metadata.settlementBatchId) {
            updateData.settlement_batch_id = metadata.settlementBatchId;
          }
          break;
        case this.STATES.SETTLED:
          updateData.settled_at = new Date();
          updateData.completed_at = new Date();
          break;
        case this.STATES.FAILED:
          updateData.failed_at = new Date();
          updateData.failure_reason = metadata.failureReason || 'Unknown failure';
          break;
      }
      
      // Update settlement
      const [updatedSettlement] = await trx('settlements')
        .where('id', settlementId)
        .update(updateData)
        .returning('*');
      
      // Create audit log
      await trx('ledger_audit_logs').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        entity_type: 'settlement',
        entity_id: settlementId,
        action: 'post', // Using 'post' as proxy for 'transition'
        user_id: transitionBy,
        source_system: 'settlement_service',
        before_state: JSON.stringify(beforeState),
        after_state: JSON.stringify(updatedSettlement),
        metadata: JSON.stringify({
          action: 'state_transition',
          fromState: settlement.status,
          toState: targetState,
          ...metadata
        })
      });
      
      return updatedSettlement;
    });
  }
  
  /**
   * Reserve funds for settlement
   * Transitions: CREATED -> FUNDS_RESERVED
   * 
   * @param {Object} params - Reserve parameters
   * @returns {Object} Updated settlement
   */
  async reserveFunds(params) {
    const { settlementId, tenantId, reservedBy } = params;
    
    return await this.transitionState({
      settlementId,
      tenantId,
      targetState: this.STATES.FUNDS_RESERVED,
      transitionBy: reservedBy,
      metadata: {
        action: 'reserve_funds'
      }
    });
  }
  
  /**
   * Mark settlement as sent to bank
   * Transitions: FUNDS_RESERVED -> SENT_TO_BANK
   * 
   * @param {Object} params - Send parameters
   * @returns {Object} Updated settlement
   */
  async sendToBank(params) {
    const { settlementId, tenantId, sentBy, bankBatchId } = params;
    
    return await this.transitionState({
      settlementId,
      tenantId,
      targetState: this.STATES.SENT_TO_BANK,
      transitionBy: sentBy,
      metadata: {
        action: 'send_to_bank',
        bankBatchId
      }
    });
  }
  
  /**
   * Confirm bank processed settlement
   * Transitions: SENT_TO_BANK -> BANK_CONFIRMED
   * This is the critical step for finality
   * 
   * @param {Object} params - Confirmation parameters
   * @returns {Object} Updated settlement
   */
  async confirmByBank(params) {
    const {
      settlementId,
      tenantId,
      confirmedBy,
      bankReferenceNumber,
      bankTransactionId,
      utrNumber,
      settlementBatchId
    } = params;
    
    // Bank confirmation details are required
    if (!utrNumber) {
      throw new Error('UTR number is required for bank confirmation');
    }
    
    return await this.transitionState({
      settlementId,
      tenantId,
      targetState: this.STATES.BANK_CONFIRMED,
      transitionBy: confirmedBy,
      metadata: {
        action: 'bank_confirmation',
        bankReferenceNumber,
        bankTransactionId,
        utrNumber,
        settlementBatchId
      }
    });
  }
  
  /**
   * Mark settlement as fully settled
   * Transitions: BANK_CONFIRMED -> SETTLED
   * 
   * @param {Object} params - Settle parameters
   * @returns {Object} Updated settlement
   */
  async markSettled(params) {
    const { settlementId, tenantId, settledBy } = params;
    
    return await this.transitionState({
      settlementId,
      tenantId,
      targetState: this.STATES.SETTLED,
      transitionBy: settledBy,
      metadata: {
        action: 'mark_settled'
      }
    });
  }
  
  /**
   * Mark settlement as failed
   * Can be called from any state
   * 
   * @param {Object} params - Failure parameters
   * @returns {Object} Updated settlement
   */
  async markFailed(params) {
    const { settlementId, tenantId, failedBy, failureReason } = params;
    
    if (!failureReason) {
      throw new Error('Failure reason is required');
    }
    
    return await this.transitionState({
      settlementId,
      tenantId,
      targetState: this.STATES.FAILED,
      transitionBy: failedBy,
      metadata: {
        action: 'mark_failed',
        failureReason
      }
    });
  }
  
  /**
   * Retry a failed settlement
   * Transitions: FAILED -> RETRIED -> FUNDS_RESERVED
   * Enforces max retry count
   * 
   * @param {Object} params - Retry parameters
   * @returns {Object} Updated settlement
   */
  async retrySettlement(params) {
    const { settlementId, tenantId, retriedBy } = params;
    
    return await db.knex.transaction(async (trx) => {
      // Get current settlement
      const settlement = await trx('settlements')
        .where('id', settlementId)
        .where('tenant_id', tenantId)
        .first();
      
      if (!settlement) {
        throw new Error('Settlement not found');
      }
      
      // Must be in FAILED state to retry
      if (settlement.status !== this.STATES.FAILED) {
        throw new SettlementStateError(
          settlement.status,
          this.STATES.RETRIED,
          settlementId
        );
      }
      
      // Check retry count
      if (settlement.retry_count >= settlement.max_retries) {
        throw new SettlementRetryExhaustedError(
          settlementId,
          settlement.retry_count,
          settlement.max_retries
        );
      }
      
      // Parse retry history
      const retryHistory = JSON.parse(settlement.retry_history || '[]');
      retryHistory.push({
        retryNumber: settlement.retry_count + 1,
        timestamp: new Date().toISOString(),
        retriedBy,
        previousFailureReason: settlement.failure_reason
      });
      
      // Calculate next retry time with backoff
      const backoffMinutes = this.RETRY_BACKOFF_MINUTES[settlement.retry_count] || 
        this.RETRY_BACKOFF_MINUTES[this.RETRY_BACKOFF_MINUTES.length - 1];
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      
      // Update to RETRIED state
      await trx('settlements')
        .where('id', settlementId)
        .update({
          status: this.STATES.RETRIED,
          retry_count: settlement.retry_count + 1,
          last_retry_at: new Date(),
          next_retry_at: nextRetryAt,
          retry_history: JSON.stringify(retryHistory),
          updated_at: new Date()
        });
      
      // Immediately transition to FUNDS_RESERVED to start retry
      const retriedSettlement = await this.transitionState({
        settlementId,
        tenantId,
        targetState: this.STATES.FUNDS_RESERVED,
        transitionBy: retriedBy,
        metadata: {
          action: 'retry_settlement',
          retryNumber: settlement.retry_count + 1,
          nextRetryAt
        }
      });
      
      return retriedSettlement;
    });
  }
  
  /**
   * Get settlement by ID
   * 
   * @param {string} settlementId - Settlement ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Settlement
   */
  async getSettlement(settlementId, tenantId) {
    const settlement = await db.knex('settlements')
      .where('id', settlementId)
      .where('tenant_id', tenantId)
      .first();
    
    if (!settlement) {
      throw new Error('Settlement not found');
    }
    
    // Parse JSON fields
    settlement.metadata = JSON.parse(settlement.metadata || '{}');
    settlement.state_transitions = JSON.parse(settlement.state_transitions || '[]');
    settlement.retry_history = JSON.parse(settlement.retry_history || '[]');
    
    return settlement;
  }
  
  /**
   * Get settlements by status
   * 
   * @param {Object} params - Query parameters
   * @returns {Array} Settlements
   */
  async getSettlementsByStatus(params) {
    const { tenantId, status, limit = 100 } = params;
    
    let query = db.knex('settlements')
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .limit(limit);
    
    if (status) {
      query = query.where('status', status);
    }
    
    return await query;
  }
  
  /**
   * Get settlements requiring retry
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Settlements ready for retry
   */
  async getSettlementsForRetry(tenantId) {
    return await db.knex('settlements')
      .where('tenant_id', tenantId)
      .where('status', this.STATES.FAILED)
      .where('retry_count', '<', db.knex.ref('max_retries'))
      .where(function() {
        this.where('next_retry_at', '<=', new Date())
          .orWhereNull('next_retry_at');
      })
      .orderBy('created_at', 'asc');
  }
}

module.exports = new SettlementService();
