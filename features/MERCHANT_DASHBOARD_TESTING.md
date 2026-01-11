# Merchant Dashboard - Manual Testing Checklist

## Prerequisites

Before testing, ensure:
1. ✅ Database migration has been run: `npm run migrate:latest`
2. ✅ Server is running: `npm start`
3. ✅ You have a valid merchant ID (UUID format)
4. ✅ Test data exists in database (transactions, settlements, etc.)

## Test Environment Setup

### Create Test Merchant (if needed):
```bash
# Use the merchant onboarding API or insert directly into database
POST /api/merchants
{
  "merchantName": "Test Merchant",
  "merchantCode": "TEST001",
  "email": "test@merchant.com",
  "phone": "1234567890"
}
```

### Access Dashboard:
```
http://localhost:3000/merchant-dashboard.html?merchantId=<your-merchant-uuid>
```

---

## Test Cases

### 1. Overview Tab ✅

**Test 1.1: Page Load**
- [ ] Dashboard loads without errors
- [ ] Merchant information displays correctly
- [ ] Statistics cards show data (or 0 if no data)
- [ ] Quick action buttons are visible

**Test 1.2: Statistics Validation**
- [ ] Total Requests shows a number
- [ ] Total Transactions shows a number
- [ ] Total Amount shows currency format (₹)
- [ ] Success Rate shows percentage

**Expected Result**: All merchant info and stats display correctly

---

### 2. Transactions Tab 💳

**Test 2.1: Transaction Listing**
- [ ] Click "Transactions" tab
- [ ] Table loads with transactions (or shows "No transactions found")
- [ ] All columns display: Order ID, Amount, Status, Payment Method, Gateway, Customer, Date, Actions

**Test 2.2: Status Filter**
- [ ] Select "Success" from status dropdown
- [ ] Click "Filter" button
- [ ] Only successful transactions shown
- [ ] Try other statuses (Pending, Failed, Refunded)

**Test 2.3: Date Range Filter**
- [ ] Set start date (e.g., 30 days ago)
- [ ] Set end date (today)
- [ ] Click "Filter" button
- [ ] Only transactions within date range shown

**Test 2.4: View Transaction Details**
- [ ] Click "View" button on any transaction
- [ ] Alert/modal shows transaction details
- [ ] Details include: Order ID, Amount, Status, Payment Method, Gateway, Customer, Date

**Test 2.5: Quick Refund**
- [ ] For a successful transaction, "Refund" button should appear
- [ ] Click "Refund" button
- [ ] Should navigate to Refunds tab
- [ ] Refund form should pre-fill with transaction ID and amount

**Expected Result**: Transaction listing, filtering, and viewing work correctly

---

### 3. Refunds Tab ↩️

**Test 3.1: Refund Listing**
- [ ] Click "Refunds" tab
- [ ] Table shows existing refunds (or "No refunds found")
- [ ] Columns: Refund Ref, Order ID, Amount, Type, Status, Initiated, Completed, Actions

**Test 3.2: Initiate Full Refund**
- [ ] Click "+ Initiate Refund" button
- [ ] Form appears
- [ ] Enter valid transaction ID
- [ ] Enter full transaction amount
- [ ] Enter reason: "Customer request"
- [ ] Click "Initiate Refund"
- [ ] Success message appears
- [ ] Refund appears in list with "initiated" status

**Test 3.3: Initiate Partial Refund**
- [ ] Click "+ Initiate Refund" button
- [ ] Enter valid transaction ID
- [ ] Enter partial amount (less than transaction amount)
- [ ] Enter reason: "Partial return"
- [ ] Click "Initiate Refund"
- [ ] Success message appears
- [ ] Refund type should be "partial"

**Test 3.4: Refund Validation - Amount Exceeds Transaction**
- [ ] Try to refund more than transaction amount
- [ ] Error message should appear
- [ ] Refund should NOT be created

**Test 3.5: Refund Validation - Over-refunding**
- [ ] For a partially refunded transaction
- [ ] Try to refund more than remaining amount
- [ ] Error message should appear indicating remaining amount

