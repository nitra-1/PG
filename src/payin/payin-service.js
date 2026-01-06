/**
 * Pay-in Service
 * Handles customer payment collection through various payment methods
 */

class PayInService {
  constructor(config) {
    this.config = config;
    this.paymentGateway = config.paymentGateway;
  }

  /**
   * Create payment order
   * @param {Object} orderData - Order details
   * @returns {Promise<Object>} Order response
   */
  async createPaymentOrder(orderData) {
    try {
      const {
        amount,
        currency,
        customerId,
        customerEmail,
        customerPhone,
        description,
        orderId,
        callbackUrl,
        paymentMethods
      } = orderData;

      // Validate order data
      this.validateOrderData(orderData);

      // Create order
      const order = {
        orderId: orderId || `ORD_${Date.now()}`,
        amount: amount,
        currency: currency || 'INR',
        customerId: customerId,
        customerEmail: customerEmail,
        customerPhone: customerPhone,
        description: description,
        status: 'CREATED',
        paymentMethods: paymentMethods || ['card', 'upi', 'netbanking', 'wallet'],
        callbackUrl: callbackUrl,
        expiryTime: new Date(Date.now() + 30 * 60000).toISOString(), // 30 minutes
        createdAt: new Date().toISOString()
      };

      // Store order in database
      await this.storeOrder(order);

      return {
        success: true,
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        paymentMethods: order.paymentMethods,
        expiryTime: order.expiryTime
      };
    } catch (error) {
      throw new Error(`Order creation failed: ${error.message}`);
    }
  }

  /**
   * Validate order data
   * @param {Object} orderData - Order details
   */
  validateOrderData(orderData) {
    const required = ['amount', 'customerId', 'customerEmail'];
    
    for (const field of required) {
      if (!orderData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (orderData.amount <= 0) {
      throw new Error('Invalid amount');
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(orderData.customerEmail)) {
      throw new Error('Invalid email address');
    }
  }

  /**
   * Process payment for an order
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} Payment response
   */
  async processPayment(paymentData) {
    try {
      const { orderId, paymentMethod, paymentDetails } = paymentData;

      // Retrieve order
      const order = await this.getOrder(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== 'CREATED') {
        throw new Error(`Order already ${order.status}`);
      }

      // Check order expiry
      if (new Date() > new Date(order.expiryTime)) {
        throw new Error('Order expired');
      }

      // Process payment through gateway
      const paymentResult = await this.paymentGateway.processPayment({
        amount: order.amount,
        currency: order.currency,
        customerId: order.customerId,
        orderId: orderId,
        paymentMethod: paymentMethod,
        ...paymentDetails
      });

      // Update order status
      await this.updateOrderStatus(orderId, 'PROCESSING', paymentResult.transactionId);

      return {
        success: true,
        orderId: orderId,
        transactionId: paymentResult.transactionId,
        status: 'PROCESSING',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Payment processing failed: ${error.message}`);
    }
  }

  /**
   * Get order details
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order details
   */
  async getOrder(orderId) {
    // Retrieve from database
    // Mock implementation
    return {
      orderId: orderId,
      amount: 1000,
      currency: 'INR',
      customerId: 'CUST_001',
      status: 'CREATED',
      expiryTime: new Date(Date.now() + 30 * 60000).toISOString()
    };
  }

  /**
   * Store order in database
   * @param {Object} order - Order details
   */
  async storeOrder(order) {
    console.log('Order stored:', order.orderId);
    
    try {
      const db = require('../database');
      await db.insertWithTenant('payment_orders', {
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        status: this.mapStatusToDBStatus(order.status),
        customer_id: order.customerId,
        customer_email: order.customerEmail,
        customer_phone: order.customerPhone,
        customer_details: JSON.stringify({
          customerId: order.customerId,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone
        }),
        payment_method: order.paymentMethods ? order.paymentMethods[0] : null,
        callback_url: order.callbackUrl,
        metadata: JSON.stringify({
          description: order.description,
          paymentMethods: order.paymentMethods
        }),
        expires_at: new Date(order.expiryTime)
      }, this.config.tenantId || this.config.defaultTenantId);
    } catch (error) {
      console.error('Failed to store order in database:', error);
    }
  }

  /**
   * Map order status to database status enum
   * @param {string} status - Order status
   * @returns {string} Database status
   */
  mapStatusToDBStatus(status) {
    const statusMap = {
      'CREATED': 'created',
      'PENDING': 'pending',
      'PROCESSING': 'pending',
      'AUTHORIZED': 'authorized',
      'CAPTURED': 'captured',
      'FAILED': 'failed',
      'CANCELLED': 'cancelled'
    };
    return statusMap[status] || 'created';
  }

  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @param {string} transactionId - Transaction ID
   */
  async updateOrderStatus(orderId, status, transactionId) {
    console.log(`Order ${orderId} updated to ${status}, Transaction: ${transactionId}`);
    
    try {
      const db = require('../database');
      // Find the order first
      const orders = await db.findByTenant('payment_orders', this.config.tenantId || this.config.defaultTenantId, {
        order_id: orderId
      });
      
      if (orders && orders.length > 0) {
        await db.updateByTenant('payment_orders', orders[0].id, {
          status: this.mapStatusToDBStatus(status),
          gateway_order_id: transactionId,
          updated_at: new Date()
        }, this.config.tenantId || this.config.defaultTenantId);
      }
    } catch (error) {
      console.error('Failed to update order status in database:', error);
    }
  }

  /**
   * Get payment status
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Payment status
   */
  async getPaymentStatus(orderId) {
    try {
      const order = await this.getOrder(orderId);
      
      return {
        orderId: orderId,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        transactionId: order.transactionId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Status retrieval failed: ${error.message}`);
    }
  }

  /**
   * Handle payment callback/webhook
   * @param {Object} callbackData - Callback data
   * @returns {Promise<Object>} Processed callback
   */
  async handleCallback(callbackData) {
    try {
      // Verify callback signature
      const isValid = await this.verifyCallback(callbackData);
      if (!isValid) {
        throw new Error('Invalid callback signature');
      }

      const { orderId, status, transactionId } = callbackData;

      // Update order
      await this.updateOrderStatus(orderId, status, transactionId);

      // Trigger merchant callback
      await this.triggerMerchantCallback(orderId, status);

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
  async verifyCallback(data) {
    // Implement signature verification using HMAC
    return true;
  }

  /**
   * Trigger merchant callback
   * @param {string} orderId - Order ID
   * @param {string} status - Payment status
   */
  async triggerMerchantCallback(orderId, status) {
    console.log(`Merchant callback triggered for order ${orderId}: ${status}`);
  }

  /**
   * Generate payment link
   * @param {Object} linkData - Payment link data
   * @returns {Promise<Object>} Payment link
   */
  async generatePaymentLink(linkData) {
    try {
      const { amount, customerId, customerEmail, description } = linkData;

      // Create order
      const order = await this.createPaymentOrder({
        amount,
        customerId,
        customerEmail,
        description
      });

      // Generate payment link
      const paymentLink = `${this.config.paymentPageUrl}?orderId=${order.orderId}`;

      return {
        success: true,
        orderId: order.orderId,
        paymentLink: paymentLink,
        expiryTime: order.expiryTime
      };
    } catch (error) {
      throw new Error(`Payment link generation failed: ${error.message}`);
    }
  }
}

module.exports = PayInService;
