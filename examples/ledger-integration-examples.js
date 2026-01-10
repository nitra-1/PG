/**
 * Example: Integrating Ledger System with Payment Flow
 * 
 * This example shows how to integrate the double-entry ledger system
 * with existing payment processing flows.
 */

const { ledgerEventHandlers } = require('../src/core/ledger');

/**
 * Example 1: Process a payment and record in ledger
 * 
 * This would typically be called after a successful payment gateway response
 */
async function processPaymentWithLedger(paymentDetails) {
  try {
    // 1. Process payment through gateway (existing code)
    const paymentResult = {
      transactionId: 'txn-123456',
      orderId: paymentDetails.orderId,
      status: 'success',
      amount: paymentDetails.amount,
      gateway: 'razorpay',
      gatewayTransactionId: 'pay_ABC123'
    };
    
    // 2. Calculate fees
    const platformFeePercentage = 0.02; // 2% MDR
    const platformFee = paymentResult.amount * platformFeePercentage;
    
    const gatewayFeePercentage = 0.015; // 1.5% gateway fee
    const gatewayFee = paymentResult.amount * gatewayFeePercentage;
    
    // 3. Record in ledger (NEW: Double-entry accounting)
    const ledgerResult = await ledgerEventHandlers.handlePaymentSuccess({
      tenantId: paymentDetails.merchantId,
      transactionId: paymentResult.transactionId,
      orderId: paymentResult.orderId,
      merchantId: paymentDetails.merchantId,
      gateway: paymentResult.gateway,
      amount: paymentResult.amount,
      platformFee: platformFee,
      gatewayFee: gatewayFee,
      createdBy: 'payment-api'
    });
    
    console.log('✅ Payment processed and recorded in ledger');
    console.log('Transaction ID:', ledgerResult.transaction.id);
    console.log('Balanced:', ledgerResult.validation.balanced);
    console.log('Total Debits:', ledgerResult.validation.totalDebits);
    console.log('Total Credits:', ledgerResult.validation.totalCredits);
    
    return {
      success: true,
      paymentResult,
      ledgerResult
    };
    
  } catch (error) {
    console.error('❌ Error processing payment:', error.message);
    throw error;
  }
}

/**
 * Example 2: Process a refund and record in ledger
 */
async function processRefundWithLedger(refundDetails) {
  try {
    // 1. Process refund through gateway (existing code)
    const refundResult = {
      refundId: 'rfnd-789012',
      transactionId: refundDetails.transactionId,
      orderId: refundDetails.orderId,
      status: 'completed',
      refundAmount: refundDetails.amount
    };
    
    // 2. Calculate fee reversals
    const platformFeePercentage = 0.02;
    const platformFeeRefund = refundResult.refundAmount * platformFeePercentage;
    
    const gatewayFeePercentage = 0.015;
    const gatewayFeeRefund = refundResult.refundAmount * gatewayFeePercentage;
    
    // 3. Record refund in ledger (NEW: Double-entry accounting)
    const ledgerResult = await ledgerEventHandlers.handleRefundCompleted({
      tenantId: refundDetails.merchantId,
      transactionId: refundResult.transactionId,
      orderId: refundResult.orderId,
      refundId: refundResult.refundId,
      merchantId: refundDetails.merchantId,
      refundAmount: refundResult.refundAmount,
      platformFeeRefund: platformFeeRefund,
      gatewayFeeRefund: gatewayFeeRefund,
      createdBy: 'refund-api'
    });
    
    console.log('✅ Refund processed and recorded in ledger');
    console.log('Refund Transaction ID:', ledgerResult.transaction.id);
    
    return {
      success: true,
      refundResult,
      ledgerResult
    };
    
  } catch (error) {
    console.error('❌ Error processing refund:', error.message);
    throw error;
  }
}

/**
 * Example 3: Process merchant settlement (T+1 or T+2)
 */
