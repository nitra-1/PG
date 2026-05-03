const ledgerService = require('../ledger/ledger-service');
const db = require('../../database');
const { generateEntries, ledgerEventType } = require('../ledger/accounting-templates');

function eventAmount(payload) {
  return Number(payload.amount || payload.refundAmount || payload.settlementAmount || payload.chargebackAmount);
}

function eventTransactionRef(event, payload, prefix) {
  if (payload.transactionRef) {
    return payload.transactionRef;
  }

  const businessRef = payload.reference ||
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

module.exports = {
  financialEventHandlers: {
    'payment.captured': handlePaymentCaptured,
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
