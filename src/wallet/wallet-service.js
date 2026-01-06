/**
 * Digital Wallet Integration Service
 * Supports Paytm, PhonePe, Google Pay, Amazon Pay, etc.
 */

class WalletService {
  constructor(config) {
    this.config = config;
    this.supportedWallets = ['paytm', 'phonepe', 'googlepay', 'amazonpay', 'mobikwik', 'freecharge'];
  }

  /**
   * Initiate wallet payment
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async initiateWalletPayment(paymentData) {
    try {
      const {
        walletType,
        amount,
        orderId,
        customerId,
        customerPhone,
        description,
        callbackUrl
      } = paymentData;

      // Validate wallet type
      if (!this.supportedWallets.includes(walletType.toLowerCase())) {
        throw new Error(`Unsupported wallet: ${walletType}`);
      }

      // Validate payment data
      this.validatePaymentData(paymentData);

      // Create wallet payment request
      const paymentRequest = {
        paymentId: `WALLET_${Date.now()}`,
        walletType: walletType.toLowerCase(),
        amount: amount,
        currency: 'INR',
        orderId: orderId,
        customerId: customerId,
        customerPhone: customerPhone,
        description: description,
        callbackUrl: callbackUrl,
        status: 'INITIATED',
        createdAt: new Date().toISOString()
      };

      // Generate wallet-specific payment URL
      const paymentUrl = await this.generateWalletPaymentUrl(paymentRequest);

      return {
        success: true,
        paymentId: paymentRequest.paymentId,
        walletType: walletType,
        paymentUrl: paymentUrl,
        orderId: orderId,
        amount: amount,
        expiryTime: new Date(Date.now() + 15 * 60000).toISOString()
      };
    } catch (error) {
      throw new Error(`Wallet payment initiation failed: ${error.message}`);
    }
  }

  /**
   * Validate payment data
   * @param {Object} data - Payment data
   */
  validatePaymentData(data) {
    const required = ['walletType', 'amount', 'orderId', 'customerId'];
    
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (data.amount <= 0) {
      throw new Error('Invalid amount');
    }
  }

  /**
   * Generate wallet-specific payment URL
   * @param {Object} paymentRequest - Payment request details
   * @returns {Promise<string>} Payment URL
   */
  async generateWalletPaymentUrl(paymentRequest) {
    const { walletType, paymentId, amount, orderId } = paymentRequest;

    // Generate wallet-specific deep link or payment URL
    // In production, integrate with respective wallet APIs
    
    const baseUrls = {
      paytm: 'https://paytm.com/pay',
      phonepe: 'phonepe://pay',
      googlepay: 'gpay://pay',
      amazonpay: 'https://amazonpay.com/pay',
      mobikwik: 'https://mobikwik.com/pay',
      freecharge: 'https://freecharge.in/pay'
    };

    const baseUrl = baseUrls[walletType];
    return `${baseUrl}?paymentId=${paymentId}&amount=${amount}&orderId=${orderId}`;
  }

