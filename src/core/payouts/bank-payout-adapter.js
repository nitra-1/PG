const crypto = require('crypto');

const DEFAULT_PROVIDER = 'mockbank';
const DEFAULT_SECRET = process.env.MOCK_BANK_WEBHOOK_SECRET || 'test-payout-secret';

const submitResponses = new Map();
const verifyResponses = new Map();

function rawString(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  if (typeof rawBody === 'string') return rawBody;
  return JSON.stringify(rawBody || {});
}

function hmac(rawBody, secret = DEFAULT_SECRET) {
  return crypto.createHmac('sha256', secret).update(rawString(rawBody)).digest('hex');
}

function normalizeStatus(status) {
  const normalized = String(status || 'ACCEPTED').toUpperCase();
  const allowed = ['ACCEPTED', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED', 'RETURNED', 'REVERSED', 'TIMEOUT'];
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported payout provider status: ${status}`);
  }
  return normalized;
}

function responseFor(map, key, fallback) {
  return map.get(key) || map.get('*') || fallback;
}

class BankPayoutAdapter {
  setMockSubmitResponse(key, response) {
    submitResponses.set(key || '*', response);
  }

  setMockVerifyResponse(key, response) {
    verifyResponses.set(key || '*', response);
  }

  resetMockResponses() {
    submitResponses.clear();
    verifyResponses.clear();
  }

  signMockPayload(rawBody, secret = DEFAULT_SECRET) {
    return hmac(rawBody, secret);
  }

  async submitPayout({ payoutInstruction, bankIdempotencyKey, correlationId }) {
    const configured = responseFor(submitResponses, bankIdempotencyKey, {});
    const status = normalizeStatus(configured.status || configured.providerStatus || 'ACCEPTED');
    const providerName = configured.providerName || payoutInstruction.provider_name || DEFAULT_PROVIDER;
    const providerPayoutId = configured.providerPayoutId || configured.provider_payout_id || `po_${bankIdempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`;

    return {
      providerName,
      providerPayoutId,
      providerStatus: status,
      status,
      utrNumber: configured.utrNumber || configured.utr_number || null,
      bankReferenceNumber: configured.bankReferenceNumber || configured.bank_reference_number || null,
      bankTransactionId: configured.bankTransactionId || configured.bank_transaction_id || null,
      failureReason: configured.failureReason || configured.failure_reason || null,
      returnReason: configured.returnReason || configured.return_reason || null,
      rawResponse: {
        provider_name: providerName,
        provider_payout_id: providerPayoutId,
        status,
        correlation_id: correlationId || null,
        ...configured
      }
    };
  }

  async verifyPayoutStatus({ providerName = DEFAULT_PROVIDER, providerPayoutId, bankIdempotencyKey, correlationId }) {
    const configured = responseFor(verifyResponses, providerPayoutId, responseFor(verifyResponses, bankIdempotencyKey, {}));
    const status = normalizeStatus(configured.status || configured.providerStatus || 'PROCESSING');

    return {
      providerName: configured.providerName || providerName,
      providerPayoutId: configured.providerPayoutId || configured.provider_payout_id || providerPayoutId,
      providerStatus: status,
      status,
      utrNumber: configured.utrNumber || configured.utr_number || null,
      bankReferenceNumber: configured.bankReferenceNumber || configured.bank_reference_number || null,
      bankTransactionId: configured.bankTransactionId || configured.bank_transaction_id || null,
      failureReason: configured.failureReason || configured.failure_reason || null,
      returnReason: configured.returnReason || configured.return_reason || null,
      rawResponse: {
        provider_name: configured.providerName || providerName,
        provider_payout_id: configured.providerPayoutId || configured.provider_payout_id || providerPayoutId,
        status,
        bank_idempotency_key: bankIdempotencyKey || null,
        correlation_id: correlationId || null,
        ...configured
      }
    };
  }

  async verifyCallbackSignature({ providerName, rawBody, headers }) {
    if (providerName !== DEFAULT_PROVIDER && providerName !== 'mock') {
      return { verified: false, status: 'FAILED', reason: `Unsupported payout provider: ${providerName}` };
    }

    const signature = headers['x-mock-signature'] || headers['x-payout-signature'];
    if (!signature) {
      return { verified: false, status: 'FAILED', reason: 'Missing payout callback signature' };
    }

    const expected = hmac(rawBody);
    if (signature !== expected) {
      return { verified: false, status: 'FAILED', reason: 'Invalid payout callback signature' };
    }

    const timestamp = headers['x-mock-timestamp'];
    if (timestamp) {
      const toleranceSeconds = Number(process.env.PAYOUT_WEBHOOK_REPLAY_TOLERANCE_SECONDS || 300);
      const ageSeconds = Math.abs(Date.now() - Number(timestamp)) / 1000;
      if (Number.isFinite(ageSeconds) && ageSeconds > toleranceSeconds) {
        return { verified: false, status: 'REPLAY_REJECTED', reason: 'Payout callback outside replay tolerance' };
      }
    }

    return { verified: true, status: 'VERIFIED' };
  }

  parseProviderEvent({ providerName = DEFAULT_PROVIDER, rawPayload }) {
    const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload || {};
    const status = normalizeStatus(payload.status || payload.provider_status);

    return {
      providerName,
      providerEventId: payload.provider_event_id || payload.event_id || null,
      providerEventType: payload.provider_event_type || payload.event_type || `payout.${status.toLowerCase()}`,
      providerPayoutId: payload.provider_payout_id || payload.providerPayoutId || null,
      bankIdempotencyKey: payload.bank_idempotency_key || payload.bankIdempotencyKey || null,
      status,
      providerStatus: status,
      eventCreatedAt: payload.event_created_at || payload.created_at || null,
      utrNumber: payload.utr_number || payload.utrNumber || null,
      bankReferenceNumber: payload.bank_reference_number || payload.bankReferenceNumber || null,
      bankTransactionId: payload.bank_transaction_id || payload.bankTransactionId || null,
      failureReason: payload.failure_reason || payload.failureReason || null,
      returnReason: payload.return_reason || payload.returnReason || null,
      rawPayload: payload
    };
  }
}

module.exports = new BankPayoutAdapter();
module.exports.BankPayoutAdapter = BankPayoutAdapter;
