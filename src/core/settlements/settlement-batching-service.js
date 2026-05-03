const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const settlementEligibilityService = require('./settlement-eligibility-service');
const settlementSignalService = require('./settlement-signal-service');

const OPEN_BATCH_STATUSES = ['DRAFT', 'ELIGIBILITY_CHECKED', 'RESERVED', 'RESERVATION_FAILED', 'READY_FOR_PAYOUT'];

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

class SettlementBatchingService {
  generateBatchRef({ tenantId, merchantId = null, cycleStart = null, cycleEnd = null }) {
    const scope = merchantId || tenantId;
    const start = cycleStart ? new Date(cycleStart).toISOString().slice(0, 10) : 'adhoc';
    const end = cycleEnd ? new Date(cycleEnd).toISOString().slice(0, 10) : 'open';
    return `SETL-BATCH-${scope.slice(0, 8)}-${start}-${end}-${uuidv4().slice(0, 8)}`;
  }

  async createSettlementBatch(params) {
    const {
      tenantId,
      merchantId = null,
      beneficiaryId = null,
      bankAccountId = null,
      cycleStart = null,
      cycleEnd = null,
      scheduledDate = null,
      scheduledSettlementDate = scheduledDate,
      createdBy = null,
      correlationId = requestContext.getCorrelationId(),
      limit = 500
    } = params;

    if (!tenantId) throw new Error('tenantId is required');

    return db.knex.transaction(async (trx) => {
      const batchRef = this.generateBatchRef({ tenantId, merchantId, cycleStart, cycleEnd });
      const [batch] = await trx('settlement_batches')
        .insert({
          id: uuidv4(),
          tenant_id: tenantId,
          batch_ref: batchRef,
          merchant_id: merchantId,
          beneficiary_id: beneficiaryId,
          bank_account_id: bankAccountId,
          settlement_cycle_start: cycleStart ? new Date(cycleStart) : null,
          settlement_cycle_end: cycleEnd ? new Date(cycleEnd) : null,
          scheduled_settlement_date: scheduledSettlementDate || null,
          batch_status: 'DRAFT',
          currency: 'INR',
          correlation_id: correlationId || null,
          metadata: {
            created_by: createdBy,
            eligibility_limit: limit
          }
        })
        .returning('*');

      await this.addEligibleItemsToBatch(batch.id, { trx, limit, correlationId });
      await this.calculateBatchTotals(batch.id, trx);
      const [updatedBatch] = await trx('settlement_batches')
        .where('id', batch.id)
        .update({
          batch_status: 'ELIGIBILITY_CHECKED',
          updated_at: new Date()
        })
        .returning('*');

      logger.info('Settlement batch created and eligibility checked', {
        tenant_id: tenantId,
        batch_id: batch.id,
        batch_ref: batchRef,
        merchant_id: merchantId,
        correlation_id: correlationId || null
      });

      return this.getBatch(updatedBatch.id, tenantId, trx);
    });
  }

  async addEligibleItemsToBatch(batchId, options = {}) {
    const trx = options.trx || db.knex;
    const batch = await trx('settlement_batches').where('id', batchId).first();
    if (!batch) throw new Error('Settlement batch not found');

    const existingRefs = await trx('settlement_items')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batch.id)
      .pluck('transaction_ref');
    const existingSet = new Set(existingRefs);

    const candidates = await settlementEligibilityService.findSettlementCandidates({
      tenantId: batch.tenant_id,
      merchantId: batch.merchant_id,
      cycleStart: batch.settlement_cycle_start,
      cycleEnd: batch.settlement_cycle_end,
      limit: options.limit || parseJson(batch.metadata).eligibility_limit || 500
    });

    const createdItems = [];

