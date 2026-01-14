# Ledger Explorer Quick Debug Guide

**Quick reference for debugging "no data" issues in Ledger Explorer**

📖 **Full Documentation**: See `LEDGER_EXPLORER_FLOW_DOCUMENTATION.md` for complete details

---

## 🚨 Most Common Issue: No Tenant Selected

**Symptom**: Table shows "Please select a merchant/tenant"

**Quick Fix**:
1. Look at the merchant selector dropdown (top of sidebar)
2. Select a merchant
3. Click Search again

**Browser Console Check**:
```javascript
console.log('Current Tenant ID:', currentTenantId);
```

---

## 🔍 Quick Debugging Checklist

Run through these checks in order:

### 1️⃣ Is a merchant/tenant selected?
```javascript
// In browser console
console.log('Tenant:', currentTenantId);
```
- ❌ If `null` or `undefined` → Select merchant from dropdown
- ✅ If UUID → Continue to next check

### 2️⃣ Check Network Request
1. Open DevTools (F12)
2. Go to Network tab
3. Click Search button
4. Find request to `/ledger/transactions`
5. Check:
   - ✅ Status: 200
   - ✅ Response has `success: true`
   - ✅ `data.transactions` is an array

### 3️⃣ Check if Data Exists in Database
```sql
-- Connect to database and run:
SELECT COUNT(*) 
FROM ledger_transactions 
WHERE tenant_id = 'YOUR-TENANT-UUID-HERE';
```
- If count = 0 → No transactions recorded (see #4)
- If count > 0 → API or UI issue (see #5)

### 4️⃣ No Transactions? Process a Test Payment
1. Make a test payment as a customer
2. Check if `handlePaymentSuccess()` is called
3. Verify ledger entries created:
```sql
SELECT * FROM ledger_transactions 
ORDER BY created_at DESC 
LIMIT 5;
```

### 5️⃣ Check API Response
In browser console, after clicking Search:
```javascript
// Look for the API call output
// Should see: { success: true, data: { transactions: [...] } }
```

### 6️⃣ Check Authentication
```javascript
// In browser console
console.log('User Role:', window.currentUser?.role);
console.log('User ID:', window.currentUser?.userId);
```
- Role must be: `FINANCE_ADMIN` or `COMPLIANCE_ADMIN`
- If not → Login with correct role

---

## 🔧 Quick Fixes

### Fix: Merchant selector shows "No merchants available"
```sql
-- Check if merchants exist
SELECT id, merchant_name FROM merchants LIMIT 5;
```
- If empty → Create merchants first
- If has data → Check API endpoint `/api/finance-admin/merchants`

### Fix: Date filters not working
- Clear date filters (leave empty)
- Try searching without filters first
- Check date format is YYYY-MM-DD

### Fix: Event type filter not working
- Select "All" from event type dropdown
- Valid types: `payment_success`, `refund_completed`, `settlement`, etc.

### Fix: Authentication errors
1. Logout (button in sidebar)
2. Clear browser localStorage: `localStorage.clear()`
3. Login again as FINANCE_ADMIN

---

## 📊 Verify Ledger Recording

After a payment, check if ledger was created:

```sql
-- Get latest transaction with entries
SELECT 
  lt.transaction_ref,
  lt.event_type,
  lt.amount,
  COUNT(le.id) as entry_count
FROM ledger_transactions lt
LEFT JOIN ledger_entries le ON lt.id = le.transaction_id
GROUP BY lt.id, lt.transaction_ref, lt.event_type, lt.amount
ORDER BY lt.created_at DESC
LIMIT 1;
```

Expected for a payment:
- `event_type`: `payment_success`
- `entry_count`: 4 to 8 (depends on fees)

---

## 🎯 Testing the Complete Flow

### End-to-End Test

1. **Make a test payment**
   ```
   Amount: ₹1000
   Platform Fee: ₹20
   Gateway Fee: ₹10
   ```

2. **Check ledger creation**
   ```sql
   SELECT * FROM ledger_transactions 
   WHERE event_type = 'payment_success' 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

3. **Login to Finance Admin Console**
   - Role: FINANCE_ADMIN
   - URL: `/finance-admin-console.html`

4. **Select merchant**
   - Choose from dropdown

5. **Go to Ledger Explorer**
   - Click "📖 Ledger Explorer"

6. **Search**
   - Click "Search" button
   - Should see the payment transaction

7. **Verify data displayed**
   - Transaction Ref: `PAY-ORDER...`
   - Event Type: `payment_success`
   - Amount: ₹1000

---

## 🐛 Common Error Messages

### "tenantId is required"
→ No merchant selected. Select from dropdown.

### "tenantId must be a valid UUID"
→ Invalid tenant ID. Check merchant data in database.

### "Authentication required"
→ Not logged in. Go to `/platform-login.html`

### "Forbidden: FINANCE_ADMIN or COMPLIANCE_ADMIN role required"
→ Wrong role. Login with correct role.

### "No transactions found for the selected filters"
→ Either no data exists OR filters too restrictive. Try without filters.

---

## 📞 Need More Help?

See full documentation: `LEDGER_EXPLORER_FLOW_DOCUMENTATION.md`

### Key Sections:
- **Section 1**: Complete flow diagram
- **Section 4**: Search button click flow
- **Section 7**: Detailed debugging (6+ issues)
- **Section 9**: Testing checklist
- **Appendix B**: Sample SQL queries

---

## ⚡ One-Command Checks

### Check if ledger system is working
```sql
-- Should return > 0
SELECT COUNT(*) FROM ledger_transactions;
```

### Check if specific tenant has data
```sql
-- Replace with your tenant UUID
SELECT COUNT(*) 
FROM ledger_transactions 
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';
```

### Check if entries are balanced
```sql
-- Should return 0 rows (all balanced)
SELECT 
  transaction_id,
  SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
FROM ledger_entries
GROUP BY transaction_id
HAVING ABS(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END)) > 0.01;
```

### Check merchant list
```sql
SELECT id, merchant_name, merchant_code, status 
FROM merchants 
WHERE status = 'active';
```

---

**Last Updated**: 2024-01-14  
**Version**: 1.0