**Test 3.6: View Refund Details**
- [ ] Click "View" button on any refund
- [ ] Alert/modal shows refund details
- [ ] Details include: Refund Ref, Order ID, Amount, Type, Status, Reason, Dates

**Expected Result**: Refund initiation and tracking work correctly with proper validation

---

### 4. Settlements Tab 💰

**Test 4.1: Settlement Listing**
- [ ] Click "Settlements" tab
- [ ] Read-only alert message displayed
- [ ] Table shows settlements (or "No settlements found")
- [ ] Columns: Settlement Ref, Date, Gross Amount, Fees, Net Amount, Status, Actions

**Test 4.2: Date Range Filter**
- [ ] Set start date
- [ ] Set end date
- [ ] Click "Filter" button
- [ ] Only settlements within date range shown

**Test 4.3: View Settlement Details**
- [ ] Click "View" button on any settlement
- [ ] Alert/modal shows settlement details
- [ ] Details include: Settlement Ref, Date, Amounts, Status, Bank Account

**Test 4.4: Read-Only Verification**
- [ ] Verify NO buttons for "Trigger Settlement"
- [ ] Verify NO buttons for "Confirm Settlement"
- [ ] Verify NO ability to edit settlement data
- [ ] Only "View" action should be available

**Expected Result**: Settlements visible but strictly read-only

---

### 5. Disputes Tab ⚠️

**Test 5.1: Dispute Listing**
- [ ] Click "Disputes" tab
- [ ] Read-only alert message displayed (Phase 1)
- [ ] Table shows disputes (or "No disputes found")
- [ ] Columns: Dispute Ref, Order ID, Amount, Type, Status, Dispute Date, Response Due, Actions

**Test 5.2: Overdue Highlighting**
- [ ] If disputes exist with past due dates
- [ ] Response Due Date should be highlighted in red
- [ ] Other dates should be normal color

**Test 5.3: View Dispute Details**
- [ ] Click "View" button on any dispute
- [ ] Alert/modal shows dispute details
- [ ] Details include: Dispute Ref, Order ID, Amount, Type, Status, Reason, Dates

**Test 5.4: Read-Only Verification (Phase 1)**
- [ ] Verify NO buttons for "Upload Evidence"
- [ ] Verify NO buttons for "Respond to Dispute"
- [ ] Verify NO ability to change dispute status
- [ ] Only "View" action should be available

**Expected Result**: Disputes visible, overdue dates highlighted, strictly read-only

---

### 6. Daily Operations Tab 📅

**Test 6.1: Today's Stats**
- [ ] Click "Daily Operations" tab
- [ ] Today's section displays
- [ ] Shows: Total Transactions, Successful, Failed, Pending, Total Amount
- [ ] Date shown is today's date

**Test 6.2: Yesterday's Stats**
- [ ] Yesterday's section displays
- [ ] Shows same metrics as today
- [ ] Date shown is yesterday's date

**Test 6.3: Pending Items**
- [ ] Pending Refunds card shows count and amount
- [ ] Open Disputes card shows count and amount

**Test 6.4: Data Accuracy**
- [ ] Compare "Today" transaction count with Transactions tab filtered to today
- [ ] Numbers should match

**Expected Result**: Daily operations provide accurate real-time operational view

---

### 7. Reports Tab 📊

**Test 7.1: Transaction Statement (CSV)**
- [ ] Click "Reports" tab
- [ ] Select "Transaction Statement"
- [ ] Set date range (e.g., last 30 days)
- [ ] Select "CSV" format
- [ ] Click "Generate & Download"
- [ ] CSV file downloads
- [ ] Open CSV in Excel
- [ ] Verify columns: ID, Order ID, Transaction Ref, Payment Method, Gateway, Amount, Status, etc.
- [ ] Verify data is within selected date range

**Test 7.2: Settlement Statement (CSV)**
- [ ] Select "Settlement Statement"
- [ ] Set date range
- [ ] Select "CSV" format
- [ ] Click "Generate & Download"
- [ ] CSV file downloads
- [ ] Verify columns: Settlement Ref, Date, Gross Amount, Fees, Net Amount, Status, Bank Account