  /**
   * Check wallet balance
   * @param {Object} walletData - Wallet credentials
   * @returns {Promise<Object>} Balance information
   */
  async checkWalletBalance(walletData) {
    try {
      const { walletType, customerId, walletId } = walletData;

      // Validate wallet type
      if (!this.supportedWallets.includes(walletType.toLowerCase())) {
        throw new Error(`Unsupported wallet: ${walletType}`);
      }

      // Query wallet balance
      // In production, call wallet provider API
      
      return {
        success: true,
        walletType: walletType,
        customerId: customerId,
        balance: 5000.00,
        currency: 'INR',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Balance check failed: ${error.message}`);
    }
  }

  /**
   * Process wallet-to-wallet transfer
   * @param {Object} transferData - Transfer details
   * @returns {Promise<Object>} Transfer response
   */
  async processWalletTransfer(transferData) {
    try {
      const {
        sourceWalletId,
        targetWalletId,
        targetPhone,
        amount,
        description
      } = transferData;

      // Validate transfer data
      if (!sourceWalletId || !amount || (!targetWalletId && !targetPhone)) {
        throw new Error('Missing required transfer details');
      }

      if (amount <= 0) {
        throw new Error('Invalid transfer amount');
      }

      // Check source wallet balance
      const balance = await this.checkWalletBalance({ walletId: sourceWalletId });
      if (balance.balance < amount) {
        throw new Error('Insufficient balance');
      }

      // Process transfer
      const transfer = {
        transferId: `TRANSFER_${Date.now()}`,
        sourceWalletId: sourceWalletId,
        targetWalletId: targetWalletId || targetPhone,
        amount: amount,
        currency: 'INR',
        description: description,
        status: 'SUCCESS',
        processedAt: new Date().toISOString()
      };

      return {
        success: true,
        transferId: transfer.transferId,
        amount: amount,
        status: transfer.status,
        timestamp: transfer.processedAt
      };
    } catch (error) {
      throw new Error(`Wallet transfer failed: ${error.message}`);
    }
  }

  /**
   * Add money to wallet
   * @param {Object} addMoneyData - Add money details
   * @returns {Promise<Object>} Add money response
   */
  async addMoneyToWallet(addMoneyData) {
    try {
      const {
        walletType,
        walletId,
        amount,
        paymentMethod,
        cardDetails
      } = addMoneyData;

      // Validate data
      if (!walletId || !amount || !paymentMethod) {
        throw new Error('Missing required details');
      }

      if (amount <= 0 || amount > 100000) {
        throw new Error('Invalid amount (must be between 1 and 100000)');
      }

      // Process add money request
      const transaction = {
        transactionId: `ADDMONEY_${Date.now()}`,
        walletId: walletId,
        amount: amount,
        paymentMethod: paymentMethod,
        status: 'SUCCESS',
        newBalance: 5000 + amount, // Mock calculation
        processedAt: new Date().toISOString()
      };

      return {
        success: true,
        transactionId: transaction.transactionId,
        amount: amount,
        newBalance: transaction.newBalance,
        status: transaction.status,
        timestamp: transaction.processedAt
      };
    } catch (error) {
      throw new Error(`Add money failed: ${error.message}`);
    }
  }

  /**
   * Link wallet to merchant account
   * @param {Object} linkData - Wallet linking details
   * @returns {Promise<Object>} Link response
   */
  async linkWallet(linkData) {
    try {
      const {
        merchantId,
        walletType,
        walletId,
        customerPhone,
        otp
      } = linkData;

      // Validate linking data
      if (!merchantId || !walletType || !walletId || !customerPhone) {
        throw new Error('Missing required linking details');
      }

      // Verify OTP
      const isValidOTP = await this.verifyOTP(customerPhone, otp);
      if (!isValidOTP) {
        throw new Error('Invalid OTP');
      }

      // Link wallet
      const link = {
        linkId: `LINK_${Date.now()}`,
        merchantId: merchantId,
        walletType: walletType,
        walletId: walletId,
        customerPhone: customerPhone,
        status: 'ACTIVE',
        linkedAt: new Date().toISOString()
      };

      return {
        success: true,
        linkId: link.linkId,
        walletType: walletType,
        status: link.status,
        timestamp: link.linkedAt
      };
    } catch (error) {
      throw new Error(`Wallet linking failed: ${error.message}`);
    }
  }

  /**
   * Verify OTP
   * @param {string} phone - Phone number
   * @param {string} otp - OTP
   * @returns {Promise<boolean>}
   */
  async verifyOTP(phone, otp) {
    // Mock OTP verification
    // In production, verify with actual OTP service
    return otp === '123456';
  }

  /**
   * Get wallet transaction history
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object>} Transaction history
   */
  async getTransactionHistory(filters) {
    try {
      const { walletId, startDate, endDate, limit = 50 } = filters;

      // Query transaction history
      // Mock implementation
      
      return {
        transactions: [
          {
            transactionId: 'TXN_001',
            type: 'PAYMENT',
            amount: 500,
            status: 'SUCCESS',
            timestamp: new Date().toISOString()
          }
        ],
        total: 1,
        limit: limit
      };
    } catch (error) {
      throw new Error(`History retrieval failed: ${error.message}`);
    }
  }

  /**
   * Handle wallet callback
   * @param {Object} callbackData - Callback data
   * @returns {Promise<Object>} Processed callback
   */
  async handleCallback(callbackData) {
    try {
      // Verify callback signature
      const isValid = await this.verifyCallbackSignature(callbackData);
      if (!isValid) {
        throw new Error('Invalid callback signature');
      }

      const { paymentId, status, walletTransactionId, amount, orderId } = callbackData;

      // Update payment status
      console.log(`Wallet payment ${paymentId} updated to ${status}`);
      
      // Store/update transaction in database
      try {
        const db = require('../database');
        // Find existing transaction
        const transactions = await db.query(
          'SELECT * FROM transactions WHERE transaction_ref = $1 OR gateway_transaction_id = $1 LIMIT 1',
          [paymentId]
        );
        
        if (transactions.rows && transactions.rows.length > 0) {
          // Update existing transaction
          const transaction = transactions.rows[0];
          await db.updateByTenant('transactions', transaction.id, {
            status: this.mapStatusToDBStatus(status),
            gateway_transaction_id: walletTransactionId,
            completed_at: status === 'SUCCESS' ? new Date() : null,
            updated_at: new Date()
          }, transaction.tenant_id);
        } else {
          // Create new transaction
          await db.insertWithTenant('transactions', {
            transaction_ref: paymentId,
            order_id: orderId || paymentId,
            payment_method: 'wallet',
            gateway: 'wallet',
            amount: amount || 0,
            currency: 'INR',
            status: this.mapStatusToDBStatus(status),
            gateway_transaction_id: walletTransactionId,
            initiated_at: new Date(),
            completed_at: status === 'SUCCESS' ? new Date() : null
          }, this.config.tenantId || this.config.defaultTenantId);
        }
      } catch (error) {
        console.error('Failed to store wallet transaction in database:', error);
      }

      return {
        success: true,
        acknowledged: true
      };
    } catch (error) {
      throw new Error(`Callback processing failed: ${error.message}`);
    }
  }

  /**
   * Map wallet status to database status enum
   * @param {string} status - Wallet status
   * @returns {string} Database status
   */
  mapStatusToDBStatus(status) {
    const statusMap = {
      'SUCCESS': 'success',
      'FAILED': 'failed',
      'PENDING': 'pending',
      'PROCESSING': 'processing'
    };
    return statusMap[status] || 'pending';
  }

  /**
   * Verify callback signature
   * @param {Object} data - Callback data
   * @returns {Promise<boolean>}
   */
  async verifyCallbackSignature(data) {
    // Implement HMAC signature verification
    return true;
  }
}

module.exports = WalletService;
