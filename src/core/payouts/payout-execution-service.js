const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const { outboxService } = require('../outbox/outbox-service');
const payoutStateMachine = require('./payout-state-machine');
const bankPayoutAdapter = require('./bank-payout-adapter');
const payoutSignalService = require('./payout-signal-service');

const LIVE_PAYOUT_STATUSES = ['CREATED', 'READY', 'SUBMITTED', 'ACCEPTED', 'QUEUED', 'PROCESSING', 'SUCCESS', 'RETURNED', 'REVERSED', 'TIMEOUT'];
const RETRYABLE_STATUSES = ['FAILED', 'REJECTED', 'TIMEOUT'];
const NON_SUCCESS_SIGNALS = {
  ACCEPTED: 'BANK_CONFIRMATION_MISSING',
  QUEUED: 'PAYOUT_DELAYED',
  PROCESSING: 'BANK_CONFIRMATION_MISSING',
  FAILED: 'PAYOUT_FAILED',
  REJECTED: 'BANK_REJECTED_PAYOUT',
  TIMEOUT: 'PAYOUT_TIMEOUT'
};

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function timestampPatch(status) {
  const column = payoutStateMachine.timestampColumn(status);
  return column ? { [column]: new Date() } : {};
}

class PayoutExecutionService {
  bankIdempotencyKeyFor({ tenantId, batch, reservation }) {
    return `payout:${tenantId}:${batch.batch_ref}:${reservation.reservation_ref}`;
  }

  async createPayoutInstructionForBatch({ batchId, tenantId = null, requestedBy = null, correlationId = requestContext.getCorrelationId() }) {
    return db.knex.transaction(async (trx) => {
      let batchQuery = trx('settlement_batches').where('id', batchId);
      if (tenantId) batchQuery = batchQuery.where('tenant_id', tenantId);
      const batch = await batchQuery.forUpdate().first();
      if (!batch) throw new Error('Settlement batch not found');

      if (!['RESERVED', 'READY_FOR_PAYOUT'].includes(batch.batch_status)) {
        throw new Error(`Cannot create payout for settlement batch in status ${batch.batch_status}`);
      }

      const reservation = await trx('settlement_fund_reservations')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .where('reservation_status', 'ACTIVE')
        .forUpdate()
        .first();

      if (!reservation) {
        const signal = await payoutSignalService.createOrUpdateSignal({
          tenantId: batch.tenant_id,
          signalType: 'PAYOUT_WITHOUT_RESERVATION',
          sourceType: 'RESERVATION',
          sourceId: batch.id,
          settlementBatchId: batch.id,
          merchantId: batch.merchant_id,
          impactAmount: batch.net_settlement_amount,
          currency: batch.currency,
          description: `Settlement batch ${batch.batch_ref} cannot create payout without an active reservation`,
          correlationId,
          metadata: { batch_status: batch.batch_status }
        }, trx);
        return {
          payoutInstruction: null,
          reservation: null,
          batch,
          status: 'PAYOUT_WITHOUT_RESERVATION',
          signals: [signal]
        };
      }

      if (Math.abs(roundMoney(reservation.reserved_amount) - roundMoney(batch.net_settlement_amount)) > 0.01) {
        throw new Error('Reservation amount does not match settlement batch net amount');
      }

      const existing = await trx('payout_instructions')
        .where('tenant_id', batch.tenant_id)
        .where('settlement_batch_id', batch.id)
        .whereIn('payout_status', LIVE_PAYOUT_STATUSES)
        .forUpdate()
        .first();

      if (existing) {
        const signal = await payoutSignalService.createOrUpdateSignal({
          tenantId: batch.tenant_id,
          signalType: 'DUPLICATE_PAYOUT_ATTEMPT',
          sourceType: 'PAYOUT_INSTRUCTION',
          sourceId: existing.id,
          payoutInstructionId: existing.id,
          settlementBatchId: batch.id,
          reservationId: reservation.id,
          merchantId: batch.merchant_id,
          impactAmount: existing.payout_amount,
          currency: existing.currency,
          description: `Duplicate payout instruction attempt for settlement batch ${batch.batch_ref}`,
          correlationId,
          metadata: { existing_payout_status: existing.payout_status }
        }, trx);
        return { payoutInstruction: existing, reservation, batch, duplicate: true, signals: [signal] };
      }

      const bankIdempotencyKey = this.bankIdempotencyKeyFor({ tenantId: batch.tenant_id, batch, reservation });
      const [instruction] = await trx('payout_instructions')
        .insert({
          id: uuidv4(),
          tenant_id: batch.tenant_id,
          settlement_id: null,
          settlement_batch_id: batch.id,
          reservation_id: reservation.id,
          settlement_ref: null,
          batch_ref: batch.batch_ref,
          merchant_id: batch.merchant_id,
          beneficiary_id: batch.beneficiary_id,
          bank_account_id: batch.bank_account_id,
          payout_amount: roundMoney(batch.net_settlement_amount).toFixed(2),
          currency: batch.currency,
          payout_status: 'READY',
          bank_idempotency_key: bankIdempotencyKey,
          retry_count: 0,
          max_retries: 3,
          correlation_id: correlationId || null,
          metadata: {
            requested_by: requestedBy,
            reservation_ref: reservation.reservation_ref,
            created_from_batch: true
          }
        })
        .returning('*');

      await trx('settlement_batches')
        .where('id', batch.id)
        .update({
          batch_status: 'READY_FOR_PAYOUT',
          payout_instruction_id: instruction.id,
          updated_at: new Date()
        });

      const signal = await payoutSignalService.createOrUpdateSignal({
        tenantId: batch.tenant_id,
        signalType: 'PAYOUT_READY_FOR_BANK_SUBMISSION',
        sourceType: 'PAYOUT_INSTRUCTION',
        sourceId: instruction.id,
        payoutInstructionId: instruction.id,
        settlementBatchId: batch.id,
        reservationId: reservation.id,
        merchantId: batch.merchant_id,
        impactAmount: instruction.payout_amount,
        currency: instruction.currency,
        description: `Payout instruction ${instruction.id} is ready for bank submission`,
        correlationId,
        metadata: {
          batch_ref: batch.batch_ref,
          reservation_ref: reservation.reservation_ref
        }
      }, trx);

      logger.info('Payout instruction created from settlement batch', {
        tenant_id: batch.tenant_id,
        batch_id: batch.id,
        payout_instruction_id: instruction.id,
        reservation_id: reservation.id,
        correlation_id: correlationId || null
      });

      return { payoutInstruction: instruction, reservation, batch, duplicate: false, signals: [signal] };
    });
  }

