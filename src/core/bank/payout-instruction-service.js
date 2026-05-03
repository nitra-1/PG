const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const logger = require('../logging/logger');
const requestContext = require('../context/request-context');

const TERMINAL_STATUSES = ['SUCCESS', 'FAILED', 'REJECTED', 'RETURNED', 'REVERSED', 'TIMEOUT'];
const ALLOWED_TRANSITIONS = {
  CREATED: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['ACCEPTED', 'REJECTED', 'PROCESSING', 'TIMEOUT', 'FAILED'],
  ACCEPTED: ['PROCESSING', 'SUCCESS', 'RETURNED', 'FAILED', 'TIMEOUT'],
  PROCESSING: ['SUCCESS', 'FAILED', 'RETURNED', 'REVERSED', 'TIMEOUT'],
  SUCCESS: ['RETURNED', 'REVERSED'],
  FAILED: [],
  REJECTED: [],
  RETURNED: [],
  REVERSED: [],
  TIMEOUT: []
};

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

class PayoutInstructionService {
  bankIdempotencyKeyForSettlement(settlement) {
    return `payout:${settlement.tenant_id}:${settlement.settlement_ref}`;
  }

  async createPayoutInstruction(settlement, options = {}) {
    if (!settlement?.id || !settlement?.tenant_id || !settlement?.settlement_ref) {
      throw new Error('Valid settlement is required to create payout instruction');
    }

    const bankIdempotencyKey = options.bankIdempotencyKey || this.bankIdempotencyKeyForSettlement(settlement);
    const existing = await db.knex('payout_instructions')
      .where({
        tenant_id: settlement.tenant_id,
        bank_idempotency_key: bankIdempotencyKey
      })
      .first();

    if (existing) return existing;

    const [instruction] = await db.knex('payout_instructions').insert({
      id: uuidv4(),
      tenant_id: settlement.tenant_id,
      settlement_id: settlement.id,
      settlement_ref: settlement.settlement_ref,
      merchant_id: settlement.merchant_id || null,
      beneficiary_id: options.beneficiaryId || null,
      bank_account_id: options.bankAccountId || null,
      payout_amount: settlement.net_amount,
      currency: options.currency || parseJson(settlement.metadata).currency || 'INR',
      payout_status: 'CREATED',
      bank_idempotency_key: bankIdempotencyKey,
      retry_count: 0,
      raw_bank_response: JSON.stringify({}),
      correlation_id: options.correlationId || requestContext.getCorrelationId() || null
    }).returning('*');

    logger.info('Payout instruction created', {
      tenant_id: instruction.tenant_id,
      settlement_ref: instruction.settlement_ref,
      payout_instruction_id: instruction.id,
      bank_idempotency_key: instruction.bank_idempotency_key,
      correlation_id: instruction.correlation_id
    });

    return instruction;
  }

  assertTransitionAllowed(currentStatus, targetStatus) {
    if (!ALLOWED_TRANSITIONS[currentStatus]) {
      throw new Error(`Unknown payout status: ${currentStatus}`);
    }

    if (currentStatus === targetStatus) return;

    if (TERMINAL_STATUSES.includes(currentStatus) && !ALLOWED_TRANSITIONS[currentStatus].includes(targetStatus)) {
      throw new Error(`Cannot transition terminal payout status ${currentStatus} to ${targetStatus}`);
    }

    if (!ALLOWED_TRANSITIONS[currentStatus].includes(targetStatus)) {
      throw new Error(`Invalid payout transition ${currentStatus} -> ${targetStatus}`);
    }
  }

  timestampForStatus(status) {
    return {
      SUBMITTED: 'submitted_at',
      ACCEPTED: 'accepted_at',
      SUCCESS: 'completed_at',
      FAILED: 'failed_at',
      REJECTED: 'failed_at',
      RETURNED: 'returned_at',
      REVERSED: 'reversed_at',
      TIMEOUT: 'failed_at'
    }[status];
  }

