/**
 * Main Entry Point
 * Payment Gateway Application Server
 */

const express = require('express');
const path = require('path');
const config = require('./config/config');
const routes = require('./api/routes');
const db = require('./database');

const app = express();

// Initialize database connection pool
db.initializePool();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealth = await db.healthCheck();
  
  res.json({
    status: dbHealth.healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbHealth
  });
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
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start Server
const PORT = config.server.port || 3000;
const HOST = config.server.host || '0.0.0.0';

app.listen(PORT, HOST, () => {
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
  - PCI-DSS: ${config.compliance.pciDssEnabled ? 'Enabled' : 'Disabled'}
  - KYC: ${config.compliance.kycRequired ? 'Required' : 'Optional'}
  - AML: ${config.compliance.amlEnabled ? 'Enabled' : 'Disabled'}

Ready to process payments! 🚀
  `);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    try {
      await db.closePool();
      console.log('Database pool closed');
    } catch (error) {
      console.error('Error closing database pool:', error);
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    try {
      await db.closePool();
      console.log('Database pool closed');
    } catch (error) {
      console.error('Error closing database pool:', error);
    }
    process.exit(0);
  });
});

module.exports = app;
