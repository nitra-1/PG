/**
 * Ledger Event Handlers
 * 
 * Maps business events to double-entry ledger postings
 * Each handler ensures proper accounting entries for RBI compliance
 * 
 * Event Flow:
 * Business Event → Event Handler → Ledger Service → Database
 * 
 * Accounting Rules Applied:
 * - Customer payment: Escrow (Dr) / Customer Liability (Cr)
 * - Merchant receivable: Merchant Receivable (Dr) / Merchant Payable (Cr)
 * - Platform fee: Platform Receivable (Dr) / Platform Revenue (Cr)
 * - Gateway fee: Gateway Fee Expense (Dr) / Gateway Payable (Cr)
 * - Settlement: Merchant Payable (Dr) / Escrow (Cr)
 * - Refund: Customer Liability (Dr) / Escrow (Cr)
 * - Chargeback: Merchant Receivable (Dr) / Chargeback Liability (Cr)
 */

const ledgerService = require('./ledger-service');
const settlementService = require('./settlement-service');
const { buildEntries } = require('./accounting-templates');
const { v4: uuidv4 } = require('uuid');

class LedgerEventHandlers {
  /**
   * Helper to get gateway-specific account codes
   * @private
   */
  getGatewayAccounts(gateway) {
    const gatewayMap = {
      razorpay: {
        collection: ledgerService.ACCOUNT_CODES.GATEWAY_RAZORPAY,
        fee: ledgerService.ACCOUNT_CODES.GATEWAY_FEE_RAZORPAY
      },
      payu: {
        collection: ledgerService.ACCOUNT_CODES.GATEWAY_PAYU,
        fee: ledgerService.ACCOUNT_CODES.GATEWAY_FEE_PAYU
      },
      ccavenue: {
        collection: ledgerService.ACCOUNT_CODES.GATEWAY_CCAVENUE,
        fee: ledgerService.ACCOUNT_CODES.GATEWAY_FEE_CCAVENUE
      }
    };
    
    return gatewayMap[gateway?.toLowerCase()] || gatewayMap.razorpay;
  }
  
  /**
   * Handle successful payment
   * 
   * Accounting Logic:
   * 1. Customer pays → Money enters escrow (Asset increases)
   * 2. Escrow liability to customer created (Liability increases)
   * 3. Merchant becomes entitled to payment (Receivable/Payable)
   * 4. Platform earns MDR/commission (Revenue)
   * 5. Gateway fee accrued (Expense)
   * 
   * @param {Object} params - Payment details
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.transactionId - Transaction ID
   * @param {string} params.orderId - Order ID
   * @param {string} params.merchantId - Merchant ID
   * @param {string} params.gateway - Gateway name
   * @param {number} params.amount - Transaction amount
   * @param {number} params.platformFee - Platform MDR/commission
   * @param {number} params.gatewayFee - Gateway processing fee
   * @param {string} params.createdBy - User/system who triggered
   * @returns {Object} Posted ledger transaction
   */
  async handlePaymentSuccess(params) {
    const {
      tenantId,
      transactionId,
      orderId,
      merchantId,
      gateway,
      amount,
      platformFee = 0,
      gatewayFee = 0,
      createdBy = 'system',
      transactionRef,
      eventId,
      correlationId,
      idempotencyKey
    } = params;
    
    // Calculate merchant settlement amount
    const merchantAmount = amount - platformFee - gatewayFee;
    
    const entries = buildEntries('payment_success', {
      orderId,
      merchantId,
      gateway,
      amount,
      platformFee,
      gatewayFee
    });
    
    // Post to ledger
    const ledgerTransaction = await ledgerService.postTransaction({
      tenantId,
      transactionRef: transactionRef || `PAY-${orderId}`,
      idempotencyKey: idempotencyKey || `payment-success-${transactionId}`,
      eventType: 'payment_success',
      sourceTransactionId: transactionId,
      sourceOrderId: orderId,
      amount,
      description: `Payment successful for order ${orderId}`,
      entries,
      metadata: { merchantId, gateway, platformFee, gatewayFee },
      createdBy,
      sourceEvent: 'payment_success',
      eventId,
      correlationId
    });

    if (ledgerTransaction.duplicate) {
      return ledgerTransaction;
    }
    
    // Create settlement entry for this payment
    // This creates a settlement in CREATED state that will be processed through the state machine
    // Generate settlement reference with safe substring handling
    const merchantIdPart = (merchantId || '').substring(0, 8).padEnd(8, '0');
    const transactionIdPart = (transactionId || '').substring(0, 8).padEnd(8, '0');
    const settlementRef = `SETL-${merchantIdPart}-${transactionIdPart}`;
    const settlementDate = new Date();
    
    await settlementService.createSettlement({
      tenantId,
      merchantId,
      settlementRef,
      settlementDate,
      periodFrom: settlementDate, // Single transaction settlement
      periodTo: settlementDate,
      grossAmount: amount,
      feesAmount: platformFee + gatewayFee,
      netAmount: merchantAmount,
      ledgerTransactionId: ledgerTransaction.transaction?.id || ledgerTransaction.id,
      metadata: {
        transactionId,
        orderId,
        gateway,
        ledgerTransactionId: ledgerTransaction.transaction?.id || ledgerTransaction.id,
        autoCreated: true,
        createdReason: 'payment_success'
      },
      createdBy: createdBy || 'payment_gateway'
    });
    
    return ledgerTransaction;
  }
  