  async transitionPayout(params) {
    const {
      payoutInstructionId,
      tenantId,
      targetStatus,
      rawBankResponse,
      utrNumber,
      bankReferenceNumber,
      bankTransactionId,
      failureReason,
      returnReason,
      correlationId = requestContext.getCorrelationId()
    } = params;

    const instruction = await db.knex('payout_instructions')
      .where('id', payoutInstructionId)
      .where('tenant_id', tenantId)
      .first();

    if (!instruction) throw new Error('Payout instruction not found');
    this.assertTransitionAllowed(instruction.payout_status, targetStatus);

    if (instruction.payout_status === targetStatus) {
      return instruction;
    }

    const mergedRawResponse = {
      ...parseJson(instruction.raw_bank_response),
      ...(rawBankResponse || {})
    };
    const updateData = {
      payout_status: targetStatus,
      raw_bank_response: JSON.stringify(mergedRawResponse),
      updated_at: new Date(),
      correlation_id: correlationId || instruction.correlation_id
    };
    const timestampColumn = this.timestampForStatus(targetStatus);
    if (timestampColumn) updateData[timestampColumn] = new Date();
    if (utrNumber) updateData.utr_number = utrNumber;
    if (bankReferenceNumber) updateData.bank_reference_number = bankReferenceNumber;
    if (bankTransactionId) updateData.bank_transaction_id = bankTransactionId;
    if (failureReason) updateData.failure_reason = failureReason;
    if (returnReason) updateData.return_reason = returnReason;

    const [updated] = await db.knex('payout_instructions')
      .where('id', payoutInstructionId)
      .where('tenant_id', tenantId)
      .update(updateData)
      .returning('*');

    logger.info('Payout instruction status changed', {
      tenant_id: tenantId,
      payout_instruction_id: payoutInstructionId,
      settlement_ref: updated.settlement_ref,
      from_status: instruction.payout_status,
      to_status: targetStatus,
      correlation_id: updated.correlation_id
    });

    return updated;
  }

  markPayoutSubmitted(params) {
    return this.transitionPayout({ ...params, targetStatus: 'SUBMITTED' });
  }

  markPayoutAccepted(params) {
    return this.transitionPayout({ ...params, targetStatus: 'ACCEPTED' });
  }

  markPayoutProcessing(params) {
    return this.transitionPayout({ ...params, targetStatus: 'PROCESSING' });
  }

  markPayoutSuccess(params) {
    return this.transitionPayout({ ...params, targetStatus: 'SUCCESS' });
  }

  markPayoutRejected(params) {
    return this.transitionPayout({ ...params, targetStatus: 'REJECTED' });
  }

  markPayoutReturned(params) {
    return this.transitionPayout({ ...params, targetStatus: 'RETURNED' });
  }

  markPayoutReversed(params) {
    return this.transitionPayout({ ...params, targetStatus: 'REVERSED' });
  }

  markPayoutTimeout(params) {
    return this.transitionPayout({ ...params, targetStatus: 'TIMEOUT' });
  }

  async listPayoutInstructions(filters = {}) {
    const {
      tenantId,
      settlementRef,
      status,
      utr_number: utrNumber,
      bank_reference_number: bankReferenceNumber,
      bank_transaction_id: bankTransactionId,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('payout_instructions')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (settlementRef) query = query.where('settlement_ref', settlementRef);
    if (status) query = query.where('payout_status', status);
    if (utrNumber) query = query.where('utr_number', utrNumber);
    if (bankReferenceNumber) query = query.where('bank_reference_number', bankReferenceNumber);
    if (bankTransactionId) query = query.where('bank_transaction_id', bankTransactionId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async getPayoutInstruction(id, tenantId = null) {
    let query = db.knex('payout_instructions').where('id', id);
    if (tenantId) query = query.where('tenant_id', tenantId);
    const instruction = await query.first();
    if (!instruction) throw new Error('Payout instruction not found');
    return instruction;
  }
}

module.exports = new PayoutInstructionService();
