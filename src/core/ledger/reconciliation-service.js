/**
 * Reconciliation Service
 * 
 * Handles reconciliation between internal ledger and external sources:
 * - Gateway settlement reports (Razorpay, PayU, CCAvenue)
 * - Bank escrow statements
 * - Merchant payout confirmations
 * 
 * Identifies discrepancies:
 * - Missing transactions (in one system but not the other)
 * - Amount mismatches
 * - Duplicate entries
 */

const db = require('../../database');
const { v4: uuidv4 } = require('uuid');

class ReconciliationService {
  /**
   * Create a new reconciliation batch
   * 
   * @param {Object} params - Batch parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.reconciliationType - Type: gateway_settlement, bank_escrow_statement, merchant_payout
   * @param {string} params.gatewayName - Gateway name (if gateway reconciliation)
   * @param {Date} params.periodFrom - Start date of reconciliation period
   * @param {Date} params.periodTo - End date of reconciliation period
   * @param {string} params.createdBy - User creating the batch
   * @returns {Object} Created reconciliation batch
   */
  async createReconciliationBatch(params) {
    const {
      tenantId,
      reconciliationType,
      gatewayName,
      gatewaySettlementId,
      periodFrom,
      periodTo,
      fileName,
      filePath,
      createdBy
    } = params;
    
    const batchRef = `RECON-${Date.now()}-${reconciliationType.toUpperCase()}`;
    
    const [batch] = await db.knex('reconciliation_batches').insert({
      id: uuidv4(),
      tenant_id: tenantId,
      batch_ref: batchRef,
      reconciliation_type: reconciliationType,
      gateway_name: gatewayName,
      gateway_settlement_id: gatewaySettlementId,
      period_from: periodFrom,
      period_to: periodTo,
      status: 'in_progress',
      file_name: fileName,
      file_path: filePath,
      created_by: createdBy,
      total_transactions: 0,
      matched_transactions: 0,
      missing_transactions: 0,
      mismatched_transactions: 0,
      duplicate_transactions: 0
    }).returning('*');
    
    return batch;
  }
  
