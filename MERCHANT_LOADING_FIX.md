# Merchant Loading Fix - Compliance Admin Portal

## Problem Statement

After PR #59, the compliance admin portal fails to load with the following error:

```
http://localhost:3000/api/merchants 404 (Not Found)
Error loading merchants: Error: Endpoint not found
```

The merchants were loading successfully prior to PR #59, and the system uses merchantId as tenantId.

## Root Cause Analysis

The compliance admin portal (`public/compliance-admin-portal.html`) attempts to load merchants via the `/api/merchants` endpoint in the `loadMerchants()` function:

```javascript
async function loadMerchants() {
  const data = await apiCall('/merchants', 'GET', null, '/api');
  // ... populate dropdown with merchants
}
```

However, the `merchant-routes.js` file only had two endpoints:
- `POST /api/merchants` - Register a new merchant
- `GET /api/merchants/:id` - Get details of a specific merchant by ID

There was **no** `GET /api/merchants` endpoint to list all merchants, causing the 404 error.

## Solution Implemented

Added a new `GET /api/merchants` endpoint to `src/merchant/merchant-routes.js` that:

1. **Returns merchant list**: Queries the database for all merchants with essential fields:
   - `id` - Merchant UUID (used as tenant ID)
   - `merchant_code` - Unique merchant identifier
   - `merchant_name` - Display name
   - `status` - Current status (active, inactive, suspended)
   - `email` - Contact email

2. **Applies proper security**:
   - Requires authentication via `x-user-role` and `x-user-id` headers
   - Returns `401 Unauthorized` if authentication headers are missing
   - Only allows admin roles: `COMPLIANCE_ADMIN`, `FINANCE_ADMIN`, `PLATFORM_ADMIN`
   - Returns `403 Forbidden` for non-admin roles

3. **Returns expected format**:
   ```json
   {
     "success": true,
     "merchants": [
       {
         "id": "uuid",
         "merchant_code": "MERCHANT_001",
         "merchant_name": "Example Merchant",
         "status": "active",
         "email": "merchant@example.com"
       }
     ]
   }
   ```

4. **Orders results**: Merchants are sorted alphabetically by `merchant_name` for better UX

## Code Changes

### File: `src/merchant/merchant-routes.js`

Added the following route before the existing `GET /:id` route:

```javascript
/**
 * GET /api/merchants
 * Get list of all merchants
 * Used by admin portals to populate merchant dropdowns
 */
router.get(
  '/',
  async (req, res) => {
    try {
      // Import database here to avoid circular dependencies
      const db = require('../database');
      
      // Check if user has admin role
      const userRole = req.headers['x-user-role'];
      const userId = req.headers['x-user-id'];
      
      // Require authentication
      if (!userRole || !userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }
      
      // Only allow admin roles to list all merchants
      const allowedRoles = ['COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'];
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Admin role required to list merchants'
        });
      }
      
      // Get all merchants from database
      const merchants = await db.knex('merchants')
        .select('id', 'merchant_code', 'merchant_name', 'status', 'email')
        .orderBy('merchant_name', 'asc');
      
      res.json({
        success: true,
        merchants
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch merchants',
        message: error.message
      });
    }
  }
);
```

## Security Considerations

### Authentication & Authorization
- ✅ Requires `x-user-role` and `x-user-id` headers
- ✅ Only admin roles can access (COMPLIANCE_ADMIN, FINANCE_ADMIN, PLATFORM_ADMIN)
- ✅ Returns 401 for missing authentication
- ✅ Returns 403 for insufficient permissions

### CodeQL Analysis
- ⚠️ Alert: Missing rate limiting
- **Assessment**: Not critical for this fix
  - Endpoint requires authentication and admin access
  - Read-only operation with simple query
  - No data modification
  - Future enhancement: Add rate limiting middleware

### Data Exposure
- Only essential merchant fields are exposed
- No sensitive data like API keys or credentials
- Access restricted to platform administrators

## Testing

### Manual Testing Steps

1. Start the server:
   ```bash
   npm start
   ```

2. Test without authentication (should return 401):
   ```bash
   curl http://localhost:3000/api/merchants
   ```

3. Test with COMPLIANCE_ADMIN role (should return 200):
   ```bash
   curl -H "x-user-role: COMPLIANCE_ADMIN" \
        -H "x-user-id: test-user-id" \
        http://localhost:3000/api/merchants
   ```

4. Test with non-admin role (should return 403):
   ```bash
   curl -H "x-user-role: MERCHANT" \
        -H "x-user-id: test-user-id" \
        http://localhost:3000/api/merchants
   ```

5. Access compliance admin portal:
   ```
   http://localhost:3000/compliance-admin-portal.html
   ```
   - Login with compliance admin credentials
   - Verify merchant dropdown populates correctly
   - Verify no 404 errors in console

### Automated Test

A test script is available at `test-merchants-list-api.js` (excluded from git via .gitignore):

```bash
# Start server first
npm start

# In another terminal, run the test
node test-merchants-list-api.js
```

## Impact

### Before Fix
- ❌ Compliance admin portal fails to load
- ❌ Console shows 404 error for `/api/merchants`
- ❌ Merchant dropdown remains empty
- ❌ Portal is unusable

### After Fix
- ✅ Compliance admin portal loads successfully
- ✅ Merchant dropdown populates with all merchants
- ✅ Proper authentication and authorization enforced
- ✅ Merchants can be selected for compliance operations

## Related Files

- `src/merchant/merchant-routes.js` - Added new endpoint
- `public/compliance-admin-portal.html` - Consumer of the endpoint
- `src/api/routes.js` - Routes mounting configuration
- `src/index.js` - Main server entry point

## Future Enhancements

1. **Rate Limiting**: Add express-rate-limit middleware to prevent abuse
2. **Caching**: Cache merchant list to reduce database queries
3. **Pagination**: Add pagination support for large merchant counts
4. **Filtering**: Add query parameters for status, search, etc.
5. **Audit Logging**: Log merchant list access attempts

## Deployment Notes

- No database migrations required
- No environment variable changes needed
- Backward compatible - does not affect existing endpoints
- Safe to deploy to production

## Rollback Plan

If issues arise, revert commits:
- db50b3e - Simplify merchants response object property
- 873afcc - Fix security vulnerability in merchants list endpoint
- 94fc090 - Add GET /api/merchants endpoint to fix merchant loading error

## Conclusion

This fix resolves the critical issue preventing the compliance admin portal from loading by adding the missing `/api/merchants` endpoint with proper authentication and authorization. The implementation follows security best practices and maintains consistency with the existing codebase.
