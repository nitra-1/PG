/**
 * Payment Gateway API Routes
 * RESTful API endpoints for payment processing
 */

const express = require('express');
const router = express.Router();

// Import services
const PaymentGateway = require('../core/payment-gateway');
const UPIService = require('../upi/upi-service');
const PayInService = require('../payin/payin-service');
const PayoutService = require('../payout/payout-service');
const PAPGService = require('../papg/papg-service');
const QRService = require('../qr/qr-service');
const WalletService = require('../wallet/wallet-service');
const BNPLService = require('../bnpl/bnpl-service');
const EMIService = require('../emi/emi-service');
const BiometricService = require('../biometric/biometric-service');
const SecurityService = require('../security/security-service');
const SubscriptionService = require('../subscription/subscription-service');

// Initialize services
const config = require('../config/config');
const paymentGateway = new PaymentGateway(config);
const upiService = new UPIService(config);
const payInService = new PayInService({ ...config, paymentGateway });
const payoutService = new PayoutService(config);
const papgService = new PAPGService(config);
const qrService = new QRService(config);
const walletService = new WalletService(config);
const bnplService = new BNPLService(config);
const emiService = new EMIService(config);
const biometricService = new BiometricService(config);
const securityService = new SecurityService(config);
const subscriptionService = new SubscriptionService(config);

// Import merchant routes
const merchantRoutes = require('../merchant/merchant-routes')(config, securityService);

// Middleware for authentication
const authenticate = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = securityService.verifyJWT(token);
    req.user = decoded;
    
    // Extract tenant ID from various possible sources
    // Priority: explicit tenantId > merchantId > userId (for backward compatibility)
    req.tenantId = decoded.tenantId || decoded.merchantId || decoded.userId || config.defaultTenantId;
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ===== Payment Gateway Routes =====

/**
 * POST /api/payments/process
 * Process payment through gateway
 */
