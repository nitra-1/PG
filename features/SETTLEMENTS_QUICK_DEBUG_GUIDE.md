# Settlements Quick Debug Guide

## 🚨 Settlements Not Showing on Screen?

Follow this quick troubleshooting checklist to diagnose the issue.

---

## ⚡ Quick Checks (2 Minutes)

### 1. Browser Console Check
```javascript
// Open DevTools (F12) → Console tab
console.log('User:', window.currentUser);
console.log('Tenant ID:', currentTenantId);
```

**Expected:**
- `currentUser.role` should be `'FINANCE_ADMIN'` or `'COMPLIANCE_ADMIN'`
- `currentTenantId` should be a valid UUID

**If Missing:** Login again or select correct tenant

---

### 2. Network Tab Check

**Steps:**
1. Open DevTools (F12) → Network tab
2. Click "Search" button on settlements screen
3. Look for request to `/api/finance-admin/settlements`

**Check Status:**
- ✅ `200 OK` → API working, check response
- ❌ `400 Bad Request` → Check tenant ID
- ❌ `401 Unauthorized` → Not logged in
- ❌ `403 Forbidden` → Wrong role
- ❌ `404 Not Found` → Route not registered
- ❌ `500 Internal Server Error` → Check server logs

---

### 3. API Response Check

In Network tab, click the settlements request → Response tab

**If `success: true` with empty data:**
```json
{
  "success": true,
  "data": []
}
```
→ No settlements exist, check database (Step 4)

**If error:**
```json
{
  "success": false,
  "error": "tenantId is required"
}
```
→ Tenant ID not provided, check JavaScript

---

## 🔍 Database Checks (5 Minutes)

### 4. Check if Settlements Exist

```sql
-- Connect to PostgreSQL
psql -U postgres -d payment_gateway

-- Check settlements
SELECT 
  id, 
  settlement_ref, 
  merchant_id, 
  net_amount, 
  status, 
  created_at 
FROM settlements 
WHERE tenant_id = 'YOUR-TENANT-UUID-HERE'
ORDER BY created_at DESC 
LIMIT 10;
```

**If No Results:**
- Settlements were never created
- Wrong tenant ID
→ Go to Step 5

**If Results Found:**
- Settlements exist but not displaying
→ Go back to Steps 1-3

---

### 5. Check if Payments Were Recorded

```sql
-- Check recent payments
SELECT 
  id,
  transaction_ref,
  event_type,
  amount,
  created_at
FROM ledger_transactions
WHERE tenant_id = 'YOUR-TENANT-UUID-HERE'
  AND event_type = 'payment'
ORDER BY created_at DESC
LIMIT 10;
```

**If No Results:**
- Payments not recorded in ledger
- Payment gateway issue
→ Check payment processing logs

**If Results Found:**
- Payments recorded but settlements not created
→ Check settlement creation process

---

## 🛠️ Common Fixes

### Fix 1: Wrong Tenant ID

**Problem:** Using wrong tenant ID

**Solution:**
```javascript
// In browser console
localStorage.setItem('selectedTenantId', 'correct-tenant-uuid');
location.reload();
```

---

### Fix 2: Status Filter Too Restrictive

**Problem:** Filter showing only specific status

**Solution:**
1. Change dropdown to "All"
2. Click "Search" again

---

### Fix 3: Not Logged In / Wrong Role

**Problem:** Authentication expired or wrong role

**Solution:**
1. Logout and login again
2. Ensure logging in as Finance Admin
3. Check role in database:

```sql
SELECT username, email, role 
FROM platform_users 
WHERE email = 'your-email@example.com';
```

---

### Fix 4: Create Test Settlement Manually

**Problem:** No settlements exist

**Solution:** Create a test settlement via API

```bash
curl -X POST http://localhost:3000/api/finance-admin/settlements \
  -H "Content-Type: application/json" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: test-user" \
  -H "x-user-email: admin@test.com" \
  -d '{
    "tenantId": "your-tenant-uuid",
    "merchantId": "your-merchant-uuid",
    "settlementRef": "SETL-TEST-001",
    "netAmount": 1000.00,
    "grossAmount": 1100.00,
    "feesAmount": 100.00,
    "bankAccountNumber": "1234567890",
    "bankIfsc": "HDFC0001234",
    "bankName": "HDFC Bank"
  }'
```

---

## 📊 Quick SQL Queries

### Get All Tenants
```sql
SELECT id, name FROM tenants ORDER BY name;
```

### Get All Merchants for a Tenant
```sql
SELECT id, merchant_name, merchant_code 
FROM merchants 
WHERE id = 'YOUR-TENANT-UUID'
ORDER BY merchant_name;
```

