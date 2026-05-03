const { v4: uuidv4, validate: isUuid } = require('uuid');

const db = require('../../database');
const logger = require('../logging/logger');
const requestContext = require('../context/request-context');

const SOURCE_CONFIG = {
  TRANSACTION_LEDGER: {
    table: 'reconciliation_transactions',
    statusColumn: 'reconciliation_status'
  },
  LEDGER_SETTLEMENT: {
    table: 'reconciliation_settlements',
    statusColumn: 'reconciliation_status'
  },
  BANK_SETTLEMENT: {
    table: 'reconciliation_bank_settlements',
    statusColumn: 'reconciliation_status'
  }
};

const CASE_STATUSES = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  RESOLVED: 'RESOLVED',
  IGNORED: 'IGNORED',
  ESCALATED: 'ESCALATED',
  REOPENED: 'REOPENED',
  CLOSED: 'CLOSED'
};

const ALLOWED_TRANSITIONS = {
  OPEN: ['IN_REVIEW', 'ESCALATED', 'IGNORED', 'PENDING_APPROVAL'],
  IN_REVIEW: ['PENDING_APPROVAL', 'RESOLVED', 'ESCALATED', 'IGNORED'],
  ESCALATED: ['IN_REVIEW', 'PENDING_APPROVAL', 'RESOLVED'],
  PENDING_APPROVAL: ['RESOLVED', 'IN_REVIEW', 'ESCALATED'],
  RESOLVED: ['REOPENED', 'CLOSED'],
  IGNORED: ['REOPENED', 'CLOSED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_REVIEW', 'ESCALATED', 'PENDING_APPROVAL']
};

const RESOLUTION_TYPES = [
  'MATCH_CONFIRMED',
  'ACCEPTED_DIFFERENCE',
  'DUPLICATE_CONFIRMED',
  'BANK_DELAY_CONFIRMED',
  'MANUAL_REVIEW_COMPLETED',
  'IGNORE_WITH_REASON',
  'ESCALATED_TO_FINANCE',
  'ESCALATED_TO_BANK',
  'CORRECTION_REQUIRED',
  'WRITE_OFF_RECOMMENDED'
];

const COMMENT_TYPES = [
  'NOTE',
  'INVESTIGATION',
  'BANK_FEEDBACK',
  'MERCHANT_FEEDBACK',
  'INTERNAL_DECISION',
  'APPROVAL_NOTE'
];

const APPROVAL_DIFFERENCE_THRESHOLD = Number(process.env.RECON_EXCEPTION_ACCEPTED_DIFF_APPROVAL_THRESHOLD || 1000);

