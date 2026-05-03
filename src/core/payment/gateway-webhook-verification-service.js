const crypto = require('crypto');

const config = require('../../config/config');

const DEFAULT_REPLAY_TOLERANCE_SECONDS = 300;

function headersLower(headers = {}) {
  return Object.entries(headers || {}).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value;
    return acc;
  }, {});
}

function rawBodyString(rawBody, parsedBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  if (typeof rawBody === 'string') return rawBody;
  if (rawBody) return String(rawBody);
  return JSON.stringify(parsedBody || {});
}

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left), 'hex');
  const rightBuffer = Buffer.from(String(right), 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    return new Date(value < 10000000000 ? value * 1000 : value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function amountFrom(value, gatewayName) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (gatewayName === 'razorpay' && Number.isInteger(numeric) && numeric >= 1000) {
    return numeric / 100;
  }
  return numeric;
}

class GatewayWebhookVerificationService {
  constructor(serviceConfig = config) {
    this.config = serviceConfig;
    this.replayToleranceSeconds = Number(
      process.env.WEBHOOK_REPLAY_TOLERANCE_SECONDS ||
      serviceConfig.webhooks?.replayToleranceSeconds ||
      DEFAULT_REPLAY_TOLERANCE_SECONDS
    );
  }

  secretFor(gatewayName) {
    if (gatewayName === 'mock') {
      return this.config.gateways?.mock?.webhookSecret || this.config.hmacSecret;
    }
    return this.config.gateways?.[gatewayName]?.webhookSecret || this.config.hmacSecret;
  }

  signatureHeaderFor(gatewayName, headers) {
    if (gatewayName === 'mock') {
      return headers['x-mock-signature'] || headers['x-razorpay-signature'];
    }
    if (gatewayName === 'razorpay') {
      return headers['x-razorpay-signature'];
    }
    return headers['x-webhook-signature'] || headers['x-signature'];
  }

  timestampHeader(headers) {
    return headers['x-webhook-timestamp'] || headers['x-razorpay-event-timestamp'] || headers['x-event-timestamp'];
  }

  verifyWebhookSignature({ gatewayName, rawBody, parsedBody, headers = {} }) {
    const normalizedGateway = String(gatewayName || '').toLowerCase();
    const normalizedHeaders = headersLower(headers);
    const signatureHeader = this.signatureHeaderFor(normalizedGateway, normalizedHeaders);
    const timestamp = this.timestampHeader(normalizedHeaders);
    const payload = rawBodyString(rawBody, parsedBody);
    const secret = this.secretFor(normalizedGateway);

    if (!secret) {
      return {
        verified: false,
        status: 'FAILED',
        reason: `Webhook secret not configured for gateway ${normalizedGateway}`,
        signatureHeader: signatureHeader || null
      };
    }

    if (!signatureHeader) {
      return {
        verified: false,
        status: 'FAILED',
        reason: 'Missing webhook signature header',
        signatureHeader: null
      };
    }

    if (timestamp) {
      const eventTime = toDate(Number(timestamp) || timestamp);
      if (!eventTime) {
        return {
          verified: false,
          status: 'FAILED',
          reason: 'Invalid webhook timestamp',
          signatureHeader
        };
      }
      const ageSeconds = Math.abs(Date.now() - eventTime.getTime()) / 1000;
      if (ageSeconds > this.replayToleranceSeconds) {
        return {
          verified: false,
          status: 'FAILED',
          replayRejected: true,
          reason: `Webhook timestamp outside replay tolerance: ${Math.round(ageSeconds)} seconds`,
          signatureHeader,
          eventTimestamp: eventTime
        };
      }
    }

    const signedPayload = timestamp ? `${timestamp}.${payload}` : payload;
    const expected = hmac(signedPayload, secret);
    const verified = safeEqual(signatureHeader, expected);

    return {
      verified,
      status: verified ? 'VERIFIED' : 'FAILED',
      reason: verified ? null : 'Webhook signature mismatch',
      signatureHeader,
      eventTimestamp: timestamp ? toDate(Number(timestamp) || timestamp) : null
    };
  }

  parseGatewayEvent({ gatewayName, rawPayload, headers = {} }) {
    const normalizedGateway = String(gatewayName || '').toLowerCase();
    const payload = rawPayload || {};
    const entity = payload.payload?.payment?.entity || payload.payment?.entity || payload.payment || payload;
    const notes = entity.notes || payload.notes || payload.metadata || {};
    const normalizedHeaders = headersLower(headers);

    const gatewayEventType = payload.event ||
      payload.event_type ||
      payload.eventType ||
      payload.gateway_event_type ||
      `${normalizedGateway}.payment.${entity.status || payload.status || 'unknown'}`;
    const gatewayEventId = payload.event_id ||
      payload.eventId ||
      payload.gateway_event_id ||
      normalizedHeaders['x-gateway-event-id'] ||
      null;

    const gatewayPaymentId = entity.id ||
      payload.payment_id ||
      payload.paymentId ||
      payload.gateway_payment_id ||
      payload.gatewayPaymentId ||
      null;
    const gatewayOrderId = entity.order_id ||
      payload.gateway_order_id ||
      payload.gatewayOrderId ||
      payload.order?.gateway_order_id ||
      null;
    const orderId = notes.order_id ||
      notes.orderId ||
      payload.internal_order_id ||
      payload.internalOrderId ||
      payload.order_id ||
      payload.orderId ||
      gatewayOrderId ||
      null;

    const amount = amountFrom(
      payload.gateway_amount ?? payload.gatewayAmount ?? entity.amount ?? payload.amount,
      normalizedGateway
    );

    return {
      gatewayName: normalizedGateway,
      gatewayEventId,
      gatewayEventType,
      gatewayPaymentId,
      gatewayOrderId,
      transactionRef: notes.transaction_ref || notes.transactionRef || payload.transaction_ref || payload.transactionRef || null,
      orderId,
      amount,
      currency: String(entity.currency || payload.currency || 'INR').toUpperCase(),
      status: entity.status || payload.status || payload.payment_status || payload.paymentStatus || 'pending',
      eventCreatedAt: toDate(entity.created_at || payload.created_at || payload.createdAt || normalizedHeaders['x-webhook-timestamp']),
      rawStatus: entity.status || payload.status || null,
      verificationStatus: payload.gateway_verification_status || payload.gatewayVerificationStatus || payload.verificationStatus || null,
      verificationAmount: amountFrom(payload.gateway_verification_amount ?? payload.gatewayVerificationAmount, normalizedGateway),
      verificationCurrency: payload.gateway_verification_currency || payload.gatewayVerificationCurrency || null
    };
  }

  async verifyGatewayPaymentStatus({ gatewayName, gatewayPaymentId, expectedAmount, expectedCurrency, event = {} }) {
    const normalizedGateway = String(gatewayName || '').toLowerCase();

    if (!gatewayPaymentId) {
      return {
        exists: false,
        verified: false,
        status: 'not_found',
        reason: 'Missing gateway payment id'
      };
    }

    if (normalizedGateway === 'mock') {
      const forced = event.verificationStatus;
      if (forced === 'not_found' || forced === 'missing') {
        return { exists: false, verified: false, status: 'not_found', reason: 'Mock gateway payment not found' };
      }
      return {
        exists: true,
        verified: true,
        status: forced || event.status,
        amount: event.verificationAmount ?? event.amount ?? Number(expectedAmount),
        currency: String(event.verificationCurrency || event.currency || expectedCurrency || 'INR').toUpperCase(),
        source: 'mock_gateway_adapter'
      };
    }

    if (normalizedGateway === 'razorpay') {
      // The adapter boundary is explicit. Until a live Razorpay API client is wired,
      // a verified Razorpay webhook is treated as signed gateway evidence.
      return {
        exists: true,
        verified: true,
        status: event.status,
        amount: event.amount ?? Number(expectedAmount),
        currency: String(event.currency || expectedCurrency || 'INR').toUpperCase(),
        source: 'signed_webhook_payload'
      };
    }

    return {
      exists: true,
      verified: true,
      status: event.status,
      amount: event.amount ?? Number(expectedAmount),
      currency: String(event.currency || expectedCurrency || 'INR').toUpperCase(),
      source: 'generic_signed_webhook_payload'
    };
  }
}

module.exports = new GatewayWebhookVerificationService();
module.exports.GatewayWebhookVerificationService = GatewayWebhookVerificationService;
module.exports.hmac = hmac;
module.exports.rawBodyString = rawBodyString;
