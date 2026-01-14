# Settlements Documentation Index

This directory contains comprehensive documentation for the settlements functionality in the Payment Gateway system.

---

## 📚 Available Documents

### 1. Settlements Lifecycle Documentation
**File:** `SETTLEMENTS_LIFECYCLE_DOCUMENTATION.md`

**Purpose:** Complete end-to-end mapping of settlements from user payment to screen display

**Use When:**
- You need to understand the complete settlements system
- You're debugging complex issues
- You're onboarding new team members
- You're planning new features or modifications
- You need technical specifications

**Contents:**
- ✅ All 14 actors involved in settlements
- ✅ 6 complete lifecycle phases
- ✅ State machine with all 7 states
- ✅ Database schemas with SQL
- ✅ API endpoints with examples
- ✅ Code snippets with file locations
- ✅ 9-step debugging guide
- ✅ Common issues and solutions
- ✅ Complete example scenario

**Size:** 42 KB | 1,512 lines

---

### 2. Settlements Quick Debug Guide
**File:** `SETTLEMENTS_QUICK_DEBUG_GUIDE.md`

**Purpose:** Rapid troubleshooting reference for when settlements don't show on screen

**Use When:**
- Settlements aren't displaying and you need to fix it quickly
- You need quick SQL queries to check data
- You want a fast diagnostic checklist
- You need to validate the system is working

**Contents:**
- ⚡ Quick checks (2 minutes)
- 🔍 Database queries
- 🛠️ Common fixes
- 🎯 Decision tree
- 💡 Pro tips
- 📝 Key file locations

**Size:** 8 KB | 390 lines

---

## 🚀 Quick Start

### Scenario: Settlements Not Showing

**Step 1:** Open the Quick Debug Guide
```bash
cat SETTLEMENTS_QUICK_DEBUG_GUIDE.md
```

**Step 2:** Follow the checklist:
1. Browser console check
2. Network tab check
3. Database check
4. Filters check

**Step 3:** If still stuck, consult the Lifecycle Documentation for deeper understanding

---

## 🎯 Which Document to Use?

### Use Quick Debug Guide for:
- ❌ "No settlements found" on screen
- ⏱️ Need answer in 5 minutes or less
- 🔧 Hands-on troubleshooting
- 📊 Need SQL queries
- ✅ Quick validation checks

### Use Lifecycle Documentation for:
- 📖 Understanding the complete system
- 🏗️ Architecture and design
- 👨‍💻 Development and code changes
- 🎓 Training and onboarding
- 🔬 Deep dive investigation
- 📋 Comprehensive debugging

---

## 📋 System Overview

### The Complete Flow:

```
1. USER PAYMENT
   Customer pays on merchant website
   ↓

2. PAYMENT GATEWAY
   Routes through smart router to provider (Razorpay/PayU/CCAvenue)
   ↓

3. LEDGER RECORDING
   Creates double-entry accounting entries
   Tables: ledger_transactions, ledger_entries
   ↓

4. SETTLEMENT CREATION (T+1/T+2)
   Aggregates merchant transactions
   Table: settlements
   Status: CREATED
   ↓

5. SETTLEMENT PROCESSING
   Finance admin processes through state machine:
   CREATED → FUNDS_RESERVED → SENT_TO_BANK → BANK_CONFIRMED → SETTLED
   ↓

6. DISPLAY ON SCREEN
   Finance Admin Console → Settlements Tab → Search Button
   API: GET /api/finance-admin/settlements
   ↓

7. ✅ SETTLEMENTS VISIBLE TO USER
```

---

## 🔍 Common Debugging Scenarios

### Scenario 1: "No settlements found" message
**Quick Answer:** 
- Check if settlements exist: `SELECT COUNT(*) FROM settlements WHERE tenant_id = 'xxx'`
- If 0: Create test settlement or check payment processing
- If >0: Check tenant ID and status filter

**Full Details:** See Quick Debug Guide → Section "Database Checks"

---

### Scenario 2: API returns 403 Forbidden
**Quick Answer:**
- User doesn't have FINANCE_ADMIN or COMPLIANCE_ADMIN role
- Check: `SELECT role FROM platform_users WHERE email = 'user@example.com'`

**Full Details:** See Lifecycle Documentation → Section "Security Considerations"

---

### Scenario 3: Settlements stuck in CREATED state
**Quick Answer:**
- Finance admin needs to manually transition states
- Click "Reserve Funds" button in UI
- Or call API: `POST /api/finance-admin/settlements/:id/reserve-funds`

**Full Details:** See Lifecycle Documentation → Section "Settlement State Machine"

---

### Scenario 4: Want to understand complete payment-to-settlement flow
**Quick Answer:**
- Read Appendix C in Lifecycle Documentation
- Shows day-by-day example with timestamps

**Full Details:** See Lifecycle Documentation → Appendix C

---

## 🗂️ File Locations Reference

### Frontend Files:
- **Finance Admin Console:** `/public/finance-admin-console.html`
- **Load Settlements Function:** Line 1183
- **Table Element:** `<tbody id="settlementsTableBody">`

