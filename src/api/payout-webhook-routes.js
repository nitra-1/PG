const express = require('express');

const db = require('../database');
const bankPayoutAdapter = require('../core/payouts/bank-payout-adapter');
const payoutCallbackIngestionService = require('../core/payouts/payout-callback-ingestion-service');

function parsedBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8') || '{}');
    } catch (error) {
      return {};
    }
  }
  return req.body || {};
}

function rawBody(req) {
  if (req.rawBody) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(JSON.stringify(req.body || {}));
}

async function deriveTenantId(providerName, body) {
  const parsed = bankPayoutAdapter.parseProviderEvent({ providerName, rawPayload: body });
  let query = db.knex('payout_instructions');
  if (parsed.providerPayoutId) {
    query = query.where('provider_payout_id', parsed.providerPayoutId);
  } else if (parsed.bankIdempotencyKey) {
    query = query.where('bank_idempotency_key', parsed.bankIdempotencyKey);
  } else {
    return null;
  }
  const payout = await query.first();
  return payout?.tenant_id || null;
}

module.exports = function createPayoutWebhookRoutes() {
  const router = express.Router();

  router.post('/:providerName', async (req, res) => {
    try {
      const body = parsedBody(req);
      const tenantId = await deriveTenantId(req.params.providerName, body);
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'Unable to derive tenant from payout callback evidence',
          correlationId: req.correlationId
        });
      }

      const result = await payoutCallbackIngestionService.ingestPayoutCallback({
        tenantId,
        providerName: req.params.providerName,
        rawBody: rawBody(req),
        parsedBody: body,
        headers: req.headers,
        correlationId: req.correlationId
      });

      res.status(202).json({
        success: result.processed !== false,
        providerEventId: result.providerEvent?.id,
        processingStatus: result.status || result.providerEvent?.processing_status,
        duplicate: Boolean(result.duplicate),
        correlationId: req.correlationId
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message, correlationId: req.correlationId });
    }
  });

  return router;
};