  async nextAttemptNumber(payoutInstructionId, trx) {
    const row = await trx('payout_attempts')
      .where('payout_instruction_id', payoutInstructionId)
      .max('attempt_number as max_attempt')
      .first();
    return Number(row?.max_attempt || 0) + 1;
  }

  async emitSuccessOutbox({ trx, payoutInstruction, response, correlationId }) {
    const event = await outboxService.createEvent({
      tenantId: payoutInstruction.tenant_id,
      aggregateType: 'payout_instruction',
      aggregateId: payoutInstruction.id,
      eventType: 'payout.successful',
      idempotencyKey: `payout.successful:${payoutInstruction.tenant_id}:${payoutInstruction.id}`,
      correlationId,
      payload: {
        payoutInstructionId: payoutInstruction.id,
        reservationId: payoutInstruction.reservation_id,
        settlementBatchId: payoutInstruction.settlement_batch_id,
        batchRef: payoutInstruction.batch_ref,
        merchantId: payoutInstruction.merchant_id,
        amount: payoutInstruction.payout_amount,
        settlementAmount: payoutInstruction.payout_amount,
        currency: payoutInstruction.currency,
        providerName: response.providerName || payoutInstruction.provider_name,
        providerPayoutId: response.providerPayoutId || payoutInstruction.provider_payout_id,
        utrNumber: response.utrNumber || payoutInstruction.utr_number,
        bankReferenceNumber: response.bankReferenceNumber || payoutInstruction.bank_reference_number,
        bankTransactionId: response.bankTransactionId || payoutInstruction.bank_transaction_id
      }
    }, trx);
    return event;
  }

