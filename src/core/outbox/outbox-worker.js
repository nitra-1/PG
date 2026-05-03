const { outboxService } = require('./outbox-service');
const { financialEventHandlers } = require('./financial-event-handlers');
const logger = require('../logging/logger');

class OutboxWorker {
  constructor({ handlers = {}, service = outboxService, batchSize = 25 } = {}) {
    this.handlers = { ...financialEventHandlers, ...handlers };
    this.service = service;
    this.batchSize = batchSize;
  }

  registerHandler(eventType, handler) {
    this.handlers[eventType] = handler;
  }

  async processEvent(event) {
    const current = await this.service.getEvent(event.id);
    if (!current) {
      throw new Error(`Outbox event not found: ${event.id}`);
    }
    if (current.status === 'PROCESSED') {
      logger.info('Outbox event already processed', {
        event_id: event.id,
        event_type: event.event_type,
        correlation_id: event.correlation_id,
        idempotency_key: event.idempotency_key,
        retry_count: current.retry_count,
        final_status: current.status
      });
      return current;
    }
    if (current.status !== 'PROCESSING') {
      throw new Error(`Cannot process outbox event ${event.id} while status is ${current.status}`);
    }

    const handler = this.handlers[event.event_type];
    if (!handler) {
      throw new Error(`No outbox handler registered for event type: ${event.event_type}`);
    }

    logger.info('Processing outbox event', {
      event_id: event.id,
      event_type: event.event_type,
      correlation_id: event.correlation_id,
      idempotency_key: event.idempotency_key,
      retry_count: event.retry_count
    });

    await handler(event);
    const processed = await this.service.markProcessed(event.id);
    logger.info('Outbox event processed', {
      event_id: event.id,
      event_type: event.event_type,
      correlation_id: event.correlation_id,
      idempotency_key: event.idempotency_key,
      retry_count: processed.retry_count,
      final_status: processed.status
    });
    return processed;
  }

  async processBatch({ limit = this.batchSize, tenantId = null } = {}) {
    const events = await this.service.fetchDueEvents({ limit, tenantId });
    const results = [];

    for (const event of events) {
      try {
        const processed = await this.processEvent(event);
        results.push({ eventId: event.id, status: processed.status });
      } catch (error) {
        const failed = await this.service.markFailed(event.id, error);
        logger.error('Outbox event processing failed', {
          event_id: event.id,
          event_type: event.event_type,
          correlation_id: event.correlation_id,
          idempotency_key: event.idempotency_key,
          status: failed.status,
          retry_count: failed.retry_count,
          final_status: failed.status,
          error: error.message
        });
        results.push({
          eventId: event.id,
          status: failed.status,
          retryCount: failed.retry_count,
          error: error.message
        });
      }
    }

    return {
      processedCount: results.length,
      results
    };
  }
}

module.exports = {
  OutboxWorker
};
