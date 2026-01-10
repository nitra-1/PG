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
      createdBy = 'system'
    } = params;
    
    // Calculate merchant settlement amount
    const merchantAmount = amount - platformFee - gatewayFee;
    
    // Get gateway-specific accounts
    const gatewayAccounts = this.getGatewayAccounts(gateway);
    
    // Create ledger entries
    const entries = [
      // 1. Debit Escrow Bank (cash received)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_BANK,
        entryType: 'debit',
        amount: amount,
        description: `Payment received for order ${orderId}`
      },
      // 2. Credit Escrow Liability (obligation to customer/merchant)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_LIABILITY,
        entryType: 'credit',
        amount: amount,
        description: `Customer funds held in escrow for order ${orderId}`
      },
      // 3. Debit Merchant Receivables (merchant's right to payment)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_RECEIVABLES,
        entryType: 'debit',
        amount: merchantAmount,
        description: `Merchant receivable for order ${orderId}`,
        metadata: { merchantId }
      },
      // 4. Credit Merchant Payables (our obligation to pay merchant)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_PAYABLES,
        entryType: 'credit',
        amount: merchantAmount,
        description: `Amount payable to merchant for order ${orderId}`,
        metadata: { merchantId }
      }
    ];
    
    // Add platform fee entries if applicable
    if (platformFee > 0) {
      entries.push(
        // 5. Debit Platform Receivables (platform's right to fee)
        {
          accountCode: ledgerService.ACCOUNT_CODES.PLATFORM_RECEIVABLES,
          entryType: 'debit',
          amount: platformFee,
          description: `Platform MDR for order ${orderId}`
        },
        // 6. Credit Platform Revenue (income recognition)
        {
          accountCode: ledgerService.ACCOUNT_CODES.PLATFORM_MDR,
          entryType: 'credit',
          amount: platformFee,
          description: `Platform revenue earned from order ${orderId}`
        }
      );
    }
    
    // Add gateway fee entries if applicable
    if (gatewayFee > 0) {
      entries.push(
        // 7. Debit Gateway Fee Expense (cost incurred)
        {
          accountCode: gatewayAccounts.fee,
          entryType: 'debit',
          amount: gatewayFee,
          description: `${gateway} gateway fee for order ${orderId}`,
          metadata: { gateway }
        },
        // 8. Credit Gateway Payables (obligation to pay gateway)
        {
          accountCode: ledgerService.ACCOUNT_CODES.GATEWAY_PAYABLES,
          entryType: 'credit',
          amount: gatewayFee,
          description: `Gateway fee payable to ${gateway} for order ${orderId}`,
          metadata: { gateway }
        }
      );
    }
    
    // Post to ledger
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `PAY-${orderId}`,
      idempotencyKey: `payment-success-${transactionId}`,
      eventType: 'payment_success',
      sourceTransactionId: transactionId,
      sourceOrderId: orderId,
      amount,
      description: `Payment successful for order ${orderId}`,
      entries,
      metadata: { merchantId, gateway, platformFee, gatewayFee },
      createdBy,
      sourceEvent: 'payment_success'
    });
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
      createdBy = 'system'
    } = params;
    
    const entries = [
      // 1. Debit Escrow Liability (reduce obligation)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_LIABILITY,
        entryType: 'debit',
        amount: refundAmount,
        description: `Refund processed for order ${orderId}`
      },
      // 2. Credit Escrow Bank (cash outflow)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_BANK,
        entryType: 'credit',
        amount: refundAmount,
        description: `Refund paid to customer for order ${orderId}`
      },
      // 3. Debit Merchant Payables (reduce obligation to merchant)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_PAYABLES,
        entryType: 'debit',
        amount: refundAmount - platformFeeRefund - gatewayFeeRefund,
        description: `Merchant payable reduced due to refund for order ${orderId}`,
        metadata: { merchantId }
      },
      // 4. Credit Merchant Receivables (reduce merchant's right)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_RECEIVABLES,
        entryType: 'credit',
        amount: refundAmount - platformFeeRefund - gatewayFeeRefund,
        description: `Merchant receivable reduced due to refund for order ${orderId}`,
        metadata: { merchantId }
      }
    ];
    
    // Reverse platform fee if applicable
    if (platformFeeRefund > 0) {
      entries.push(
        {
          accountCode: ledgerService.ACCOUNT_CODES.PLATFORM_MDR,
          entryType: 'debit',
          amount: platformFeeRefund,
          description: `Platform revenue reversed for refund ${refundId}`
        },
        {
          accountCode: ledgerService.ACCOUNT_CODES.PLATFORM_RECEIVABLES,
          entryType: 'credit',
          amount: platformFeeRefund,
          description: `Platform receivable reversed for refund ${refundId}`
        }
      );
    }
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `REF-${refundId}`,
      idempotencyKey: `refund-completed-${refundId}`,
      eventType: 'refund_completed',
      sourceTransactionId: transactionId,
      sourceOrderId: orderId,
      amount: refundAmount,
      description: `Refund completed for order ${orderId}`,
      entries,
      metadata: { merchantId, refundId, platformFeeRefund, gatewayFeeRefund },
      createdBy,
      sourceEvent: 'refund_completed'
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
      createdBy = 'system'
    } = params;
    
    const entries = [
      // 1. Debit Merchant Payables (clear obligation)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_PAYABLES,
        entryType: 'debit',
        amount: settlementAmount,
        description: `Settlement to merchant ${merchantId} - UTR: ${utrNumber}`,
        metadata: { merchantId, utrNumber }
      },
      // 2. Credit Merchant Settlement Account (track settlements)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_SETTLEMENT,
        entryType: 'credit',
        amount: settlementAmount,
        description: `Settlement paid to merchant ${merchantId} - UTR: ${utrNumber}`,
        metadata: { merchantId, utrNumber }
      },
      // 3. Debit Escrow Liability (reduce obligation)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_LIABILITY,
        entryType: 'debit',
        amount: settlementAmount,
        description: `Escrow released for settlement ${settlementRef}`,
        metadata: { settlementId, merchantId }
      },
      // 4. Credit Escrow Bank (cash outflow)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_BANK,
        entryType: 'credit',
        amount: settlementAmount,
        description: `Settlement payment to merchant ${merchantId}`,
        metadata: { settlementId, merchantId, utrNumber }
      }
    ];
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `SETL-${settlementRef}`,
      idempotencyKey: `settlement-${settlementId}`,
      eventType: 'settlement',
      sourceTransactionId: settlementId,
      sourceOrderId: settlementRef,
      amount: settlementAmount,
      description: `Merchant settlement ${settlementRef}`,
      entries,
      metadata: { settlementId, merchantId, utrNumber },
      createdBy,
      sourceEvent: 'settlement'
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
      createdBy = 'system'
    } = params;
    
    const entries = [
      // 1. Debit Chargeback Liability (create liability)
      {
        accountCode: ledgerService.ACCOUNT_CODES.CHARGEBACK_LIABILITY,
        entryType: 'debit',
        amount: chargebackAmount,
        description: `Chargeback for order ${orderId}: ${reason}`,
        metadata: { chargebackId, merchantId, reason }
      },
      // 2. Credit Merchant Receivables (reduce merchant's right)
      {
        accountCode: ledgerService.ACCOUNT_CODES.MERCHANT_RECEIVABLES,
        entryType: 'credit',
        amount: chargebackAmount,
        description: `Merchant receivable reduced for chargeback on order ${orderId}`,
        metadata: { chargebackId, merchantId }
      },
      // 3. Debit Escrow Liability (reduce obligation)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_LIABILITY,
        entryType: 'debit',
        amount: chargebackAmount,
        description: `Escrow liability adjusted for chargeback ${chargebackId}`
      },
      // 4. Credit Escrow Bank (cash outflow for chargeback)
      {
        accountCode: ledgerService.ACCOUNT_CODES.ESCROW_BANK,
        entryType: 'credit',
        amount: chargebackAmount,
        description: `Chargeback payment for order ${orderId}`,
        metadata: { chargebackId }
      }
    ];
    
    return await ledgerService.postTransaction({
      tenantId,
      transactionRef: `CHB-${chargebackId}`,
      idempotencyKey: `chargeback-${chargebackId}`,
      eventType: 'chargeback_debit',
      sourceTransactionId: chargebackId,
      sourceOrderId: orderId,
      amount: chargebackAmount,
      description: `Chargeback for order ${orderId}`,
      entries,
      metadata: { chargebackId, merchantId, reason },
      createdBy,
      sourceEvent: 'chargeback_debit'
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
      createdBy = 'system'
    } = params;
    
    // Simply reverse the original chargeback transaction
    return await ledgerService.reverseTransaction({
      tenantId,
      originalTransactionId: originalChargebackTransactionId,
      reason: `Chargeback won by merchant: ${reason}`,
      createdBy
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
