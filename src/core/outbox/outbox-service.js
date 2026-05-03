const db = require('../../database');
const requestContext = require('../context/request-context');
const config = require('../../config/config');

class OutboxService {
  constructor() {
    this.DEFAULT_MAX_RETRIES = 3;
    this.DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 30000];
    this.LOCK_MS = 5 * 60 * 1000;
    this.PROCESSING_TIMEOUT_SECONDS = Number(config.outbox?.processingTimeoutSeconds || process.env.OUTBOX_PROCESSING_TIMEOUT_SECONDS || 300);
  }

  async createEvent(params, trx = db.knex) {
    const {
      tenantId,
      aggregateType,
      aggregateId,
      eventType,
      eventVersion = 1,
      idempotencyKey,
      payload,
      maxRetries = this.DEFAULT_MAX_RETRIES,
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!tenantId || !aggregateType || !aggregateId || !eventType || !idempotencyKey) {
      throw new Error('tenantId, aggregateType, aggregateId, eventType, and idempotencyKey are required');
    }

    const insertData = {
      tenant_id: tenantId,
      aggregate_type: aggregateType,
      aggregate_id: String(aggregateId),
      event_type: eventType,
      event_version: eventVersion,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId || null,
      payload: payload || {},
      status: 'PENDING',
      retry_count: 0,
      max_retries: maxRetries,
      next_retry_at: new Date(),
      processing_started_at: null
    };

    const [event] = await trx('outbox_events')
      .insert(insertData)
      .onConflict(['tenant_id', 'event_type', 'idempotency_key'])
      .merge({
        updated_at: new Date()
      })
      .returning('*');

    return event;
  }

  async getEvent(eventId) {
    return db.knex('outbox_events').where('id', eventId).first();
  }

  async recoverTimedOutEvents({ tenantId = null, limit = 100 } = {}) {
    return db.knex.transaction(async (trx) => {
      const timeoutAt = new Date(Date.now() - (this.PROCESSING_TIMEOUT_SECONDS * 1000));

      let staleQuery = trx('outbox_events')
        .where('status', 'PROCESSING')
        .where('processing_started_at', '<=', timeoutAt)
        .orderBy('processing_started_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked();

      if (tenantId) {
        staleQuery = staleQuery.where('tenant_id', tenantId);
      }

      const staleEvents = await staleQuery;
      const recovered = [];

      for (const event of staleEvents) {
        const retryCount = Number(event.retry_count || 0) + 1;
        const exhausted = retryCount >= Number(event.max_retries || this.DEFAULT_MAX_RETRIES);
        const [updated] = await trx('outbox_events')
          .where('id', event.id)
          .where('status', 'PROCESSING')
          .update({
            retry_count: retryCount,
            status: exhausted ? 'DLQ' : 'PENDING',
            last_error: `Processing timeout after ${this.PROCESSING_TIMEOUT_SECONDS} seconds`,
            locked_until: null,
            processing_started_at: null,
            next_retry_at: exhausted ? null : new Date(),
            dlq_at: exhausted ? new Date() : null,
            updated_at: new Date()
          })
          .returning('*');

        if (updated) {
          recovered.push(updated);
        }
      }

      return recovered;
    });
  }

  async fetchDueEvents({ limit = 25, tenantId = null } = {}) {
    return db.knex.transaction(async (trx) => {
      await this.recoverTimedOutEvents({ tenantId, limit });

      let query = trx('outbox_events')
        .whereIn('status', ['PENDING', 'FAILED'])
        .where(function() {
          this.whereNull('next_retry_at').orWhere('next_retry_at', '<=', new Date());
        })
        .where(function() {
          this.whereNull('locked_until').orWhere('locked_until', '<=', new Date());
        })
        .orderBy('created_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked();

      if (tenantId) {
        query = query.where('tenant_id', tenantId);
      }

      const events = await query;
      if (events.length === 0) {
        return [];
      }

      const ids = events.map(event => event.id);
      const now = new Date();
      await trx('outbox_events')
        .whereIn('id', ids)
        .whereIn('status', ['PENDING', 'FAILED'])
        .update({
          status: 'PROCESSING',
          locked_until: new Date(Date.now() + this.LOCK_MS),
          processing_started_at: now,
          updated_at: now
        });

      return events.map(event => ({
        ...event,
        status: 'PROCESSING'
      }));
    });
  }

  async markProcessed(eventId) {
    const [event] = await db.knex('outbox_events')
      .where('id', eventId)
      .where('status', 'PROCESSING')
      .update({
        status: 'PROCESSED',
        processed_at: new Date(),
        locked_until: null,
        processing_started_at: null,
        last_error: null,
        next_retry_at: null,
        updated_at: new Date()
      })
      .returning('*');

    if (!event) {
      throw new Error(`Invalid outbox transition to PROCESSED for event: ${eventId}`);
    }

    return event;
  }

  getNextRetryAt(retryCount) {
    const delay = this.DEFAULT_RETRY_DELAYS_MS[Math.min(retryCount - 1, this.DEFAULT_RETRY_DELAYS_MS.length - 1)];
    return new Date(Date.now() + delay);
  }

  async markFailed(eventId, error) {
    return db.knex.transaction(async (trx) => {
      const event = await trx('outbox_events')
        .where('id', eventId)
        .forUpdate()
        .first();

      if (!event) {
        throw new Error(`Outbox event not found: ${eventId}`);
      }

      const retryCount = Number(event.retry_count || 0) + 1;
      const exhausted = retryCount >= Number(event.max_retries || this.DEFAULT_MAX_RETRIES);

      if (event.status !== 'PROCESSING') {
        throw new Error(`Invalid outbox transition to FAILED/DLQ from ${event.status} for event: ${eventId}`);
      }

      const updateData = {
        retry_count: retryCount,
        status: exhausted ? 'DLQ' : 'FAILED',
        last_error: error?.stack || error?.message || String(error || 'Unknown error'),
        locked_until: null,
        processing_started_at: null,
        next_retry_at: exhausted ? null : this.getNextRetryAt(retryCount),
        dlq_at: exhausted ? new Date() : null,
        updated_at: new Date()
      };

      const [updated] = await trx('outbox_events')
        .where('id', eventId)
        .update(updateData)
        .returning('*');

      return updated;
    });
  }

  async getDlqEvents({ tenantId, limit = 100 } = {}) {
    let query = db.knex('outbox_events')
      .where('status', 'DLQ')
      .orderBy('dlq_at', 'desc')
      .limit(limit);

    if (tenantId) {
      query = query.where('tenant_id', tenantId);
    }

    return query;
  }

  async requeueDlq(eventId) {
    const [event] = await db.knex('outbox_events')
      .where('id', eventId)
      .where('status', 'DLQ')
      .update({
        status: 'PENDING',
        locked_until: null,
        processing_started_at: null,
        next_retry_at: new Date(),
        dlq_at: null,
        updated_at: new Date()
      })
      .returning('*');

    if (!event) {
      throw new Error(`DLQ event not found: ${eventId}`);
    }

    return event;
  }
}

module.exports = {
  outboxService: new OutboxService(),
  OutboxService
};