**Test 7.3: Refund Statement (CSV)**
- [ ] Select "Refund Statement"
- [ ] Set date range
- [ ] Select "CSV" format
- [ ] Click "Generate & Download"
- [ ] CSV file downloads
- [ ] Verify columns: Refund Ref, Amount, Type, Status, Order ID, Dates

**Test 7.4: JSON Format**
- [ ] Select any statement type
- [ ] Select "JSON" format
- [ ] Click "Generate & Download"
- [ ] Check browser console for JSON data
- [ ] Success message appears with record count

**Expected Result**: All statement types generate correctly in both CSV and JSON formats

---

### 8. Settings Tab ⚙️

**Test 8.1: Load Settings**
- [ ] Click "Settings" tab
- [ ] Form loads with current merchant data
- [ ] All fields populated: Name, Email, Phone, Business Type, Website, Callback URL

**Test 8.2: Update Settings**
- [ ] Modify any field (e.g., phone number)
- [ ] Click "Save Settings"
- [ ] Success message appears
- [ ] Reload page
- [ ] Verify changes persisted

**Expected Result**: Settings load and save correctly

---

### 9. API Keys Tab 🔑

**Test 9.1: View Existing API Keys**
- [ ] Click "API Keys" tab
- [ ] Table shows existing API keys
- [ ] Columns: Key Name, API Key, Status, Created, Expires, Actions

**Test 9.2: Generate New API Key**
- [ ] Click "+ Generate New API Key"
- [ ] Form appears
- [ ] Enter key name: "Test Key"
- [ ] Click "Generate"
- [ ] Success message appears with API Secret (shown only once)
- [ ] New key appears in table
- [ ] Status is "active"

**Test 9.3: Revoke API Key**
- [ ] Click "Revoke" on a test key
- [ ] Confirmation dialog appears
- [ ] Confirm revocation
- [ ] Success message appears
- [ ] Key status changes to "revoked"

**Expected Result**: API key management works correctly

---

### 10. Webhooks Tab 🔔

**Test 10.1: View Webhooks**
- [ ] Click "Webhooks" tab
- [ ] Table shows configured webhooks
- [ ] Columns: Webhook URL, Events, Status, Success/Failure, Created, Actions

**Test 10.2: Configure New Webhook**
- [ ] Click "+ Configure Webhook"
- [ ] Form appears
- [ ] Enter webhook URL: "https://example.com/webhook"
- [ ] Enter events (one per line):
  ```
  payment.success
  payment.failed
  refund.processed
  ```
- [ ] Click "Configure"
- [ ] Success message appears with webhook secret
- [ ] New webhook appears in table

**Test 10.3: Enable/Disable Webhook**
- [ ] Click "Disable" on active webhook
- [ ] Status changes to "inactive"
- [ ] Click "Enable" on inactive webhook
- [ ] Status changes to "active"

**Expected Result**: Webhook configuration and management works correctly

---

### 11. Rate Limits Tab ⏱️

**Test 11.1: View Rate Limits**
- [ ] Click "Rate Limits" tab
- [ ] Table shows configured rate limits
- [ ] Columns: Endpoint Pattern, Max Requests, Window, Status, Created

**Test 11.2: Configure Rate Limit**
- [ ] Click "+ Configure Rate Limit"
- [ ] Form appears
- [ ] Enter endpoint pattern: "/api/payments/*"
- [ ] Enter max requests: 100
- [ ] Enter window: 60000 (1 minute)
- [ ] Click "Configure"
- [ ] Success message appears
- [ ] New rate limit appears in table

**Expected Result**: Rate limit configuration works correctly

---

### 12. IP Whitelist Tab 🛡️

**Test 12.1: View IP Whitelist**
- [ ] Click "IP Whitelist" tab
- [ ] Table shows whitelisted IPs
- [ ] Columns: IP Address, Description, Status, Last Used, Created, Actions

**Test 12.2: Add IP to Whitelist**
- [ ] Click "+ Add IP Address"
- [ ] Form appears
- [ ] Enter IP: "192.168.1.1"
- [ ] Enter description: "Office network"
- [ ] Click "Add IP"
- [ ] Success message appears
- [ ] New IP appears in table

