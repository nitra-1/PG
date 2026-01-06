/**
 * QR Code Solution Service
 * Handles static and dynamic QR code generation for payments
 */

const QRCode = require('qrcode');

class QRService {
  constructor(config) {
    this.config = config;
    this.qrCodes = new Map();
  }

  /**
   * Generate static QR code
   * @param {Object} qrData - QR code data
   * @returns {Promise<Object>} QR code response
   */
  async generateStaticQR(qrData) {
    try {
      const {
        merchantId,
        merchantName,
        merchantVPA,
        storeId,
        storeName,
        purpose
      } = qrData;

      // Validate data
      if (!merchantId || !merchantVPA) {
        throw new Error('Missing required merchant details');
      }

      // Generate QR code ID
      const qrCodeId = `STATIC_QR_${Date.now()}`;

      // Build QR code data
      const qrCodeData = this.buildStaticQRData({
        merchantId,
        merchantName,
        merchantVPA,
        storeId,
        storeName,
        purpose
      });

      // Generate QR code image
      const qrCodeImage = await this.generateQRImage(qrCodeData);

      const qrCode = {
        qrCodeId: qrCodeId,
        type: 'STATIC',
        merchantId: merchantId,
        merchantVPA: merchantVPA,
        storeId: storeId,
        qrCodeData: qrCodeData,
        qrCodeImage: qrCodeImage,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      // Store QR code
      this.qrCodes.set(qrCodeId, qrCode);

      return {
        success: true,
        qrCodeId: qrCodeId,
        qrCodeImage: qrCodeImage,
        qrCodeData: qrCodeData,
        type: 'STATIC'
      };
    } catch (error) {
      throw new Error(`Static QR generation failed: ${error.message}`);
    }
  }

  /**
   * Generate dynamic QR code
   * @param {Object} qrData - QR code data with amount
   * @returns {Promise<Object>} QR code response
   */
  async generateDynamicQR(qrData) {
    try {
      const {
        merchantId,
        merchantName,
        merchantVPA,
        amount,
        orderId,
        description,
        expiryMinutes = 30
      } = qrData;

      // Validate data
      if (!merchantId || !merchantVPA || !amount || !orderId) {
        throw new Error('Missing required fields for dynamic QR');
      }

      // Generate QR code ID
      const qrCodeId = `DYNAMIC_QR_${Date.now()}`;

      // Build QR code data
      const qrCodeData = this.buildDynamicQRData({
        merchantId,
        merchantName,
        merchantVPA,
        amount,
        orderId,
        description
      });

      // Generate QR code image
      const qrCodeImage = await this.generateQRImage(qrCodeData);

      const qrCode = {
        qrCodeId: qrCodeId,
        type: 'DYNAMIC',
        merchantId: merchantId,
        merchantVPA: merchantVPA,
        amount: amount,
        orderId: orderId,
        qrCodeData: qrCodeData,
        qrCodeImage: qrCodeImage,
        status: 'ACTIVE',
        singleUse: true,
        expiryTime: new Date(Date.now() + expiryMinutes * 60000).toISOString(),
        createdAt: new Date().toISOString()
      };

      // Store QR code
      this.qrCodes.set(qrCodeId, qrCode);

      return {
        success: true,
        qrCodeId: qrCodeId,
        qrCodeImage: qrCodeImage,
        qrCodeData: qrCodeData,
        type: 'DYNAMIC',
        amount: amount,
        orderId: orderId,
        expiryTime: qrCode.expiryTime
      };
    } catch (error) {
      throw new Error(`Dynamic QR generation failed: ${error.message}`);
    }
  }

  /**
   * Build static QR code data
   * @param {Object} params - QR parameters
   * @returns {string} QR code data string
   */
  buildStaticQRData(params) {
    const { merchantVPA, merchantName } = params;
    
    // UPI QR format for static QR
    return `upi://pay?pa=${encodeURIComponent(merchantVPA)}&pn=${encodeURIComponent(merchantName)}&cu=INR`;
  }

  /**
   * Build dynamic QR code data
   * @param {Object} params - QR parameters
   * @returns {string} QR code data string
   */
  buildDynamicQRData(params) {
    const { merchantVPA, merchantName, amount, orderId, description } = params;
    
    // UPI QR format with amount
    let qrData = `upi://pay?pa=${encodeURIComponent(merchantVPA)}&pn=${encodeURIComponent(merchantName)}`;
    qrData += `&am=${amount}&cu=INR`;
    qrData += `&tr=${orderId}`;
    
    if (description) {
      qrData += `&tn=${encodeURIComponent(description)}`;
    }
    
    return qrData;
  }

  /**
   * Generate QR code image
   * @param {string} data - Data to encode in QR
   * @returns {Promise<string>} Base64 encoded QR image
   */
  async generateQRImage(data) {
    try {
      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(data, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 2
      });
      
      return qrCodeDataUrl;
    } catch (error) {
      throw new Error(`QR code image generation failed: ${error.message}`);
    }
  }