  async emitReversalOutbox({ trx, payoutInstruction, response, eventType, correlationId }) {
    const event = await outboxService.createEvent({
      tenantId: payoutInstruction.tenant_id,
      aggregateType: 'payout_instruction',
      aggregateId: payoutInstruction.id,
      eventType,
      idempotencyKey: `${eventType}:${payoutInstruction.tenant_id}:${payoutInstruction.id}:${response.providerStatus || response.status || ''}`,
      correlationId,
      payload: {
        payoutInstructionId: payoutInstruction.id,
        reservationId: payoutInstruction.reservation_id,
        settlementBatchId: payoutInstruction.settlement_batch_id,
        batchRef: payoutInstruction.batch_ref,
        merchantId: payoutInstruction.merchant_id,
        amount: payoutInstruction.payout_amount,
        settlementAmount: payoutInstruction.payout_amount,
        currency: payoutInstruction.currency,
        providerName: response.providerName || payoutInstruction.provider_name,
        providerPayoutId: response.providerPayoutId || payoutInstruction.provider_payout_id,
        utrNumber: response.utrNumber || payoutInstruction.utr_number,
        bankReferenceNumber: response.bankReferenceNumber || payoutInstruction.bank_reference_number,
        bankTransactionId: response.bankTransactionId || payoutInstruction.bank_transaction_id,
        reason: response.returnReason || response.failureReason || response.providerStatusReason || null
      }
    }, trx);
    return event;
  }

  async applyProviderOutcome({ trx, payoutInstruction, response, attempt = null, providerEvent = null, correlationId }) {
    const status = String(response.status || response.providerStatus).toUpperCase();
    const currentStatus = payoutInstruction.payout_status;
    const currentMetadata = parseJson(payoutInstruction.metadata);

    if (currentStatus === 'SUCCESS' && ['FAILED', 'REJECTED', 'TIMEOUT'].includes(status)) {
      const signal = await payoutSignalService.createOrUpdateSignal({
        tenantId: payoutInstruction.tenant_id,
        signalType: 'PAYOUT_STATUS_CONFLICT',
        sourceType: providerEvent ? 'PROVIDER_EVENT' : 'PAYOUT_INSTRUCTION',
        sourceId: providerEvent?.id || payoutInstruction.id,
        payoutInstructionId: payoutInstruction.id,
        payoutAttemptId: attempt?.id || null,
        providerEventId: providerEvent?.id || null,
        settlementBatchId: payoutInstruction.settlement_batch_id,
        reservationId: payoutInstruction.reservation_id,
        merchantId: payoutInstruction.merchant_id,
        impactAmount: payoutInstruction.payout_amount,
        currency: payoutInstruction.currency,
        description: `Provider status ${status} conflicts with local payout status ${currentStatus}`,
        correlationId,
        metadata: {
          local_status: currentStatus,
          provider_status: status,
          provider_payout_id: response.providerPayoutId || payoutInstruction.provider_payout_id
        }
      }, trx);
      return { payoutInstruction, signal, conflict: true };
    }

    if (currentStatus === status) {
      return { payoutInstruction, duplicate: true };
    }

    payoutStateMachine.assertTransitionAllowed(currentStatus, status);

    const patch = {
      payout_status: status,
      provider_name: response.providerName || payoutInstruction.provider_name,
      provider_payout_id: response.providerPayoutId || payoutInstruction.provider_payout_id,
      provider_status: response.providerStatus || status,
      utr_number: response.utrNumber || payoutInstruction.utr_number,
      bank_reference_number: response.bankReferenceNumber || payoutInstruction.bank_reference_number,
      bank_transaction_id: response.bankTransactionId || payoutInstruction.bank_transaction_id,
      provider_status_reason: response.failureReason || response.returnReason || payoutInstruction.provider_status_reason,
      failure_reason: ['FAILED', 'REJECTED', 'TIMEOUT'].includes(status) ? response.failureReason || response.providerStatusReason || payoutInstruction.failure_reason : payoutInstruction.failure_reason,
      return_reason: ['RETURNED', 'REVERSED'].includes(status) ? response.returnReason || response.providerStatusReason || payoutInstruction.return_reason : payoutInstruction.return_reason,
      raw_bank_response: response.rawResponse || payoutInstruction.raw_bank_response || {},
      raw_callback_payload: providerEvent?.raw_payload || payoutInstruction.raw_callback_payload || {},
      correlation_id: correlationId || payoutInstruction.correlation_id,
      updated_at: new Date(),
      metadata: {
        ...currentMetadata,
        last_provider_outcome: {
          status,
          provider_status: response.providerStatus || status,
          provider_payout_id: response.providerPayoutId || payoutInstruction.provider_payout_id,
          source: providerEvent ? 'callback' : 'submit_or_verify',
          at: new Date().toISOString()
        }
      },
      ...timestampPatch(status)
    };

    let outboxEvent = null;
    if (status === 'SUCCESS') {
      outboxEvent = await this.emitSuccessOutbox({ trx, payoutInstruction: { ...payoutInstruction, ...patch }, response, correlationId });
      patch.outbox_event_id = outboxEvent.id;
    } else if ((status === 'RETURNED' || status === 'REVERSED') && payoutInstruction.ledger_transaction_id) {
      const eventType = status === 'RETURNED' ? 'payout.returned' : 'payout.reversed';
      outboxEvent = await this.emitReversalOutbox({ trx, payoutInstruction: { ...payoutInstruction, ...patch }, response, eventType, correlationId });
      patch.outbox_event_id = outboxEvent.id;
    }

    const [updated] = await trx('payout_instructions')
      .where('id', payoutInstruction.id)
      .update(patch)
      .returning('*');

    let signal = null;
    if (NON_SUCCESS_SIGNALS[status]) {
      signal = await payoutSignalService.createOrUpdateSignal({
        tenantId: updated.tenant_id,
        signalType: NON_SUCCESS_SIGNALS[status],
        sourceType: attempt ? 'PAYOUT_ATTEMPT' : (providerEvent ? 'PROVIDER_EVENT' : 'PAYOUT_INSTRUCTION'),
        sourceId: attempt?.id || providerEvent?.id || updated.id,
        payoutInstructionId: updated.id,
        payoutAttemptId: attempt?.id || null,
        providerEventId: providerEvent?.id || null,
        settlementBatchId: updated.settlement_batch_id,
        reservationId: updated.reservation_id,
        merchantId: updated.merchant_id,
        impactAmount: updated.payout_amount,
        currency: updated.currency,
        description: `Payout ${updated.id} moved to ${status}: ${response.failureReason || response.returnReason || 'awaiting final bank outcome'}`,
        correlationId,
        metadata: {
          provider_status: response.providerStatus || status,
          provider_payout_id: response.providerPayoutId || updated.provider_payout_id
        }
      }, trx);
    }

    if (status === 'RETURNED' || status === 'REVERSED') {
      signal = await payoutSignalService.createOrUpdateSignal({
        tenantId: updated.tenant_id,
        signalType: status === 'RETURNED' ? 'PAYOUT_RETURNED' : 'PAYOUT_REVERSED',
        sourceType: providerEvent ? 'PROVIDER_EVENT' : 'PAYOUT_INSTRUCTION',
        sourceId: providerEvent?.id || updated.id,
        payoutInstructionId: updated.id,
        providerEventId: providerEvent?.id || null,
        settlementBatchId: updated.settlement_batch_id,
        reservationId: updated.reservation_id,
        merchantId: updated.merchant_id,
        impactAmount: updated.payout_amount,
        currency: updated.currency,
        description: `Payout ${updated.id} was ${status.toLowerCase()} by bank/provider`,
        correlationId,
        metadata: {
          provider_status: response.providerStatus || status,
          reason: response.returnReason || response.failureReason || null,
          outbox_event_id: outboxEvent?.id || null
        }
      }, trx);
    }

    return { payoutInstruction: updated, outboxEvent, signal };
  }