  /**
   * Handle refund initiation and completion
   * 
   * Accounting Logic:
   * 1. Reverse merchant payable (reduce obligation)
   * 2. Create refund payable (new liability to customer)
   * 3. Reduce escrow liability and bank balance
   * 4. Reverse platform revenue (if applicable)
   * 
   * @param {Object} params - Refund details
   */
  async handleRefundCompleted(params) {
    const {
      tenantId,
      transactionId,
      orderId,
      refundId,
      merchantId,
      refundAmount,
      platformFeeRefund = 0,
      gatewayFeeRefund = 0,
      createdBy = 'system',
      eventId,
      correlationId,
      idempotencyKey
    } = params;
    
    const entries = buildEntries('refund_completed', {
      orderId,
      refundId,
      merchantId,
      refundAmount,
      platformFeeRefund,
      gatewayFeeRefund
    });
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `REF-${refundId}`,
      idempotencyKey: idempotencyKey || `refund-completed-${refundId}`,
      eventType: 'refund_completed',
      sourceTransactionId: transactionId,
      sourceOrderId: orderId,
      amount: refundAmount,
      description: `Refund completed for order ${orderId}`,
      entries,
      metadata: { merchantId, refundId, platformFeeRefund, gatewayFeeRefund },
      createdBy,
      sourceEvent: 'refund_completed',
      eventId,
      correlationId
    });
  }
  
  /**
   * Handle merchant settlement (T+1 or T+2)
   * 
   * Accounting Logic:
   * 1. Pay merchant from escrow
   * 2. Clear merchant payable
   * 3. Reduce escrow liability
   * 
   * @param {Object} params - Settlement details
   */
  async handleSettlement(params) {
    const {
      tenantId,
      settlementId,
      settlementRef,
      merchantId,
      settlementAmount,
      utrNumber,
      createdBy = 'system',
      eventId,
      correlationId,
      idempotencyKey
    } = params;
    
    const entries = buildEntries('settlement', {
      settlementId,
      settlementRef,
      merchantId,
      settlementAmount,
      utrNumber
    });
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `SETL-${settlementRef}`,
      idempotencyKey: idempotencyKey || `settlement-${settlementId}`,
      eventType: 'settlement',
      sourceTransactionId: settlementId,
      sourceOrderId: settlementRef,
      amount: settlementAmount,
      description: `Merchant settlement ${settlementRef}`,
      entries,
      metadata: { settlementId, merchantId, utrNumber },
      createdBy,
      sourceEvent: 'settlement',
      eventId,
      correlationId
    });
  }
  
  /**
   * Handle chargeback debit from merchant
   * 
   * Accounting Logic:
   * 1. Create chargeback liability
   * 2. Reduce merchant receivable
   * 3. Reduce escrow
   * 
   * @param {Object} params - Chargeback details
   */
  async handleChargebackDebit(params) {
    const {
      tenantId,
      chargebackId,
      orderId,
      merchantId,
      chargebackAmount,
      reason,
      createdBy = 'system',
      eventId,
      correlationId,
      idempotencyKey
    } = params;
    
    const entries = buildEntries('chargeback_debit', {
      chargebackId,
      orderId,
      merchantId,
      chargebackAmount,
      reason
    });
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `CHB-${chargebackId}`,
      idempotencyKey: idempotencyKey || `chargeback-${chargebackId}`,
      eventType: 'chargeback_debit',
      sourceTransactionId: chargebackId,
      sourceOrderId: orderId,
      amount: chargebackAmount,
      description: `Chargeback for order ${orderId}`,
      entries,
      metadata: { chargebackId, merchantId, reason },
      createdBy,
      sourceEvent: 'chargeback_debit',
      eventId,
      correlationId
    });
  }
  
  /**
   * Handle chargeback reversal (merchant wins dispute)
   * 
   * @param {Object} params - Reversal details
   */
  async handleChargebackReversal(params) {
    const {
      tenantId,
      originalChargebackTransactionId,
      reason,
      createdBy = 'system',
      eventId,
      correlationId,
      idempotencyKey
    } = params;
    
    // Simply reverse the original chargeback transaction
    return await ledgerService.reverseTransaction({
      tenantId,
      originalTransactionId: originalChargebackTransactionId,
      reason: `Chargeback won by merchant: ${reason}`,
      createdBy,
      eventId,
      correlationId,
      idempotencyKey
    });
  }
  
  /**
   * Handle manual adjustment (admin only, requires approval)
   * 
   * @param {Object} params - Adjustment details
   */
  async handleManualAdjustment(params) {
    const {
      tenantId,
      adjustmentId,
      adjustmentType,
      amount,
      fromAccountCode,
      toAccountCode,
      reason,
      approvedBy,
      createdBy
    } = params;
    
    if (!approvedBy) {
      throw new Error('Manual adjustments require approval');
    }
    
    const entries = [
      {
        accountCode: fromAccountCode,
        entryType: 'credit',
        amount,
        description: `Manual adjustment: ${reason}`,
        metadata: { adjustmentType, approvedBy }
      },
      {
        accountCode: toAccountCode,
        entryType: 'debit',
        amount,
        description: `Manual adjustment: ${reason}`,
        metadata: { adjustmentType, approvedBy }
      }
    ];
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `ADJ-${adjustmentId}`,
      idempotencyKey: `adjustment-${adjustmentId}`,
      eventType: 'manual_adjustment',
      sourceTransactionId: adjustmentId,
      amount,
      description: `Manual adjustment: ${reason}`,
      entries,
      metadata: { adjustmentType, reason, approvedBy },
      createdBy,
      sourceEvent: 'manual_adjustment'
    });
  }
}

module.exports = new LedgerEventHandlers();
