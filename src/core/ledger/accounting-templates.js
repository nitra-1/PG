/**
 * Accounting Templates
 *
 * Converts business financial events into debit/credit ledger entries.
 * These templates express financial meaning: assets held, liabilities owed,
 * revenue earned, and expenses/losses incurred.
 */

const LOGICAL_ACCOUNTS = {
  BANK_ESCROW: 'ESC-001',
  GATEWAY_RECEIVABLE: 'GTW-001-RZP',
  MERCHANT_PAYABLE: 'MER-002',
  MERCHANT_RECOVERABLE: 'MER-001',
  PLATFORM_FEE_REVENUE: 'REV-001',
  GATEWAY_FEE_EXPENSE: 'GTW-FEE-001',
  CHARGEBACK_LOSS: 'CHB-001'
};

const ACCOUNT_CODES = {
  ...LOGICAL_ACCOUNTS,

  // Backwards-compatible names used by older services/tests.
  ESCROW_BANK: LOGICAL_ACCOUNTS.BANK_ESCROW,
  GATEWAY_RAZORPAY: LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE,
  MERCHANT_RECEIVABLES: LOGICAL_ACCOUNTS.MERCHANT_RECOVERABLE,
  MERCHANT_PAYABLES: LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
  MERCHANT_SETTLEMENT: 'MER-003',
  GATEWAY_FEE_RAZORPAY: LOGICAL_ACCOUNTS.GATEWAY_FEE_EXPENSE,
  GATEWAY_FEE_PAYU: 'GTW-FEE-002',
  GATEWAY_FEE_CCAVENUE: 'GTW-FEE-003',
  GATEWAY_PAYABLES: 'GTW-PAY-001',
  PLATFORM_MDR: LOGICAL_ACCOUNTS.PLATFORM_FEE_REVENUE,
  PLATFORM_RECEIVABLES: 'REV-REC-001',
  CHARGEBACK_LIABILITY: LOGICAL_ACCOUNTS.CHARGEBACK_LOSS
};

const EVENT_ALIASES = {
  'payment.captured': 'payment_success',
  'gateway.settlement.received': 'gateway_settlement',
  'payout.successful': 'merchant_payout',
  'payout.returned': 'payout_returned',
  'payout.reversed': 'payout_reversed',
  refund_completed: 'refund',
  settlement: 'merchant_payout',
  chargeback_debit: 'chargeback'
};

const LEDGER_EVENT_TYPE_ALIASES = {
  refund: 'refund_completed',
  merchant_payout: 'settlement',
  payout_returned: 'settlement',
  payout_reversed: 'settlement',
  chargeback: 'chargeback_debit'
};

function canonicalEventType(eventType) {
  return EVENT_ALIASES[eventType] || eventType;
}

function ledgerEventType(eventType) {
  const canonical = canonicalEventType(eventType);
  return LEDGER_EVENT_TYPE_ALIASES[canonical] || canonical;
}

function metadataOf(eventOrMetadata) {
  if (!eventOrMetadata) return {};
  if (eventOrMetadata.metadata) return eventOrMetadata.metadata || {};
  if (eventOrMetadata.payload) return eventOrMetadata.payload || {};
  return eventOrMetadata;
}

function amountOf(eventOrMetadata, fieldName = 'amount') {
  const metadata = metadataOf(eventOrMetadata);
  const value = eventOrMetadata?.[fieldName] ?? metadata[fieldName] ?? metadata.amount;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return amount;
}

function entry(accountCode, entryType, amount, description, metadata = {}) {
  return {
    accountCode,
    entryType,
    amount,
    description,
    metadata
  };
}

function pair(debitAccount, creditAccount, amount, description, metadata = {}) {
  return [
    entry(debitAccount, 'debit', amount, description, metadata),
    entry(creditAccount, 'credit', amount, description, metadata)
  ];
}

function paymentSuccess(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event);
  return pair(
    LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE,
    LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
    amount,
    `Payment captured${metadata.orderId ? ` for order ${metadata.orderId}` : ''}`,
    {
      merchantId: metadata.merchantId,
      gateway: metadata.gateway
    }
  );
}

function gatewaySettlement(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event);
  return pair(
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE,
    amount,
    `Gateway settlement${metadata.gatewaySettlementId ? ` ${metadata.gatewaySettlementId}` : ''}`,
    {
      gateway: metadata.gateway,
      gatewaySettlementId: metadata.gatewaySettlementId,
      utrNumber: metadata.utrNumber
    }
  );
}

function platformFee(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event);
  return pair(
    LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
    LOGICAL_ACCOUNTS.PLATFORM_FEE_REVENUE,
    amount,
    `Platform fee${metadata.reference ? ` ${metadata.reference}` : ''}`,
    {
      merchantId: metadata.merchantId,
      orderId: metadata.orderId
    }
  );
}