  async submitPayout({ payoutInstructionId, tenantId = null, submittedBy = null, correlationId = requestContext.getCorrelationId() }) {
    let payoutQuery = db.knex('payout_instructions').where('id', payoutInstructionId);
    if (tenantId) payoutQuery = payoutQuery.where('tenant_id', tenantId);
    const payout = await payoutQuery.first();
    if (!payout) throw new Error('Payout instruction not found');

    if (payout.payout_status === 'SUCCESS') {
      return { payoutInstruction: payout, duplicate: true };
    }

    if (payout.payout_status !== 'READY') {
      if (['SUBMITTED', 'ACCEPTED', 'QUEUED', 'PROCESSING'].includes(payout.payout_status)) {
        await payoutSignalService.createOrUpdateSignal({
          tenantId: payout.tenant_id,
          signalType: 'DUPLICATE_PAYOUT_ATTEMPT',
          sourceType: 'PAYOUT_INSTRUCTION',
          sourceId: payout.id,
          payoutInstructionId: payout.id,
          settlementBatchId: payout.settlement_batch_id,
          reservationId: payout.reservation_id,
          merchantId: payout.merchant_id,
          impactAmount: payout.payout_amount,
          currency: payout.currency,
          description: `Duplicate payout submit attempted while payout is ${payout.payout_status}`,
          correlationId
        });
        return { payoutInstruction: payout, duplicate: true };
      }
      throw new Error(`Cannot submit payout in status ${payout.payout_status}`);
    }

    const reservation = await db.knex('settlement_fund_reservations')
      .where('id', payout.reservation_id)
      .where('tenant_id', payout.tenant_id)
      .first();
    if (!reservation || reservation.reservation_status !== 'ACTIVE') {
      await payoutSignalService.createOrUpdateSignal({
        tenantId: payout.tenant_id,
        signalType: 'PAYOUT_WITHOUT_RESERVATION',
        sourceType: 'PAYOUT_INSTRUCTION',
        sourceId: payout.id,
        payoutInstructionId: payout.id,
        settlementBatchId: payout.settlement_batch_id,
        reservationId: payout.reservation_id,
        merchantId: payout.merchant_id,
        impactAmount: payout.payout_amount,
        currency: payout.currency,
        description: `Payout ${payout.id} cannot be submitted without an active reservation`,
        correlationId
      });
      throw new Error('Active settlement reservation is required before payout submission');
    }

    const response = await bankPayoutAdapter.submitPayout({
      payoutInstruction: payout,
      bankIdempotencyKey: payout.bank_idempotency_key,
      correlationId
    });

    return db.knex.transaction(async (trx) => {
      let currentQuery = trx('payout_instructions').where('id', payoutInstructionId);
      if (tenantId) currentQuery = currentQuery.where('tenant_id', tenantId);
      const current = await currentQuery
        .forUpdate()
        .first();
      if (!current) throw new Error('Payout instruction not found');
      if (current.payout_status !== 'READY') return { payoutInstruction: current, duplicate: true };

      const attemptNumber = await this.nextAttemptNumber(current.id, trx);
      const [attempt] = await trx('payout_attempts')
        .insert({
          id: uuidv4(),
          tenant_id: current.tenant_id,
          payout_instruction_id: current.id,
          attempt_number: attemptNumber,
          provider_name: response.providerName,
          bank_idempotency_key: current.bank_idempotency_key,
          request_payload: {
            payout_instruction_id: current.id,
            amount: current.payout_amount,
            currency: current.currency,
            submitted_by: submittedBy
          },
          response_payload: response.rawResponse || response,
          provider_payout_id: response.providerPayoutId,
          provider_status: response.providerStatus,
          attempt_status: response.status,
          failure_reason: response.failureReason || null,
          submitted_at: new Date(),
          completed_at: ['SUCCESS', 'FAILED', 'REJECTED', 'TIMEOUT'].includes(response.status) ? new Date() : null,
          correlation_id: correlationId || null,
          metadata: { submitted_by: submittedBy }
        })
        .returning('*');

      await trx('payout_instructions')
        .where('id', current.id)
        .update({
          payout_status: 'SUBMITTED',
          provider_name: response.providerName,
          provider_payout_id: response.providerPayoutId,
          provider_status: 'SUBMITTED',
          submitted_at: new Date(),
          raw_bank_response: response.rawResponse || response,
          correlation_id: correlationId || current.correlation_id,
          updated_at: new Date(),
          metadata: {
            ...parseJson(current.metadata),
            submitted_by: submittedBy,
            last_attempt_id: attempt.id
          }
        });

      const submitted = { ...current, payout_status: 'SUBMITTED', provider_name: response.providerName, provider_payout_id: response.providerPayoutId };
      const outcome = await this.applyProviderOutcome({ trx, payoutInstruction: submitted, response, attempt, correlationId });
      return { ...outcome, attempt };
    });
  }

