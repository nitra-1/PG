/**
 * User Management Routes - Platform Ops Console
 * 
 * CRITICAL SECURITY RULES:
 * 1. No self-role escalation
 * 2. Finance roles (FINANCE_ADMIN) cannot be assigned here
 * 3. Dual confirmation required for PLATFORM_ADMIN role assignment
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const bcrypt = require('bcrypt');
const { requireOpsConsoleAccess, logOpsAction } = require('./ops-console-middleware');

/**
 * GET /api/ops/users
 * List platform users
 */
router.get('/', requireOpsConsoleAccess, logOpsAction('LIST_USERS'), async (req, res) => {
  try {
    const { role, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, username, email, role, status, last_login_at, created_at 
      FROM platform_users 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (role) {
      query += ` AND role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list users'
    });
  }
});

/**
 * POST /api/ops/users
 * Create new platform user
 */
router.post('/', requireOpsConsoleAccess, logOpsAction('CREATE_USER'), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    if (!username || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Username, email, password, and role are required'
      });
    }
    
    // RULE 2: Finance roles blocked in Ops Console
    if (role === 'FINANCE_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Cannot assign finance roles',
        message: 'Finance roles can only be assigned by system administrators through secure channels'
      });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      `INSERT INTO platform_users (username, email, password_hash, role, status, created_by) 
       VALUES ($1, $2, $3, $4, 'active', $5) 
       RETURNING id, username, email, role, status, created_at`,
      [username, email, passwordHash, role, req.opsUser.userId]
    );
    
    res.json({
      success: true,
      user: result.rows[0],
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        error: 'Username or email already exists'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * PUT /api/ops/users/:id/role
 * Update user role with security checks
 */
router.put('/:id/role', requireOpsConsoleAccess, logOpsAction('UPDATE_USER_ROLE'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    // RULE 1: Prevent self-role escalation
    if (id === req.opsUser.userId) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify your own role',
        message: 'Self-role escalation is not allowed for security reasons'
      });
    }
    
    // RULE 2: Finance roles blocked in Ops Console
    if (role === 'FINANCE_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Cannot assign finance roles',
        message: 'Finance roles can only be assigned by system administrators through secure channels'
      });
    }
    
    // Get current user info
    const userResult = await db.query(
      'SELECT id, username, role FROM platform_users WHERE id = $1',
      [id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    
    // RULE 3: Dual confirmation for PLATFORM_ADMIN
    if (role === 'PLATFORM_ADMIN') {
      // Create approval request
      const approvalResult = await db.query(
        `INSERT INTO approval_requests (request_type, requestor_id, request_data, status) 
         VALUES ('role_assignment', $1, $2, 'pending') 
         RETURNING id`,
        [
          req.opsUser.userId,
          JSON.stringify({ userId: id, role, currentRole: user.role })
        ]
      );
      
      return res.json({
        success: true,
        message: 'Role assignment requires dual approval',
        approvalRequestId: approvalResult.rows[0].id,
        note: 'Another PLATFORM_ADMIN must approve this request'
      });
    }
    
    // Proceed with role assignment for OPS_ADMIN and MERCHANT
    const result = await db.query(
      `UPDATE platform_users SET role = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, username, email, role`,
      [role, id]
    );
    
    res.json({
      success: true,
      user: result.rows[0],
      message: 'User role updated successfully'
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user role'
    });
  }
});

/**
 * PUT /api/ops/users/:id/status
 * Update user status (activate/disable)
 */
router.put('/:id/status', requireOpsConsoleAccess, logOpsAction('UPDATE_USER_STATUS'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be active or disabled'
      });
    }
    
    // Prevent self-disable
    if (id === req.opsUser.userId) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify your own status',
        message: 'Self-disable is not allowed for security reasons'
      });
    }
    
    const result = await db.query(
      `UPDATE platform_users SET status = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, username, email, role, status`,
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: result.rows[0],
      message: `User ${status === 'active' ? 'activated' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    });
  }
});

module.exports = router;