router.post('/payments/process', authenticate, async (req, res) => {
  try {
    // Add tenant ID to payment data from authenticated request
    // Use tenant ID from JWT token (req.tenantId) to prevent tenant spoofing
    const paymentData = {
      ...req.body,
      tenantId: req.tenantId
    };
    const result = await paymentGateway.processPayment(paymentData);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/payments/:transactionId
 * Get payment status
 */
router.get('/payments/:transactionId', authenticate, async (req, res) => {
  try {
    const result = await paymentGateway.getTransactionStatus(req.params.transactionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/payments/:transactionId/refund
 * Refund a transaction
 */
router.post('/payments/:transactionId/refund', authenticate, async (req, res) => {
  try {
    const result = await paymentGateway.refundTransaction(
      req.params.transactionId,
      req.body.amount
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== UPI Routes =====

/**
 * POST /api/upi/validate-vpa
 * Validate UPI VPA
 */
router.post('/upi/validate-vpa', authenticate, async (req, res) => {
  try {
    const result = await upiService.validateVPA(req.body.vpa);
    res.json({ valid: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/upi/collect
 * Create UPI collect request
 */
router.post('/upi/collect', authenticate, async (req, res) => {
  try {
    const result = await upiService.createCollectRequest(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/upi/qr/generate
 * Generate UPI QR code
 */
router.post('/upi/qr/generate', authenticate, async (req, res) => {
  try {
    const result = await upiService.generateQRCode(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/upi/intent
 * Process UPI intent
 */
router.post('/upi/intent', authenticate, async (req, res) => {
  try {
    const result = await upiService.processIntent(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Pay-in Routes =====

/**
 * POST /api/payin/orders
 * Create payment order
 */
router.post('/payin/orders', authenticate, async (req, res) => {
  try {
    const result = await payInService.createPaymentOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/payin/orders/:orderId/pay
 * Process payment for order
 */
router.post('/payin/orders/:orderId/pay', authenticate, async (req, res) => {
  try {
    const result = await payInService.processPayment({
      orderId: req.params.orderId,
      ...req.body
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/payin/orders/:orderId/status
 * Get payment status
 */
router.get('/payin/orders/:orderId/status', authenticate, async (req, res) => {
  try {
    const result = await payInService.getPaymentStatus(req.params.orderId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Payout Routes =====

/**
 * POST /api/payout/beneficiaries
 * Create beneficiary
 */
router.post('/payout/beneficiaries', authenticate, async (req, res) => {
  try {
    const result = await payoutService.createBeneficiary(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/payout/payouts
 * Create payout
 */
router.post('/payout/payouts', authenticate, async (req, res) => {
  try {
    const result = await payoutService.createPayout(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/payout/payouts/bulk
 * Create bulk payout
 */
router.post('/payout/payouts/bulk', authenticate, async (req, res) => {
  try {
    const result = await payoutService.createBulkPayout(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/payout/payouts/:payoutId
 * Get payout status
 */
router.get('/payout/payouts/:payoutId', authenticate, async (req, res) => {
  try {
    const result = await payoutService.getPayoutStatus(req.params.payoutId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== QR Code Routes =====

/**
 * POST /api/qr/static
 * Generate static QR code
 */
router.post('/qr/static', authenticate, async (req, res) => {
  try {
    const result = await qrService.generateStaticQR(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/qr/dynamic
 * Generate dynamic QR code
 */
router.post('/qr/dynamic', authenticate, async (req, res) => {
  try {
    const result = await qrService.generateDynamicQR(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/qr/:qrCodeId/payment
 * Process QR code payment
 */
router.post('/qr/:qrCodeId/payment', authenticate, async (req, res) => {
  try {
    const result = await qrService.processQRPayment(req.params.qrCodeId, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/qr/:qrCodeId
 * Get QR code details
 */
router.get('/qr/:qrCodeId', authenticate, async (req, res) => {
  try {
    const result = qrService.getQRCode(req.params.qrCodeId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/qr/:qrCodeId/transactions
 * Get QR code transactions
 */
router.get('/qr/:qrCodeId/transactions', authenticate, async (req, res) => {
  try {
    const result = qrService.getQRTransactions(req.params.qrCodeId, req.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Subscription Routes =====

/**
 * POST /api/subscriptions/plans
 * Create subscription plan
 */
router.post('/subscriptions/plans', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.createPlan(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/subscriptions/plans
 * List subscription plans
 */
router.get('/subscriptions/plans', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.listPlans(req.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/subscriptions/plans/:planId
 * Get subscription plan
 */
router.get('/subscriptions/plans/:planId', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.getPlan(req.params.planId);
    res.json({ success: true, plan: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions
 * Create subscription
 */
router.post('/subscriptions', authenticate, async (req, res) => {
  try {
    const result = await subscriptionService.createSubscription(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/subscriptions/:subscriptionId
 * Get subscription details
 */
router.get('/subscriptions/:subscriptionId', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.getSubscription(req.params.subscriptionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/subscriptions/:subscriptionId
 * Update subscription
 */
router.put('/subscriptions/:subscriptionId', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.updateSubscription(req.params.subscriptionId, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/:subscriptionId/cancel
 * Cancel subscription
 */
router.post('/subscriptions/:subscriptionId/cancel', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.cancelSubscription(req.params.subscriptionId, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/:subscriptionId/pause
 * Pause subscription
 */
router.post('/subscriptions/:subscriptionId/pause', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.pauseSubscription(req.params.subscriptionId, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/:subscriptionId/resume
 * Resume subscription
 */
router.post('/subscriptions/:subscriptionId/resume', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.resumeSubscription(req.params.subscriptionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/:subscriptionId/process-payment
 * Process recurring payment
 */
router.post('/subscriptions/:subscriptionId/process-payment', authenticate, async (req, res) => {
  try {
    const result = await subscriptionService.processRecurringPayment(req.params.subscriptionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/subscriptions/:subscriptionId/billing-history
 * Get subscription billing history
 */
router.get('/subscriptions/:subscriptionId/billing-history', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.getSubscriptionBillingHistory(req.params.subscriptionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/customers/:customerId/subscriptions
 * List customer subscriptions
 */
router.get('/customers/:customerId/subscriptions', authenticate, async (req, res) => {
  try {
    const result = subscriptionService.listCustomerSubscriptions(req.params.customerId, req.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Wallet Routes =====

/**
 * POST /api/wallet/payment/initiate
 * Initiate wallet payment
 */
router.post('/wallet/payment/initiate', authenticate, async (req, res) => {
  try {
    const result = await walletService.initiateWalletPayment(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/wallet/balance
 * Check wallet balance
 */
router.get('/wallet/balance', authenticate, async (req, res) => {
  try {
    const result = await walletService.checkWalletBalance(req.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== BNPL Routes =====

/**
 * POST /api/bnpl/eligibility
 * Check BNPL eligibility
 */
router.post('/bnpl/eligibility', authenticate, async (req, res) => {
  try {
    const result = await bnplService.checkEligibility(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/bnpl/orders
 * Create BNPL order
 */
router.post('/bnpl/orders', authenticate, async (req, res) => {
  try {
    const result = await bnplService.createBNPLOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/bnpl/orders/:bnplOrderId
 * Get BNPL order details
 */
router.get('/bnpl/orders/:bnplOrderId', authenticate, async (req, res) => {
  try {
    const result = await bnplService.getBNPLOrder(req.params.bnplOrderId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/bnpl/installments/process
 * Process installment payment
 */
router.post('/bnpl/installments/process', authenticate, async (req, res) => {
  try {
    const result = await bnplService.processInstallment(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/bnpl/customers/:customerId/summary
 * Get customer BNPL summary
 */
router.get('/bnpl/customers/:customerId/summary', authenticate, async (req, res) => {
  try {
    const result = await bnplService.getCustomerBNPLSummary(req.params.customerId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/bnpl/providers
 * Get available BNPL providers
 */
router.get('/bnpl/providers', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      providers: bnplService.partners
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== EMI Routes =====

/**
 * POST /api/emi/calculate
 * Calculate EMI
 */
router.post('/emi/calculate', authenticate, async (req, res) => {
  try {
    const result = emiService.calculateEMI(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/emi/plans
 * Get available EMI plans
 */
router.get('/emi/plans', authenticate, async (req, res) => {
  try {
    const result = await emiService.getAvailableEMIPlans(req.query);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/emi/transactions
 * Create EMI transaction
 */
router.post('/emi/transactions', authenticate, async (req, res) => {
  try {
    const result = await emiService.createEMITransaction(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Biometric Routes =====

/**
 * POST /api/biometric/register
 * Register biometric
 */
router.post('/biometric/register', authenticate, async (req, res) => {
  try {
    const result = await biometricService.registerBiometric(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/biometric/authenticate
 * Authenticate with biometric
 */
router.post('/biometric/authenticate', async (req, res) => {
  try {
    const result = await biometricService.authenticateWithBiometric(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/biometric/payment
 * Process biometric payment
 */
router.post('/biometric/payment', async (req, res) => {
  try {
    const result = await biometricService.processBiometricPayment(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Security Routes =====

/**
 * POST /api/security/kyc
 * Perform KYC verification
 */
router.post('/security/kyc', authenticate, async (req, res) => {
  try {
    const result = await securityService.performKYC(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/security/aml-check
 * Perform AML check
 */
router.post('/security/aml-check', authenticate, async (req, res) => {
  try {
    const result = await securityService.performAMLCheck(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Demo/Testing Routes =====

/**
 * POST /api/demo/token
 * Generate demo authentication token for testing
 */
router.post('/demo/token', async (req, res) => {
  try {
    const { userId = 'demo-user', name = 'Demo Customer' } = req.body;
    
    const token = securityService.generateJWT({
      userId: userId,
      name: name,
      role: 'customer'
    }, 3600); // 1 hour expiration
    
    res.json({
      success: true,
      token: token,
      expiresIn: 3600,
      message: 'Demo token generated successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ===== Merchant Routes =====
router.use('/merchants', merchantRoutes);

module.exports = router;
