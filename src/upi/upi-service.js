/**
 * UPI Payment Service
 * Handles UPI payment processing, VPA validation, and QR code generation
 */

class UPIService {
  constructor(config) {
    this.config = config;
    this.merchantVPA = config.merchantVPA;
    this.merchantId = config.merchantId;
  }

  /**
   * Validate Virtual Payment Address (VPA)
   * @param {string} vpa - UPI VPA (e.g., user@bank)
   * @returns {Promise<boolean>} Validation result
   */
  async validateVPA(vpa) {
    try {
      // Validate VPA format
      const vpaRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/;
      if (!vpaRegex.test(vpa)) {
        return false;
      }

      // Check with NPCI for VPA existence
      // This would be an actual API call in production
      const isValid = await this.checkVPAWithNPCI(vpa);
      
      return isValid;
    } catch (error) {
      console.error('VPA validation error:', error);
      return false;
    }
  }

  /**
   * Check VPA with NPCI
   * @param {string} vpa - UPI VPA
   * @returns {Promise<boolean>}
   */
  async checkVPAWithNPCI(vpa) {
    // Mock implementation - in production, this would call NPCI APIs
    return true;
  }

  /**
   * Create UPI collect request
   * @param {Object} collectData - Collect request details
   * @returns {Promise<Object>} Collect request response
   */
  async createCollectRequest(collectData) {
    try {
      const { vpa, amount, description, orderId } = collectData;

      // Validate inputs
      if (!vpa || !amount || !orderId) {
        throw new Error('Missing required fields for collect request');
      }

      // Validate VPA
      const isValidVPA = await this.validateVPA(vpa);
      if (!isValidVPA) {
        throw new Error('Invalid VPA');
      }

      // Create collect request
      const collectRequest = {
        requestId: `UPI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        merchantVPA: this.merchantVPA,
        customerVPA: vpa,
        amount: amount,
        currency: 'INR',
        description: description || 'Payment',
        orderId: orderId,
        expiryTime: new Date(Date.now() + 15 * 60000).toISOString(), // 15 minutes
        status: 'PENDING',
        createdAt: new Date().toISOString()
      };

      // Send collect request to customer's UPI app
      await this.sendCollectRequest(collectRequest);

      return {
        success: true,
        requestId: collectRequest.requestId,
        status: 'PENDING',
        expiryTime: collectRequest.expiryTime
      };
    } catch (error) {
      throw new Error(`Collect request failed: ${error.message}`);
    }
  }

  /**
   * Send collect request to customer
   * @param {Object} collectRequest - Collect request details
   */
  async sendCollectRequest(collectRequest) {
    // Integration with UPI payment service provider
    console.log('Collect request sent:', collectRequest.requestId);
  }

  /**
   * Generate UPI QR code
   * @param {Object} qrData - QR code data
   * @returns {Promise<Object>} QR code details
   */
  async generateQRCode(qrData) {
    try {
      const { amount, orderId, description, isStatic = false } = qrData;

      // Build UPI URL
      const upiURL = this.buildUPIURL({
        pa: this.merchantVPA,
        pn: this.config.merchantName,
        am: isStatic ? undefined : amount,
        tn: description || 'Payment',
        tr: orderId
      });

      // Generate QR code from UPI URL
      const qrCode = await this.generateQRImage(upiURL);

      return {
        success: true,
        qrCodeId: `QR_${Date.now()}`,
        qrCodeData: upiURL,
        qrCodeImage: qrCode,
        isStatic: isStatic,
        amount: amount,
        orderId: orderId,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`QR code generation failed: ${error.message}`);
    }
  }

  /**
   * Build UPI URL for QR code
   * @param {Object} params - UPI URL parameters
   * @returns {string} UPI URL
   */
  buildUPIURL(params) {
    const { pa, pn, am, tn, tr } = params;
    let url = `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}`;
    
    if (am) {
      url += `&am=${am}`;
    }
    if (tn) {
      url += `&tn=${encodeURIComponent(tn)}`;
    }
    if (tr) {
      url += `&tr=${tr}`;
    }
    
    url += `&cu=INR`;
    
    return url;
  }

  /**
   * Generate QR code image from URL
   * @param {string} url - UPI URL
   * @returns {Promise<string>} Base64 encoded QR code image
   */
  async generateQRImage(url) {
    // In production, use QR code library like 'qrcode'
    // This is a placeholder
    return `data:image/png;base64,QR_CODE_FOR_${url}`;
  }

  /**
   * Process UPI intent payment
   * @param {Object} intentData - Intent payment data
   * @returns {Promise<Object>} Intent response
   */
  async processIntent(intentData) {
    try {
      const { amount, orderId, description } = intentData;

      // Create UPI intent URL
      const intentURL = this.buildUPIURL({
        pa: this.merchantVPA,
        pn: this.config.merchantName,
        am: amount,
        tn: description || 'Payment',
        tr: orderId
      });

      return {
        success: true,
        intentURL: intentURL,
        orderId: orderId,
        expiryTime: new Date(Date.now() + 15 * 60000).toISOString()
      };
    } catch (error) {
      throw new Error(`Intent processing failed: ${error.message}`);
    }
  }

  /**
   * Check UPI transaction status
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Transaction status
   */
  async checkTransactionStatus(transactionId) {
    try {
      // Query transaction status
      // In production, this would call payment service provider API
      
      return {
        transactionId: transactionId,
        status: 'SUCCESS', // SUCCESS, FAILED, PENDING
        amount: 100.00,
        utr: `UPI${Date.now()}`, // Unique Transaction Reference
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Status check failed: ${error.message}`);
    }
  }

  /**
   * Handle UPI callback/webhook
   * @param {Object} callbackData - Callback data from UPI
   * @returns {Promise<Object>} Processed callback
   */
  async handleCallback(callbackData) {
    try {
      // Verify callback signature
      const isValid = await this.verifyCallbackSignature(callbackData);
      if (!isValid) {
        throw new Error('Invalid callback signature');
      }

      // Process callback
      const { transactionId, status, utr } = callbackData;

      // Update transaction in database
      await this.updateTransactionStatus(transactionId, status, utr);

      // Send notification to merchant
      await this.notifyMerchant(transactionId, status);

      return {
        success: true,
        acknowledged: true
      };
    } catch (error) {
      throw new Error(`Callback processing failed: ${error.message}`);
    }
  }

  /**
   * Verify callback signature
   * @param {Object} data - Callback data
   * @returns {Promise<boolean>}
   */
  async verifyCallbackSignature(data) {
    // Implement signature verification
    // Use HMAC-SHA256 with shared secret
    return true;
  }

  /**
   * Update transaction status in database
   * @param {string} transactionId - Transaction ID
   * @param {string} status - Transaction status
   * @param {string} utr - UTR number
   */
  async updateTransactionStatus(transactionId, status, utr) {
    console.log(`Transaction ${transactionId} updated to ${status}, UTR: ${utr}`);
  }

  /**
   * Notify merchant about transaction status
   * @param {string} transactionId - Transaction ID
   * @param {string} status - Transaction status
   */
  async notifyMerchant(transactionId, status) {
    console.log(`Notification sent for transaction ${transactionId}: ${status}`);
  }
}

module.exports = UPIService;
