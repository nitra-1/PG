const db = require('../../database');

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketAge(date) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS));
  if (days <= 1) return '0_1_days';
  if (days <= 3) return '2_3_days';
  if (days <= 7) return '4_7_days';
  if (days <= 15) return '8_15_days';
  return '16_plus_days';
}

function initAging() {
  return { '0_1_days': 0, '2_3_days': 0, '4_7_days': 0, '8_15_days': 0, '16_plus_days': 0 };
}

class OpsHealthReportingService {
  async getOutboxHealth({ tenantId, from = null, to = null } = {}) {
    let query = db.knex('outbox_events');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);
    const rows = await query;

    const byStatus = {};
    const retryDistribution = {};
    let oldestPendingAgeSeconds = null;
    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      retryDistribution[row.retry_count] = (retryDistribution[row.retry_count] || 0) + 1;
      if (row.status === 'PENDING') {
        const age = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
        oldestPendingAgeSeconds = oldestPendingAgeSeconds == null ? age : Math.max(oldestPendingAgeSeconds, age);
      }
    }

    return {
      reportType: 'OUTBOX_HEALTH',
      tenantId: tenantId || null,
      pendingCount: byStatus.PENDING || 0,
      processingCount: byStatus.PROCESSING || 0,
      failedCount: byStatus.FAILED || 0,
      dlqCount: byStatus.DLQ || 0,
      processedCount: byStatus.PROCESSED || 0,
      oldestPendingAgeSeconds,
      retryDistribution,
      byStatus
    };
  }

  async getDLQReport({ tenantId, from = null, to = null } = {}) {
    let query = db.knex('outbox_events').where('status', 'DLQ').orderBy('dlq_at', 'desc');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);
    const rows = await query;
    const byEventType = {};
    for (const row of rows) byEventType[row.event_type] = (byEventType[row.event_type] || 0) + 1;
    return { reportType: 'DLQ_REPORT', tenantId: tenantId || null, count: rows.length, byEventType, records: rows };
  }

  async getWebhookHealth({ tenantId, from = null, to = null } = {}) {
    let query = db.knex('gateway_webhook_events');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (from) query = query.where('received_at', '>=', from);
    if (to) query = query.where('received_at', '<=', to);
    const rows = await query;

    return {
      reportType: 'WEBHOOK_HEALTH',
      tenantId: tenantId || null,
      invalidSignatureCount: rows.filter(row => row.verification_status === 'FAILED').length,
      replayRejectedCount: rows.filter(row => row.processing_status === 'REPLAY_REJECTED').length,
      duplicateWebhookCount: rows.filter(row => row.processing_status === 'DUPLICATE').length,
      outOfOrderCount: rows.filter(row => row.processing_status === 'OUT_OF_ORDER').length,
      lateSuccessCount: rows.filter(row => (row.metadata?.late_success === true) || row.gateway_event_type === 'payment.captured.late').length,
      total: rows.length
    };
  }

  async getReconciliationExceptionSummary({ tenantId, from = null, to = null } = {}) {
    let query = db.knex('reconciliation_exception_cases');
    if (tenantId) query = query.where('tenant_id', tenantId);
    if (from) query = query.where('opened_at', '>=', from);
    if (to) query = query.where('opened_at', '<=', to);
    const rows = await query;

    const byStatus = {};
    const bySeverity = {};
    const agingBuckets = initAging();
    for (const row of rows) {
      byStatus[row.case_status] = (byStatus[row.case_status] || 0) + 1;
      bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
      if (!['RESOLVED', 'IGNORED', 'CLOSED'].includes(row.case_status)) {
        agingBuckets[bucketAge(row.opened_at)] += 1;
      }
    }

    return {
      reportType: 'RECONCILIATION_EXCEPTION_SUMMARY',
      tenantId: tenantId || null,
      total: rows.length,
      openCases: byStatus.OPEN || 0,
      inReview: byStatus.IN_REVIEW || 0,
      pendingApproval: byStatus.PENDING_APPROVAL || 0,
      escalated: byStatus.ESCALATED || 0,
      resolved: byStatus.RESOLVED || 0,
      ignored: byStatus.IGNORED || 0,
      byStatus,
      bySeverity,
      agingBuckets
    };
  }

  async getControlDashboardSummary({ tenantId, from = null, to = null } = {}) {
    const [outboxHealth, dlq, webhookHealth, reconciliationExceptions] = await Promise.all([
      this.getOutboxHealth({ tenantId, from, to }),
      this.getDLQReport({ tenantId, from, to }),
      this.getWebhookHealth({ tenantId, from, to }),
      this.getReconciliationExceptionSummary({ tenantId, from, to })
    ]);
    return { reportType: 'CONTROL_DASHBOARD_SUMMARY', tenantId: tenantId || null, outboxHealth, dlq, webhookHealth, reconciliationExceptions };
  }
}

module.exports = new OpsHealthReportingService();
module.exports.OpsHealthReportingService = OpsHealthReportingService;