const SEVERITY_BY_STATUS = {
  DUPLICATE_LEDGER: 'CRITICAL',
  DUPLICATE_BANK_MATCH: 'CRITICAL',
  DUPLICATE_PAYOUT: 'CRITICAL',
  TENANT_MISMATCH: 'CRITICAL',
  AMOUNT_MISMATCH: 'HIGH',
  NET_AMOUNT_MISMATCH: 'HIGH',
  MISSING_LEDGER: 'HIGH',
  MISSING_LEDGER_TRANSACTION: 'HIGH',
  MISSING_BANK_STATEMENT: 'HIGH',
  RETURNED_OR_REVERSED: 'HIGH',
  CURRENCY_MISMATCH: 'MEDIUM',
  FEE_MISMATCH: 'MEDIUM',
  BANK_REFERENCE_MISMATCH: 'MEDIUM',
  UTR_MISMATCH: 'MEDIUM',
  BANK_TRANSACTION_ID_MISMATCH: 'MEDIUM',
  DATE_MISMATCH: 'LOW'
};

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function amountNumber(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function severityForStatus(sourceStatus, sourceRow = {}) {
  if (sourceStatus === 'LEDGER_ENTRIES_MISSING' && amountNumber(sourceRow.discrepancy_amount) === 0) {
    return 'LOW';
  }
  return SEVERITY_BY_STATUS[sourceStatus] || 'MEDIUM';
}

function priorityForSeverity(severity) {
  return {
    CRITICAL: 'URGENT',
    HIGH: 'HIGH',
    MEDIUM: 'NORMAL',
    LOW: 'LOW'
  }[severity] || 'NORMAL';
}

class ReconciliationExceptionService {
  validateSourceType(sourceType) {
    if (!SOURCE_CONFIG[sourceType]) {
      throw new Error(`Unsupported reconciliation source type: ${sourceType}`);
    }
  }

  validateTransition(previousStatus, newStatus, options = {}) {
    if (previousStatus === newStatus) return;
    if (!ALLOWED_TRANSITIONS[previousStatus]?.includes(newStatus)) {
      throw new Error(`Invalid exception case transition ${previousStatus} -> ${newStatus}`);
    }
    if (previousStatus === CASE_STATUSES.CLOSED && newStatus === CASE_STATUSES.REOPENED && !options.isPlatformAdmin) {
      throw new Error('Only platform or super admin can reopen CLOSED exception cases');
    }
  }

  async getSourceRow({ tenantId, sourceType, sourceReconciliationId }) {
    this.validateSourceType(sourceType);
    const config = SOURCE_CONFIG[sourceType];
    const sourceRow = await db.knex(config.table)
      .where({
        tenant_id: tenantId,
        id: sourceReconciliationId
      })
      .first();

    if (!sourceRow) {
      throw new Error('Source reconciliation record not found');
    }

    return sourceRow;
  }

  sourceSnapshot(sourceRow) {
    return {
      id: sourceRow.id,
      reconciliation_status: sourceRow.reconciliation_status,
      discrepancy_amount: sourceRow.discrepancy_amount || null,
      transaction_ref: sourceRow.transaction_ref || null,
      settlement_ref: sourceRow.settlement_ref || null,
      ledger_transaction_id: sourceRow.ledger_transaction_id || null,
      payout_instruction_id: sourceRow.payout_instruction_id || null,
      bank_statement_line_id: sourceRow.bank_statement_line_id || null,
      checked_at: sourceRow.checked_at || null
    };
  }

  async insertWorkflowAudit(trx, {
    tenantId,
    caseId,
    actionType,
    previousStatus = null,
    newStatus = null,
    performedBy,
    reason = null,
    correlationId = null,
    metadata = {}
  }) {
    await trx('reconciliation_exception_audit_events').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      case_id: caseId,
      action_type: actionType,
      previous_status: previousStatus,
      new_status: newStatus,
      performed_by: performedBy || 'system',
      reason,
      correlation_id: correlationId || null,
      metadata: JSON.stringify(metadata || {})
    });

    await trx('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'reconciliation_exception_case',
      entity_id: caseId,
      action: actionType === 'CASE_OPENED' ? 'create' : 'update',
      user_id: performedBy || 'system',
      changes_before: JSON.stringify({ case_status: previousStatus }),
      changes_after: JSON.stringify({ case_status: newStatus }),
      metadata: JSON.stringify({
        action_type: actionType,
        reason,
        ...metadata
      }),
      correlation_id: correlationId || null,
      action_category: 'RECONCILIATION_EXCEPTION',
      action_type: actionType,
      resource_type: 'reconciliation_exception_case',
      resource_id: caseId,
      details: JSON.stringify(metadata || {})
    });
  }

  async createOrUpdateExceptionFromReconciliation(params) {
    const {
      tenantId,
      sourceType,
      sourceReconciliationId,
      sourceStatus,
      correlationId = requestContext.getCorrelationId(),
      openedBy = 'system'
    } = params;

    if (!tenantId || !sourceType || !sourceReconciliationId) {
      throw new Error('tenantId, sourceType and sourceReconciliationId are required');
    }

    const sourceRow = await this.getSourceRow({ tenantId, sourceType, sourceReconciliationId });
    const effectiveStatus = sourceStatus || sourceRow.reconciliation_status;

    if (effectiveStatus === 'MATCHED') {
      return null;
    }

    const severity = severityForStatus(effectiveStatus, sourceRow);
    const priority = priorityForSeverity(severity);
    const sourceMetadata = this.sourceSnapshot(sourceRow);

    return db.knex.transaction(async (trx) => {
      const existing = await trx('reconciliation_exception_cases')
        .where({
          tenant_id: tenantId,
          source_type: sourceType,
          source_reconciliation_id: sourceReconciliationId
        })
        .first();

      if (existing) {
        const existingMetadata = parseJson(existing.metadata);
        const [updated] = await trx('reconciliation_exception_cases')
          .where('id', existing.id)
          .update({
            source_status: effectiveStatus,
            severity,
            priority,
            last_action_at: new Date(),
            correlation_id: correlationId || existing.correlation_id,
            metadata: JSON.stringify({
              ...existingMetadata,
              source_snapshot: sourceMetadata
            }),
            updated_at: new Date()
          })
          .returning('*');
        return updated;
      }

      const caseId = uuidv4();
      const [created] = await trx('reconciliation_exception_cases')
        .insert({
          id: caseId,
          tenant_id: tenantId,
          source_type: sourceType,
          source_reconciliation_id: sourceReconciliationId,
          source_status: effectiveStatus,
          case_status: CASE_STATUSES.OPEN,
          severity,
          priority,
          opened_by: openedBy || 'system',
          opened_at: new Date(),
          last_action_at: new Date(),
          correlation_id: correlationId || null,
          metadata: JSON.stringify({
            source_snapshot: sourceMetadata
          })
        })
        .returning('*');

      await this.insertWorkflowAudit(trx, {
        tenantId,
        caseId,
        actionType: 'CASE_OPENED',
        previousStatus: null,
        newStatus: CASE_STATUSES.OPEN,
        performedBy: openedBy || 'system',
        correlationId,
        metadata: { source_type: sourceType, source_status: effectiveStatus }
      });

      logger.info('Reconciliation exception case opened', {
        tenant_id: tenantId,
        case_id: caseId,
        source_type: sourceType,
        source_reconciliation_id: sourceReconciliationId,
        source_status: effectiveStatus,
        severity,
        correlation_id: correlationId || null
      });

      return created;
    });
  }

  async createCasesForSource(params) {
    const { tenantId, sourceType, limit, correlationId } = params;
    this.validateSourceType(sourceType);
    const config = SOURCE_CONFIG[sourceType];
    let query = db.knex(config.table)
      .whereNot(config.statusColumn, 'MATCHED')
      .orderBy('checked_at', 'asc');

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (limit) query = query.limit(Number(limit));

    const rows = await query;
    const cases = [];

    for (const row of rows) {
      cases.push(await this.createOrUpdateExceptionFromReconciliation({
        tenantId: row.tenant_id,
        sourceType,
        sourceReconciliationId: row.id,
        sourceStatus: row[config.statusColumn],
        correlationId
      }));
    }

    return cases.filter(Boolean);
  }

  async createCasesForAllOpenMismatches(params = {}) {
    const { tenantId, sourceType = 'ALL', limit, correlationId = requestContext.getCorrelationId() } = params;
    const sourceTypes = sourceType === 'ALL' ? Object.keys(SOURCE_CONFIG) : [sourceType];
    const results = [];

    for (const type of sourceTypes) {
      const cases = await this.createCasesForSource({ tenantId, sourceType: type, limit, correlationId });
      results.push(...cases);
    }

    return {
      total: results.length,
      by_source_type: results.reduce((acc, row) => {
        acc[row.source_type] = (acc[row.source_type] || 0) + 1;
        return acc;
      }, {}),
      by_status: results.reduce((acc, row) => {
        acc[row.case_status] = (acc[row.case_status] || 0) + 1;
        return acc;
      }, {}),
      cases: results
    };
  }

  async listExceptionCases(filters = {}) {
    const {
      tenantId,
      sourceType,
      sourceStatus,
      caseStatus,
      severity,
      priority,
      assignedTo,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('reconciliation_exception_cases')
      .orderBy('last_action_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (sourceType) query = query.where('source_type', sourceType);
    if (sourceStatus) query = query.where('source_status', sourceStatus);
    if (caseStatus) query = query.where('case_status', caseStatus);
    if (severity) query = query.where('severity', severity);
    if (priority) query = query.where('priority', priority);
    if (assignedTo) query = query.where('assigned_to', assignedTo);
    if (from) query = query.where('opened_at', '>=', from);
    if (to) query = query.where('opened_at', '<=', to);

    return query;
  }

  async getExceptionCase(caseId, tenantId = null) {
    let query = db.knex('reconciliation_exception_cases').where('id', caseId);
    if (tenantId) query = query.where('tenant_id', tenantId);

    const exceptionCase = await query.first();
    if (!exceptionCase) {
      throw new Error('Reconciliation exception case not found');
    }

    const [comments, auditEvents] = await Promise.all([
      db.knex('reconciliation_exception_comments')
        .where({ tenant_id: exceptionCase.tenant_id, case_id: caseId })
        .orderBy('created_at', 'asc'),
      db.knex('reconciliation_exception_audit_events')
        .where({ tenant_id: exceptionCase.tenant_id, case_id: caseId })
        .orderBy('performed_at', 'asc')
    ]);

    return {
      case: exceptionCase,
      comments,
      audit_events: auditEvents
    };
  }

  async fetchCaseForUpdate(trx, caseId) {
    const exceptionCase = await trx('reconciliation_exception_cases')
      .where('id', caseId)
      .forUpdate()
      .first();

    if (!exceptionCase) {
      throw new Error('Reconciliation exception case not found');
    }

    return exceptionCase;
  }

  async updateCaseStatus(trx, exceptionCase, {
    newStatus,
    performedBy,
    actionType = 'STATUS_CHANGED',
    reason = null,
    correlationId = null,
    metadata = {},
    isPlatformAdmin = false,
    updateData = {}
  }) {
    this.validateTransition(exceptionCase.case_status, newStatus, { isPlatformAdmin });

    const [updated] = await trx('reconciliation_exception_cases')
      .where('id', exceptionCase.id)
      .update({
        ...updateData,
        case_status: newStatus,
        last_action_at: new Date(),
        correlation_id: correlationId || exceptionCase.correlation_id,
        updated_at: new Date()
      })
      .returning('*');

    await this.insertWorkflowAudit(trx, {
      tenantId: exceptionCase.tenant_id,
      caseId: exceptionCase.id,
      actionType,
      previousStatus: exceptionCase.case_status,
      newStatus,
      performedBy,
      reason,
      correlationId,
      metadata
    });

    return updated;
  }

  async assignCase(params) {
    const { caseId, assignedTo, assignedBy, correlationId = requestContext.getCorrelationId() } = params;
    if (!assignedTo || !assignedBy) throw new Error('assignedTo and assignedBy are required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      let workingCase = exceptionCase;

      if ([CASE_STATUSES.OPEN, CASE_STATUSES.REOPENED, CASE_STATUSES.ESCALATED].includes(exceptionCase.case_status)) {
        workingCase = await this.updateCaseStatus(trx, exceptionCase, {
          newStatus: CASE_STATUSES.IN_REVIEW,
          performedBy: assignedBy,
          actionType: 'STATUS_CHANGED',
          reason: 'Case assigned for review',
          correlationId
        });
      }

      const [updated] = await trx('reconciliation_exception_cases')
        .where('id', caseId)
        .update({
          assigned_to: assignedTo,
          assigned_by: assignedBy,
          assigned_at: new Date(),
          last_action_at: new Date(),
          correlation_id: correlationId || workingCase.correlation_id,
          updated_at: new Date()
        })
        .returning('*');

      await this.insertWorkflowAudit(trx, {
        tenantId: updated.tenant_id,
        caseId,
        actionType: 'CASE_ASSIGNED',
        previousStatus: workingCase.case_status,
        newStatus: updated.case_status,
        performedBy: assignedBy,
        correlationId,
        metadata: { assigned_to: assignedTo }
      });

      return updated;
    });
  }

  async unassignCase(params) {
    const { caseId, performedBy, correlationId = requestContext.getCorrelationId() } = params;
    if (!performedBy) throw new Error('performedBy is required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      const previousAssignedTo = exceptionCase.assigned_to;
      const [updated] = await trx('reconciliation_exception_cases')
        .where('id', caseId)
        .update({
          assigned_to: null,
          assigned_by: null,
          assigned_at: null,
          last_action_at: new Date(),
          correlation_id: correlationId || exceptionCase.correlation_id,
          updated_at: new Date()
        })
        .returning('*');

      await this.insertWorkflowAudit(trx, {
        tenantId: updated.tenant_id,
        caseId,
        actionType: 'CASE_UNASSIGNED',
        previousStatus: exceptionCase.case_status,
        newStatus: updated.case_status,
        performedBy,
        correlationId,
        metadata: { previous_assigned_to: previousAssignedTo }
      });

      return updated;
    });
  }

  async addComment(params) {
    const {
      caseId,
      commentText,
      commentType = 'NOTE',
      createdBy,
      correlationId = requestContext.getCorrelationId(),
      metadata = {}
    } = params;

    if (!commentText || !createdBy) throw new Error('commentText and createdBy are required');
    if (!COMMENT_TYPES.includes(commentType)) throw new Error(`Invalid commentType: ${commentType}`);

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      const [comment] = await trx('reconciliation_exception_comments')
        .insert({
          id: uuidv4(),
          tenant_id: exceptionCase.tenant_id,
          case_id: caseId,
          comment_text: commentText,
          comment_type: commentType,
          created_by: createdBy,
          correlation_id: correlationId || null,
          metadata: JSON.stringify(metadata || {})
        })
        .returning('*');

      await trx('reconciliation_exception_cases')
        .where('id', caseId)
        .update({
          last_action_at: new Date(),
          correlation_id: correlationId || exceptionCase.correlation_id,
          updated_at: new Date()
        });

      await this.insertWorkflowAudit(trx, {
        tenantId: exceptionCase.tenant_id,
        caseId,
        actionType: 'COMMENT_ADDED',
        previousStatus: exceptionCase.case_status,
        newStatus: exceptionCase.case_status,
        performedBy: createdBy,
        correlationId,
        metadata: { comment_id: comment.id, comment_type: commentType }
      });

      return comment;
    });
  }

  async escalateCase(params) {
    const { caseId, reason, performedBy, correlationId = requestContext.getCorrelationId() } = params;
    if (!reason || !performedBy) throw new Error('reason and performedBy are required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.ESCALATED,
        performedBy,
        actionType: 'ESCALATED',
        reason,
        correlationId
      });
    });
  }

  approvalRequiredFor(exceptionCase, resolutionType) {
    if (['WRITE_OFF_RECOMMENDED', 'CORRECTION_REQUIRED'].includes(resolutionType)) return true;
    if (resolutionType === 'IGNORE_WITH_REASON' && ['HIGH', 'CRITICAL'].includes(exceptionCase.severity)) return true;
    if (resolutionType === 'ACCEPTED_DIFFERENCE') {
      const sourceSnapshot = parseJson(exceptionCase.metadata).source_snapshot || {};
      return amountNumber(sourceSnapshot.discrepancy_amount) > APPROVAL_DIFFERENCE_THRESHOLD;
    }
    return false;
  }

  async resolveApprovalUserId(userId) {
    const actor = String(userId || 'system');
    if (isUuid(actor)) {
      const existing = await db.knex('platform_users').where('id', actor).first();
      if (existing) return existing.id;

      await db.knex('platform_users')
        .insert({
          id: actor,
          username: `recon-${actor.slice(0, 8)}`,
          email: `recon-${actor.slice(0, 8)}@system.local`,
          password_hash: 'not-used',
          role: 'FINANCE_ADMIN',
          status: 'active'
        })
        .onConflict('id')
        .ignore();
      return actor;
    }

    const safe = actor.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'system';
    const username = `recon-${safe}`;
    const existing = await db.knex('platform_users').where('username', username).first();
    if (existing) return existing.id;

    const [created] = await db.knex('platform_users')
      .insert({
        username,
        email: `${username}@system.local`,
        password_hash: 'not-used',
        role: 'FINANCE_ADMIN',
        status: 'active'
      })
      .returning('*');
    return created.id;
  }

  async createApprovalRequest(trx, exceptionCase, {
    resolutionType,
    resolutionReason,
    resolutionNotes,
    requestedBy,
    correlationId
  }) {
    const requestorId = await this.resolveApprovalUserId(requestedBy);
    const [approvalRequest] = await trx('approval_requests')
      .insert({
        request_type: 'RECONCILIATION_EXCEPTION_RESOLUTION',
        requestor_id: requestorId,
        status: 'pending',
        request_data: JSON.stringify({
          tenantId: exceptionCase.tenant_id,
          caseId: exceptionCase.id,
          sourceType: exceptionCase.source_type,
          sourceReconciliationId: exceptionCase.source_reconciliation_id,
          sourceStatus: exceptionCase.source_status,
          severity: exceptionCase.severity,
          resolutionType,
          resolutionReason,
          resolutionNotes,
          requestedBy,
          requestedAt: new Date(),
          correlationId
        })
      })
      .returning('*');

    return approvalRequest;
  }

  async requestApprovalForResolution(params) {
    const {
      caseId,
      resolutionType,
      resolutionReason,
      resolutionNotes,
      requestedBy,
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!RESOLUTION_TYPES.includes(resolutionType)) throw new Error(`Invalid resolutionType: ${resolutionType}`);
    if (!resolutionReason || !requestedBy) throw new Error('resolutionReason and requestedBy are required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      if (!this.approvalRequiredFor(exceptionCase, resolutionType)) {
        throw new Error('Approval is not required for this resolution');
      }
      this.validateTransition(exceptionCase.case_status, CASE_STATUSES.PENDING_APPROVAL);

      const approvalRequest = exceptionCase.approval_request_id
        ? await trx('approval_requests').where('id', exceptionCase.approval_request_id).first()
        : await this.createApprovalRequest(trx, exceptionCase, {
          resolutionType,
          resolutionReason,
          resolutionNotes,
          requestedBy,
          correlationId
        });

      const [updated] = await trx('reconciliation_exception_cases')
        .where('id', caseId)
        .update({
          case_status: CASE_STATUSES.PENDING_APPROVAL,
          resolution_type: resolutionType,
          resolution_reason: resolutionReason,
          resolution_notes: resolutionNotes || null,
          approval_required: true,
          approval_request_id: approvalRequest.id,
          last_action_at: new Date(),
          correlation_id: correlationId || exceptionCase.correlation_id,
          updated_at: new Date()
        })
        .returning('*');

      await this.insertWorkflowAudit(trx, {
        tenantId: exceptionCase.tenant_id,
        caseId,
        actionType: 'APPROVAL_REQUESTED',
        previousStatus: exceptionCase.case_status,
        newStatus: CASE_STATUSES.PENDING_APPROVAL,
        performedBy: requestedBy,
        reason: resolutionReason,
        correlationId,
        metadata: {
          approval_request_id: approvalRequest.id,
          resolution_type: resolutionType
        }
      });

      return updated;
    });
  }

  async moveCaseToPendingApproval(trx, exceptionCase, {
    resolutionType,
    resolutionReason,
    resolutionNotes,
    requestedBy,
    correlationId
  }) {
    this.validateTransition(exceptionCase.case_status, CASE_STATUSES.PENDING_APPROVAL);

    const approvalRequest = exceptionCase.approval_request_id
      ? await trx('approval_requests').where('id', exceptionCase.approval_request_id).first()
      : await this.createApprovalRequest(trx, exceptionCase, {
        resolutionType,
        resolutionReason,
        resolutionNotes,
        requestedBy,
        correlationId
      });

    const [updated] = await trx('reconciliation_exception_cases')
      .where('id', exceptionCase.id)
      .update({
        case_status: CASE_STATUSES.PENDING_APPROVAL,
        resolution_type: resolutionType,
        resolution_reason: resolutionReason,
        resolution_notes: resolutionNotes || null,
        approval_required: true,
        approval_request_id: approvalRequest.id,
        last_action_at: new Date(),
        correlation_id: correlationId || exceptionCase.correlation_id,
        updated_at: new Date()
      })
      .returning('*');

    await this.insertWorkflowAudit(trx, {
      tenantId: exceptionCase.tenant_id,
      caseId: exceptionCase.id,
      actionType: 'APPROVAL_REQUESTED',
      previousStatus: exceptionCase.case_status,
      newStatus: CASE_STATUSES.PENDING_APPROVAL,
      performedBy: requestedBy,
      reason: resolutionReason,
      correlationId,
      metadata: {
        approval_request_id: approvalRequest.id,
        resolution_type: resolutionType
      }
    });

    return updated;
  }

  async ensureReviewState(trx, exceptionCase, performedBy, correlationId) {
    if (exceptionCase.case_status === CASE_STATUSES.OPEN || exceptionCase.case_status === CASE_STATUSES.REOPENED) {
      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.IN_REVIEW,
        performedBy,
        actionType: 'STATUS_CHANGED',
        reason: 'Case entered review before resolution',
        correlationId
      });
    }
    return exceptionCase;
  }

  async assertApprovalAllowsResolution(trx, exceptionCase, performedBy, correlationId) {
    if (!exceptionCase.approval_required) return;
    if (!exceptionCase.approval_request_id) {
      throw new Error('Approval is required before resolving this case');
    }

    const approvalRequest = await trx('approval_requests')
      .where('id', exceptionCase.approval_request_id)
      .first();

    if (!approvalRequest || approvalRequest.status === 'pending') {
      throw new Error('Approval is pending; case cannot be resolved');
    }

    if (approvalRequest.status === 'rejected') {
      const [updated] = await trx('reconciliation_exception_cases')
        .where('id', exceptionCase.id)
        .update({
          case_status: CASE_STATUSES.IN_REVIEW,
          last_action_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      await this.insertWorkflowAudit(trx, {
        tenantId: exceptionCase.tenant_id,
        caseId: exceptionCase.id,
        actionType: 'APPROVAL_REJECTED',
        previousStatus: exceptionCase.case_status,
        newStatus: CASE_STATUSES.IN_REVIEW,
        performedBy,
        reason: approvalRequest.approval_reason || 'Approval rejected',
        correlationId,
        metadata: { approval_request_id: approvalRequest.id }
      });

      throw new Error(`Approval was rejected for case ${updated.id}`);
    }

    await this.insertWorkflowAudit(trx, {
      tenantId: exceptionCase.tenant_id,
      caseId: exceptionCase.id,
      actionType: 'APPROVAL_APPROVED',
      previousStatus: exceptionCase.case_status,
      newStatus: exceptionCase.case_status,
      performedBy,
      reason: approvalRequest.approval_reason || null,
      correlationId,
      metadata: { approval_request_id: approvalRequest.id }
    });
  }

  async resolveCase(params) {
    const {
      caseId,
      resolutionType,
      resolutionReason,
      resolutionNotes,
      resolvedBy,
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!RESOLUTION_TYPES.includes(resolutionType)) throw new Error(`Invalid resolutionType: ${resolutionType}`);
    if (!resolutionReason || !resolvedBy) throw new Error('resolutionReason and resolvedBy are required');

    return db.knex.transaction(async (trx) => {
      let exceptionCase = await this.fetchCaseForUpdate(trx, caseId);

      if (this.approvalRequiredFor(exceptionCase, resolutionType) && !exceptionCase.approval_required) {
        return this.moveCaseToPendingApproval(trx, exceptionCase, {
          resolutionType,
          resolutionReason,
          resolutionNotes,
          requestedBy: resolvedBy,
          correlationId
        });
      }

      exceptionCase = await this.ensureReviewState(trx, exceptionCase, resolvedBy, correlationId);
      await this.assertApprovalAllowsResolution(trx, exceptionCase, resolvedBy, correlationId);

      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.RESOLVED,
        performedBy: resolvedBy,
        actionType: 'RESOLVED',
        reason: resolutionReason,
        correlationId,
        updateData: {
          resolved_by: resolvedBy,
          resolved_at: new Date(),
          resolution_type: resolutionType,
          resolution_reason: resolutionReason,
          resolution_notes: resolutionNotes || null
        },
        metadata: { resolution_type: resolutionType }
      });
    });
  }

  async ignoreCase(params) {
    const { caseId, reason, ignoredBy, correlationId = requestContext.getCorrelationId() } = params;
    if (!reason || !ignoredBy) throw new Error('reason and ignoredBy are required');

    return db.knex.transaction(async (trx) => {
      let exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      if (this.approvalRequiredFor(exceptionCase, 'IGNORE_WITH_REASON') && !exceptionCase.approval_required) {
        return this.moveCaseToPendingApproval(trx, exceptionCase, {
          resolutionType: 'IGNORE_WITH_REASON',
          resolutionReason: reason,
          resolutionNotes: null,
          requestedBy: ignoredBy,
          correlationId
        });
      }

      exceptionCase = await this.ensureReviewState(trx, exceptionCase, ignoredBy, correlationId);
      await this.assertApprovalAllowsResolution(trx, exceptionCase, ignoredBy, correlationId);

      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.IGNORED,
        performedBy: ignoredBy,
        actionType: 'IGNORED',
        reason,
        correlationId,
        updateData: {
          resolved_by: ignoredBy,
          resolved_at: new Date(),
          resolution_type: 'IGNORE_WITH_REASON',
          resolution_reason: reason
        }
      });
    });
  }

  async reopenCase(params) {
    const { caseId, reason, reopenedBy, correlationId = requestContext.getCorrelationId(), isPlatformAdmin = false } = params;
    if (!reason || !reopenedBy) throw new Error('reason and reopenedBy are required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.REOPENED,
        performedBy: reopenedBy,
        actionType: 'REOPENED',
        reason,
        correlationId,
        isPlatformAdmin,
        updateData: {
          resolved_by: null,
          resolved_at: null
        }
      });
    });
  }

  async closeCase(params) {
    const { caseId, reason, closedBy, correlationId = requestContext.getCorrelationId() } = params;
    if (!reason || !closedBy) throw new Error('reason and closedBy are required');

    return db.knex.transaction(async (trx) => {
      const exceptionCase = await this.fetchCaseForUpdate(trx, caseId);
      return this.updateCaseStatus(trx, exceptionCase, {
        newStatus: CASE_STATUSES.CLOSED,
        performedBy: closedBy,
        actionType: 'CLOSED',
        reason,
        correlationId
      });
    });
  }
}

module.exports = new ReconciliationExceptionService();
