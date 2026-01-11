# Platform Ops Console - Login Setup Guide

## Overview

The Platform Ops Console now has a proper authentication system with a login page. Users must log in with valid credentials stored in the `platform_users` table.

## Quick Start

### 1. Generate a Password Hash

First, generate a bcrypt hash for your desired password:

```bash
node generate-password-hash.js yourpassword
```

This will output the bcrypt hash to use in your database.

### 2. Insert Admin User

Use the generated hash to create an admin user in the database:

```sql
INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES (
  'admin',
  'admin@example.com',
  '$2b$10$...',  -- Use the hash generated in step 1
  'PLATFORM_ADMIN',
  'active'
);
```

**Important:** The `password_hash` column must contain a bcrypt hash, not a plain text password.

### 3. Access the Console

1. Navigate to `http://localhost:3000/platform-login.html`
2. Enter your username and password
3. Click "Sign In"
4. You will be redirected to the ops console if login is successful

## Fixing Existing Plain Text Password

If you already inserted a record with plain text password (like `'asdf.'`), you need to update it:

1. Generate the hash:
```bash
node generate-password-hash.js asdf.
```

2. Update the database:
```sql
UPDATE platform_users 
SET password_hash = '$2b$10$...'  -- Use the generated hash
WHERE username = 'admin';
```

## Features

### Login Page (`/platform-login.html`)
- Clean, modern UI
- Username and password fields
- Error handling with user-friendly messages
- Automatic redirect if already logged in
- Stores authentication info in localStorage

### Authentication API
- `POST /api/ops/auth/login` - Authenticates user and returns user info
- `POST /api/ops/auth/logout` - Logs out user (optional, mainly for audit logging)

### Ops Console Updates
- Redirects to login page if not authenticated
- Shows logout button in sidebar
- Clears authentication on logout

## Security Features

1. **Password Hashing**: Uses bcrypt with 10 salt rounds
2. **Account Status Check**: Prevents login for disabled/pending accounts
3. **Role Validation**: Only PLATFORM_ADMIN and OPS_ADMIN can access
4. **Audit Logging**: Logs all login/logout events
5. **Secure Storage**: Authentication info stored in localStorage (client-side)

## User Roles

- **PLATFORM_ADMIN**: Full access to ops console
- **OPS_ADMIN**: Full access to ops console
- **FINANCE_ADMIN**: Cannot access ops console (separate console for finance)
- **MERCHANT**: Cannot access ops console

## Troubleshooting

### "Invalid username or password"
- Check that the username exists in `platform_users` table
- Verify the password hash was generated correctly
- Make sure you're using the correct password

### "Account is disabled/pending"
- Check the `status` column in `platform_users` table
- Update to 'active':
  ```sql
  UPDATE platform_users SET status = 'active' WHERE username = 'admin';
  ```

### "Access denied: Ops Console requires PLATFORM_ADMIN or OPS_ADMIN role"
- Check the `role` column in `platform_users` table
- Update to correct role:
  ```sql
  UPDATE platform_users SET role = 'PLATFORM_ADMIN' WHERE username = 'admin';
  ```

### Redirect loop or console blank
- Clear browser localStorage: Open browser console and run `localStorage.clear()`
- Try logging in again

## API Details

### POST /api/ops/auth/login

**Request:**
```json
{
  "username": "admin",
  "password": "yourpassword"
}
```

**Success Response (200):**
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

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

### POST /api/ops/auth/logout

**Request Headers:**
- `x-user-id`: User ID from localStorage
- `x-username`: Username from localStorage

**Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```
