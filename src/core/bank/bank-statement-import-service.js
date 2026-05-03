const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../../database');
const logger = require('../logging/logger');
const requestContext = require('../context/request-context');

const VALID_SOURCE_TYPES = ['CSV_UPLOAD', 'API_FEED', 'MANUAL_UPLOAD', 'BANK_WEBHOOK'];

function toAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  return amount;
}

function dateOnly(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

class BankStatementImportService {
  extractReferences(text = '') {
    const source = String(text || '');
    const utrMatch = source.match(/\bUTR[:\s-]+([A-Z0-9]{6,})\b/i) ||
      source.match(/\b(?:UPI|NEFT|IMPS|RTGS)\/([A-Z0-9]{6,})\b/i);
    const bankRefMatch = source.match(/\b(?:BANKREF|BANK_REF|REF|REFERENCE)[:\s-]*([A-Z0-9-]{4,})\b/i);
    const bankTxnMatch = source.match(/\b(?:TXN|TXNID|BANKTXN|BANK_TXN)[:\s-]*([A-Z0-9-]{4,})\b/i);

    return {
      utr_number: utrMatch?.[1] || null,
      bank_reference_number: bankRefMatch?.[1] || null,
      bank_transaction_id: bankTxnMatch?.[1] || null
    };
  }

  normalizeBankStatementLine(rawLine) {
    const narration = rawLine.narration || rawLine.description || rawLine.details || '';
    const refs = this.extractReferences(narration);
    const debitAmount = toAmount(rawLine.debit_amount ?? rawLine.debitAmount ?? rawLine.debit ?? 0);
    const creditAmount = toAmount(rawLine.credit_amount ?? rawLine.creditAmount ?? rawLine.credit ?? 0);
    const explicitAmount = rawLine.amount !== undefined ? toAmount(rawLine.amount) : 0;
    const transactionType = rawLine.transaction_type || rawLine.transactionType ||
      (creditAmount > 0 ? 'CREDIT' : debitAmount > 0 ? 'DEBIT' : null);
    const amount = explicitAmount > 0 ? explicitAmount : Math.max(debitAmount, creditAmount);

    if (!['CREDIT', 'DEBIT'].includes(transactionType)) {
      throw new Error('Bank statement line transaction_type must be CREDIT or DEBIT');
    }
    if (amount <= 0) {
      throw new Error('Bank statement line amount must be greater than 0');
    }
    if ((debitAmount > 0 && creditAmount > 0) || (debitAmount <= 0 && creditAmount <= 0)) {
      throw new Error('Exactly one of debit_amount or credit_amount must be positive');
    }
    if ((transactionType === 'CREDIT' && creditAmount <= 0) || (transactionType === 'DEBIT' && debitAmount <= 0)) {
      throw new Error('Bank statement line amount direction does not match transaction_type');
    }

    return {
      transaction_date: dateOnly(rawLine.transaction_date || rawLine.transactionDate || rawLine.date),
      value_date: dateOnly(rawLine.value_date || rawLine.valueDate),
      bank_transaction_id: rawLine.bank_transaction_id || rawLine.bankTransactionId || refs.bank_transaction_id,
      utr_number: rawLine.utr_number || rawLine.utrNumber || refs.utr_number,
      bank_reference_number: rawLine.bank_reference_number || rawLine.bankReferenceNumber || refs.bank_reference_number,
      external_reference: rawLine.external_reference || rawLine.externalReference || null,
      narration,
      description: rawLine.description || narration,
      debit_amount: transactionType === 'DEBIT' ? amount.toFixed(2) : '0.00',
      credit_amount: transactionType === 'CREDIT' ? amount.toFixed(2) : '0.00',
      amount: amount.toFixed(2),
      currency: rawLine.currency || 'INR',
      transaction_type: transactionType,
      counterparty_name: rawLine.counterparty_name || rawLine.counterpartyName || null,
      counterparty_account: rawLine.counterparty_account || rawLine.counterpartyAccount || null,
      raw_payload: rawLine
    };
  }

  calculateNormalizedHash(line) {
    const payload = [
      line.transaction_date,
      line.value_date || '',
      line.bank_transaction_id || '',
      line.utr_number || '',
      line.bank_reference_number || '',
      line.external_reference || '',
      line.amount,
      line.currency,
      line.transaction_type,
      line.narration || ''
    ].join('|');

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async detectDuplicateLine(tenantId, line) {
    let query = db.knex('bank_statement_lines')
      .where('tenant_id', tenantId)
      .where(function() {
        this.where('normalized_hash', line.normalized_hash);
        if (line.bank_transaction_id) this.orWhere('bank_transaction_id', line.bank_transaction_id);
        if (line.utr_number) this.orWhere('utr_number', line.utr_number);
        if (line.bank_reference_number) this.orWhere('bank_reference_number', line.bank_reference_number);
      });

    return query.first();
  }

  async importBankStatementBatch(params) {
    const {
      tenantId,
      bankAccountId = null,
      sourceType,
      sourceFilename,
      sourceReference,
      importedBy,
      lines = [],
      correlationId = requestContext.getCorrelationId()
    } = params;

    if (!tenantId) throw new Error('tenantId is required');
    if (!VALID_SOURCE_TYPES.includes(sourceType)) throw new Error(`Invalid sourceType: ${sourceType}`);
    if (!Array.isArray(lines)) throw new Error('lines must be an array');

    const [batch] = await db.knex('bank_statement_batches').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      bank_account_id: bankAccountId,
      source_type: sourceType,
      source_filename: sourceFilename || null,
      source_reference: sourceReference || null,
      imported_by: importedBy || null,
      import_status: 'PROCESSING',
      total_lines: lines.length,
      imported_lines: 0,
      duplicate_lines: 0,
      failed_lines: 0,
      correlation_id: correlationId || null
    }).returning('*');

    let importedLines = 0;
    let duplicateLines = 0;
    let failedLines = 0;
    const errors = [];

    for (let index = 0; index < lines.length; index += 1) {
      try {
        const normalized = this.normalizeBankStatementLine(lines[index]);
        normalized.normalized_hash = this.calculateNormalizedHash(normalized);
        const duplicate = await this.detectDuplicateLine(tenantId, normalized);

        if (duplicate) {
          duplicateLines += 1;
          await db.knex('bank_statement_lines')
            .where('id', duplicate.id)
            .update({
              reconciliation_status: 'DUPLICATE',
              updated_at: new Date(),
              correlation_id: correlationId || duplicate.correlation_id
            });
          continue;
        }

        await db.knex('bank_statement_lines').insert({
          id: uuidv4(),
          tenant_id: tenantId,
          batch_id: batch.id,
          bank_account_id: bankAccountId,
          ...normalized,
          raw_payload: JSON.stringify(normalized.raw_payload),
          reconciliation_status: 'UNMATCHED',
          correlation_id: correlationId || null
        });
        importedLines += 1;
      } catch (error) {
        failedLines += 1;
        errors.push({ line: index + 1, error: error.message });
      }
    }

    const importStatus = failedLines === lines.length && lines.length > 0 ? 'FAILED' : 'COMPLETED';
    const [updatedBatch] = await db.knex('bank_statement_batches')
      .where('id', batch.id)
      .update({
        import_status: importStatus,
        imported_lines: importedLines,
        duplicate_lines: duplicateLines,
        failed_lines: failedLines,
        error_message: errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null,
        imported_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    logger.info('Bank statement batch imported', {
      tenant_id: tenantId,
      batch_id: batch.id,
      import_status: importStatus,
      imported_lines: importedLines,
      duplicate_lines: duplicateLines,
      failed_lines: failedLines,
      correlation_id: correlationId || null
    });

    return {
      batch: updatedBatch,
      summary: {
        total_lines: lines.length,
        imported_lines: importedLines,
        duplicate_lines: duplicateLines,
        failed_lines: failedLines,
        errors
      }
    };
  }

  async getImportBatch(batchId, tenantId = null) {
    let batchQuery = db.knex('bank_statement_batches').where('id', batchId);
    if (tenantId) batchQuery = batchQuery.where('tenant_id', tenantId);
    const batch = await batchQuery.first();
    if (!batch) throw new Error('Bank statement batch not found');

    const lines = await db.knex('bank_statement_lines')
      .where('batch_id', batchId)
      .orderBy('created_at', 'asc');

    return { batch, lines };
  }

  async listBatches(filters = {}) {
    const { tenantId, status, from, to, limit = 100, offset = 0 } = filters;
    let query = db.knex('bank_statement_batches')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (status) query = query.where('import_status', status);
    if (from) query = query.where('imported_at', '>=', from);
    if (to) query = query.where('imported_at', '<=', to);

    return query;
  }

  async listBankStatementLines(filters = {}) {
    const {
      tenantId,
      utr_number: utrNumber,
      bank_reference_number: bankReferenceNumber,
      bank_transaction_id: bankTransactionId,
      amount,
      transaction_type: transactionType,
      reconciliation_status: reconciliationStatus,
      from,
      to,
      limit = 100,
      offset = 0
    } = filters;
    let query = db.knex('bank_statement_lines')
      .orderBy('transaction_date', 'desc')
      .orderBy('created_at', 'desc')
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    if (tenantId) query = query.where('tenant_id', tenantId);
    if (utrNumber) query = query.where('utr_number', utrNumber);
    if (bankReferenceNumber) query = query.where('bank_reference_number', bankReferenceNumber);
    if (bankTransactionId) query = query.where('bank_transaction_id', bankTransactionId);
    if (amount) query = query.where('amount', Number(amount).toFixed(2));
    if (transactionType) query = query.where('transaction_type', transactionType);
    if (reconciliationStatus) query = query.where('reconciliation_status', reconciliationStatus);
    if (from) query = query.where('transaction_date', '>=', from);
    if (to) query = query.where('transaction_date', '<=', to);

    return query;
  }
}

module.exports = new BankStatementImportService();