### Backend Files:
- **Main Router:** `src/api/routes.js`
- **Finance Admin Routes:** `src/api/finance-admin-routes.js`
- **Settlement Routes:** `src/api/settlement-routes.js`
- **Settlement Service:** `src/core/ledger/settlement-service.js`
- **Ledger Service:** `src/core/ledger/ledger-service.js`
- **Event Handlers:** `src/core/ledger/ledger-event-handlers.js`

### Database Tables:
- **settlements** - Main settlement records
- **ledger_transactions** - Financial transaction records
- **ledger_entries** - Double-entry bookkeeping entries
- **merchants** - Merchant information
- **account_balances** - Real-time account balances

---

## 🎓 Learning Path

### For New Team Members:

**Day 1: Understanding**
1. Read Lifecycle Documentation - Actors section
2. Read Lifecycle Documentation - Complete Lifecycle Overview
3. Understand the 6 phases

**Day 2: Technical Details**
1. Review State Machine section
2. Study Database Schemas
3. Review API Endpoints

**Day 3: Hands-On**
1. Use Quick Debug Guide to check live system
2. Run SQL queries on database
3. Test creating a settlement via API

**Day 4: Debugging**
1. Complete 9-step debugging guide
2. Practice troubleshooting scenarios
3. Review common issues and solutions

---

## 💻 Quick Commands

### Check Settlements Count
```sql
SELECT status, COUNT(*), SUM(net_amount) 
FROM settlements 
WHERE tenant_id = 'your-tenant-uuid'
GROUP BY status;
```

### Test API Endpoint
```bash
curl -X GET "http://localhost:3000/api/finance-admin/settlements?tenantId=test" \
  -H "x-user-role: FINANCE_ADMIN" \
  -H "x-user-id: test-user"
```

### Check Logs
```bash
# If using PM2
pm2 logs | grep settlement

# If using Docker
docker logs payment-gateway | grep settlement
```

---

## 🆘 Getting Help

### If Quick Debug Guide doesn't solve it:
1. Check Lifecycle Documentation debugging section
2. Review the decision tree
3. Check server logs
4. Verify database connection

### If Lifecycle Documentation doesn't have the answer:
1. Check related documentation in /features directory
2. Review source code at file locations provided
3. Check test files for examples: `tests/settlement-service.test.js`

---

## 📊 Metrics & KPIs

Both documents help you answer:
- ✅ Are settlements being created?
- ✅ What state are settlements in?
- ✅ Why aren't settlements showing?
- ✅ Is the state machine working correctly?
- ✅ Are ledger entries being created?
- ✅ Is the API responding correctly?

---

## 🔐 Security Notes

**Role Requirements:**
- Viewing settlements: `FINANCE_ADMIN` or `COMPLIANCE_ADMIN`
- State transitions: `FINANCE_ADMIN`
- Approvals: `COMPLIANCE_ADMIN` only
- Read-only audit: `AUDITOR`

**See:** Lifecycle Documentation → Security Considerations section

---

## 🏗️ Architecture Quick Reference

**Tech Stack:**
- Backend: Node.js + Express
- Database: PostgreSQL with Knex.js
- Frontend: Vanilla JavaScript
- Authentication: JWT-based
- State Management: Finite State Machine
- Accounting: Double-Entry Ledger

**Design Patterns:**
- State Machine (Settlement lifecycle)
- Event-Driven (Payment to ledger)
- Repository Pattern (Database access)
- Circuit Breaker (Payment gateway)
- Retry with Backoff (Failed operations)

---

## 📈 Performance

**Query Performance:**
- Indexed on: tenant_id, status, created_at, merchant_id
- Default limit: 100 settlements per request
- Pagination: Offset-based

**See:** Lifecycle Documentation → Performance Considerations

---

## 🔄 Recent Updates

- **2026-01-14:** Initial creation of both documents
  - Complete lifecycle mapping
  - All 14 actors identified
  - Comprehensive debugging guide
  - Quick reference created

---

## 📞 Quick Links

- **Complete Lifecycle:** `SETTLEMENTS_LIFECYCLE_DOCUMENTATION.md`
- **Quick Debug:** `SETTLEMENTS_QUICK_DEBUG_GUIDE.md`
- **Source Code:** `/home/runner/work/PG/PG/src/`
- **Frontend:** `/home/runner/work/PG/PG/public/`
- **Tests:** `/home/runner/work/PG/PG/tests/settlement-service.test.js`

---

## ✅ Checklist for Debugging

- [ ] Check browser console for errors
- [ ] Check Network tab for API requests
- [ ] Verify user role is FINANCE_ADMIN
- [ ] Verify tenant ID is correct
- [ ] Try "All" status filter
- [ ] Check if settlements exist in database
- [ ] Check if payments were recorded
- [ ] Verify server is running
- [ ] Check server logs for errors
- [ ] Test API endpoint with curl

**See:** Quick Debug Guide for detailed steps

---

**Happy Debugging! 🎉**

For questions or issues, refer to the detailed documentation or check the source code files referenced in the guides.