### Get Settlement Counts by Status
```sql
SELECT status, COUNT(*), SUM(net_amount) 
FROM settlements 
WHERE tenant_id = 'YOUR-TENANT-UUID'
GROUP BY status;
```

### Get Recent Activity
```sql
SELECT 
  'payment' as type,
  transaction_ref as ref,
  amount,
  created_at
FROM ledger_transactions
WHERE tenant_id = 'YOUR-TENANT-UUID'
  AND event_type = 'payment'
  AND created_at > NOW() - INTERVAL '7 days'

UNION ALL

SELECT 
  'settlement' as type,
  settlement_ref as ref,
  net_amount as amount,
  created_at
FROM settlements
WHERE tenant_id = 'YOUR-TENANT-UUID'
  AND created_at > NOW() - INTERVAL '7 days'

ORDER BY created_at DESC
LIMIT 20;
```

---

## 🎯 Decision Tree

```
Settlements not showing?
│
├─ Can you see the settlements table? 
│  │
│  ├─ NO → JavaScript error
│  │       → Check browser console for errors
│  │       → Check if page loaded correctly
│  │
│  └─ YES → Table shows but no data?
│           │
│           ├─ "Loading..." message stuck?
│           │   → API call failed
│           │   → Check Network tab
│           │
│           └─ "No settlements found" message?
│               → Check database (settlements exist?)
│
├─ Network request shows 200 OK with data?
│  │
│  ├─ YES → JavaScript not rendering
│  │       → Check settlementsTableBody element exists
│  │       → Check browser console for JavaScript errors
│  │
│  └─ NO → API error
│          → Check response status code
│          → Check error message in response
│
└─ Database has settlements?
   │
   ├─ NO → Settlements never created
   │       → Check payment processing
   │       → Create test settlement manually
   │
   └─ YES → Wrong tenant ID or filter
           → Verify tenant ID matches
           → Try "All" status filter
```

---

## 🔧 Server-Side Debugging

### Check Server Logs

```bash
# If using PM2
pm2 logs

# If using Docker
docker logs payment-gateway-container

# If using systemd
journalctl -u payment-gateway -f

# Look for:
# - "Error fetching settlements"
# - "Error loading settlements"
# - Any 500 errors
```

### Test API Endpoint Directly

```bash
# Test settlements endpoint
curl -X GET "http://localhost:3000/api/finance-admin/settlements?tenantId=test-tenant" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: test-user" \
  -v

# Should return 200 OK with JSON response
```

### Check Route Registration

```bash
# Check if server started successfully
grep "Settlement routes mounted" logs/app.log

# Check if finance-admin routes loaded
grep "Finance admin routes" logs/app.log
```

---

## 📝 Key File Locations

When debugging code issues:

### Frontend
- **Main File:** `/public/finance-admin-console.html`
- **Load Function:** Line 1183 `async function loadSettlements()`
- **Table Element:** `<tbody id="settlementsTableBody">`

### Backend
- **Main Routes:** `src/api/routes.js` Line 824-825
- **Finance Routes:** `src/api/finance-admin-routes.js` Line 161-162
- **Settlement Routes:** `src/api/settlement-routes.js` Line 32-61
- **Settlement Service:** `src/core/ledger/settlement-service.js` Line 492-505

### Database
- **Table:** `settlements`
- **Related:** `ledger_transactions`, `ledger_entries`, `merchants`

---

## 💡 Pro Tips

1. **Always check browser console first** - Most issues show errors here
2. **Use "All" status filter** when debugging - Don't restrict by status initially
3. **Verify tenant ID** - Most common issue is wrong/missing tenant ID
4. **Check role** - Only FINANCE_ADMIN and COMPLIANCE_ADMIN can view
5. **Test with curl** - Bypass frontend to test API directly
6. **Check database directly** - Confirms if data exists

---

## 🆘 Still Not Working?

If settlements still don't show after trying everything:

1. **Clear browser cache:** Ctrl+Shift+Del → Clear all
2. **Hard refresh:** Ctrl+Shift+R
3. **Try incognito/private mode:** Rules out extension issues
4. **Check different browser:** Chrome vs Firefox
5. **Restart server:** `pm2 restart all` or restart Docker container
6. **Check database connection:** `SELECT NOW();` in psql
7. **Review complete documentation:** See `SETTLEMENTS_LIFECYCLE_DOCUMENTATION.md`

---

## 📚 For Complete Details

See the comprehensive documentation:
- **File:** `features/SETTLEMENTS_LIFECYCLE_DOCUMENTATION.md`
- **Covers:** Complete lifecycle, all actors, detailed debugging, code samples

---

**Last Updated:** 2026-01-14