async function processSettlementWithLedger(settlementDetails) {
  try {
    // 1. Calculate settlement amount from pending transactions
    const grossAmount = settlementDetails.totalTransactionAmount;
    const totalFees = settlementDetails.totalPlatformFees + settlementDetails.totalGatewayFees;
    const netAmount = grossAmount - totalFees;
    
    // 2. Initiate bank transfer (existing code)
    const bankTransferResult = {
      utrNumber: 'UTR' + Date.now(),
      status: 'completed',
      amount: netAmount
    };
    
    // 3. Record settlement in ledger (NEW: Double-entry accounting)
    const ledgerResult = await ledgerEventHandlers.handleSettlement({
      tenantId: settlementDetails.merchantId,
      settlementId: settlementDetails.settlementId,
      settlementRef: settlementDetails.settlementRef,
      merchantId: settlementDetails.merchantId,
      settlementAmount: netAmount,
      utrNumber: bankTransferResult.utrNumber,
      createdBy: 'settlement-service'
    });
    
    console.log('✅ Settlement processed and recorded in ledger');
    console.log('Settlement Transaction ID:', ledgerResult.transaction.id);
    console.log('UTR Number:', bankTransferResult.utrNumber);
    console.log('Net Amount Settled:', netAmount);
    
    return {
      success: true,
      bankTransferResult,
      ledgerResult
    };
    
  } catch (error) {
    console.error('❌ Error processing settlement:', error.message);
    throw error;
  }
}

/**
 * Example 4: Handle chargeback from gateway
 */
async function processChargebackWithLedger(chargebackDetails) {
  try {
    // 1. Receive chargeback notification from gateway (existing code)
    const chargebackResult = {
      chargebackId: 'chb-345678',
      orderId: chargebackDetails.orderId,
      amount: chargebackDetails.amount,
      reason: chargebackDetails.reason
    };
    
    // 2. Record chargeback in ledger (NEW: Double-entry accounting)
    const ledgerResult = await ledgerEventHandlers.handleChargebackDebit({
      tenantId: chargebackDetails.merchantId,
      chargebackId: chargebackResult.chargebackId,
      orderId: chargebackResult.orderId,
      merchantId: chargebackDetails.merchantId,
      chargebackAmount: chargebackResult.amount,
      reason: chargebackResult.reason,
      createdBy: 'chargeback-service'
    });
    
    console.log('✅ Chargeback recorded in ledger');
    console.log('Chargeback Transaction ID:', ledgerResult.transaction.id);
    console.log('Amount:', chargebackResult.amount);
    console.log('Reason:', chargebackResult.reason);
    
    // 3. Deduct from future settlements
    // (Implementation depends on settlement logic)
    
    return {
      success: true,
      chargebackResult,
      ledgerResult
    };
    
  } catch (error) {
    console.error('❌ Error processing chargeback:', error.message);
    throw error;
  }
}

/**
 * Example 5: Query account balances for reporting
 */
async function generateMerchantBalanceReport(merchantId) {
  const { ledgerService } = require('../src/core/ledger');
  
  try {
    // Get various account balances
    const merchantReceivables = await ledgerService.getAccountBalance({
      tenantId: merchantId,
      accountCode: 'MER-001'
    });
    
    const merchantPayables = await ledgerService.getAccountBalance({
      tenantId: merchantId,
      accountCode: 'MER-002'
    });
    
    const escrowBalance = await ledgerService.getAccountBalance({
      tenantId: merchantId,
      accountCode: 'ESC-001'
    });
    
    console.log('\n📊 Merchant Balance Report');
    console.log('===========================');
    console.log(`Merchant ID: ${merchantId}`);
    console.log('\nReceivables:');
    console.log(`  Balance: ₹${merchantReceivables.balance}`);
    console.log(`  Total Debits: ₹${merchantReceivables.total_debits}`);
    console.log(`  Total Credits: ₹${merchantReceivables.total_credits}`);
    console.log('\nPayables (Pending Settlements):');
    console.log(`  Balance: ₹${merchantPayables.balance}`);
    console.log('\nEscrow Balance:');
    console.log(`  Balance: ₹${escrowBalance.balance}`);
    console.log('===========================\n');
    
    return {
      merchantReceivables,
      merchantPayables,
      escrowBalance
    };
    
  } catch (error) {
    console.error('❌ Error generating balance report:', error.message);
    throw error;
  }
}

