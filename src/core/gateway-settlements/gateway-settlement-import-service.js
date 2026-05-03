const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const requestContext = require('../context/request-context');
const logger = require('../logging/logger');
const feeValidationService = require('./gateway-fee-validation-service');
const gatewaySettlementLedgerService = require('./gateway-settlement-ledger-service');
const gatewaySettlementSignalService = require('./gateway-settlement-signal-service');
const { roundMoney, absDiff } = require('./gateway-fee-validation-service');

const VALID_SOURCE_TYPES = ['CSV_UPLOAD', 'API_FEED', 'MANUAL_UPLOAD', 'GATEWAY_WEBHOOK'];
const VALID_LINE_TYPES = ['PAYMENT', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT', 'FEE', 'TAX', 'OTHER'];

function amount(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid amount: ${value}`);
  return roundMoney(parsed);
}

function dateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnlyOrNull(value) {
  const parsed = dateOrNull(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
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

class GatewaySettlementImportService {
  normalizeGatewayName(gatewayName) {
    return String(gatewayName || '').toLowerCase();
  }

  normalizeGatewaySettlementLine({ gatewayName, rawLine }) {
    const normalizedGateway = this.normalizeGatewayName(gatewayName);
    const lineType = String(rawLine.line_type || rawLine.lineType || 'PAYMENT').toUpperCase();
    if (!VALID_LINE_TYPES.includes(lineType)) {
      throw new Error(`Invalid gateway settlement line type: ${lineType}`);
    }

    const grossAmount = amount(rawLine.gross_amount ?? rawLine.grossAmount ?? rawLine.amount, null);
    if ((lineType === 'PAYMENT' || lineType === 'REFUND') && (!Number.isFinite(grossAmount) || grossAmount <= 0)) {
      throw new Error('Payment settlement line gross_amount must be greater than 0');
    }

    const gatewayFee = amount(rawLine.gateway_fee ?? rawLine.gatewayFee ?? rawLine.fee, 0);
    const gstAmount = amount(rawLine.gst_amount ?? rawLine.gstAmount ?? rawLine.tax ?? rawLine.gst, 0);
    const adjustmentAmount = amount(rawLine.adjustment_amount ?? rawLine.adjustmentAmount ?? rawLine.adjustment, 0);
    const computedNet = roundMoney(Number(grossAmount || 0) - gatewayFee - gstAmount + adjustmentAmount);
    const netAmount = amount(rawLine.net_amount ?? rawLine.netAmount ?? rawLine.settlement_amount ?? rawLine.settlementAmount, computedNet);

    return {
      gateway_name: normalizedGateway,
      gateway_settlement_id: rawLine.gateway_settlement_id || rawLine.gatewaySettlementId || rawLine.settlement_id || rawLine.settlementId || null,
      gateway_settlement_line_id: rawLine.gateway_settlement_line_id || rawLine.gatewaySettlementLineId || rawLine.line_id || rawLine.lineId || null,
      transaction_ref: rawLine.transaction_ref || rawLine.transactionRef || null,
      gateway_transaction_id: rawLine.gateway_transaction_id || rawLine.gatewayTransactionId || rawLine.gateway_payment_id || rawLine.gatewayPaymentId || null,
      gateway_payment_id: rawLine.gateway_payment_id || rawLine.gatewayPaymentId || rawLine.payment_id || rawLine.paymentId || null,
      order_id: rawLine.order_id || rawLine.orderId || null,
      merchant_id: rawLine.merchant_id || rawLine.merchantId || null,
      line_type: lineType,
      gateway_status: rawLine.gateway_status || rawLine.gatewayStatus || rawLine.status || null,
      transaction_date: dateOrNull(rawLine.transaction_date || rawLine.transactionDate),
      captured_at: dateOrNull(rawLine.captured_at || rawLine.capturedAt),
      settled_at: dateOrNull(rawLine.settled_at || rawLine.settledAt || rawLine.settlement_date || rawLine.settlementDate),
      gross_amount: grossAmount || 0,
      gateway_fee: gatewayFee,
      gst_amount: gstAmount,
      adjustment_amount: adjustmentAmount,
      net_amount: netAmount,
      currency: String(rawLine.currency || 'INR').toUpperCase(),
      raw_payload: rawLine
    };
  }

  calculateNormalizedHash(line) {
    const payload = [
      line.gateway_name,
      line.gateway_settlement_id || '',
      line.gateway_settlement_line_id || '',
      line.transaction_ref || '',
      line.gateway_transaction_id || '',
      line.gateway_payment_id || '',
      line.order_id || '',
      line.line_type,
      line.gross_amount,
      line.gateway_fee,
      line.gst_amount,
      line.adjustment_amount,
      line.net_amount,
      line.currency,
      line.settled_at ? new Date(line.settled_at).toISOString() : ''
    ].join('|');

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  calculateRawHash(gatewayName, rawLine) {
    return crypto.createHash('sha256')
      .update(`${this.normalizeGatewayName(gatewayName)}|${JSON.stringify(rawLine || {})}`)
      .digest('hex');
  }

  async detectDuplicateLine(tenantId, line) {
    return db.knex('gateway_settlement_lines')
      .where('tenant_id', tenantId)
      .where(function() {
        this.where('normalized_hash', line.normalized_hash);
        if (line.gateway_settlement_line_id) {
          this.orWhere(function() {
            this.where('gateway_name', line.gateway_name)
              .where('gateway_settlement_line_id', line.gateway_settlement_line_id);
          });
        }
      })
      .first();
  }

  async matchLineToTransaction(line, trx = db.knex) {
    const predicates = [
      line.transaction_ref ? ['transaction_ref', line.transaction_ref] : null,
      line.gateway_transaction_id ? ['gateway_transaction_id', line.gateway_transaction_id] : null,
      line.gateway_payment_id ? ['gateway_transaction_id', line.gateway_payment_id] : null,
      line.order_id ? ['order_id', line.order_id] : null
    ].filter(Boolean);

    if (predicates.length === 0) return null;

    return trx('transactions')
      .where('tenant_id', line.tenant_id)
      .where(function() {
        for (const [column, value] of predicates) {
          this.orWhere(column, value);
        }
      })
      .first();
  }

  validateLineAmounts(line, transaction = null) {
    const expectedNet = feeValidationService.expectedNet({
      grossAmount: line.gross_amount,
      gatewayFee: line.gateway_fee,
      gstAmount: line.gst_amount,
      adjustmentAmount: line.adjustment_amount
    });
    const netDiscrepancy = absDiff(line.net_amount, expectedNet);

    if (transaction) {
      const txAmount = Number(transaction.amount || 0);
      if (absDiff(txAmount, line.gross_amount) > 0.01) {
        return {
          status: 'AMOUNT_MISMATCH',
          signalType: 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH',
          impactAmount: absDiff(txAmount, line.gross_amount),
          reason: `Gateway gross amount ${line.gross_amount} does not match transaction amount ${txAmount}`,
          expectedNet,
          netDiscrepancy
        };
      }
      if (String(transaction.currency || 'INR').toUpperCase() !== line.currency) {
        return {
          status: 'AMOUNT_MISMATCH',
          signalType: 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH',
          impactAmount: Number(line.gross_amount || 0),
          reason: `Gateway settlement currency ${line.currency} does not match transaction currency ${transaction.currency}`,
          expectedNet,
          netDiscrepancy
        };
      }
      if (transaction.status !== 'success') {
        return {
          status: 'UNMATCHED',
          signalType: 'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT',
          impactAmount: Number(line.gross_amount || 0),
          reason: `Gateway settlement line references transaction ${transaction.transaction_ref} with non-captured status ${transaction.status}`,
          expectedNet,
          netDiscrepancy
        };
      }
    }

    if (netDiscrepancy > 0.01) {
      return {
        status: 'NET_MISMATCH',
        signalType: 'NET_SETTLEMENT_MISMATCH',
        impactAmount: netDiscrepancy,
        reason: `Gateway net amount ${line.net_amount} does not match computed net ${expectedNet}`,
        expectedNet,
        netDiscrepancy
      };
    }

    return { status: 'MATCHED', expectedNet, netDiscrepancy: 0 };
  }

  async emitLineSignal({ line, batch, transaction = null, signalType, sourceType = 'GATEWAY_SETTLEMENT_LINE', description, impactAmount = null, metadata = {} }, trx = null) {
    return gatewaySettlementSignalService.createOrUpdateSignal({
      tenantId: line.tenant_id,
      signalType,
      sourceType,
      sourceId: line.id,
      batchId: batch.id,
      lineId: line.id,
      transactionId: transaction?.id || line.transaction_id,
      transactionRef: transaction?.transaction_ref || line.transaction_ref,
      gatewayName: line.gateway_name,
      gatewaySettlementId: line.gateway_settlement_id || batch.gateway_settlement_id,
      gatewayTransactionId: line.gateway_transaction_id || line.gateway_payment_id,
      impactAmount,
      currency: line.currency,
      description,
      correlationId: line.correlation_id || batch.correlation_id,
      metadata
    }, trx);
  }

  async insertFailedLine({ tenantId, batch, gatewayName, rawLine, error, correlationId }) {
    const normalizedHash = this.calculateRawHash(gatewayName, rawLine);
    try {
      const [line] = await db.knex('gateway_settlement_lines')
        .insert({
          id: uuidv4(),
          tenant_id: tenantId,
          batch_id: batch.id,
          gateway_name: this.normalizeGatewayName(gatewayName),
          gateway_settlement_id: batch.gateway_settlement_id,
          line_type: 'OTHER',
          gross_amount: '0.00',
          gateway_fee: '0.00',
          gst_amount: '0.00',
          adjustment_amount: '0.00',
          net_amount: '0.00',
          currency: batch.currency || 'INR',
          raw_payload: rawLine || {},
          normalized_hash: normalizedHash,
          reconciliation_status: 'FAILED',
          correlation_id: correlationId || null,
          metadata: { error: error.message }
        })
        .returning('*');
      return line;
    } catch (insertError) {
      if (insertError.code === '23505') return null;
      throw insertError;
    }
  }

  async processLine({ tenantId, batch, gatewayName, rawLine, correlationId }) {
    let normalized;
    try {
      normalized = this.normalizeGatewaySettlementLine({ gatewayName, rawLine });
      normalized.tenant_id = tenantId;
      normalized.batch_id = batch.id;
      normalized.gateway_settlement_id = normalized.gateway_settlement_id || batch.gateway_settlement_id;
      normalized.normalized_hash = this.calculateNormalizedHash(normalized);
    } catch (error) {
      await this.insertFailedLine({ tenantId, batch, gatewayName, rawLine, error, correlationId });
      return { imported: false, duplicate: false, failed: true, error };
    }

    const duplicate = await this.detectDuplicateLine(tenantId, normalized);
    if (duplicate) {
      await db.knex('gateway_settlement_lines')
        .where('id', duplicate.id)
        .update({
          metadata: {
            ...(parseJson(duplicate.metadata)),
            duplicate_detected_at: new Date().toISOString(),
            duplicate_batch_id: batch.id
          },
          updated_at: new Date()
        });
      await gatewaySettlementSignalService.createOrUpdateSignal({
        tenantId,
        signalType: 'DUPLICATE_GATEWAY_SETTLEMENT_LINE',
        sourceType: 'GATEWAY_SETTLEMENT_LINE',
        sourceId: duplicate.id,
        batchId: duplicate.batch_id,
        lineId: duplicate.id,
        transactionId: duplicate.transaction_id,
        transactionRef: duplicate.transaction_ref,
        gatewayName: duplicate.gateway_name,
        gatewaySettlementId: duplicate.gateway_settlement_id,
        gatewayTransactionId: duplicate.gateway_transaction_id,
        impactAmount: duplicate.net_amount,
        currency: duplicate.currency,
        description: `Duplicate gateway settlement line detected for ${duplicate.gateway_settlement_line_id || duplicate.normalized_hash}`,
        correlationId,
        metadata: {
          duplicate_batch_id: batch.id,
          normalized_hash: duplicate.normalized_hash
        }
      });
      return { imported: false, duplicate: true, failed: false, line: duplicate };
    }

    const transaction = await this.matchLineToTransaction(normalized);
    let reconciliationStatus = 'MATCHED';
    let validation = {
      expectedNet: feeValidationService.expectedNet({
        grossAmount: normalized.gross_amount,
        gatewayFee: normalized.gateway_fee,
        gstAmount: normalized.gst_amount,
        adjustmentAmount: normalized.adjustment_amount
      }),
      netDiscrepancy: 0
    };
    let feeValidation = null;

    if (!transaction) {
      reconciliationStatus = 'MISSING_TRANSACTION';
    } else {
      normalized.transaction_id = transaction.id;
      normalized.transaction_ref = transaction.transaction_ref;
      normalized.order_id = transaction.order_id;
      normalized.gateway_transaction_id = normalized.gateway_transaction_id || transaction.gateway_transaction_id;
      normalized.gateway_payment_id = normalized.gateway_payment_id || transaction.gateway_transaction_id;
      normalized.merchant_id = normalized.merchant_id || transaction.tenant_id;

      validation = this.validateLineAmounts(normalized, transaction);
      reconciliationStatus = validation.status;

      if (reconciliationStatus === 'MATCHED') {
        feeValidation = await feeValidationService.validateGatewayLineFees(normalized, transaction);
        if (feeValidation.pricingRuleMissing) reconciliationStatus = 'UNMATCHED';
        else if (feeValidation.feeMismatch) reconciliationStatus = 'FEE_MISMATCH';
        else if (feeValidation.gstMismatch) reconciliationStatus = 'GST_MISMATCH';
        else if (feeValidation.netMismatch) reconciliationStatus = 'NET_MISMATCH';
      }
    }

    const [line] = await db.knex('gateway_settlement_lines')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        batch_id: batch.id,
        ...normalized,
        gross_amount: normalized.gross_amount.toFixed(2),
        gateway_fee: normalized.gateway_fee.toFixed(2),
        gst_amount: normalized.gst_amount.toFixed(2),
        adjustment_amount: normalized.adjustment_amount.toFixed(2),
        net_amount: normalized.net_amount.toFixed(2),
        expected_gateway_fee: feeValidation?.expectedGatewayFee ?? null,
        expected_gst_amount: feeValidation?.expectedGstAmount ?? null,
        expected_net_amount: feeValidation?.expectedNetAmount ?? validation.expectedNet ?? null,
        fee_discrepancy_amount: feeValidation?.feeDiscrepancyAmount ?? null,
        gst_discrepancy_amount: feeValidation?.gstDiscrepancyAmount ?? null,
        net_discrepancy_amount: feeValidation?.netDiscrepancyAmount ?? validation.netDiscrepancy ?? null,
        pricing_rule_id: feeValidation?.pricingRule?.id || null,
        pricing_snapshot: feeValidation?.pricingSnapshot || null,
        raw_payload: normalized.raw_payload,
        reconciliation_status: reconciliationStatus,
        correlation_id: correlationId || null,
        metadata: {
          validation_reason: validation.reason || null,
          pricing_rule_missing: Boolean(feeValidation?.pricingRuleMissing)
        }
      })
      .returning('*');

    if (reconciliationStatus === 'MISSING_TRANSACTION') {
      await this.emitLineSignal({
        line,
        batch,
        signalType: 'GATEWAY_SETTLEMENT_WITHOUT_PAYMENT',
        description: `Gateway settlement line ${line.gateway_settlement_line_id || line.normalized_hash} does not map to an internal captured payment`,
        impactAmount: line.gross_amount,
        metadata: { raw_references: normalized.raw_payload }
      });
    } else if (validation.signalType) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: validation.signalType,
        description: validation.reason,
        impactAmount: validation.impactAmount,
        metadata: validation
      });
    }

    if (feeValidation?.pricingRuleMissing) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: 'PRICING_RULE_MISSING',
        sourceType: 'PRICING_VALIDATION',
        description: `No active pricing rule found for ${line.gateway_name} ${transaction?.payment_method || 'payment'} settlement line`,
        impactAmount: line.gateway_fee,
        metadata: { payment_method: transaction?.payment_method || null }
      });
    } else if (feeValidation?.feeMismatch) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: 'GATEWAY_FEE_MISMATCH',
        sourceType: 'PRICING_VALIDATION',
        description: `Gateway fee ${line.gateway_fee} differs from expected fee ${feeValidation.expectedGatewayFee}`,
        impactAmount: feeValidation.feeDiscrepancyAmount,
        metadata: feeValidation
      });
    } else if (feeValidation?.gstMismatch) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: 'GST_MISMATCH',
        sourceType: 'PRICING_VALIDATION',
        description: `Gateway GST ${line.gst_amount} differs from expected GST ${feeValidation.expectedGstAmount}`,
        impactAmount: feeValidation.gstDiscrepancyAmount,
        metadata: feeValidation
      });
    } else if (feeValidation?.netMismatch) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: 'NET_SETTLEMENT_MISMATCH',
        sourceType: 'PRICING_VALIDATION',
        description: `Gateway net ${line.net_amount} differs from computed expected net ${line.expected_net_amount}`,
        impactAmount: line.net_discrepancy_amount,
        metadata: feeValidation || validation
      });
    }

    if (Number(line.adjustment_amount || 0) !== 0) {
      await this.emitLineSignal({
        line,
        batch,
        transaction,
        signalType: 'UNEXPECTED_GATEWAY_DEDUCTION',
        description: `Gateway settlement line includes adjustment amount ${line.adjustment_amount}`,
        impactAmount: Math.abs(Number(line.adjustment_amount || 0)),
        metadata: { adjustment_amount: line.adjustment_amount }
      });
    }

    return { imported: true, duplicate: false, failed: false, line, transaction };
  }

  async findExistingBatch({ tenantId, gatewayName, gatewaySettlementId, sourceReference }) {
    const predicates = [
      gatewaySettlementId ? ['gateway_settlement_id', gatewaySettlementId] : null,
      sourceReference ? ['source_reference', sourceReference] : null
    ].filter(Boolean);

    if (predicates.length === 0) return null;

    const query = db.knex('gateway_settlement_batches')
      .where('tenant_id', tenantId)
      .where('gateway_name', gatewayName)
      .where(function() {
        for (const [column, value] of predicates) {
          this.orWhere(column, value);
        }
      });

    return query.first();
  }

  validateReportedTotals(reportedTotals, computedTotals) {
    const checks = [
      ['gross_amount', 'gross'],
      ['total_gateway_fee', 'fee'],
      ['total_gst_amount', 'gst'],
      ['total_adjustment_amount', 'adjustment'],
      ['net_settlement_amount', 'net']
    ];
    const mismatches = [];

    for (const [reportedKey, computedKey] of checks) {
      if (reportedTotals[reportedKey] === null || reportedTotals[reportedKey] === undefined) continue;
      const discrepancy = absDiff(reportedTotals[reportedKey], computedTotals[computedKey]);
      if (discrepancy > 0.01) {
        mismatches.push({
          field: reportedKey,
          reported: reportedTotals[reportedKey],
          computed: roundMoney(computedTotals[computedKey]),
          discrepancy
        });
      }
    }

    return {
      hasMismatch: mismatches.length > 0,
      mismatches,
      impactAmount: mismatches.reduce((max, item) => Math.max(max, Number(item.discrepancy || 0)), 0)
    };
  }

  async finalizeBatchTotals(batchId) {
    const rows = await db.knex('gateway_settlement_lines')
      .where('batch_id', batchId)
      .whereNotIn('reconciliation_status', ['FAILED', 'DUPLICATE_LINE']);

    const totals = rows.reduce((acc, row) => {
      acc.gross += Number(row.gross_amount || 0);
      acc.fee += Number(row.gateway_fee || 0);
      acc.gst += Number(row.gst_amount || 0);
      acc.adjustment += Number(row.adjustment_amount || 0);
      acc.net += Number(row.net_amount || 0);
      if (row.currency) acc.currency = row.currency;
      if (row.reconciliation_status !== 'MATCHED') acc.hasMismatches = true;
      return acc;
    }, { gross: 0, fee: 0, gst: 0, adjustment: 0, net: 0, currency: 'INR', hasMismatches: false });

    const counts = await db.knex('gateway_settlement_lines')
      .where('batch_id', batchId)
      .select('reconciliation_status')
      .count('* as count')
      .groupBy('reconciliation_status');
    const countMap = counts.reduce((acc, row) => {
      acc[row.reconciliation_status] = Number(row.count);
      return acc;
    }, {});

    return {
      totals,
      countMap,
      importedLines: rows.length,
      failedLines: countMap.FAILED || 0,
      duplicateLines: countMap.DUPLICATE_LINE || 0
    };
  }

  async importGatewaySettlementBatch(params) {
    const {
      tenantId,
      gatewayName,
      sourceType,
      sourceFilename = null,
      sourceReference = null,
      settlementId = null,
      gatewaySettlementId = settlementId,
      settlementCycleStart = null,
      settlementCycleEnd = null,
      expectedSettlementDate = null,
      actualSettlementDate = null,
      settlementUtr = null,
      bankReferenceNumber = null,
      grossAmount = null,
      totalGatewayFee = null,
      totalGstAmount = null,
      totalAdjustmentAmount = null,
      netSettlementAmount = null,
      lines = [],
      importedBy = null,
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!tenantId) throw new Error('tenantId is required');
    if (!gatewayName) throw new Error('gatewayName is required');
    if (!VALID_SOURCE_TYPES.includes(sourceType)) throw new Error(`Invalid sourceType: ${sourceType}`);
    if (!Array.isArray(lines)) throw new Error('lines must be an array');

    const normalizedGateway = this.normalizeGatewayName(gatewayName);
    const existingBatch = await this.findExistingBatch({
      tenantId,
      gatewayName: normalizedGateway,
      gatewaySettlementId,
      sourceReference
    });

    if (existingBatch) {
      const existingLines = await db.knex('gateway_settlement_lines')
        .where('batch_id', existingBatch.id)
        .orderBy('created_at', 'asc');
      return {
        batch: existingBatch,
        lines: existingLines,
        idempotent: true,
        summary: {
          total_lines: existingBatch.total_lines,
          imported_lines: existingBatch.imported_lines,
          duplicate_lines: existingBatch.duplicate_lines,
          failed_lines: existingBatch.failed_lines
        }
      };
    }

    const [batch] = await db.knex('gateway_settlement_batches')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        gateway_name: normalizedGateway,
        gateway_settlement_id: gatewaySettlementId || null,
        settlement_cycle_start: dateOrNull(settlementCycleStart),
        settlement_cycle_end: dateOrNull(settlementCycleEnd),
        expected_settlement_date: dateOnlyOrNull(expectedSettlementDate),
        actual_settlement_date: dateOnlyOrNull(actualSettlementDate) || new Date().toISOString().slice(0, 10),
        settlement_utr: settlementUtr || null,
        bank_reference_number: bankReferenceNumber || null,
        source_type: sourceType,
        source_filename: sourceFilename,
        source_reference: sourceReference,
        import_status: 'PROCESSING',
        total_lines: lines.length,
        imported_by: importedBy,
        correlation_id: correlationId || null,
        raw_payload: { lines },
        metadata: {
          reported_totals: {
            gross_amount: grossAmount,
            total_gateway_fee: totalGatewayFee,
            total_gst_amount: totalGstAmount,
            total_adjustment_amount: totalAdjustmentAmount,
            net_settlement_amount: netSettlementAmount
          }
        }
      })
      .returning('*');

    const errors = [];
    let duplicateLines = 0;
    let failedLines = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const result = await this.processLine({
        tenantId,
        batch,
        gatewayName: normalizedGateway,
        rawLine: lines[index],
        correlationId
      });
      if (result.duplicate) duplicateLines += 1;
      if (result.failed) {
        failedLines += 1;
        errors.push({ line: index + 1, error: result.error.message });
      }
    }

    const finalized = await this.finalizeBatchTotals(batch.id);
    const reportedTotals = {
      gross_amount: grossAmount === null || grossAmount === undefined ? null : amount(grossAmount, null),
      total_gateway_fee: totalGatewayFee === null || totalGatewayFee === undefined ? null : amount(totalGatewayFee, null),
      total_gst_amount: totalGstAmount === null || totalGstAmount === undefined ? null : amount(totalGstAmount, null),
      total_adjustment_amount: totalAdjustmentAmount === null || totalAdjustmentAmount === undefined ? null : amount(totalAdjustmentAmount, null),
      net_settlement_amount: netSettlementAmount === null || netSettlementAmount === undefined ? null : amount(netSettlementAmount, null)
    };
    const batchTotalValidation = this.validateReportedTotals(reportedTotals, finalized.totals);
    const hasErrors = failedLines > 0 ||
      duplicateLines > 0 ||
      finalized.totals.hasMismatches ||
      batchTotalValidation.hasMismatch ||
      Object.entries(finalized.countMap).some(([status, count]) => status !== 'MATCHED' && count > 0);
    const importStatus = finalized.importedLines === 0 && failedLines > 0
      ? 'FAILED'
      : hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';

    const [updatedBatch] = await db.knex('gateway_settlement_batches')
      .where('id', batch.id)
      .update({
        import_status: importStatus,
        imported_lines: finalized.importedLines,
        duplicate_lines: duplicateLines,
        failed_lines: failedLines,
        gross_amount: roundMoney(finalized.totals.gross).toFixed(2),
        total_gateway_fee: roundMoney(finalized.totals.fee).toFixed(2),
        total_gst_amount: roundMoney(finalized.totals.gst).toFixed(2),
        total_adjustment_amount: roundMoney(finalized.totals.adjustment).toFixed(2),
        net_settlement_amount: roundMoney(finalized.totals.net).toFixed(2),
        currency: finalized.totals.currency,
        error_message: errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null,
        imported_at: new Date(),
        updated_at: new Date(),
        metadata: {
          reconciliation_counts: finalized.countMap,
          reported_totals: reportedTotals,
          batch_total_validation: batchTotalValidation
        }
      })
      .returning('*');

    let outboxEvent = null;
    if (batchTotalValidation.hasMismatch) {
      await gatewaySettlementSignalService.createOrUpdateSignal({
        tenantId,
        signalType: 'GATEWAY_SETTLEMENT_AMOUNT_MISMATCH',
        sourceType: 'GATEWAY_SETTLEMENT_BATCH',
        sourceId: updatedBatch.id,
        batchId: updatedBatch.id,
        gatewayName: normalizedGateway,
        gatewaySettlementId: updatedBatch.gateway_settlement_id,
        impactAmount: batchTotalValidation.impactAmount,
        currency: updatedBatch.currency,
        description: `Gateway settlement batch reported totals do not match imported line totals for ${updatedBatch.gateway_settlement_id || updatedBatch.id}`,
        correlationId,
        metadata: batchTotalValidation
      });
    }

    if (importStatus === 'COMPLETED' && Number(updatedBatch.net_settlement_amount || 0) > 0) {
      await db.knex.transaction(async (trx) => {
        outboxEvent = await gatewaySettlementLedgerService.emitGatewaySettlementReceived(updatedBatch, trx);
      });
    }

    const storedLines = await db.knex('gateway_settlement_lines')
      .where('batch_id', batch.id)
      .orderBy('created_at', 'asc');

    logger.info('Gateway settlement batch imported', {
      tenant_id: tenantId,
      batch_id: batch.id,
      gateway_name: normalizedGateway,
      gateway_settlement_id: gatewaySettlementId || null,
      import_status: importStatus,
      imported_lines: finalized.importedLines,
      duplicate_lines: duplicateLines,
      failed_lines: failedLines,
      outbox_event_id: outboxEvent?.id || null,
      correlation_id: correlationId || null
    });

    return {
      batch: updatedBatch,
      lines: storedLines,
      outboxEvent,
      idempotent: false,
      summary: {
        total_lines: lines.length,
        imported_lines: finalized.importedLines,
        duplicate_lines: duplicateLines,
        failed_lines: failedLines,
        errors
      }
    };
  }

  async getBatch(batchId, tenantId = null) {
    let query = db.knex('gateway_settlement_batches').where('id', batchId);
    if (tenantId) query = query.where('tenant_id', tenantId);
    const batch = await query.first();
    if (!batch) throw new Error('Gateway settlement batch not found');
    const lines = await db.knex('gateway_settlement_lines').where('batch_id', batch.id).orderBy('created_at', 'asc');
    return { batch, lines };
  }

  async listBatches(filters = {}) {
    const {
      tenantId,
      gatewayName,
      importStatus,
      settlementUtr,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;

    let query = db.knex('gateway_settlement_batches')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (gatewayName) query = query.where('gateway_name', this.normalizeGatewayName(gatewayName));
    if (importStatus) query = query.where('import_status', importStatus);
    if (settlementUtr) query = query.where('settlement_utr', settlementUtr);
    if (from) query = query.where('actual_settlement_date', '>=', from);
    if (to) query = query.where('actual_settlement_date', '<=', to);

    return query;
  }

  async listLines(filters = {}) {
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
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (batchId) query = query.where('batch_id', batchId);
    if (gatewayName) query = query.where('gateway_name', this.normalizeGatewayName(gatewayName));
    if (transactionRef) query = query.where('transaction_ref', transactionRef);
    if (gatewayTransactionId) query = query.where('gateway_transaction_id', gatewayTransactionId);
    if (gatewayPaymentId) query = query.where('gateway_payment_id', gatewayPaymentId);
    if (reconciliationStatus) query = query.where('reconciliation_status', reconciliationStatus);
    if (from) query = query.where('settled_at', '>=', from);
    if (to) query = query.where('settled_at', '<=', to);

    return query;
  }
}

module.exports = new GatewaySettlementImportService();
module.exports.GatewaySettlementImportService = GatewaySettlementImportService;
