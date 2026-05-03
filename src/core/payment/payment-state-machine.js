const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

const DB_TO_LOGICAL_STATUS = {
  pending: 'PENDING',
  processing: 'PENDING',
  success: 'CAPTURED',
  failed: 'FAILED',
  refunded: 'REFUNDED'
};

const GATEWAY_TO_LOGICAL_STATUS = {
  created: 'CREATED',
  pending: 'PENDING',
  processing: 'PENDING',
  authorized: 'AUTHORIZED',
  authorised: 'AUTHORIZED',
  captured: 'CAPTURED',
  capture: 'CAPTURED',
  success: 'CAPTURED',
  successful: 'CAPTURED',
  completed: 'CAPTURED',
  failed: 'FAILED',
  failure: 'FAILED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  expired: 'EXPIRED',
  refunded: 'REFUNDED',
  partially_refunded: 'PARTIALLY_REFUNDED',
  disputed: 'DISPUTED'
};

const LOGICAL_TO_DB_STATUS = {
  CREATED: 'pending',
  PENDING: 'pending',
  AUTHORIZED: 'processing',
  CAPTURED: 'success',
  FAILED: 'failed',
  CANCELLED: 'failed',
  EXPIRED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'refunded',
  DISPUTED: 'success'
};

const ALLOWED_TRANSITIONS = {
  CREATED: ['PENDING'],
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AUTHORIZED: ['CAPTURED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  FAILED: ['CAPTURED'],
  CANCELLED: [],
  EXPIRED: [],
  CAPTURED: ['REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'DISPUTED'],
  REFUNDED: [],
  DISPUTED: ['CAPTURED']
};

function executor(trx) {
  return trx || db.knex;
}

class PaymentStateMachine {
  logicalStatusFromDb(status) {
    return DB_TO_LOGICAL_STATUS[String(status || '').toLowerCase()] || 'CREATED';
  }

  logicalStatusFromGateway(status) {
    const normalized = String(status || '').toLowerCase();
    return GATEWAY_TO_LOGICAL_STATUS[normalized] || 'PENDING';
  }

  dbStatusFromLogical(status) {
    return LOGICAL_TO_DB_STATUS[status] || 'pending';
  }

  isTerminalSecurityFailure(transaction) {
    const responseCode = String(transaction.gateway_response_code || '').toUpperCase();
    const responseMessage = String(transaction.gateway_response_message || '').toUpperCase();
    return responseCode.includes('FRAUD') ||
      responseCode.includes('SECURITY') ||
      responseMessage.includes('FRAUD') ||
      responseMessage.includes('SECURITY');
  }

  isOutOfOrder(previousStatus, incomingStatus) {
    if (previousStatus === 'CAPTURED' && ['CREATED', 'PENDING', 'AUTHORIZED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(incomingStatus)) {
      return true;
    }
    if (['REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'].includes(previousStatus) &&
      ['CREATED', 'PENDING', 'AUTHORIZED', 'FAILED', 'CANCELLED', 'EXPIRED', 'CAPTURED'].includes(incomingStatus)) {
      return previousStatus !== 'DISPUTED' || incomingStatus !== 'CAPTURED';
    }
    return false;
  }

  assertTransitionAllowed({ transaction, previousStatus, incomingStatus, gatewayVerified }) {
    if (previousStatus === incomingStatus) {
      return { allowed: true, noOp: true, lateSuccess: false };
    }

    if (this.isOutOfOrder(previousStatus, incomingStatus)) {
      return { allowed: false, outOfOrder: true };
    }

    if (previousStatus === 'FAILED' && incomingStatus === 'CAPTURED') {
      if (!gatewayVerified || this.isTerminalSecurityFailure(transaction)) {
        return { allowed: false, stateConflict: true };
      }
      return { allowed: true, lateSuccess: true };
    }

    const allowed = ALLOWED_TRANSITIONS[previousStatus] || [];
    if (!allowed.includes(incomingStatus)) {
      return { allowed: false, invalidTransition: true };
    }

    return { allowed: true, lateSuccess: false };
  }

  async transitionPayment(params, trx = null) {
    const {
      tenantId,
      transaction,
      incomingStatus,
      transitionReason,
      gatewayName = null,
      gatewayPaymentId = null,
      gatewayEventId = null,
      webhookEventId = null,
      correlationId = requestContext.getCorrelationId(),
      gatewayVerified = false,
      metadata = {}
    } = params;

    if (!tenantId || !transaction?.id || !incomingStatus) {
      throw new Error('tenantId, transaction, and incomingStatus are required for payment state transition');
    }

    const query = executor(trx);
    const current = await query('transactions')
      .where('id', transaction.id)
      .where('tenant_id', tenantId)
      .forUpdate()
      .first();

    if (!current) throw new Error('Transaction not found for payment state transition');

    const previousStatus = this.logicalStatusFromDb(current.status);
    const targetStatus = typeof incomingStatus === 'string' && incomingStatus === incomingStatus.toUpperCase()
      ? incomingStatus
      : this.logicalStatusFromGateway(incomingStatus);
    const decision = this.assertTransitionAllowed({
      transaction: current,
      previousStatus,
      incomingStatus: targetStatus,
      gatewayVerified
    });

    if (!decision.allowed) {
      return {
        transitioned: false,
        previousStatus,
        newStatus: targetStatus,
        transaction: current,
        outOfOrder: Boolean(decision.outOfOrder),
        stateConflict: Boolean(decision.stateConflict),
        invalidTransition: Boolean(decision.invalidTransition)
      };
    }

    if (decision.noOp) {
      return {
        transitioned: false,
        previousStatus,
        newStatus: targetStatus,
        transaction: current,
        duplicateState: true,
        lateSuccess: false
      };
    }

    const dbStatus = this.dbStatusFromLogical(targetStatus);
    const updateData = {
      status: dbStatus,
      gateway_response_message: metadata.gatewayResponseMessage || current.gateway_response_message,
      updated_at: new Date()
    };

    if (gatewayPaymentId && !current.gateway_transaction_id) {
      updateData.gateway_transaction_id = gatewayPaymentId;
    }
    if (targetStatus === 'CAPTURED') {
      updateData.completed_at = current.completed_at || new Date();
    }

    const [updated] = await query('transactions')
      .where('id', current.id)
      .where('tenant_id', tenantId)
      .update(updateData)
      .returning('*');

    await query('payment_state_transitions').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      transaction_id: current.id,
      transaction_ref: current.transaction_ref,
      gateway_name: gatewayName,
      gateway_payment_id: gatewayPaymentId || current.gateway_transaction_id,
      previous_status: previousStatus,
      new_status: targetStatus,
      transition_reason: transitionReason || (decision.lateSuccess ? 'late_success_verified' : 'gateway_webhook'),
      gateway_event_id: gatewayEventId,
      webhook_event_id: webhookEventId,
      correlation_id: correlationId || null,
      metadata: {
        ...metadata,
        db_status: dbStatus,
        late_success: Boolean(decision.lateSuccess)
      }
    });

    logger.info('Payment state transitioned', {
      tenant_id: tenantId,
      transaction_id: current.id,
      transaction_ref: current.transaction_ref,
      previous_status: previousStatus,
      new_status: targetStatus,
      db_status: dbStatus,
      gateway_payment_id: gatewayPaymentId,
      webhook_event_id: webhookEventId,
      correlation_id: correlationId || null
    });

    return {
      transitioned: true,
      previousStatus,
      newStatus: targetStatus,
      dbStatus,
      transaction: updated,
      lateSuccess: Boolean(decision.lateSuccess)
    };
  }
}

module.exports = new PaymentStateMachine();
module.exports.PaymentStateMachine = PaymentStateMachine;
