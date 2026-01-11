# Finance Admin TenantId UUID Error - Fix Guide

## Problem Description

When logging in as a FINANCE_ADMIN user, you encountered the error:
```
Error: tenantId must be a valid UUID
```

## Root Cause

The Finance Admin Console had a hardcoded tenant ID value of `'default'`, which is not a valid UUID. The backend API requires all tenantId parameters to be valid UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

## Solution Implemented

We've added a **Merchant/Tenant Selector** to the Finance Admin Console that allows FINANCE_ADMIN users to select which merchant they want to view financial data for.

## What Changed

### 1. New Merchant Selector Dropdown
- Located in the left sidebar of the Finance Admin Console
- Shows all available merchants with their names and codes
- Automatically remembers your last selected merchant

### 2. Smart Auto-Selection
- If only one merchant exists, it's automatically selected
- Previously selected merchant is restored when you log back in
- Clear messaging when no merchant is selected

### 3. All Operations Now Use Valid UUID
- Dashboard, Accounting Periods, Settlements, Locks, etc.
- All report generation functions
- All API calls now use proper merchant UUID

## How to Use

1. **Login** to the platform as FINANCE_ADMIN at `/platform-login.html`
2. You'll be redirected to the Finance Admin Console
3. **Select a Merchant** from the dropdown in the left sidebar
4. All dashboard data will load automatically for the selected merchant
5. You can switch between merchants anytime by selecting a different one

## First-Time Setup

If you're setting up the system for the first time, ensure you have at least one merchant in the database:

```sql
-- Check existing merchants
SELECT id, merchant_code, merchant_name, status FROM merchants;

-- If no merchants exist, create one:
INSERT INTO merchants (merchant_code, merchant_name, email, status)
VALUES ('MERCH001', 'Test Merchant', 'merchant@example.com', 'active');
```

## Technical Details

### Backend Changes
- **New Endpoint**: `GET /api/finance-admin/merchants`
  - Returns list of all merchants
  - Requires FINANCE_ADMIN or COMPLIANCE_ADMIN role
  - Returns: `{ success: true, merchants: [...] }`

### Frontend Changes
- **Removed**: `const TENANT_ID = 'default'`
- **Added**: `let currentTenantId = null` (dynamic)
- **New Functions**:
  - `loadMerchants()` - Fetches merchant list
  - `onMerchantChange()` - Handles selection
  - `requireTenant()` - Validates selection before operations

### Storage
- Selected merchant ID is stored in `localStorage` as `selectedTenantId`
- Persists across page refreshes and logins
- Cleared on logout

## Troubleshooting

### No Merchants Available
**Problem**: Dropdown shows "No merchants available"
**Solution**: Add merchants to the database using the SQL above

### Error Still Occurs
**Problem**: Still getting UUID error after update
**Solution**: 
1. Clear your browser cache and localStorage
2. Refresh the page (Ctrl+F5 or Cmd+Shift+R)
3. Login again
4. Select a merchant from the dropdown

### Merchant Dropdown Not Showing
**Problem**: Dropdown not visible in sidebar
**Solution**: 
1. Ensure you're logged in as FINANCE_ADMIN or COMPLIANCE_ADMIN
2. Check browser console for errors
3. Verify the server is running

## Verification

To verify the fix is working:

1. Open browser developer tools (F12)
2. Go to Console tab
3. Login as FINANCE_ADMIN
4. You should see:
   - Merchant dropdown populated
   - No UUID validation errors
   - Dashboard loads successfully after selecting merchant

## API Testing

Test the merchants endpoint directly:

```bash
# Get list of merchants
curl -X GET http://localhost:3000/api/finance-admin/merchants \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: YOUR_USER_UUID" \
  -H "x-user-email: finance@example.com"

# Expected response:
{
  "success": true,
  "merchants": [
    {
      "id": "uuid-here",
      "merchant_code": "MERCH001",
      "merchant_name": "Test Merchant",
      "status": "active",
      "email": "merchant@example.com"
    }
  ]
}
```

## Summary

The fix ensures that:
- ✅ No more hardcoded 'default' tenant ID
- ✅ All operations use valid UUIDs
- ✅ FINANCE_ADMIN can view data for any merchant
- ✅ User-friendly merchant selection
- ✅ Persistent selection across sessions
- ✅ Proper validation and error messages

## Support

If you encounter any issues:
1. Check that merchants exist in the database
2. Verify user has FINANCE_ADMIN role
3. Clear browser cache and localStorage
4. Check server logs for errors
5. Ensure all migrations are up to date: `npm run migrate:latest`
