/**
 * Configuration File
 * Central configuration for the payment gateway system
 */

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
    environment: process.env.NODE_ENV || 'development'
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'payment_gateway',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    poolSize: parseInt(process.env.DB_POOL_SIZE) || 10,
    // Failover configuration - add replica hosts for high availability
    replicas: process.env.DB_REPLICAS ? JSON.parse(process.env.DB_REPLICAS) : [],
    // Multi-tenancy configuration
    multiTenancy: {
      enabled: process.env.MULTI_TENANCY_ENABLED !== 'false',
      strategy: process.env.TENANT_STRATEGY || 'column', // 'column' or 'schema'
      tenantHeader: 'X-Tenant-ID'
    }
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0
  },

  // Payment Gateway Configuration
  defaultGateway: process.env.DEFAULT_GATEWAY || 'razorpay',

  // Gateway API Keys (use environment variables in production)
  gateways: {
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID || '',
      keySecret: process.env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || ''
    },
    payu: {
      merchantKey: process.env.PAYU_MERCHANT_KEY || '',
      merchantSalt: process.env.PAYU_MERCHANT_SALT || ''
    },
    ccavenue: {
      merchantId: process.env.CCAVENUE_MERCHANT_ID || '',
      accessCode: process.env.CCAVENUE_ACCESS_CODE || '',
      workingKey: process.env.CCAVENUE_WORKING_KEY || ''
    }
  },

  // UPI Configuration
  merchantVPA: process.env.MERCHANT_VPA || 'merchant@bank',
  merchantId: process.env.MERCHANT_ID || 'MERCHANT001',
  merchantName: process.env.MERCHANT_NAME || 'Merchant Name',

  // Payment Page Configuration
  paymentPageUrl: process.env.PAYMENT_PAGE_URL || 'https://payment.example.com/pay',

  // Security Configuration
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  hmacSecret: process.env.HMAC_SECRET || 'your-hmac-secret-key',
  jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',

  // Transaction Limits
  limits: {
    minAmount: parseFloat(process.env.MIN_AMOUNT) || 1,
    maxAmount: parseFloat(process.env.MAX_AMOUNT) || 200000,
    dailyLimit: parseFloat(process.env.DAILY_LIMIT) || 500000,
    monthlyLimit: parseFloat(process.env.MONTHLY_LIMIT) || 2000000
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100
  },

  // Webhook Configuration
  webhooks: {
    retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS) || 3,
    retryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY) || 5000,
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 30000
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
  },

  // Monitoring Configuration
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT) || 9090
  },

  // Feature Flags
  features: {
    upi: process.env.FEATURE_UPI !== 'false',
    cards: process.env.FEATURE_CARDS !== 'false',
    netbanking: process.env.FEATURE_NETBANKING !== 'false',
    wallets: process.env.FEATURE_WALLETS !== 'false',
    bnpl: process.env.FEATURE_BNPL !== 'false',
    emi: process.env.FEATURE_EMI !== 'false',
    biometric: process.env.FEATURE_BIOMETRIC !== 'false',
    qr: process.env.FEATURE_QR !== 'false',
    payout: process.env.FEATURE_PAYOUT !== 'false'
  },

  // Compliance Configuration
  compliance: {
    pciDssEnabled: process.env.PCI_DSS_ENABLED !== 'false',
    kycRequired: process.env.KYC_REQUIRED !== 'false',
    amlEnabled: process.env.AML_ENABLED !== 'false',
    dataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS) || 90
  },

  // Email Configuration
  email: {
    host: process.env.EMAIL_HOST || 'smtp.example.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'noreply@example.com'
  },

  // SMS Configuration
  sms: {
    provider: process.env.SMS_PROVIDER || 'twilio',
    apiKey: process.env.SMS_API_KEY || '',
    apiSecret: process.env.SMS_API_SECRET || '',
    senderId: process.env.SMS_SENDER_ID || 'PAYMENT'
  }
};