**Test 12.3: Remove IP from Whitelist**
- [ ] Click "Remove" on a test IP
- [ ] Confirmation dialog appears
- [ ] Confirm removal
- [ ] Success message appears
- [ ] IP removed from table

**Expected Result**: IP whitelist management works correctly

---

## Security Tests 🔒

### Security Test 1: Cross-Merchant Access
- [ ] Get merchant ID A
- [ ] Load dashboard with merchant ID A
- [ ] Note a transaction ID from merchant A
- [ ] Change URL to merchant ID B
- [ ] Try to view transaction from merchant A
- [ ] **EXPECTED**: Should get "not found" or "forbidden" error

### Security Test 2: Invalid Merchant ID
- [ ] Use invalid merchant ID in URL (e.g., "invalid-id")
- [ ] Dashboard should show error: "Invalid merchant ID format"
- [ ] No data should load

### Security Test 3: Settlement Trigger Verification
- [ ] Check all tabs for any "Trigger Settlement" buttons
- [ ] **EXPECTED**: NO such buttons should exist
- [ ] Settlements should be strictly read-only

### Security Test 4: Ledger Access Verification
- [ ] Check browser network tab during all operations
- [ ] **EXPECTED**: No calls to `/api/ledger/*` endpoints
- [ ] **EXPECTED**: No calls to `/api/accounting-period/*` endpoints

### Security Test 5: Refund Authority Verification
- [ ] Initiate a refund
- [ ] Check that it calls `/api/merchant/refunds` (not direct ledger)
- [ ] Verify refund status is "initiated" not "completed"
- [ ] Merchant cannot directly complete refunds

---

## Error Handling Tests ⚠️

### Error Test 1: Network Failure
- [ ] Disconnect internet
- [ ] Try to load any tab
- [ ] **EXPECTED**: Error message "Failed to load data. Please check your network connection."

### Error Test 2: Invalid Transaction ID
- [ ] Try to initiate refund with non-existent transaction ID
- [ ] **EXPECTED**: Error message "Transaction not found or not eligible for refund"

### Error Test 3: Invalid Refund Amount
- [ ] Try to refund negative amount
- [ ] **EXPECTED**: HTML5 validation prevents submission
- [ ] Try to refund 0 amount
- [ ] **EXPECTED**: Validation error

### Error Test 4: Empty Result Sets
- [ ] Filter transactions with impossible criteria
- [ ] **EXPECTED**: "No transactions found" message
- [ ] Same for refunds, settlements, disputes

---

## Performance Tests ⚡

### Performance Test 1: Large Dataset
- [ ] Load transactions with 100+ records
- [ ] **EXPECTED**: Pagination limits to 50 per page
- [ ] Page loads in reasonable time (< 3 seconds)

### Performance Test 2: Date Range
- [ ] Select very large date range (1 year)
- [ ] **EXPECTED**: Still loads, but may take longer
- [ ] Consider limiting max date range if too slow

---

## Browser Compatibility Tests 🌐

Test on multiple browsers:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (if available)

Each browser should:
- [ ] Display UI correctly
- [ ] Load all data
- [ ] Execute all JavaScript functions
- [ ] Download CSV files correctly

---

## Accessibility Tests ♿

- [ ] Tab navigation works through all form fields
- [ ] Enter key submits forms
- [ ] Escape key closes modals/forms
- [ ] Color contrast is readable
- [ ] All buttons have clear labels

---

## Test Results Summary

### Pass/Fail Count:
- Total Tests: ___
- Passed: ___
- Failed: ___
- Blocked: ___

### Critical Issues Found:
1. 
2. 
3. 

### Minor Issues Found:
1. 
2. 
3. 

### Recommendations:
1. 
2. 
3. 

---

## Sign-off

**Tested By**: _________________  
**Date**: _________________  
**Environment**: _________________  
**Status**: ☐ Approved  ☐ Approved with Issues  ☐ Rejected  

**Notes**:
