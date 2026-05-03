const ledgerService = require('../ledger/ledger-service');
const db = require('../../database');
const { generateEntries, ledgerEventType } = require('../ledger/accounting-templates');

function eventAmount(payload) {
  return Number(
    payload.amount ||
    payload.netSettlementAmount ||
    payload.net_settlement_amount ||
    payload.refundAmount ||
    payload.settlementAmount ||
    payload.payoutAmount ||
    payload.payout_amount ||
    payload.chargebackAmount
  );
}

function eventTransactionRef(event, payload, prefix) {
  if (payload.transactionRef) {
    return payload.transactionRef;
  }

  const businessRef = payload.reference ||
    payload.gatewaySettlementId ||
    payload.gateway_settlement_id ||
    payload.batchId ||
    payload.batch_id ||
    payload.batchRef ||
    payload.payoutInstructionId ||
    payload.settlementRef ||
    payload.refundId ||
    payload.chargebackId;

  return businessRef ? `${prefix}-${businessRef}` : `${prefix}-${event.id}`;
}

async function postTemplatedLedgerEvent(event, { eventType, transactionRef, amount, sourceTransactionId, sourceOrderId, metadata = {} }) {
  const payload = event.payload || {};
  const templateEventType = eventType || payload.eventType || event.event_type;
  const entries = generateEntries({
    event_type: templateEventType,
    amount: amount || eventAmount(payload),
    metadata: {
      ...payload,
      ...metadata
    }
  });

  return ledgerService.postTransaction({
    tenantId: event.tenant_id,
    transactionRef: transactionRef || eventTransactionRef(event, payload, ledgerEventType(templateEventType).toUpperCase()),
    idempotencyKey: event.idempotency_key || `event:${event.id}`,
    eventType: ledgerEventType(templateEventType),
    sourceTransactionId: sourceTransactionId || payload.sourceTransactionId || payload.transactionId || event.aggregate_id,
    sourceOrderId: sourceOrderId || payload.orderId || payload.reference || payload.settlementRef,
    amount: amount || eventAmount(payload),
    currency: payload.currency || 'INR',
    description: payload.description || `Ledger posting for ${templateEventType}`,
    entries,
    metadata: {
      ...payload,
      template_event_type: templateEventType
    },
    createdBy: payload.createdBy || 'outbox_worker',
    eventId: event.id,
    correlationId: event.correlation_id,
    sourceEvent: event.event_type
  });
}

async function handlePaymentCaptured(event) {
  const payload = event.payload || {};
  const transactionRef = payload.transactionRef || payload.gatewayTransactionId;

  const sourceTransaction = await db.knex('transactions')
    .where('tenant_id', event.tenant_id)
    .where(function() {
      if (payload.transactionId) {
        this.where('id', payload.transactionId);
      }
      if (transactionRef) {
        this.orWhere('transaction_ref', transactionRef);
      }
    })
    .first();

  if (!sourceTransaction) {
    throw new Error(`Successful payment ledger source transaction not found for event ${event.id}`);
  }

  if (sourceTransaction.status !== 'success') {
    throw new Error(`Payment ledger source transaction ${sourceTransaction.id} is not success: ${sourceTransaction.status}`);
  }

  return postTemplatedLedgerEvent(event, {
    eventType: 'payment_success',
    transactionRef: sourceTransaction.transaction_ref,
    amount: Number(sourceTransaction.amount),
    sourceTransactionId: sourceTransaction.id,
    sourceOrderId: sourceTransaction.order_id,
    metadata: {
      merchantId: payload.merchantId || event.tenant_id,
      gateway: payload.gateway || sourceTransaction.gateway,
      orderId: sourceTransaction.order_id || payload.orderId || sourceTransaction.transaction_ref
    }
  });
}

