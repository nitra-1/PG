const db = require('../../database');
const gatewaySettlementSignalService = require('./gateway-settlement-signal-service');
const { absDiff } = require('./gateway-fee-validation-service');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');

class GatewaySettlementReconciliationService {
  async getLine(lineOrId) {
    if (typeof lineOrId === 'object' && lineOrId?.id) return lineOrId;
    const line = await db.knex('gateway_settlement_lines').where('id', lineOrId).first();
    if (!line) throw new Error('Gateway settlement line not found');
    return line;
  }

  async findPaymentLedger(line) {
    if (!line.transaction_id) return null;
    return db.knex('ledger_transactions')
      .where('tenant_id', line.tenant_id)
      .where('source_transaction_id', line.transaction_id)
      .where('event_type', 'payment_success')
      .whereIn('status', ['posted', 'reversed'])
      .first();
  }

  async findGatewaySettlementLedger(line) {
    if (line.ledger_transaction_id) {
      const ledger = await db.knex('ledger_transactions')
        .where('id', line.ledger_transaction_id)
        .where('tenant_id', line.tenant_id)
        .first();
      if (ledger) return ledger;
    }

    if (!line.outbox_event_id) return null;
    return db.knex('ledger_transactions')
      .where('tenant_id', line.tenant_id)
      .where('metadata', '@>', JSON.stringify({ event_id: line.outbox_event_id }))
      .first();
  }

  async signalForLine(line, signalType, description, impactAmount = null, metadata = {}) {
    return gatewaySettlementSignalService.createOrUpdateSignal({
      tenantId: line.tenant_id,
      signalType,
      sourceType: 'RECONCILIATION',
      sourceId: line.id,
      batchId: line.batch_id,
      lineId: line.id,
      transactionId: line.transaction_id,
      transactionRef: line.transaction_ref,
      gatewayName: line.gateway_name,
      gatewaySettlementId: line.gateway_settlement_id,
      gatewayTransactionId: line.gateway_transaction_id || line.gateway_payment_id,
      impactAmount,
      currency: line.currency,
      description,
      correlationId: line.correlation_id || requestContext.getCorrelationId(),
      metadata
    });
  }

