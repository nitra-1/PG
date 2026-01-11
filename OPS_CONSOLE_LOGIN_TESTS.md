/**
 * Manual Test Plan for Ops Console Login
 * 
 * This document provides a comprehensive test plan for the login functionality
 * Run these tests after setting up the database with the proper schema
 */

## Prerequisites

1. Database should be running with PostgreSQL
2. Run migrations to create the platform_users table:
   ```bash
   npm run migrate:latest
   ```

3. Generate a password hash:
   ```bash
   node generate-password-hash.js "yourpassword"
   ```

4. Insert an admin user with the generated hash:
   ```sql
   INSERT INTO platform_users (username, email, password_hash, role, status)
   VALUES (
     'admin',
     'admin@example.com',
     '$2b$10$...',  -- Use the generated hash
     'PLATFORM_ADMIN',
     'active'
   );
   ```

## Test Cases

### Test 1: Login Page Access
**Steps:**
1. Start the server: `npm start`
2. Navigate to `http://localhost:3000/platform-login.html`

**Expected Results:**
- Login page loads successfully
- Shows "Platform Login" title
- Shows "Ops Console Access" subtitle
- Username and password fields are visible
- "Sign In" button is present
- Info box explains this is for PLATFORM_ADMIN or OPS_ADMIN

### Test 2: Successful Login with PLATFORM_ADMIN
**Steps:**
1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter username: `admin`
3. Enter password: (the password you used to generate the hash)
4. Click "Sign In"

**Expected Results:**
- Button text changes to "Signing in..." with spinner
- No error message is shown
- Redirected to `http://localhost:3000/ops-console.html`
- Role indicator in sidebar shows "PLATFORM_ADMIN"
- Dashboard loads with statistics
- Logout button is visible in sidebar

### Test 3: Login with Incorrect Password
**Steps:**
1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter username: `admin`
3. Enter password: `wrongpassword`
4. Click "Sign In"

**Expected Results:**
- Error message appears: "Invalid username or password"
- User remains on login page
- Username field retains the entered value
- Button returns to "Sign In" after error

### Test 4: Login with Non-existent User
**Steps:**
1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter username: `nonexistent`
3. Enter password: `anypassword`
4. Click "Sign In"

**Expected Results:**
- Error message appears: "Invalid username or password"
- User remains on login page
- Button returns to "Sign In" after error

### Test 5: Login with Disabled Account
**Preparation:**
```sql
UPDATE platform_users SET status = 'disabled' WHERE username = 'admin';
```

**Steps:**
1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter username: `admin`
3. Enter correct password
4. Click "Sign In"

**Expected Results:**
- Error message appears: "Account is disabled. Please contact administrator."
- User remains on login page

**Cleanup:**
```sql
UPDATE platform_users SET status = 'active' WHERE username = 'admin';
```

### Test 6: Login with MERCHANT Role (Access Denied)
**Preparation:**
```sql
INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES (
  'merchant1',
  'merchant@example.com',
  '$2b$10$...',  -- Use a generated hash
  'MERCHANT',
  'active'
);
```

**Steps:**
1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter username: `merchant1`
3. Enter correct password
4. Click "Sign In"

**Expected Results:**
- Login succeeds (API returns success)
- User is redirected to ops-console.html
- Immediately redirected back to login page with alert
- Alert message: "Access denied: Ops Console requires PLATFORM_ADMIN or OPS_ADMIN role"
- localStorage is cleared

### Test 7: Logout Functionality
**Steps:**
1. Login successfully as admin
2. Navigate to ops-console.html
3. Click the "🚪 Logout" button in the sidebar
4. Confirm the logout dialog

**Expected Results:**
- Confirmation dialog appears: "Are you sure you want to log out?"
- After confirming, redirected to login page
- localStorage is cleared (verify in browser dev tools)
- Attempting to access ops-console.html directly redirects to login

### Test 8: Direct Access to Ops Console (Not Logged In)
**Steps:**
1. Clear browser localStorage (Console: `localStorage.clear()`)
2. Navigate directly to `http://localhost:3000/ops-console.html`