  /**
   * Process QR code payment
   * @param {string} qrCodeId - QR code ID
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async processQRPayment(qrCodeId, paymentData) {
    try {
      const qrCode = this.qrCodes.get(qrCodeId);
      
      if (!qrCode) {
        throw new Error('QR code not found');
      }

      if (qrCode.status !== 'ACTIVE') {
        throw new Error('QR code is not active');
      }

      // Check expiry for dynamic QR
      if (qrCode.type === 'DYNAMIC') {
        if (new Date() > new Date(qrCode.expiryTime)) {
          throw new Error('QR code has expired');
        }

        // Check if already used for single-use QR
        if (qrCode.singleUse && qrCode.usedAt) {
          throw new Error('QR code already used');
        }
      }

      // Validate amount for dynamic QR
      if (qrCode.type === 'DYNAMIC' && paymentData.amount !== qrCode.amount) {
        throw new Error('Amount mismatch');
      }

      /**
       * Process payment with real-time transaction linking
       * 
       * Real-time linking implementation:
       * 1. Instant transaction tracking - transactions are queryable immediately after creation
       * 2. QR code analytics - automatic aggregation of total transactions and amounts
       * 3. Payment reconciliation - direct link between QR code and all associated payments
       * 4. Historical tracking - complete audit trail of all payments made via each QR code
       * 
       * The transaction object is created with full context (QR code ID, merchant ID, customer details)
       * and immediately stored in the QR code's transactions array for instant availability.
       */
      const transactionId = `TXN_QR_${Date.now()}`;
      const transaction = {
        transactionId: transactionId,
        qrCodeId: qrCodeId,
        merchantId: qrCode.merchantId,
        amount: paymentData.amount || qrCode.amount,
        orderId: qrCode.orderId || paymentData.orderId,
        customerVPA: paymentData.customerVPA,
        customerName: paymentData.customerName,
        status: 'SUCCESS',
        paymentMethod: 'QR_CODE',
        qrType: qrCode.type,
        processedAt: new Date().toISOString()
      };

      // Link transaction to QR code
      if (!qrCode.transactions) {
        qrCode.transactions = [];
      }
      qrCode.transactions.push(transaction);

      // Mark as used for single-use QR
      if (qrCode.singleUse) {
        qrCode.usedAt = new Date().toISOString();
        qrCode.status = 'USED';
      }

      // Update last payment time
      qrCode.lastPaymentAt = new Date().toISOString();
      qrCode.totalTransactions = (qrCode.totalTransactions || 0) + 1;
      qrCode.totalAmount = (qrCode.totalAmount || 0) + transaction.amount;

      return {
        success: true,
        transactionId: transactionId,
        qrCodeId: qrCodeId,
        amount: transaction.amount,
        orderId: transaction.orderId,
        status: 'SUCCESS',
        transaction: transaction,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`QR payment processing failed: ${error.message}`);
    }
  }

  /**
   * Get QR code details
   * @param {string} qrCodeId - QR code ID
   * @returns {Object} QR code details
   */
  getQRCode(qrCodeId) {
    const qrCode = this.qrCodes.get(qrCodeId);
    
    if (!qrCode) {
      throw new Error('QR code not found');
    }

    return {
      qrCodeId: qrCode.qrCodeId,
      type: qrCode.type,
      merchantId: qrCode.merchantId,
      status: qrCode.status,
      createdAt: qrCode.createdAt,
      expiryTime: qrCode.expiryTime,
      lastPaymentAt: qrCode.lastPaymentAt,
      totalTransactions: qrCode.totalTransactions || 0,
      totalAmount: qrCode.totalAmount || 0,
      transactions: qrCode.transactions || []
    };
  }

  /**
   * Get QR code transactions
   * @param {string} qrCodeId - QR code ID
   * @param {Object} filters - Filter options
   * @returns {Object} Transaction list
   */
  getQRTransactions(qrCodeId, filters = {}) {
    const qrCode = this.qrCodes.get(qrCodeId);
    
    if (!qrCode) {
      throw new Error('QR code not found');
    }

    let transactions = qrCode.transactions || [];

    // Apply filters
    if (filters.status) {
      transactions = transactions.filter(txn => txn.status === filters.status);
    }

    if (filters.fromDate) {
      transactions = transactions.filter(txn => 
        new Date(txn.processedAt) >= new Date(filters.fromDate)
      );
    }

    if (filters.toDate) {
      transactions = transactions.filter(txn => 
        new Date(txn.processedAt) <= new Date(filters.toDate)
      );
    }

    return {
      success: true,
      qrCodeId: qrCodeId,
      transactions: transactions,
      total: transactions.length,
      totalAmount: transactions.reduce((sum, txn) => sum + txn.amount, 0)
    };
  }

  /**
   * Deactivate QR code
   * @param {string} qrCodeId - QR code ID
   * @returns {Object} Response
   */
  deactivateQRCode(qrCodeId) {
    const qrCode = this.qrCodes.get(qrCodeId);
    
    if (!qrCode) {
      throw new Error('QR code not found');
    }

    qrCode.status = 'INACTIVE';
    qrCode.deactivatedAt = new Date().toISOString();

    return {
      success: true,
      qrCodeId: qrCodeId,
      status: 'INACTIVE'
    };
  }

  /**
   * Get QR code usage analytics
   * @param {string} merchantId - Merchant ID
   * @param {Object} filters - Date filters
   * @returns {Object} Analytics data
   */
  getQRAnalytics(merchantId, filters) {
    // Filter QR codes by merchant
    const merchantQRs = Array.from(this.qrCodes.values())
      .filter(qr => qr.merchantId === merchantId);

    return {
      totalQRCodes: merchantQRs.length,
      activeQRCodes: merchantQRs.filter(qr => qr.status === 'ACTIVE').length,
      usedQRCodes: merchantQRs.filter(qr => qr.status === 'USED').length,
      staticQRCodes: merchantQRs.filter(qr => qr.type === 'STATIC').length,
      dynamicQRCodes: merchantQRs.filter(qr => qr.type === 'DYNAMIC').length,
      totalTransactions: merchantQRs.filter(qr => qr.lastPaymentAt).length
    };
  }
}

module.exports = QRService;
