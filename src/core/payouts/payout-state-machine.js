const TERMINAL_STATUSES = ['SUCCESS', 'RETURNED', 'REVERSED', 'CANCELLED'];

const ALLOWED_TRANSITIONS = {
  CREATED: ['READY', 'CANCELLED'],
  READY: ['SUBMITTED', 'CANCELLED', 'FAILED', 'REJECTED', 'TIMEOUT'],
  SUBMITTED: ['ACCEPTED', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED', 'TIMEOUT'],
  ACCEPTED: ['PROCESSING', 'SUCCESS', 'FAILED', 'RETURNED', 'TIMEOUT'],
  QUEUED: ['PROCESSING', 'FAILED', 'TIMEOUT'],
  PROCESSING: ['SUCCESS', 'FAILED', 'RETURNED', 'REVERSED', 'TIMEOUT'],
  SUCCESS: ['RETURNED', 'REVERSED'],
  FAILED: ['READY'],
  REJECTED: ['READY'],
  TIMEOUT: ['READY', 'PROCESSING', 'SUCCESS', 'FAILED'],
  RETURNED: [],
  REVERSED: [],
  CANCELLED: []
};

const TIMESTAMP_COLUMNS = {
  SUBMITTED: 'submitted_at',
  ACCEPTED: 'accepted_at',
  QUEUED: 'queued_at',
  PROCESSING: 'processing_at',
  SUCCESS: 'completed_at',
  FAILED: 'failed_at',
  REJECTED: 'failed_at',
  RETURNED: 'returned_at',
  REVERSED: 'reversed_at',
  TIMEOUT: 'timeout_at',
  CANCELLED: 'cancelled_at'
};

class PayoutStateMachine {
  normalize(status) {
    return String(status || '').toUpperCase();
  }

  canTransition(fromStatus, toStatus) {
    const from = this.normalize(fromStatus);
    const to = this.normalize(toStatus);
    if (from === to) return true;
    return (ALLOWED_TRANSITIONS[from] || []).includes(to);
  }

  assertTransitionAllowed(fromStatus, toStatus) {
    const from = this.normalize(fromStatus);
    const to = this.normalize(toStatus);
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid payout status transition ${from} -> ${to}`);
    }
    return { from, to };
  }

  isTerminal(status) {
    return TERMINAL_STATUSES.includes(this.normalize(status));
  }

  timestampColumn(status) {
    return TIMESTAMP_COLUMNS[this.normalize(status)] || null;
  }

  transitionPatch(fromStatus, toStatus, metadata = {}) {
    const { from, to } = this.assertTransitionAllowed(fromStatus, toStatus);
    const patch = {
      payout_status: to,
      updated_at: new Date(),
      metadata: {
        ...(metadata.currentMetadata || {}),
        last_transition: {
          from_status: from,
          to_status: to,
          reason: metadata.reason || null,
          provider_status: metadata.providerStatus || null,
          transitioned_at: new Date().toISOString()
        }
      }
    };
    const timestampColumn = this.timestampColumn(to);
    if (timestampColumn) patch[timestampColumn] = new Date();
    return patch;
  }
}

module.exports = new PayoutStateMachine();
module.exports.PayoutStateMachine = PayoutStateMachine;
module.exports.ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