  async reconcileGatewaySettlementLine(lineOrId) {
    const line = await this.getLine(lineOrId);
    const batch = await db.knex('gateway_settlement_batches').where('id', line.batch_id).first();
    const transaction = line.transaction_id
      ? await db.knex('transactions').where('id', line.transaction_id).where('tenant_id', line.tenant_id).first()
      : null;

    let status = line.reconciliation_status;
    let reason = null;

    if (!transaction) {
      status = 'MISSING_TRANSACTION';
      reason = 'No matching internal transaction exists for gateway settlement line';
      await this.signalForLine(line, 'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT', reason, line.gross_amount);
    } else if (transaction.status !== 'success') {
      status = 'UNMATCHED';
      reason = `Matched transaction ${transaction.transaction_ref} is not captured: ${transaction.status}`;
      await this.signalForLine(line, 'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT', reason, line.gross_amount);
    } else if (absDiff(transaction.amount, line.gross_amount) > 0.01) {
      status = 'AMOUNT_MISMATCH';
      reason = `Transaction amount ${transaction.amount} differs from gateway gross ${line.gross_amount}`;
      await this.signalForLine(line, 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH', reason, absDiff(transaction.amount, line.gross_amount));
    } else if (Number(line.fee_discrepancy_amount || 0) > 0.01) {
      status = 'FEE_MISMATCH';
      reason = `Gateway fee discrepancy ${line.fee_discrepancy_amount}`;
      await this.signalForLine(line, 'GATEWAY_FEE_MISMATCH', reason, line.fee_discrepancy_amount);
    } else if (Number(line.gst_discrepancy_amount || 0) > 0.01) {
      status = 'GST_MISMATCH';
      reason = `Gateway GST discrepancy ${line.gst_discrepancy_amount}`;
      await this.signalForLine(line, 'GST_MISMATCH', reason, line.gst_discrepancy_amount);
    } else if (Number(line.net_discrepancy_amount || 0) > 0.01) {
      status = 'NET_MISMATCH';
      reason = `Gateway net discrepancy ${line.net_discrepancy_amount}`;
      await this.signalForLine(line, 'NET_SETTLEMENT_MISMATCH', reason, line.net_discrepancy_amount);
    } else if (!line.pricing_rule_id) {
      status = 'UNMATCHED';
      reason = 'No pricing rule was available when validating gateway settlement line';
      await this.signalForLine(line, 'PRICING_RULE_MISSING', reason, line.gateway_fee);
    } else {
      status = 'MATCHED';
    }

    const paymentLedger = await this.findPaymentLedger(line);
    if (transaction && !paymentLedger) {
      await this.signalForLine(
        line,
        'MISSING_GATEWAY_SETTLEMENT_LINE',
        `Payment ledger receivable is missing for transaction ${transaction.transaction_ref}`,
        transaction.amount,
        { transaction_id: transaction.id }
      );
    }

    const settlementLedger = await this.findGatewaySettlementLedger(line);
    if (batch?.import_status === 'COMPLETED' && !settlementLedger) {
      await this.signalForLine(
        line,
        'ESCROW_NOT_CREDITED',
        `Gateway settlement batch ${batch.id} has no posted receivable-to-escrow ledger transaction`,
        line.net_amount,
        { outbox_event_id: line.outbox_event_id }
      );
    }

    const [updated] = await db.knex('gateway_settlement_lines')
      .where('id', line.id)
      .update({
        reconciliation_status: status,
        metadata: {
          ...(typeof line.metadata === 'object' && line.metadata ? line.metadata : {}),
          last_reconciled_at: new Date().toISOString(),
          reconciliation_reason: reason
        },
        updated_at: new Date()
      })
      .returning('*');

    logger.info('Gateway settlement line reconciled', {
      tenant_id: line.tenant_id,
      line_id: line.id,
      batch_id: line.batch_id,
      transaction_ref: line.transaction_ref,
      reconciliation_status: status,
      correlation_id: line.correlation_id || requestContext.getCorrelationId()
    });

    return updated;
  }

  async reconcileGatewaySettlementBatch(batchId) {
    const batch = await db.knex('gateway_settlement_batches').where('id', batchId).first();
    if (!batch) throw new Error('Gateway settlement batch not found');

    const lines = await db.knex('gateway_settlement_lines').where('batch_id', batchId);
    const results = [];
    for (const line of lines) {
      results.push(await this.reconcileGatewaySettlementLine(line));
    }

    const byStatus = results.reduce((acc, line) => {
      acc[line.reconciliation_status] = (acc[line.reconciliation_status] || 0) + 1;
      return acc;
    }, {});

    return {
      batch,
      total: results.length,
      by_status: byStatus,
      lines: results
    };
  }

  async detectDelayedSettlements({ tenantId, gatewayName = null, olderThanDays = 2, limit = 100, correlationId = requestContext.getCorrelationId() }) {
    const cutoff = new Date(Date.now() - Number(olderThanDays) * 24 * 60 * 60 * 1000);
    let query = db.knex('transactions as t')
      .where('t.tenant_id', tenantId)
      .where('t.status', 'success')
      .where('t.completed_at', '<=', cutoff)
      .whereNotExists(function() {
        this.select(1)
          .from('gateway_settlement_lines as gsl')
          .whereRaw('gsl.tenant_id = t.tenant_id')
          .where(function() {
            this.whereRaw('gsl.transaction_id = t.id')
              .orWhereRaw('gsl.transaction_ref = t.transaction_ref')
              .orWhereRaw('gsl.gateway_transaction_id = t.gateway_transaction_id')
              .orWhereRaw('gsl.gateway_payment_id = t.gateway_transaction_id');
          })
          .whereIn('gsl.reconciliation_status', ['MATCHED', 'AMOUNT_MISMATCH', 'FEE_MISMATCH', 'GST_MISMATCH', 'NET_MISMATCH']);
      })
      .limit(Math.min(Number(limit) || 100, 500));

    if (gatewayName) query = query.where('t.gateway', String(gatewayName).toLowerCase());

    const delayed = await query.select('t.*');
    const signals = [];
    for (const transaction of delayed) {
      signals.push(await gatewaySettlementSignalService.createOrUpdateSignal({
        tenantId,
        signalType: 'GATEWAY_SETTLEMENT_DELAYED',
        sourceType: 'RECONCILIATION',
        sourceId: transaction.id,
        transactionId: transaction.id,
        transactionRef: transaction.transaction_ref,
        gatewayName: String(transaction.gateway || gatewayName || 'unknown').toLowerCase(),
        gatewayTransactionId: transaction.gateway_transaction_id,
        impactAmount: transaction.amount,
        currency: transaction.currency,
        description: `Captured transaction ${transaction.transaction_ref} has no gateway settlement line after ${olderThanDays} days`,
        correlationId,
        metadata: {
          completed_at: transaction.completed_at,
          cutoff: cutoff.toISOString()
        }
      }));
    }

    return {
      total: delayed.length,
      signals
    };
  }

  async listGatewaySettlementReconciliations(filters = {}) {
    const {
      tenantId,
      batchId,
      gatewayName,
      transactionRef,
      gatewayTransactionId,
      gatewayPaymentId,
      reconciliationStatus,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('gateway_settlement_lines')
      .orderBy('updated_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (batchId) query = query.where('batch_id', batchId);
    if (gatewayName) query = query.where('gateway_name', String(gatewayName).toLowerCase());
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (gatewayTransactionId) query = query.where('gateway_transaction_id', gatewayTransactionId);
    if (gatewayPaymentId) query = query.where('gateway_payment_id', gatewayPaymentId);
    if (reconciliationStatus) query = query.where('reconciliation_status', reconciliationStatus);
    if (from) query = query.where('updated_at', '>=', from);
    if (to) query = query.where('updated_at', '<=', to);

    return query;
  }
}

module.exports = new GatewaySettlementReconciliationService();
module.exports.GatewaySettlementReconciliationService = GatewaySettlementReconciliationService;