  /**
   * Reconcile gateway settlement report
   * 
   * @param {Object} params - Reconciliation parameters
   * @param {string} params.batchId - Reconciliation batch ID
   * @param {Array} params.externalTransactions - Transactions from gateway report
   * @param {string} params.externalTransactions[].externalRef - Gateway transaction ID
   * @param {string} params.externalTransactions[].orderId - Order ID
   * @param {number} params.externalTransactions[].amount - Transaction amount
   * @param {Date} params.externalTransactions[].date - Transaction date
   * @returns {Object} Reconciliation results
   */
  async reconcileGatewaySettlement(params) {
    const { batchId, externalTransactions } = params;
    
    return await db.knex.transaction(async (trx) => {
      // Get batch details
      const batch = await trx('reconciliation_batches')
        .where('id', batchId)
        .first();
        
      if (!batch) {
        throw new Error('Reconciliation batch not found');
      }
      
      const results = {
        matched: [],
        missing_internal: [],
        missing_external: [],
        amount_mismatch: [],
        duplicates: []
      };
      
      // Get internal transactions for the period
      const internalTransactions = await trx('ledger_transactions as lt')
        .join('ledger_entries as le', 'lt.id', 'le.transaction_id')
        .join('ledger_accounts as la', 'le.account_id', 'la.id')
        .where('lt.tenant_id', batch.tenant_id)
        .where('lt.created_at', '>=', batch.period_from)
        .where('lt.created_at', '<=', batch.period_to)
        .where('lt.status', 'posted')
        .where('la.gateway_name', batch.gateway_name)
        .select(
          'lt.id as transaction_id',
          'lt.source_order_id',
          'lt.amount',
          'lt.created_at'
        )
        .groupBy('lt.id', 'lt.source_order_id', 'lt.amount', 'lt.created_at');
      
      // Create maps for efficient lookup
      const internalMap = new Map();
      internalTransactions.forEach(tx => {
        const key = `${tx.source_order_id}`;
        if (internalMap.has(key)) {
          // Duplicate in internal system
          results.duplicates.push(tx);
        } else {
          internalMap.set(key, tx);
        }
      });
      
      const externalMap = new Map();
      externalTransactions.forEach(tx => {
        const key = `${tx.orderId}`;
        externalMap.set(key, tx);
      });
      
      // Match external transactions with internal
      for (const extTx of externalTransactions) {
        const key = `${extTx.orderId}`;
        const intTx = internalMap.get(key);
        
        if (!intTx) {
          // Transaction in external but not in internal
          results.missing_internal.push(extTx);
          
          await trx('reconciliation_items').insert({
            id: uuidv4(),
            tenant_id: batch.tenant_id,
            batch_id: batchId,
            external_ref: extTx.externalRef,
            external_transaction_id: extTx.externalRef,
            match_status: 'missing_internal',
            external_amount: extTx.amount,
            internal_amount: null,
            difference_amount: extTx.amount,
            resolution_status: 'unresolved',
            metadata: JSON.stringify({ external_data: extTx })
          });
        } else {
          // Check amount match
          const amountDiff = Math.abs(parseFloat(intTx.amount) - parseFloat(extTx.amount));
          
          if (amountDiff > 0.01) {
            // Amount mismatch
            results.amount_mismatch.push({ internal: intTx, external: extTx, difference: amountDiff });
            
            await trx('reconciliation_items').insert({
              id: uuidv4(),
              tenant_id: batch.tenant_id,
              batch_id: batchId,
              transaction_id: intTx.transaction_id,
              external_ref: extTx.externalRef,
              external_transaction_id: extTx.externalRef,
              match_status: 'amount_mismatch',
              internal_amount: intTx.amount,
              external_amount: extTx.amount,
              difference_amount: amountDiff,
              resolution_status: 'unresolved',
              metadata: JSON.stringify({ internal_data: intTx, external_data: extTx })
            });
          } else {
            // Perfect match
            results.matched.push({ internal: intTx, external: extTx });
            
            await trx('reconciliation_items').insert({
              id: uuidv4(),
              tenant_id: batch.tenant_id,
              batch_id: batchId,
              transaction_id: intTx.transaction_id,
              external_ref: extTx.externalRef,
              external_transaction_id: extTx.externalRef,
              match_status: 'matched',
              internal_amount: intTx.amount,
              external_amount: extTx.amount,
              difference_amount: 0,
              resolution_status: 'resolved',
              metadata: JSON.stringify({ internal_data: intTx, external_data: extTx })
            });
          }
          
          // Remove from internal map
          internalMap.delete(key);
        }
      }
      
      // Remaining items in internalMap are missing in external
      for (const [key, intTx] of internalMap) {
        if (!results.duplicates.find(d => d.transaction_id === intTx.transaction_id)) {
          results.missing_external.push(intTx);
          
          await trx('reconciliation_items').insert({
            id: uuidv4(),
            tenant_id: batch.tenant_id,
            batch_id: batchId,
            transaction_id: intTx.transaction_id,
            match_status: 'missing_external',
            internal_amount: intTx.amount,
            external_amount: null,
            difference_amount: intTx.amount,
            resolution_status: 'unresolved',
            metadata: JSON.stringify({ internal_data: intTx })
          });
        }
      }
      
      // Calculate totals
      const expectedAmount = internalTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const actualAmount = externalTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const differenceAmount = Math.abs(expectedAmount - actualAmount);
      
      // Update batch with results
      const status = (results.missing_internal.length === 0 && 
                     results.missing_external.length === 0 && 
                     results.amount_mismatch.length === 0)
                     ? 'completed'
                     : 'discrepancy_found';
      
      await trx('reconciliation_batches')
        .where('id', batchId)
        .update({
          status,
          total_transactions: externalTransactions.length,
          matched_transactions: results.matched.length,
          missing_transactions: results.missing_internal.length + results.missing_external.length,
          mismatched_transactions: results.amount_mismatch.length,
          duplicate_transactions: results.duplicates.length,
          expected_amount: expectedAmount,
          actual_amount: actualAmount,
          difference_amount: differenceAmount,
          completed_at: new Date(),
          discrepancies: JSON.stringify({
            summary: {
              matched: results.matched.length,
              missing_internal: results.missing_internal.length,
              missing_external: results.missing_external.length,
              amount_mismatch: results.amount_mismatch.length,
              duplicates: results.duplicates.length
            }
          })
        });
      
      return {
        batch_id: batchId,
        status,
        results,
        summary: {
          total_external: externalTransactions.length,
          total_internal: internalTransactions.length,
          matched: results.matched.length,
          missing_internal: results.missing_internal.length,
          missing_external: results.missing_external.length,
          amount_mismatch: results.amount_mismatch.length,
          duplicates: results.duplicates.length,
          expected_amount: expectedAmount,
          actual_amount: actualAmount,
          difference_amount: differenceAmount
        }
      };
    });
  }
  