function gatewayFee(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event);
  const creditAccount = metadata.feeSource === 'gateway_receivable'
    ? LOGICAL_ACCOUNTS.GATEWAY_RECEIVABLE
    : LOGICAL_ACCOUNTS.BANK_ESCROW;

  return pair(
    LOGICAL_ACCOUNTS.GATEWAY_FEE_EXPENSE,
    creditAccount,
    amount,
    `Gateway fee${metadata.reference ? ` ${metadata.reference}` : ''}`,
    {
      gateway: metadata.gateway,
      feeSource: metadata.feeSource || 'bank_escrow'
    }
  );
}

function merchantPayout(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event, 'settlementAmount');
  return pair(
    LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    amount,
    `Merchant payout${metadata.settlementRef ? ` ${metadata.settlementRef}` : ''}`,
    {
      merchantId: metadata.merchantId,
      settlementId: metadata.settlementId,
      utrNumber: metadata.utrNumber
    }
  );
}

function payoutReturned(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event, 'settlementAmount');
  return pair(
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    LOGICAL_ACCOUNTS.MERCHANT_PAYABLE,
    amount,
    `Payout returned${metadata.batchRef ? ` ${metadata.batchRef}` : ''}`,
    {
      merchantId: metadata.merchantId,
      payoutInstructionId: metadata.payoutInstructionId,
      batchRef: metadata.batchRef,
      utrNumber: metadata.utrNumber,
      reason: metadata.reason
    }
  );
}

function refund(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event, 'refundAmount');
  const afterPayout = metadata.afterPayout === true || metadata.refundTiming === 'after_payout';
  const debitAccount = afterPayout
    ? LOGICAL_ACCOUNTS.MERCHANT_RECOVERABLE
    : LOGICAL_ACCOUNTS.MERCHANT_PAYABLE;

  return pair(
    debitAccount,
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    amount,
    `${afterPayout ? 'Post-payout' : 'Pre-payout'} refund${metadata.refundId ? ` ${metadata.refundId}` : ''}`,
    {
      merchantId: metadata.merchantId,
      refundId: metadata.refundId,
      orderId: metadata.orderId,
      afterPayout
    }
  );
}

function chargeback(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event, 'chargebackAmount');
  const recoverFromMerchant = metadata.recoverFromMerchant === true;
  const debitAccount = recoverFromMerchant
    ? LOGICAL_ACCOUNTS.MERCHANT_RECOVERABLE
    : LOGICAL_ACCOUNTS.CHARGEBACK_LOSS;

  return pair(
    debitAccount,
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    amount,
    `Chargeback${metadata.chargebackId ? ` ${metadata.chargebackId}` : ''}`,
    {
      merchantId: metadata.merchantId,
      chargebackId: metadata.chargebackId,
      orderId: metadata.orderId,
      recoverFromMerchant
    }
  );
}

function chargebackReversal(event) {
  const metadata = metadataOf(event);
  const amount = amountOf(event, 'chargebackAmount');
  const recoverFromMerchant = metadata.recoverFromMerchant === true;
  const creditAccount = recoverFromMerchant
    ? LOGICAL_ACCOUNTS.MERCHANT_RECOVERABLE
    : LOGICAL_ACCOUNTS.CHARGEBACK_LOSS;

  return pair(
    LOGICAL_ACCOUNTS.BANK_ESCROW,
    creditAccount,
    amount,
    `Chargeback reversal${metadata.chargebackId ? ` ${metadata.chargebackId}` : ''}`,
    {
      merchantId: metadata.merchantId,
      chargebackId: metadata.chargebackId,
      orderId: metadata.orderId,
      recoverFromMerchant
    }
  );
}

function manualAdjustment(event) {
  const metadata = metadataOf(event);
  if (!Array.isArray(metadata.entries) || metadata.entries.length === 0) {
    throw new Error('Manual adjustment requires explicit ledger entries');
  }
  return metadata.entries;
}

const templates = {
  payment_success: paymentSuccess,
  gateway_settlement: gatewaySettlement,
  platform_fee: platformFee,
  gateway_fee: gatewayFee,
  merchant_payout: merchantPayout,
  payout_returned: payoutReturned,
  payout_reversed: payoutReturned,
  refund,
  chargeback,
  chargeback_reversal: chargebackReversal,
  manual_adjustment: manualAdjustment,

  // Backwards-compatible aliases.
  refund_completed: refund,
  settlement: merchantPayout,
  'payout.successful': merchantPayout,
  'payout.returned': payoutReturned,
  'payout.reversed': payoutReturned,
  chargeback_debit: chargeback
};

function hasTemplate(eventType) {
  return Boolean(templates[canonicalEventType(eventType)]);
}

function generateEntries(event) {
  const eventType = canonicalEventType(event.event_type || event.eventType);
  const template = templates[eventType];
  if (!template) {
    throw new Error(`No accounting template for event type: ${event.event_type || event.eventType}`);
  }
  return template(event);
}

function buildEntries(eventType, params = {}) {
  return generateEntries({
    event_type: eventType,
    amount: params.amount ?? params.refundAmount ?? params.settlementAmount ?? params.chargebackAmount,
    metadata: params
  });
}

module.exports = {
  ACCOUNT_CODES,
  LOGICAL_ACCOUNTS,
  buildEntries,
  canonicalEventType,
  generateEntries,
  hasTemplate,
  ledgerEventType,
  templates
};