    for (const candidate of candidates) {
      if (!candidate.transaction_ref || existingSet.has(candidate.transaction_ref)) continue;

      const evaluation = await settlementEligibilityService.evaluateCandidateEligibility(candidate, { trx });
      const amounts = evaluation.amounts || {
        grossAmount: roundMoney(candidate.amount),
        feeDeduction: 0,
        taxDeduction: 0,
        adjustmentAmount: 0,
        netAmount: roundMoney(candidate.amount),
        currency: candidate.currency || 'INR'
      };
      const details = evaluation.details || {};

      const [item] = await trx('settlement_items')
        .insert({
          id: uuidv4(),
          tenant_id: batch.tenant_id,
          batch_id: batch.id,
          transaction_id: candidate.id,
          transaction_ref: candidate.transaction_ref,
          merchant_id: batch.merchant_id,
          ledger_transaction_id: details.ledger_transaction_id || evaluation.ledgerTransaction?.id || null,
          gateway_settlement_line_id: details.gateway_settlement_line_id || evaluation.gatewaySettlementLine?.id || null,
          item_status: evaluation.passed ? 'ELIGIBLE' : 'INELIGIBLE',
          eligibility_status: evaluation.passed ? 'PASSED' : 'FAILED',
          eligibility_reason: evaluation.reason,
          eligibility_details: details,
          gross_amount: amounts.grossAmount.toFixed(2),
          fee_deduction: amounts.feeDeduction.toFixed(2),
          tax_deduction: amounts.taxDeduction.toFixed(2),
          adjustment_amount: amounts.adjustmentAmount.toFixed(2),
          net_amount: amounts.netAmount.toFixed(2),
          currency: amounts.currency,
          correlation_id: options.correlationId || batch.correlation_id || null,
          metadata: {
            transaction_completed_at: candidate.completed_at,
            gateway_transaction_id: candidate.gateway_transaction_id
          }
        })
        .returning('*');

      createdItems.push(item);
      existingSet.add(candidate.transaction_ref);

      if (!evaluation.passed) {
        await settlementEligibilityService.createEligibilitySignal({
          batch,
          item,
          evaluation,
          correlationId: options.correlationId
        }, trx);
      }
    }

