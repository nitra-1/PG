/**
 * Platform Ops Console - Authentication Routes
 * Handles login/logout for platform users
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

/**
 * POST /api/ops/auth/login
 * Authenticate platform user and return user info
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }
    
    const db = require('../database');
    
    // Get user from database
    const result = await db.query(
      `SELECT id, username, email, password_hash, role, status, last_login_at
       FROM platform_users 
       WHERE username = $1`,
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }
    
    const user = result.rows[0];
    
    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: `Account is ${user.status}. Please contact administrator.`
      });
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }
    
    // Update last login time
    await db.query(
      'UPDATE platform_users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );
    
    // Log successful login via audit trail if available
    const auditTrailService = req.app.locals.auditTrailService;
    if (auditTrailService) {
      auditTrailService.logSecurityEvent({
        eventSubType: 'USER_LOGIN',
        severity: 'INFO',
        userId: user.id,
        description: `Platform user ${username} logged in successfully`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }).catch(err => {
        console.error('Failed to log login event:', err);
      });
    }
    
    // Return user info (exclude password_hash)
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLoginAt: user.last_login_at
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

/**
 * POST /api/ops/auth/logout
 * Logout (client-side mainly, but logs the event)
 */
router.post('/logout', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-username'];
    
    // Log logout event if user info available
    if (userId) {
      const auditTrailService = req.app.locals.auditTrailService;
      if (auditTrailService) {
        auditTrailService.logSecurityEvent({
          eventSubType: 'USER_LOGOUT',
          severity: 'INFO',
          userId: userId,
          description: `Platform user ${username || userId} logged out`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }).catch(err => {
          console.error('Failed to log logout event:', err);
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

module.exports = router;
