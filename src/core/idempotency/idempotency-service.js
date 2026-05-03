const crypto = require('crypto');
const db = require('../../database');
const requestContext = require('../context/request-context');

class IdempotencyConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.status = 409;
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

class IdempotencyInProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IdempotencyInProgressError';
    this.status = 409;
    this.code = 'IDEMPOTENCY_IN_PROGRESS';
  }
}

class IdempotencyService {
  constructor() {
    this.DEFAULT_TTL_HOURS = 24;
    this.LOCK_MINUTES = 10;
  }

  hashRequest(body) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(body || {}))
      .digest('hex');
  }

  async begin(params) {
    const {
      tenantId,
      scope,
      idempotencyKey,
      requestBody,
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!tenantId || !scope || !idempotencyKey) {
      throw new Error('tenantId, scope, and idempotencyKey are required');
    }

    const requestHash = this.hashRequest(requestBody);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    const lockedUntil = new Date(now.getTime() + this.LOCK_MINUTES * 60 * 1000);

    return db.knex.transaction(async (trx) => {
      const existing = await trx('idempotency_keys')
        .where({ tenant_id: tenantId, scope, idempotency_key: idempotencyKey })
        .forUpdate()
        .first();

      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new IdempotencyConflictError('Idempotency key was reused with a different request body');
        }

        if (existing.status === 'COMPLETED') {
          return {
            replay: true,
            status: existing.status,
            responseBody: existing.response_body
          };
        }

        if (existing.status === 'IN_PROGRESS' && existing.locked_until && new Date(existing.locked_until) > now) {
          throw new IdempotencyInProgressError('Request with this idempotency key is still in progress');
        }

        const [updated] = await trx('idempotency_keys')
          .where('id', existing.id)
          .update({
            status: 'IN_PROGRESS',
            locked_until: lockedUntil,
            correlation_id: correlationId,
            updated_at: now
          })
          .returning('*');

        return {
          replay: false,
          record: updated
        };
      }

      const [created] = await trx('idempotency_keys')
        .insert({
          tenant_id: tenantId,
          scope,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          status: 'IN_PROGRESS',
          locked_until: lockedUntil,
          expires_at: expiresAt,
          correlation_id: correlationId
        })
        .returning('*');

      return {
        replay: false,
        record: created
      };
    });
  }

  async complete(params) {
    const { tenantId, scope, idempotencyKey, responseBody } = params;

    await db.knex('idempotency_keys')
      .where({ tenant_id: tenantId, scope, idempotency_key: idempotencyKey })
      .update({
        status: 'COMPLETED',
        response_body: responseBody || {},
        locked_until: null,
        updated_at: new Date()
      });
  }

  async fail(params) {
    const { tenantId, scope, idempotencyKey, error } = params;

    await db.knex('idempotency_keys')
      .where({ tenant_id: tenantId, scope, idempotency_key: idempotencyKey })
      .update({
        status: 'FAILED',
        error_message: error?.message || String(error || 'Unknown error'),
        locked_until: null,
        updated_at: new Date()
      });
  }
}

module.exports = {
  idempotencyService: new IdempotencyService(),
  IdempotencyConflictError,
  IdempotencyInProgressError
};