    return createdItems;
  }

  async calculateBatchTotals(batchId, trx = db.knex) {
    const rows = await trx('settlement_items')
      .where('batch_id', batchId);

    const totals = rows.reduce((acc, row) => {
      acc.itemCount += 1;
      if (row.item_status === 'ELIGIBLE' || row.item_status === 'RESERVED' || row.item_status === 'SETTLED') {
        acc.eligibleCount += 1;
        acc.gross += Number(row.gross_amount || 0);
        acc.fees += Number(row.fee_deduction || 0);
        acc.taxes += Number(row.tax_deduction || 0);
        acc.adjustments += Number(row.adjustment_amount || 0);
        acc.net += Number(row.net_amount || 0);
        acc.currency = row.currency || acc.currency;
      } else if (row.item_status === 'INELIGIBLE') {
        acc.ineligibleCount += 1;
      }
      return acc;
    }, {
      gross: 0,
      fees: 0,
      taxes: 0,
      adjustments: 0,
      net: 0,
      itemCount: 0,
      eligibleCount: 0,
      ineligibleCount: 0,
      currency: 'INR'
    });

    const [batch] = await trx('settlement_batches')
      .where('id', batchId)
      .update({
        gross_payable_amount: roundMoney(totals.gross).toFixed(2),
        total_fee_deduction: roundMoney(totals.fees).toFixed(2),
        total_tax_deduction: roundMoney(totals.taxes).toFixed(2),
        total_adjustment_amount: roundMoney(totals.adjustments).toFixed(2),
        net_settlement_amount: roundMoney(totals.net).toFixed(2),
        currency: totals.currency,
        item_count: totals.itemCount,
        eligible_item_count: totals.eligibleCount,
        ineligible_item_count: totals.ineligibleCount,
        updated_at: new Date()
      })
      .returning('*');

    return batch;
  }

  async markBatchEligibilityChecked(batchId) {
    return db.knex.transaction(async (trx) => {
      await this.addEligibleItemsToBatch(batchId, { trx });
      await this.calculateBatchTotals(batchId, trx);
      const [batch] = await trx('settlement_batches')
        .where('id', batchId)
        .update({
          batch_status: 'ELIGIBILITY_CHECKED',
          updated_at: new Date()
        })
        .returning('*');
      if (!batch) throw new Error('Settlement batch not found');
      return this.getBatch(batch.id, batch.tenant_id, trx);
    });
  }

  async cancelBatch({ batchId, reason, cancelledBy, correlationId = requestContext.getCorrelationId() }) {
    if (!reason) throw new Error('Cancellation reason is required');
    const settlementFundReservationService = require('./settlement-fund-reservation-service');

    return db.knex.transaction(async (trx) => {
      const batch = await trx('settlement_batches')
        .where('id', batchId)
        .forUpdate()
        .first();
      if (!batch) throw new Error('Settlement batch not found');
      if (['CANCELLED', 'EXPIRED', 'PAYOUT_CREATED'].includes(batch.batch_status)) {
        throw new Error(`Cannot cancel settlement batch in status ${batch.batch_status}`);
      }

      const reservation = await trx('settlement_fund_reservations')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .where('reservation_status', 'ACTIVE')
        .first();

      if (reservation) {
        await settlementFundReservationService.releaseReservation({
          reservationId: reservation.id,
          reason,
          releasedBy: cancelledBy,
          correlationId
        }, trx);
      }

      await trx('settlement_items')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .whereNotIn('item_status', ['SETTLED'])
        .update({
          item_status: 'CANCELLED',
          released_at: new Date(),
          release_reason: reason,
          updated_at: new Date()
        });

      const [updatedBatch] = await trx('settlement_batches')
        .where('id', batch.id)
        .update({
          batch_status: 'CANCELLED',
          cancelled_at: new Date(),
          cancelled_by: cancelledBy || null,
          cancellation_reason: reason,
          reserved_amount: '0.00',
          updated_at: new Date()
        })
        .returning('*');

      await settlementSignalService.createOrUpdateSignal({
        tenantId: batch.tenant_id,
        signalType: 'SETTLEMENT_BATCH_CANCELLED',
        sourceType: 'SETTLEMENT_BATCH',
        sourceId: batch.id,
        batchId: batch.id,
        merchantId: batch.merchant_id,
        impactAmount: batch.net_settlement_amount,
        currency: batch.currency,
        description: `Settlement batch ${batch.batch_ref} cancelled: ${reason}`,
        correlationId,
        metadata: { cancelled_by: cancelledBy }
      }, trx);

      return updatedBatch;
    });
  }

  async expireBatchIfNeeded(batchId) {
    const settlementFundReservationService = require('./settlement-fund-reservation-service');
    const batch = await db.knex('settlement_batches').where('id', batchId).first();
    if (!batch) throw new Error('Settlement batch not found');
    if (!batch.reservation_expires_at || new Date(batch.reservation_expires_at) > new Date()) return batch;

    await settlementFundReservationService.expireReservations({ tenantId: batch.tenant_id, now: new Date() });
    return db.knex('settlement_batches').where('id', batchId).first();
  }

  async getBatch(batchId, tenantId = null, trx = db.knex) {
    let query = trx('settlement_batches').where('id', batchId);
    if (tenantId) query = query.where('tenant_id', tenantId);
    const batch = await query.first();
    if (!batch) throw new Error('Settlement batch not found');
    const items = await trx('settlement_items')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batch.id)
      .orderBy('created_at', 'asc');
    const reservations = await trx('settlement_fund_reservations')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batch.id)
      .orderBy('created_at', 'desc');
    return { batch, items, reservations };
  }

  async listBatches(filters = {}) {
    const {
      tenantId,
      merchantId,
      batchStatus,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('settlement_batches')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (batchStatus) query = query.where('batch_status', batchStatus);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    return query;
  }

  async listBatchItems(filters = {}) {
    const {
      tenantId,
      batchId,
      merchantId,
      transactionRef,
      itemStatus,
      eligibilityStatus,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('settlement_items')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (batchId) query = query.where('batch_id', batchId);
    if (merchantId) query = query.where('merchant_id', merchantId);
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (itemStatus) query = query.where('item_status', itemStatus);
    if (eligibilityStatus) query = query.where('eligibility_status', eligibilityStatus);

    return query;
  }

  async assertBatchTotalsMatchItems(batch, trx = db.knex) {
    const totals = await trx('settlement_items')
      .where('tenant_id', batch.tenant_id)
      .where('batch_id', batch.id)
      .whereIn('item_status', ['ELIGIBLE', 'RESERVED'])
      .first(
        db.knex.raw('COALESCE(SUM(net_amount), 0) as net_amount'),
        db.knex.raw('COALESCE(SUM(gross_amount), 0) as gross_amount')
      );

    const itemNet = roundMoney(totals.net_amount || 0);
    const batchNet = roundMoney(batch.net_settlement_amount || 0);
    return {
      matches: Math.abs(itemNet - batchNet) <= 0.01,
      itemNet,
      batchNet,
      discrepancy: roundMoney(Math.abs(itemNet - batchNet))
    };
  }

  openBatchStatuses() {
    return OPEN_BATCH_STATUSES;
  }
}

module.exports = new SettlementBatchingService();
module.exports.SettlementBatchingService = SettlementBatchingService;