  async retryPayout({ payoutInstructionId, tenantId = null, requestedBy = null, correlationId = requestContext.getCorrelationId() }) {
    return db.knex.transaction(async (trx) => {
      let payoutQuery = trx('payout_instructions').where('id', payoutInstructionId);
      if (tenantId) payoutQuery = payoutQuery.where('tenant_id', tenantId);
      const payout = await payoutQuery.forUpdate().first();
      if (!payout) throw new Error('Payout instruction not found');
      if (!RETRYABLE_STATUSES.includes(payout.payout_status)) {
        throw new Error(`Cannot retry payout in status ${payout.payout_status}`);
      }
      if (Number(payout.retry_count || 0) >= Number(payout.max_retries || 3)) {
        throw new Error('Payout retry limit exceeded');
      }

      const currentMetadata = parseJson(payout.metadata);
      payoutStateMachine.assertTransitionAllowed(payout.payout_status, 'READY');
      const [updated] = await trx('payout_instructions')
        .where('id', payout.id)
        .update({
          payout_status: 'READY',
          retry_count: Number(payout.retry_count || 0) + 1,
          correlation_id: correlationId || payout.correlation_id,
          metadata: {
            ...currentMetadata,
            retry_requested_by: requestedBy,
            retry_requested_at: new Date().toISOString()
          },
          updated_at: new Date()
        })
        .returning('*');

      const signal = await payoutSignalService.createOrUpdateSignal({
        tenantId: payout.tenant_id,
        signalType: 'PAYOUT_RETRY_REQUIRED',
        sourceType: 'PAYOUT_INSTRUCTION',
        sourceId: payout.id,
        payoutInstructionId: payout.id,
        settlementBatchId: payout.settlement_batch_id,
        reservationId: payout.reservation_id,
        merchantId: payout.merchant_id,
        impactAmount: payout.payout_amount,
        currency: payout.currency,
        description: `Payout ${payout.id} is ready for controlled retry`,
        correlationId,
        metadata: { requested_by: requestedBy }
      }, trx);

      return { payoutInstruction: updated, signal };
    });
  }

