/**
 * Gateway Health Routes - Platform Ops Console
 * Monitor gateway health and performance metrics
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireOpsConsoleAccess, logOpsAction } = require('./ops-console-middleware');

/**
 * GET /api/ops/gateway-health/status
 * Get all gateway statuses
 */
router.get('/status', requireOpsConsoleAccess, logOpsAction('GET_GATEWAY_STATUS'), async (req, res) => {
  try {
    // Get gateway health from circuit breaker states
    const result = await db.query(`
      SELECT 
        gateway,
        state,
        failure_count,
        last_failure_time,
        success_count,
        created_at,
        updated_at
      FROM circuit_breakers
      ORDER BY gateway
    `);
    
    res.json({
      success: true,
      gateways: result.rows
    });
  } catch (error) {
    console.error('Error getting gateway status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get gateway status'
    });
  }
});

/**
 * GET /api/ops/gateway-health/:gateway/metrics
 * Get specific gateway metrics
 */
router.get('/:gateway/metrics', requireOpsConsoleAccess, logOpsAction('GET_GATEWAY_METRICS'), async (req, res) => {
  try {
    const { gateway } = req.params;
    const { dateFrom, dateTo } = req.query;
    
    let query = `
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        SUM(amount) as total_volume
      FROM transactions
      WHERE gateway = $1
    `;
    const params = [gateway];
    let paramIndex = 2;
    
    if (dateFrom) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    if (dateTo) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(dateTo);
    }
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      gateway,
      metrics: result.rows[0]
    });
  } catch (error) {
    console.error('Error getting gateway metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get gateway metrics'
    });
  }
});

/**
 * GET /api/ops/gateway-health/circuit-breakers
 * Get circuit breaker states
 */
router.get('/circuit-breakers', requireOpsConsoleAccess, logOpsAction('GET_CIRCUIT_BREAKERS'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        gateway,
        state,
        failure_count,
        last_failure_time,
        success_count,
        updated_at
      FROM circuit_breakers
      ORDER BY state DESC, failure_count DESC
    `);
    
    res.json({
      success: true,
      circuitBreakers: result.rows
    });
  } catch (error) {
    console.error('Error getting circuit breakers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get circuit breaker states'
    });
  }
});

module.exports = router;