/**
 * Example 6: Perform gateway reconciliation
 */
async function performGatewayReconciliation() {
  const { reconciliationService } = require('../src/core/ledger');
  
  try {
    // 1. Create reconciliation batch
    const batch = await reconciliationService.createReconciliationBatch({
      tenantId: 'platform',
      reconciliationType: 'gateway_settlement',
      gatewayName: 'razorpay',
      gatewaySettlementId: 'RZP-SETL-123',
      periodFrom: new Date('2024-01-01'),
      periodTo: new Date('2024-01-31'),
      createdBy: 'reconciliation-service'
    });
    
    console.log('✅ Reconciliation batch created:', batch.batch_ref);
    
    // 2. Fetch gateway settlement data (mock example)
    const gatewayTransactions = [
      {
        externalRef: 'RZP-TXN-001',
        orderId: 'order-123',
        amount: 1000.00,
        date: new Date('2024-01-15')
      },
      {
        externalRef: 'RZP-TXN-002',
        orderId: 'order-456',
        amount: 2500.00,
        date: new Date('2024-01-16')
      }
      // ... more transactions
    ];
    
    // 3. Reconcile
    const result = await reconciliationService.reconcileGatewaySettlement({
      batchId: batch.id,
      externalTransactions: gatewayTransactions
    });
    
    console.log('\n📊 Reconciliation Results');
    console.log('========================');
    console.log(`Status: ${result.status}`);
    console.log(`Matched: ${result.summary.matched}`);
    console.log(`Missing Internal: ${result.summary.missing_internal}`);
    console.log(`Missing External: ${result.summary.missing_external}`);
    console.log(`Amount Mismatch: ${result.summary.amount_mismatch}`);
    console.log(`Difference: ₹${result.summary.difference_amount}`);
    console.log('========================\n');
    
    return result;
    
  } catch (error) {
    console.error('❌ Error performing reconciliation:', error.message);
    throw error;
  }
}

// ==========================================
// Run Examples
// ==========================================

async function runExamples() {
  console.log('\n🚀 Ledger System Integration Examples\n');
  
  // Example 1: Payment
  console.log('\n--- Example 1: Process Payment ---');
  await processPaymentWithLedger({
    orderId: 'order-123',
    merchantId: 'merchant-456',
    amount: 1000.00
  });
  
  // Example 2: Refund
  console.log('\n--- Example 2: Process Refund ---');
  await processRefundWithLedger({
    transactionId: 'txn-123456',
    orderId: 'order-123',
    merchantId: 'merchant-456',
    amount: 1000.00
  });
  
  // Example 3: Settlement
  console.log('\n--- Example 3: Process Settlement ---');
  await processSettlementWithLedger({
    settlementId: 'setl-789',
    settlementRef: 'SETL-2024-01-001',
    merchantId: 'merchant-456',
    totalTransactionAmount: 50000.00,
    totalPlatformFees: 1000.00,
    totalGatewayFees: 750.00
  });
  
  // Example 4: Chargeback
  console.log('\n--- Example 4: Process Chargeback ---');
  await processChargebackWithLedger({
    orderId: 'order-789',
    merchantId: 'merchant-456',
    amount: 500.00,
    reason: 'Customer disputed transaction'
  });
  
  // Example 5: Balance Report
  console.log('\n--- Example 5: Generate Balance Report ---');
  await generateMerchantBalanceReport('merchant-456');
  
  // Example 6: Reconciliation
  console.log('\n--- Example 6: Gateway Reconciliation ---');
  await performGatewayReconciliation();
  
  console.log('\n✅ All examples completed\n');
}

// Export functions for use in other modules
module.exports = {
  processPaymentWithLedger,
  processRefundWithLedger,
  processSettlementWithLedger,
  processChargebackWithLedger,
  generateMerchantBalanceReport,
  performGatewayReconciliation
};

// Run examples if executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}
