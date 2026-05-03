const express = require('express');

const settlementBatchingService = require('../core/settlements/settlement-batching-service');
const settlementFundReservationService = require('../core/settlements/settlement-fund-reservation-service');
const { authenticateJWT, requireRoles } = require('../core/auth/rbac-middleware');

const ADMIN_ROLES = ['FINANCE_ADMIN', 'COMPLIANCE_ADMIN', 'OPS_ADMIN', 'finance_admin', 'compliance_admin', 'ops_admin'];
const READ_ROLES = [...ADMIN_ROLES, 'AUDITOR', 'auditor'];
const CROSS_TENANT_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'super_admin', 'platform_admin'];

function resolveTenant(req) {
  const canReadCrossTenant = CROSS_TENANT_ROLES.includes(req.user?.role);
  const requestedTenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
  if (requestedTenantId !== req.tenantId && !canReadCrossTenant) {
    const error = new Error('Forbidden: cannot access settlement batch records for another tenant');
    error.statusCode = 403;
    throw error;
  }
  return requestedTenantId;
}

module.exports = function createSettlementBatchRoutes(config) {
  const router = express.Router();
  const readAuth = [authenticateJWT(config), requireRoles([...READ_ROLES, ...CROSS_TENANT_ROLES])];
  const writeAuth = [authenticateJWT(config), requireRoles([...ADMIN_ROLES, ...CROSS_TENANT_ROLES])];

  router.post('/', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await settlementBatchingService.createSettlementBatch({
        tenantId,
        merchantId: req.body.merchantId || null,
        beneficiaryId: req.body.beneficiaryId || null,
        bankAccountId: req.body.bankAccountId || null,
        cycleStart: req.body.cycleStart,
        cycleEnd: req.body.cycleEnd,
        scheduledSettlementDate: req.body.scheduledSettlementDate,
        createdBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.status(201).json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await settlementBatchingService.listBatches({
        tenantId,
        merchantId: req.query.merchantId,
        batchStatus: req.query.batchStatus,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/:id', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const result = await settlementBatchingService.getBatch(req.params.id, tenantId);
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.get('/:id/items', readAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const records = await settlementBatchingService.listBatchItems({
        tenantId,
        batchId: req.params.id,
        merchantId: req.query.merchantId,
        transactionRef: req.query.transactionRef,
        itemStatus: req.query.itemStatus,
        eligibilityStatus: req.query.eligibilityStatus,
        limit: req.query.limit,
        offset: req.query.offset
      });
      res.json({ success: true, records, count: records.length, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/:id/check-eligibility', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      await settlementBatchingService.getBatch(req.params.id, tenantId);
      const result = await settlementBatchingService.markBatchEligibilityChecked(req.params.id);
      res.json({ success: true, ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/:id/reserve', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const batch = await settlementBatchingService.getBatch(req.params.id, tenantId);
      const result = await settlementFundReservationService.reserveFundsForBatch({
        batchId: batch.batch.id,
        reservedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.status(result.status === 'RESERVATION_FAILED' ? 409 : 200).json({ success: result.status !== 'RESERVATION_FAILED', ...result, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/:id/release-reservation', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const batch = await settlementBatchingService.getBatch(req.params.id, tenantId);
      const activeReservation = batch.reservations.find(reservation => reservation.reservation_status === 'ACTIVE');
      if (!activeReservation) {
        return res.status(404).json({ success: false, error: 'Active settlement reservation not found', correlationId: req.correlationId });
      }
      const reservation = await settlementFundReservationService.releaseReservation({
        reservationId: activeReservation.id,
        reason: req.body.reason,
        releasedBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.json({ success: true, reservation, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  router.post('/:id/cancel', writeAuth, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      await settlementBatchingService.getBatch(req.params.id, tenantId);
      const batch = await settlementBatchingService.cancelBatch({
        batchId: req.params.id,
        reason: req.body.reason,
        cancelledBy: req.user?.userId || req.user?.id,
        correlationId: req.correlationId
      });
      res.json({ success: true, batch, correlationId: req.correlationId });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message, correlationId: req.correlationId });
      next(error);
    }
  });

  return router;
};