  async verifyPayoutStatus({ payoutInstructionId, tenantId = null, correlationId = requestContext.getCorrelationId() }) {
    let payoutQuery = db.knex('payout_instructions').where('id', payoutInstructionId);
    if (tenantId) payoutQuery = payoutQuery.where('tenant_id', tenantId);
    const payout = await payoutQuery.first();
    if (!payout) throw new Error('Payout instruction not found');

    const response = await bankPayoutAdapter.verifyPayoutStatus({
      providerName: payout.provider_name || 'mockbank',
      providerPayoutId: payout.provider_payout_id,
      bankIdempotencyKey: payout.bank_idempotency_key,
      correlationId
    });

    return db.knex.transaction(async (trx) => {
      let currentQuery = trx('payout_instructions').where('id', payoutInstructionId);
      if (tenantId) currentQuery = currentQuery.where('tenant_id', tenantId);
      const current = await currentQuery.forUpdate().first();
      if (!current) throw new Error('Payout instruction not found');
      return this.applyProviderOutcome({ trx, payoutInstruction: current, response, correlationId });
    });
  }

  async listPayoutInstructions(filters = {}) {
    const {
      tenantId,
      merchantId,
      settlementBatchId,
      reservationId,
      payoutStatus,
      providerName,
      providerPayoutId,
      utrNumber,
      bankReferenceNumber,
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
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (settlementBatchId) query = query.where('settlement_batch_id', settlementBatchId);
    if (reservationId) query = query.where('reservation_id', reservationId);
    if (payoutStatus) query = query.where('payout_status', payoutStatus);
    if (providerName) query = query.where('provider_name', providerName);
    if (providerPayoutId) query = query.where('provider_payout_id', providerPayoutId);
    if (utrNumber) query = query.where('utr_number', utrNumber);
    if (bankReferenceNumber) query = query.where('bank_reference_number', bankReferenceNumber);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async getPayoutInstruction(id, tenantId = null) {
    let query = db.knex('payout_instructions').where('id', id);
    if (tenantId) query = query.where('tenant_id', tenantId);
    const payoutInstruction = await query.first();
    if (!payoutInstruction) throw new Error('Payout instruction not found');
    const attempts = await db.knex('payout_attempts')
      .where('tenant_id', payoutInstruction.tenant_id)
      .where('payout_instruction_id', payoutInstruction.id)
      .orderBy('attempt_number', 'asc');
    const providerEvents = await db.knex('payout_provider_events')
      .where('tenant_id', payoutInstruction.tenant_id)
      .where('payout_instruction_id', payoutInstruction.id)
      .orderBy('created_at', 'desc');
    return { payoutInstruction, attempts, providerEvents };
  }
}

module.exports = new PayoutExecutionService();
module.exports.PayoutExecutionService = PayoutExecutionService;
