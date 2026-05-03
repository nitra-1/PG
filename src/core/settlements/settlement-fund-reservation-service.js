const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const settlementSignalService = require('./settlement-signal-service');
const settlementBatchingService = require('./settlement-batching-service');

const ACTIVE_ITEM_STATUSES = ['RESERVED', 'SETTLED'];
const DEFAULT_RESERVATION_TTL_MINUTES = Number(process.env.SETTLEMENT_RESERVATION_TTL_MINUTES || 60);

function roundMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function executor(trx) {
  return trx || db.knex;
}

class SettlementFundReservationService {
  reservationRefForBatch(batch) {
    return `RSV-${batch.batch_ref}`;
  }

  idempotencyKeyForBatch(batch) {
    return `settlement_reservation:${batch.tenant_id}:${batch.batch_ref}`;
  }

  async lockReservationScope(trx, { tenantId, merchantId = null, currency = 'INR' }) {
    const lockKey = `settlement-reservation:${tenantId}:${merchantId || 'all'}:${currency}`;
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey]);
  }

  async getAccountBalance({ tenantId, accountCode, currency = 'INR', merchantId = null, normalBalance }, trx = db.knex) {
    let query = trx('ledger_entries as le')
      .join('ledger_transactions as lt', 'lt.id', 'le.transaction_id')
      .join('ledger_accounts as la', 'la.id', 'le.account_id')
      .where('le.tenant_id', tenantId)
      .where('lt.tenant_id', tenantId)
      .where('lt.status', 'posted')
      .where('la.account_code', accountCode)
      .where('le.currency', currency);

    if (merchantId && accountCode === 'MER-002') {
      query = query.where(function() {
        this.whereRaw("COALESCE(le.metadata->>'merchantId', le.metadata->>'merchant_id', lt.metadata->>'merchantId', lt.metadata->>'merchant_id') = ?", [merchantId])
          .orWhereRaw('FALSE');
      });
    }

    const row = await query.first(
      db.knex.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE 0 END), 0) as debits"),
      db.knex.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END), 0) as credits")
    );

    const debits = Number(row?.debits || 0);
    const credits = Number(row?.credits || 0);
    return normalBalance === 'credit' ? roundMoney(credits - debits) : roundMoney(debits - credits);
  }

  async getActiveReservedAmount({ tenantId, merchantId = null, currency = 'INR' }, trx = db.knex) {
    let query = trx('settlement_fund_reservations')
      .where('tenant_id', tenantId)
      .where('currency', currency)
      .where('reservation_status', 'ACTIVE');

    if (merchantId) query = query.where('merchant_id', merchantId);

    const row = await query.first(db.knex.raw('COALESCE(SUM(reserved_amount), 0) as reserved_amount'));
    return roundMoney(row?.reserved_amount || 0);
  }

  async getEscrowAvailableBalance({ tenantId, currency = 'INR' }, trx = db.knex) {
    const ledgerBalance = await this.getAccountBalance({
      tenantId,
      accountCode: 'ESC-001',
      currency,
      normalBalance: 'debit'
    }, trx);
    const activeReserved = await this.getActiveReservedAmount({ tenantId, currency }, trx);
    return roundMoney(ledgerBalance - activeReserved);
  }

  async getMerchantPayableBalance({ tenantId, merchantId = null, currency = 'INR' }, trx = db.knex) {
    let ledgerBalance = await this.getAccountBalance({
      tenantId,
      accountCode: 'MER-002',
      currency,
      merchantId,
      normalBalance: 'credit'
    }, trx);

    if (merchantId && ledgerBalance === 0) {
      ledgerBalance = await this.getAccountBalance({
        tenantId,
        accountCode: 'MER-002',
        currency,
        normalBalance: 'credit'
      }, trx);
    }

    const activeReserved = await this.getActiveReservedAmount({ tenantId, merchantId, currency }, trx);
    return roundMoney(ledgerBalance - activeReserved);
  }

  async failReservation({ trx, batch, signalType, description, impactAmount, metadata = {}, correlationId }) {
    const [updatedBatch] = await trx('settlement_batches')
      .where('id', batch.id)
      .update({
        batch_status: 'RESERVATION_FAILED',
        reserved_amount: '0.00',
        metadata: {
          ...(typeof batch.metadata === 'object' && batch.metadata ? batch.metadata : {}),
          reservation_failure: {
            signal_type: signalType,
            description,
            ...metadata
          }
        },
        updated_at: new Date()
      })
      .returning('*');

    const signal = await settlementSignalService.createOrUpdateSignal({
      tenantId: batch.tenant_id,
      signalType,
      sourceType: signalType === 'SETTLEMENT_AMOUNT_MISMATCH' ? 'SETTLEMENT_BATCH' : 'FUND_RESERVATION',
      sourceId: batch.id,
      batchId: batch.id,
      merchantId: batch.merchant_id,
      impactAmount,
      currency: batch.currency,
      description,
      correlationId,
      metadata
    }, trx);

    return {
      reservation: null,
      batch: updatedBatch,
      signals: [signal],
      status: 'RESERVATION_FAILED'
    };
  }

  async reserveFundsForBatch(params) {
    const {
      batchId,
      reservedBy = null,
      correlationId = requestContext.getCorrelationId()
    } = params;

    return db.knex.transaction(async (trx) => {
      const batch = await trx('settlement_batches')
        .where('id', batchId)
        .forUpdate()
        .first();
      if (!batch) throw new Error('Settlement batch not found');

      await this.lockReservationScope(trx, {
        tenantId: batch.tenant_id,
        merchantId: batch.merchant_id,
        currency: batch.currency
      });

      const existing = await trx('settlement_fund_reservations')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .where('reservation_status', 'ACTIVE')
        .forUpdate()
        .first();

      if (existing) {
        return { reservation: existing, batch, signals: [], status: 'ALREADY_RESERVED' };
      }

      if (!['ELIGIBILITY_CHECKED', 'RESERVATION_FAILED'].includes(batch.batch_status)) {
        throw new Error(`Cannot reserve settlement batch in status ${batch.batch_status}`);
      }

      const eligibleItems = await trx('settlement_items')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .where('item_status', 'ELIGIBLE')
        .forUpdate();

      if (eligibleItems.length === 0) {
        return this.failReservation({
          trx,
          batch,
          signalType: 'SETTLEMENT_ELIGIBILITY_FAILED',
          description: `Settlement batch ${batch.batch_ref} has no eligible items to reserve`,
          impactAmount: batch.net_settlement_amount,
          correlationId
        });
      }

      const duplicateActive = await trx('settlement_items')
        .where('tenant_id', batch.tenant_id)
        .whereIn('transaction_ref', eligibleItems.map(item => item.transaction_ref))
        .whereIn('item_status', ACTIVE_ITEM_STATUSES)
        .whereNot('batch_id', batch.id)
        .forUpdate()
        .first();

      if (duplicateActive) {
        return this.failReservation({
          trx,
          batch,
          signalType: 'PAYABLE_RESERVED_TWICE_ATTEMPTED',
          description: `Transaction ${duplicateActive.transaction_ref} is already reserved or settled in another batch`,
          impactAmount: duplicateActive.net_amount,
          metadata: {
            duplicate_item_id: duplicateActive.id,
            duplicate_batch_id: duplicateActive.batch_id,
            transaction_ref: duplicateActive.transaction_ref
          },
          correlationId
        });
      }

      const totalsCheck = await settlementBatchingService.assertBatchTotalsMatchItems(batch, trx);
      if (!totalsCheck.matches) {
        return this.failReservation({
          trx,
          batch,
          signalType: 'SETTLEMENT_AMOUNT_MISMATCH',
          description: `Settlement batch ${batch.batch_ref} totals do not match eligible items`,
          impactAmount: totalsCheck.discrepancy,
          metadata: totalsCheck,
          correlationId
        });
      }

      await trx('settlement_fund_reservations')
        .where('tenant_id', batch.tenant_id)
        .where('currency', batch.currency)
        .where('reservation_status', 'ACTIVE')
        .forUpdate();

      const requestedAmount = roundMoney(batch.net_settlement_amount);
      const availableEscrow = await this.getEscrowAvailableBalance({
        tenantId: batch.tenant_id,
        currency: batch.currency
      }, trx);
      const availableMerchantPayable = await this.getMerchantPayableBalance({
        tenantId: batch.tenant_id,
        merchantId: batch.merchant_id,
        currency: batch.currency
      }, trx);

      if (availableEscrow + 0.01 < requestedAmount) {
        return this.failReservation({
          trx,
          batch,
          signalType: 'INSUFFICIENT_ESCROW_FOR_SETTLEMENT',
          description: `Available escrow ${availableEscrow.toFixed(2)} is below settlement batch net amount ${requestedAmount.toFixed(2)}`,
          impactAmount: roundMoney(requestedAmount - availableEscrow),
          metadata: {
            available_escrow_amount: availableEscrow,
            requested_amount: requestedAmount
          },
          correlationId
        });
      }

      if (availableMerchantPayable + 0.01 < requestedAmount) {
        return this.failReservation({
          trx,
          batch,
          signalType: 'INSUFFICIENT_MERCHANT_PAYABLE',
          description: `Available merchant payable ${availableMerchantPayable.toFixed(2)} is below settlement batch net amount ${requestedAmount.toFixed(2)}`,
          impactAmount: roundMoney(requestedAmount - availableMerchantPayable),
          metadata: {
            available_merchant_payable_amount: availableMerchantPayable,
            requested_amount: requestedAmount
          },
          correlationId
        });
      }

      const expiresAt = new Date(Date.now() + DEFAULT_RESERVATION_TTL_MINUTES * 60 * 1000);
      const reservationData = {
        id: uuidv4(),
        tenant_id: batch.tenant_id,
        reservation_ref: this.reservationRefForBatch(batch),
        batch_id: batch.id,
        merchant_id: batch.merchant_id,
        currency: batch.currency,
        reservation_status: 'ACTIVE',
        reserved_amount: requestedAmount.toFixed(2),
        available_escrow_amount: availableEscrow.toFixed(2),
        available_merchant_payable_amount: availableMerchantPayable.toFixed(2),
        reserved_at: new Date(),
        expires_at: expiresAt,
        idempotency_key: this.idempotencyKeyForBatch(batch),
        correlation_id: correlationId || null,
        metadata: {
          reserved_by: reservedBy,
          item_count: eligibleItems.length
        }
      };

      const [reservation] = await trx('settlement_fund_reservations')
        .insert(reservationData)
        .returning('*');

      await trx('settlement_items')
        .where('tenant_id', batch.tenant_id)
        .where('batch_id', batch.id)
        .where('item_status', 'ELIGIBLE')
        .update({
          item_status: 'RESERVED',
          reserved_amount: db.knex.ref('net_amount'),
          reserved_at: new Date(),
          updated_at: new Date()
        });

      const [updatedBatch] = await trx('settlement_batches')
        .where('id', batch.id)
        .update({
          batch_status: 'RESERVED',
          reserved_amount: requestedAmount.toFixed(2),
          reserved_at: new Date(),
          reserved_by: reservedBy,
          reservation_expires_at: expiresAt,
          updated_at: new Date()
        })
        .returning('*');

      const signal = await settlementSignalService.createOrUpdateSignal({
        tenantId: batch.tenant_id,
        signalType: 'SETTLEMENT_READY_FOR_PAYOUT',
        sourceType: 'FUND_RESERVATION',
        sourceId: reservation.id,
        batchId: batch.id,
        reservationId: reservation.id,
        merchantId: batch.merchant_id,
        impactAmount: requestedAmount,
        currency: batch.currency,
        description: `Settlement batch ${batch.batch_ref} reserved and ready for payout preparation`,
        correlationId,
        metadata: {
          reservation_ref: reservation.reservation_ref,
          expires_at: expiresAt
        }
      }, trx);

      logger.info('Settlement funds reserved', {
        tenant_id: batch.tenant_id,
        batch_id: batch.id,
        reservation_id: reservation.id,
        reserved_amount: requestedAmount,
        correlation_id: correlationId || null
      });

      return {
        reservation,
        batch: updatedBatch,
        signals: [signal],
        status: 'RESERVED'
      };
    });
  }

  async releaseReservation(params, outerTrx = null) {
    const run = async (trx) => {
      const {
        reservationId,
        reason,
        releasedBy = null,
        correlationId = requestContext.getCorrelationId()
      } = params;

      if (!reason) throw new Error('Release reason is required');
      const reservation = await trx('settlement_fund_reservations')
        .where('id', reservationId)
        .forUpdate()
        .first();
      if (!reservation) throw new Error('Settlement reservation not found');
      if (reservation.reservation_status !== 'ACTIVE') return reservation;

      const batch = await trx('settlement_batches')
        .where('id', reservation.batch_id)
        .where('tenant_id', reservation.tenant_id)
        .forUpdate()
        .first();

      const [updatedReservation] = await trx('settlement_fund_reservations')
        .where('id', reservation.id)
        .update({
          reservation_status: 'RELEASED',
          released_at: new Date(),
          failure_reason: reason,
          metadata: {
            ...(typeof reservation.metadata === 'object' && reservation.metadata ? reservation.metadata : {}),
            released_by: releasedBy,
            release_reason: reason
          },
          updated_at: new Date()
        })
        .returning('*');

      await trx('settlement_items')
        .where('tenant_id', reservation.tenant_id)
        .where('batch_id', reservation.batch_id)
        .where('item_status', 'RESERVED')
        .update({
          item_status: 'RELEASED',
          reserved_amount: '0.00',
          released_at: new Date(),
          release_reason: reason,
          updated_at: new Date()
        });

      if (batch && batch.batch_status === 'RESERVED') {
        await trx('settlement_batches')
          .where('id', batch.id)
          .update({
            batch_status: 'ELIGIBILITY_CHECKED',
            reserved_amount: '0.00',
            reservation_expires_at: null,
            updated_at: new Date()
          });
      }

      await settlementSignalService.createOrUpdateSignal({
        tenantId: reservation.tenant_id,
        signalType: 'RESERVATION_RELEASED',
        sourceType: 'FUND_RESERVATION',
        sourceId: reservation.id,
        batchId: reservation.batch_id,
        reservationId: reservation.id,
        merchantId: reservation.merchant_id,
        impactAmount: reservation.reserved_amount,
        currency: reservation.currency,
        description: `Settlement reservation ${reservation.reservation_ref} released: ${reason}`,
        correlationId,
        metadata: { released_by: releasedBy }
      }, trx);

      return updatedReservation;
    };

    if (outerTrx) return run(outerTrx);
    return db.knex.transaction(run);
  }

  async expireReservations({ tenantId = null, now = new Date() } = {}) {
    const expired = await db.knex('settlement_fund_reservations')
      .where('reservation_status', 'ACTIVE')
      .where('expires_at', '<=', now)
      .modify((query) => {
        if (tenantId) query.where('tenant_id', tenantId);
      })
      .orderBy('expires_at', 'asc');

    const results = [];
    for (const reservation of expired) {
      const result = await db.knex.transaction(async (trx) => {
        const current = await trx('settlement_fund_reservations')
          .where('id', reservation.id)
          .where('reservation_status', 'ACTIVE')
          .forUpdate()
          .first();
        if (!current) return null;

        const [updatedReservation] = await trx('settlement_fund_reservations')
          .where('id', current.id)
          .update({
            reservation_status: 'EXPIRED',
            released_at: new Date(),
            failure_reason: 'Reservation expired',
            updated_at: new Date()
          })
          .returning('*');

        await trx('settlement_items')
          .where('tenant_id', current.tenant_id)
          .where('batch_id', current.batch_id)
          .where('item_status', 'RESERVED')
          .update({
            item_status: 'RELEASED',
            reserved_amount: '0.00',
            released_at: new Date(),
            release_reason: 'Reservation expired',
            updated_at: new Date()
          });

        await trx('settlement_batches')
          .where('id', current.batch_id)
          .where('tenant_id', current.tenant_id)
          .update({
            batch_status: 'EXPIRED',
            reserved_amount: '0.00',
            reservation_expires_at: null,
            updated_at: new Date()
          });

        await settlementSignalService.createOrUpdateSignal({
          tenantId: current.tenant_id,
          signalType: 'RESERVATION_EXPIRED',
          sourceType: 'FUND_RESERVATION',
          sourceId: current.id,
          batchId: current.batch_id,
          reservationId: current.id,
          merchantId: current.merchant_id,
          impactAmount: current.reserved_amount,
          currency: current.currency,
          description: `Settlement reservation ${current.reservation_ref} expired before payout preparation`,
          correlationId: current.correlation_id,
          metadata: { expired_at: new Date().toISOString() }
        }, trx);

        return updatedReservation;
      });
      if (result) results.push(result);
    }

    return results;
  }

  async consumeReservationForPayout({ reservationId, payoutInstructionId, correlationId = requestContext.getCorrelationId() }) {
    return db.knex.transaction(async (trx) => {
      const reservation = await trx('settlement_fund_reservations')
        .where('id', reservationId)
        .where('reservation_status', 'ACTIVE')
        .forUpdate()
        .first();
      if (!reservation) throw new Error('Active settlement reservation not found');

      const [updatedReservation] = await trx('settlement_fund_reservations')
        .where('id', reservation.id)
        .update({
          reservation_status: 'CONSUMED',
          consumed_at: new Date(),
          correlation_id: correlationId || reservation.correlation_id,
          updated_at: new Date()
        })
        .returning('*');

      await trx('settlement_batches')
        .where('id', reservation.batch_id)
        .where('tenant_id', reservation.tenant_id)
        .update({
          batch_status: payoutInstructionId ? 'PAYOUT_CREATED' : 'READY_FOR_PAYOUT',
          payout_instruction_id: payoutInstructionId || null,
          updated_at: new Date()
        });

      return updatedReservation;
    });
  }
}

module.exports = new SettlementFundReservationService();
module.exports.SettlementFundReservationService = SettlementFundReservationService;
