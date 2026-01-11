/**
 * Platform Ops Console - Main Routes Index
 * Exports all ops console route modules
 */

const express = require('express');
const router = express.Router();

// Import middleware
const { 
  requireOpsConsoleAccess, 
  blockFinanceOperations,
  logOpsAction
} = require('./ops-console-middleware');

// Import route modules
const authRoutes = require('./auth-routes');
const merchantManagementRoutes = require('./merchant-management-routes');
const transactionMonitoringRoutes = require('./transaction-monitoring-routes');
const gatewayHealthRoutes = require('./gateway-health-routes');
const userManagementRoutes = require('./user-management-routes');
const systemConfigRoutes = require('./system-config-routes');

// Mount auth routes BEFORE security middleware (login doesn't need authentication)
router.use('/auth', authRoutes);

// Apply global finance operations blocker to all other routes
// NOTE: requireOpsConsoleAccess is applied at individual route level, not globally
router.use(blockFinanceOperations);

// Mount route modules
router.use('/merchants', merchantManagementRoutes);
router.use('/transactions', transactionMonitoringRoutes);
router.use('/gateway-health', gatewayHealthRoutes);
router.use('/users', userManagementRoutes);
router.use('/system-config', systemConfigRoutes);

// Dashboard overview endpoint
router.get('/dashboard', requireOpsConsoleAccess, logOpsAction('GET_DASHBOARD'), async (req, res) => {
  try {
    const db = require('../database');
    
    // Get summary statistics
    const [merchantCount, transactionStats, gatewayHealth] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM merchants'),
      db.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as last_24h
        FROM transactions
      `),
      db.query(`
        SELECT 
          gateway, state, failure_count 
        FROM circuit_breakers 
        WHERE state != 'closed'
      `)
    ]);
    
    res.json({
      success: true,
      dashboard: {
        merchants: {
          total: parseInt(merchantCount.rows[0].count)
        },
        transactions: transactionStats.rows[0],
        gateways: {
          unhealthy: gatewayHealth.rows
        }
      }
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard data'
    });
  }
});

module.exports = router;
