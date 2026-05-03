const db = require('../../database');
const { outboxService } = require('../outbox/outbox-service');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

class GatewaySettlementLedgerService {
  idempotencyKeyForBatch(batch) {
    const businessRef = batch.gateway_settlement_id || batch.id;
    return `gateway_settlement_received:${batch.tenant_id}:${batch.gateway_name}:${businessRef}`;
  }

  async emitGatewaySettlementReceived(batch, trx = db.knex) {
    if (!batch?.id || !batch?.tenant_id || !batch?.gateway_name) {
      throw new Error('Valid gateway settlement batch is required');
    }

    const amount = Number(batch.net_settlement_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Gateway settlement net_settlement_amount must be greater than 0 to post escrow movement');
    }

    const event = await outboxService.createEvent({
      tenantId: batch.tenant_id,
      aggregateType: 'gateway_settlement_batch',
      aggregateId: batch.id,
      eventType: 'gateway.settlement.received',
      idempotencyKey: this.idempotencyKeyForBatch(batch),
      correlationId: batch.correlation_id || requestContext.getCorrelationId(),
      payload: {
        tenant_id: batch.tenant_id,
        gateway_name: batch.gateway_name,
        gateway: batch.gateway_name,
        gateway_settlement_id: batch.gateway_settlement_id,
        gatewaySettlementId: batch.gateway_settlement_id,
        batch_id: batch.id,
        batchId: batch.id,
        gross_amount: String(batch.gross_amount || '0.00'),
        grossAmount: String(batch.gross_amount || '0.00'),
        total_gateway_fee: String(batch.total_gateway_fee || '0.00'),
        totalGatewayFee: String(batch.total_gateway_fee || '0.00'),
        total_gst_amount: String(batch.total_gst_amount || '0.00'),
        totalGstAmount: String(batch.total_gst_amount || '0.00'),
        total_adjustment_amount: String(batch.total_adjustment_amount || '0.00'),
        totalAdjustmentAmount: String(batch.total_adjustment_amount || '0.00'),
        net_settlement_amount: String(batch.net_settlement_amount || '0.00'),
        netSettlementAmount: String(batch.net_settlement_amount || '0.00'),
        amount: String(batch.net_settlement_amount || '0.00'),
        settlement_utr: batch.settlement_utr,
        utrNumber: batch.settlement_utr,
        bank_reference_number: batch.bank_reference_number,
        bankReferenceNumber: batch.bank_reference_number,
        currency: batch.currency || 'INR',
        correlation_id: batch.correlation_id || requestContext.getCorrelationId()
      }
    }, trx);

    await trx('gateway_settlement_lines')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batch.id)
      .where('reconciliation_status', 'MATCHED')
      .update({
        outbox_event_id: event.id,
        updated_at: new Date()
      });

    logger.info('Gateway settlement outbox event created', {
      tenant_id: batch.tenant_id,
      batch_id: batch.id,
      gateway_settlement_id: batch.gateway_settlement_id,
      outbox_event_id: event.id,
      idempotency_key: event.idempotency_key,
      correlation_id: event.correlation_id
    });

    return event;
  }
}

module.exports = new GatewaySettlementLedgerService();
module.exports.GatewaySettlementLedgerService = GatewaySettlementLedgerService;
