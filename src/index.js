/**
 * Main Entry Point
 * Payment Gateway Application Server
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const config = require('./config/config');
const routes = require('./api/routes');
const db = require('./database');
const logger = require('./core/logging/logger');
const { correlationIdMiddleware } = require('./core/middleware/correlation-id');

// Import security services
const TokenizationService = require('./security/tokenization-service');
const AuditTrailService = require('./security/audit-trail-service');
const PCIDSSComplianceService = require('./security/pci-dss-compliance');
const {
  enforceHTTPS,
  enforceTLSVersion,
  addSecurityHeaders,
  blockInsecureEndpoints,
  logInsecureRequests
} = require('./security/https-middleware');

const app = express();

// Trust proxy for IP whitelisting (important for production behind load balancers)
// Set to true if behind a reverse proxy, or specify the number of proxy hops
app.set('trust proxy', config.server.trustProxy || false);

// Initialize database connection pool
db.initializePool();

// Initialize security services
const tokenizationService = new TokenizationService(config);
const auditTrailService = new AuditTrailService(config, db);
const pciComplianceService = new PCIDSSComplianceService(config, tokenizationService, auditTrailService);

// Make services available to routes
app.locals.tokenizationService = tokenizationService;
app.locals.auditTrailService = auditTrailService;
app.locals.pciComplianceService = pciComplianceService;

// HTTPS/TLS Enforcement (PCI-DSS Requirement 4)
app.use(enforceHTTPS);
app.use(enforceTLSVersion);
app.use(logInsecureRequests(auditTrailService));

// Define sensitive endpoints that must use HTTPS
const sensitiveEndpoints = [
  '/api/payments',
  '/api/payin',
  '/api/payout',
  '/api/bnpl',
  '/api/security',
  '/api/merchants'
];
app.use(blockInsecureEndpoints(sensitiveEndpoints));

// Enhanced Security Headers (PCI-DSS aligned)
app.use(addSecurityHeaders);

// Middleware
app.use(correlationIdMiddleware);
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl && (req.originalUrl.startsWith('/api/webhooks/') || req.originalUrl.startsWith('/api/payout-webhooks/'))) {
      req.rawBody = Buffer.from(buf);
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Correlation-Id, Idempotency-Key');
  res.header('Access-Control-Expose-Headers', 'X-Correlation-Id, Idempotency-Replayed');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealth = await db.healthCheck();
  
  res.json({
    status: dbHealth.healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId,
    uptime: process.uptime(),
    database: dbHealth
  });
});

// PCI-DSS Compliance Report Endpoint (restricted access)
app.get('/api/compliance/report', async (req, res) => {
  try {
    // In production, this should require admin authentication
    const report = await pciComplianceService.generateComplianceReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Payment Gateway API',
    version: '1.0.0',
    description: 'Comprehensive fintech payment gateway with UPI, PAPG, Pay-in, Payout, QR, Wallets, BNPL, EMI, and Biometric support',
    documentation: '/api/docs',
    health: '/health'
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    correlationId: req.correlationId
  });
});

// Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', {
    error: err.message,
    stack: err.stack,
    correlation_id: req.correlationId
  });
  
  res.status(err.status || 500).json({
    success: false,
    code: err.code || 'INTERNAL_ERROR',
    error: err.message || 'Internal server error',
    correlationId: req.correlationId,
    timestamp: new Date().toISOString()
  });
});

// Start Server
const PORT = config.server.port || 3000;
const HOST = config.server.host || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info('Payment Gateway server started', {
    host: HOST,
    port: PORT,
    environment: config.server.environment,
    nodeVersion: process.version
  });
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Payment Gateway Server Started                  ║
╚═══════════════════════════════════════════════════════════╝

Server: http://${HOST}:${PORT}
Environment: ${config.server.environment}
Node Version: ${process.version}

Features Enabled:
  - UPI Payments: ${config.features.upi ? '✓' : '✗'}
  - Card Payments: ${config.features.cards ? '✓' : '✗'}
  - Wallets: ${config.features.wallets ? '✓' : '✗'}
  - BNPL: ${config.features.bnpl ? '✓' : '✗'}
  - EMI: ${config.features.emi ? '✓' : '✗'}
  - Biometric: ${config.features.biometric ? '✓' : '✗'}
  - QR Codes: ${config.features.qr ? '✓' : '✗'}
  - Payout: ${config.features.payout ? '✓' : '✗'}

Security:
  - PCI-DSS: ${config.compliance.pciDssEnabled ? 'Enabled ✓' : 'Disabled'}
  - Tokenization: Enabled ✓
  - Audit Trail: Enabled ✓
  - TLS Enforcement: ${process.env.NODE_ENV === 'production' ? 'Enabled ✓' : 'Disabled (dev mode)'}
  - KYC: ${config.compliance.kycRequired ? 'Required' : 'Optional'}
  - AML: ${config.compliance.amlEnabled ? 'Enabled' : 'Disabled'}

Ready to process payments! 🚀
  `);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await db.closePool();
      logger.info('Database pool closed');
    } catch (error) {
      logger.error('Error closing database pool', { error: error.message });
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await db.closePool();
      logger.info('Database pool closed');
    } catch (error) {
      logger.error('Error closing database pool', { error: error.message });
    }
    process.exit(0);
  });
});

module.exports = app;