**Expected Results:**
- Immediately redirected to `http://localhost:3000/platform-login.html`
- No console content is shown

### Test 9: Session Persistence
**Steps:**
1. Login successfully as admin
2. Refresh the ops-console page
3. Navigate away and back to ops-console

**Expected Results:**
- User remains logged in after refresh
- No redirect to login page
- Role indicator and username remain visible
- Dashboard data loads correctly

### Test 10: Already Logged In Access to Login Page
**Steps:**
1. Login successfully as admin
2. Navigate to `http://localhost:3000/platform-login.html`

**Expected Results:**
- Immediately redirected to `http://localhost:3000/ops-console.html`
- Login form is not shown
- User remains logged in

### Test 11: API Endpoint - Login Success
**Using curl or Postman:**
```bash
curl -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
```

**Expected Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@example.com",
    "role": "PLATFORM_ADMIN",
    "lastLoginAt": "2024-01-07T10:00:00Z"
  }
}
```

### Test 12: API Endpoint - Login Failure
```bash
curl -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrongpassword"}'
```

**Expected Response (401):**
```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

### Test 13: API Endpoint - Missing Credentials
```bash
curl -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin"}'
```

**Expected Response (400):**
```json
{
  "success": false,
  "error": "Username and password are required"
}
```

### Test 14: Audit Trail Logging
**Steps:**
1. Login successfully
2. Check the database for audit trail entries

**SQL Query:**
```sql
SELECT * FROM audit_trail 
WHERE event_type = 'SECURITY_EVENT' 
  AND event_sub_type IN ('USER_LOGIN', 'USER_LOGOUT')
ORDER BY created_at DESC 
LIMIT 10;
```

**Expected Results:**
- USER_LOGIN event is logged with:
  - User ID
  - Username in description
  - IP address
  - User agent
  - Timestamp

### Test 15: Last Login Timestamp Update
**Steps:**
1. Check user's last_login_at before login:
   ```sql
   SELECT last_login_at FROM platform_users WHERE username = 'admin';
   ```
2. Login successfully
3. Check user's last_login_at after login:
   ```sql
   SELECT last_login_at FROM platform_users WHERE username = 'admin';
   ```

**Expected Results:**
- last_login_at is updated to current timestamp after login

## Security Verification

### Verify Password Hashing
**Check:**
- Password hashes in database start with `$2b$10$`
- Password hashes are 60 characters long
- Plain text passwords are never stored

**SQL Query:**
```sql
SELECT username, 
       LENGTH(password_hash) as hash_length,
       LEFT(password_hash, 10) as hash_prefix
FROM platform_users;
```

**Expected:**
- hash_length: 60
- hash_prefix: $2b$10$...

### Verify Auth Routes Are Not Protected
**Test:**
- Login endpoint should work without authentication headers
- Other ops console endpoints should still require authentication

```bash
# Should work (no auth needed)
curl -X POST http://localhost:3000/api/ops/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'

# Should fail without auth headers
curl -X GET http://localhost:3000/api/ops/dashboard
```

## Browser Compatibility Testing

Test the login page and console in:
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge

## Performance Testing

1. **Login Response Time:**
   - Should complete within 2 seconds under normal conditions
   
2. **Concurrent Logins:**
   - Multiple users should be able to log in simultaneously
   
3. **Database Query Performance:**
   - Login query should use index on username column
   - Verify with EXPLAIN:
     ```sql
     EXPLAIN ANALYZE
     SELECT id, username, email, password_hash, role, status, last_login_at
     FROM platform_users 
     WHERE username = 'admin';
     ```

## Regression Testing

After implementation, verify existing functionality still works:
- [ ] Ops console dashboard loads correctly when authenticated
- [ ] Merchant management functions work
- [ ] Transaction monitoring works (read-only)
- [ ] Gateway health monitoring works
- [ ] User management functions work
- [ ] System config management works
- [ ] Finance operations are still blocked (returns 403)

## Notes

- All tests should be run in a clean browser session or incognito mode
- Clear localStorage between test scenarios when needed
- Check browser console for JavaScript errors
- Check server logs for backend errors
- Verify audit trail entries are created for security events