async function handleGatewaySettlementReceived(event) {
  const payload = event.payload || {};
  const amount = eventAmount(payload);
  const batchId = payload.batchId || payload.batch_id || event.aggregate_id;
  const gatewaySettlementId = payload.gatewaySettlementId || payload.gateway_settlement_id || batchId;

  const result = await postTemplatedLedgerEvent(event, {
    eventType: 'gateway_settlement',
    transactionRef: `GATEWAY_SETTLEMENT-${gatewaySettlementId}`,
    amount,
    sourceTransactionId: batchId,
    sourceOrderId: gatewaySettlementId,
    metadata: {
      gateway: payload.gateway || payload.gateway_name,
      gatewaySettlementId,
      batchId,
      utrNumber: payload.utrNumber || payload.settlement_utr,
      bankReferenceNumber: payload.bankReferenceNumber || payload.bank_reference_number
    }
  });

  if (batchId && result?.transaction?.id) {
    await db.knex('gateway_settlement_lines')
      .where('tenant_id', event.tenant_id)
      .where('batch_id', batchId)
      .where('outbox_event_id', event.id)
      .update({
        ledger_transaction_id: result.transaction.id,
        updated_at: new Date()
      });
  }

  return result;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

async function loadPayoutInstruction(event) {
  const payload = event.payload || {};
  const payoutInstructionId = payload.payoutInstructionId || payload.payout_instruction_id || event.aggregate_id;
  const payoutInstruction = await db.knex('payout_instructions')
    .where('tenant_id', event.tenant_id)
    .where('id', payoutInstructionId)
    .first();

  if (!payoutInstruction) {
    throw new Error(`Payout instruction not found for event ${event.id}`);
  }

  return payoutInstruction;
}

async function handlePayoutSuccessful(event) {
  const payload = event.payload || {};
  const payoutInstruction = await loadPayoutInstruction(event);
  const amount = eventAmount({
    ...payload,
    settlementAmount: payload.settlementAmount || payoutInstruction.payout_amount
  });

  const result = await postTemplatedLedgerEvent(event, {
    eventType: 'merchant_payout',
    transactionRef: `PAYOUT-${payoutInstruction.id}`,
    amount,
    sourceTransactionId: payoutInstruction.id,
    sourceOrderId: payoutInstruction.batch_ref || payoutInstruction.settlement_ref || payoutInstruction.id,
    metadata: {
      payoutInstructionId: payoutInstruction.id,
      reservationId: payoutInstruction.reservation_id,
      settlementBatchId: payoutInstruction.settlement_batch_id,
      batchRef: payoutInstruction.batch_ref,
      merchantId: payoutInstruction.merchant_id || payload.merchantId,
      settlementAmount: amount,
      utrNumber: payload.utrNumber || payoutInstruction.utr_number,
      bankReferenceNumber: payload.bankReferenceNumber || payoutInstruction.bank_reference_number,
      bankTransactionId: payload.bankTransactionId || payoutInstruction.bank_transaction_id
    }
  });

  const ledgerTransactionId = result?.transaction?.id;
  if (ledgerTransactionId) {
    const existingMetadata = parseMetadata(payoutInstruction.metadata);
    await db.knex('payout_instructions')
      .where('tenant_id', event.tenant_id)
      .where('id', payoutInstruction.id)
      .update({
        ledger_transaction_id: ledgerTransactionId,
        outbox_event_id: event.id,
        metadata: {
          ...existingMetadata,
          payout_success_ledger_transaction_id: ledgerTransactionId,
          payout_success_outbox_event_id: event.id
        },
        updated_at: new Date()
      });

    if (payoutInstruction.reservation_id) {
      await db.knex('settlement_fund_reservations')
        .where('tenant_id', event.tenant_id)
        .where('id', payoutInstruction.reservation_id)
        .where('reservation_status', 'ACTIVE')
        .update({
          reservation_status: 'CONSUMED',
          consumed_at: new Date(),
          updated_at: new Date()
        });
    }

    if (payoutInstruction.settlement_batch_id) {
      await db.knex('settlement_batches')
        .where('tenant_id', event.tenant_id)
        .where('id', payoutInstruction.settlement_batch_id)
        .update({
          batch_status: 'PAYOUT_CREATED',
          payout_instruction_id: payoutInstruction.id,
          updated_at: new Date()
        });

      await db.knex('settlement_items')
        .where('tenant_id', event.tenant_id)
        .where('batch_id', payoutInstruction.settlement_batch_id)
        .whereIn('item_status', ['RESERVED', 'ELIGIBLE'])
        .update({
          item_status: 'SETTLED',
          updated_at: new Date()
        });
    }
  }

  return result;
}

async function handlePayoutReturnedOrReversed(event, templateEventType) {
  const payload = event.payload || {};
  const payoutInstruction = await loadPayoutInstruction(event);

  if (!payoutInstruction.ledger_transaction_id) {
    throw new Error(`Cannot post ${templateEventType} without prior payout success ledger transaction`);
  }

  const amount = eventAmount({
    ...payload,
    settlementAmount: payload.settlementAmount || payoutInstruction.payout_amount
  });
  const result = await postTemplatedLedgerEvent(event, {
    eventType: templateEventType,
    transactionRef: `${templateEventType.toUpperCase()}-${payoutInstruction.id}`,
    amount,
    sourceTransactionId: payoutInstruction.id,
    sourceOrderId: payoutInstruction.batch_ref || payoutInstruction.settlement_ref || payoutInstruction.id,
    metadata: {
      payoutInstructionId: payoutInstruction.id,
      reservationId: payoutInstruction.reservation_id,
      settlementBatchId: payoutInstruction.settlement_batch_id,
      batchRef: payoutInstruction.batch_ref,
      merchantId: payoutInstruction.merchant_id || payload.merchantId,
      settlementAmount: amount,
      utrNumber: payload.utrNumber || payoutInstruction.utr_number,
      bankReferenceNumber: payload.bankReferenceNumber || payoutInstruction.bank_reference_number,
      bankTransactionId: payload.bankTransactionId || payoutInstruction.bank_transaction_id,
      reason: payload.reason || payoutInstruction.return_reason || payoutInstruction.failure_reason
    }
  });

  const ledgerTransactionId = result?.transaction?.id;
  if (ledgerTransactionId) {
    const current = await db.knex('payout_instructions')
      .where('tenant_id', event.tenant_id)
      .where('id', payoutInstruction.id)
      .first();
    const metadataKey = templateEventType === 'payout_returned'
      ? 'payout_returned_ledger_transaction_id'
      : 'payout_reversed_ledger_transaction_id';

    await db.knex('payout_instructions')
      .where('tenant_id', event.tenant_id)
      .where('id', payoutInstruction.id)
      .update({
        outbox_event_id: event.id,
        metadata: {
          ...parseMetadata(current?.metadata),
          [metadataKey]: ledgerTransactionId,
          last_reversal_outbox_event_id: event.id
        },
        updated_at: new Date()
      });
  }

  return result;
}

module.exports = {
  financialEventHandlers: {
    'payment.captured': handlePaymentCaptured,
    'gateway.settlement.received': handleGatewaySettlementReceived,
    'payout.successful': handlePayoutSuccessful,
    'payout.returned': (event) => handlePayoutReturnedOrReversed(event, 'payout_returned'),
    'payout.reversed': (event) => handlePayoutReturnedOrReversed(event, 'payout_reversed'),
    'gateway_settlement': (event) => postTemplatedLedgerEvent(event, { eventType: 'gateway_settlement' }),
    'platform_fee': (event) => postTemplatedLedgerEvent(event, { eventType: 'platform_fee' }),
    'gateway_fee': (event) => postTemplatedLedgerEvent(event, { eventType: 'gateway_fee' }),
    'merchant_payout': (event) => postTemplatedLedgerEvent(event, { eventType: 'merchant_payout' }),
    'refund': (event) => postTemplatedLedgerEvent(event, { eventType: 'refund' }),
    'refund_completed': (event) => postTemplatedLedgerEvent(event, { eventType: 'refund' }),
    'chargeback': (event) => postTemplatedLedgerEvent(event, { eventType: 'chargeback' }),
    'chargeback_reversal': (event) => postTemplatedLedgerEvent(event, { eventType: 'chargeback_reversal' }),
    'ledger.reversal.requested': async (event) => {
      const payload = event.payload || {};
      return ledgerService.reverseTransaction({
        tenantId: event.tenant_id,
        originalTransactionId: payload.originalTransactionId,
        reason: payload.reason,
        createdBy: payload.createdBy || 'outbox_worker',
        eventId: event.id,
        correlationId: event.correlation_id,
        idempotencyKey: event.idempotency_key
      });
    }
  }
};