  /**
   * Reconcile bank escrow statement
   * 
   * @param {Object} params - Reconciliation parameters
   * @param {string} params.batchId - Reconciliation batch ID
   * @param {Array} params.bankTransactions - Transactions from bank statement
   * @returns {Object} Reconciliation results
   */
  async reconcileBankEscrowStatement(params) {
    const { batchId, bankTransactions } = params;
    
    return await db.knex.transaction(async (trx) => {
      const batch = await trx('reconciliation_batches')
        .where('id', batchId)
        .first();
        
      if (!batch) {
        throw new Error('Reconciliation batch not found');
      }
      
      const results = {
        matched: [],
        missing_internal: [],
        missing_external: [],
        amount_mismatch: []
      };
      
      // Get escrow account balance from ledger
      const escrowEntries = await trx('ledger_entries as le')
        .join('ledger_transactions as lt', 'le.transaction_id', 'lt.id')
        .join('ledger_accounts as la', 'le.account_id', 'la.id')
        .where('le.tenant_id', batch.tenant_id)
        .where('la.account_code', 'ESC-001') // Escrow Bank Account
        .where('lt.status', 'posted')
        .where('le.created_at', '>=', batch.period_from)
        .where('le.created_at', '<=', batch.period_to)
        .select(
          'le.id as entry_id',
          'le.entry_type',
          'le.amount',
          'le.description',
          'lt.transaction_ref'
        );
      
      // Calculate escrow balance from ledger
      let ledgerBalance = 0;
      escrowEntries.forEach(entry => {
        if (entry.entry_type === 'debit') {
          ledgerBalance += parseFloat(entry.amount);
        } else {
          ledgerBalance -= parseFloat(entry.amount);
        }
      });
      
      // Calculate bank balance
      const bankBalance = bankTransactions.reduce((sum, tx) => {
        return sum + (tx.type === 'credit' ? parseFloat(tx.amount) : -parseFloat(tx.amount));
      }, 0);
      
      const balanceDifference = Math.abs(ledgerBalance - bankBalance);
      
      // Update batch
      const status = balanceDifference < 0.01 ? 'completed' : 'discrepancy_found';
      
      await trx('reconciliation_batches')
        .where('id', batchId)
        .update({
          status,
          total_transactions: bankTransactions.length,
          expected_amount: ledgerBalance,
          actual_amount: bankBalance,
          difference_amount: balanceDifference,
          completed_at: new Date(),
          discrepancies: JSON.stringify({
            ledger_balance: ledgerBalance,
            bank_balance: bankBalance,
            difference: balanceDifference,
            entry_count: escrowEntries.length
          })
        });
      
      return {
        batch_id: batchId,
        status,
        ledger_balance: ledgerBalance,
        bank_balance: bankBalance,
        difference: balanceDifference,
        balanced: balanceDifference < 0.01
      };
    });
  }
  
  /**
   * Get reconciliation batch details
   * 
   * @param {string} batchId - Batch ID
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Batch with items
   */
  async getReconciliationBatch(batchId, tenantId) {
    const batch = await db.knex('reconciliation_batches')
      .where('id', batchId)
      .where('tenant_id', tenantId)
      .first();
      
    if (!batch) {
      throw new Error('Reconciliation batch not found');
    }
    
    const items = await db.knex('reconciliation_items')
      .where('batch_id', batchId)
      .where('tenant_id', tenantId);
    
    return {
      batch,
      items,
      summary: {
        total: items.length,
        by_status: items.reduce((acc, item) => {
          acc[item.match_status] = (acc[item.match_status] || 0) + 1;
          return acc;
        }, {}),
        by_resolution: items.reduce((acc, item) => {
          acc[item.resolution_status] = (acc[item.resolution_status] || 0) + 1;
          return acc;
        }, {})
      }
    };
  }
  
  /**
   * Resolve a reconciliation discrepancy
   * 
   * @param {Object} params - Resolution parameters
   * @param {string} params.itemId - Reconciliation item ID
   * @param {string} params.resolution - Resolution: resolved, investigating, written_off
   * @param {string} params.notes - Resolution notes
   * @param {string} params.resolvedBy - User resolving the item
   */
  async resolveReconciliationItem(params) {
    const { itemId, resolution, notes, resolvedBy } = params;
    
    await db.knex('reconciliation_items')
      .where('id', itemId)
      .update({
        resolution_status: resolution,
        resolution_notes: notes,
        resolved_by: resolvedBy,
        resolved_at: new Date()
      });
    
    return { success: true, item_id: itemId, resolution };
  }
}

module.exports = new ReconciliationService();
