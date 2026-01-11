# Merchant Dashboard - Feature Documentation

## Overview

The Merchant Dashboard is a comprehensive web-based interface that enables merchants to manage their payment gateway operations, monitor transactions, handle refunds, view settlements, and track disputes. This dashboard is designed with strict separation of duties, ensuring merchants have operational capabilities without access to finance or ledger controls.

## Architecture

### Technology Stack
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js/Express.js
- **Database**: PostgreSQL
- **API**: RESTful architecture with JSON responses

### Security Model
- **Authentication**: Merchant ID-based authentication
- **Authorization**: All operations scoped to merchant's tenant_id
- **Data Isolation**: No cross-merchant visibility
- **Role-Based**: Merchant role only (no finance/admin access)

## Core Features

### 1. Overview Tab (Dashboard Home)

**Purpose**: Provides at-a-glance view of merchant account status and key metrics.

**Features**:
- **Statistics Cards**:
  - Total Requests (last 30 days)
  - Total Transactions (last 30 days)
  - Total Amount processed (last 30 days)
  - Success Rate percentage

- **Merchant Information Panel**:
  - Merchant ID
  - Merchant Code
  - Merchant Name
  - Email
  - Account Status

- **Quick Actions**:
  - Generate API Key
  - Configure Webhook
  - Set Rate Limit
  - View Usage

**API Endpoints**:
- `GET /api/merchants/:id` - Fetch merchant details
- `GET /api/merchants/:id/usage` - Fetch usage statistics

---

### 2. Transactions Tab

**Purpose**: View and search all payment transactions with detailed filtering.

**Features**:
- **Transaction Listing**:
  - Order ID
  - Amount
  - Status (pending, processing, success, failed, refunded)
  - Payment Method
  - Gateway
  - Customer Email
  - Transaction Date
  - Action buttons (View, Refund)

- **Filters**:
  - Status filter (dropdown)
  - Date range filter (start date, end date)
  - Pagination support (50 records per page)

- **Actions**:
  - View transaction details
  - Quick refund initiation (for successful transactions)

**API Endpoints**:
- `GET /api/merchant/transactions` - List transactions with filters
  - Query params: `merchantId`, `status`, `startDate`, `endDate`, `limit`, `offset`
- `GET /api/merchant/transactions/:transactionId` - Get transaction details
  - Includes associated refunds

**Business Rules**:
- Only merchant's own transactions are visible
- Refund button only shown for successful, non-refunded transactions
- All data is read-only except refund initiation

---

### 3. Refunds Tab

**Purpose**: Initiate and track refunds for transactions.

**Features**:
- **Refund Initiation Form**:
  - Transaction ID input
  - Refund Amount (with validation)
  - Reason for refund
  - Additional notes

- **Refund Listing**:
  - Refund Reference
  - Order ID
  - Refund Amount
  - Refund Type (full/partial)
  - Status (initiated, processing, completed, failed, cancelled)
  - Initiated Date
  - Completed Date
  - View action

- **Validation**:
  - Refund amount cannot exceed transaction amount
  - Prevents over-refunding (tracks total refunded amount)
  - Only successful transactions can be refunded

**API Endpoints**:
- `POST /api/merchant/refunds` - Initiate refund
  - Body: `{ transactionId, refundAmount, reason, notes }`
- `GET /api/merchant/refunds` - List refunds with filters
  - Query params: `merchantId`, `status`, `startDate`, `endDate`, `limit`, `offset`
- `GET /api/merchant/refunds/:refundId` - Get refund details

**Business Rules**:
- **Full Refund**: Refund amount equals remaining transaction amount
- **Partial Refund**: Refund amount less than remaining transaction amount
- Merchants can initiate refunds but cannot cancel them once processing
- Refunds call backend APIs (no direct ledger access)
- Status tracking: initiated → processing → completed/failed

---

### 4. Settlements Tab (Read-Only)

**Purpose**: View settlement history and status (merchant-safe, read-only access).

**Features**:
- **Settlement Listing**:
  - Settlement Reference
  - Settlement Date
  - Gross Amount
  - Fees Amount
  - Net Amount
  - Status
  - View action

- **Filters**:
  - Date range filter
  - Status filter (optional)

- **Information Alert**:
  - Clear message that this is read-only
  - Instructions to contact support for settlement inquiries

**API Endpoints**:
- `GET /api/merchant/settlements` - List settlements (merchant-scoped)
  - Query params: `merchantId`, `status`, `startDate`, `endDate`, `limit`, `offset`
- `GET /api/merchant/settlements/:settlementId` - Get settlement details

**Business Rules**:
- **Strictly Read-Only**: No ability to trigger, modify, or confirm settlements
- Settlements are scoped to merchant_id only
- No access to finance controls or ledger operations
- Settlement timing controlled by finance team
- Bank account details shown (last 4 digits only for security)

**Security Boundaries**:
- ✅ Merchants CAN view their settlement history
- ❌ Merchants CANNOT trigger settlements
- ❌ Merchants CANNOT modify settlement dates
- ❌ Merchants CANNOT access settlement batches
- ❌ Merchants CANNOT view or edit ledger entries

---

### 5. Disputes Tab (Read-Only - Phase 1)

**Purpose**: View disputes raised against merchant transactions.

**Features**:
- **Dispute Listing**:
  - Dispute Reference
  - Order ID
  - Disputed Amount
  - Dispute Type (chargeback, fraud, product issues, etc.)
  - Status (open, under_review, accepted, won, lost, closed)
  - Dispute Date
  - Response Due Date (highlighted if overdue)
  - View action

- **Status Indicators**:
  - Color-coded badges for different statuses
  - Red highlighting for overdue response dates

- **Information Alert**:
  - Note about evidence upload coming in Phase 2

**API Endpoints**:
- `GET /api/merchant/disputes` - List disputes
  - Query params: `merchantId`, `status`, `limit`, `offset`
- `GET /api/merchant/disputes/:disputeId` - Get dispute details

**Business Rules**:
- **Phase 1: Read-Only** - Merchants can only view disputes
- Phase 2 (Future): Evidence upload and response capabilities
- Merchants cannot change dispute status
- Merchants cannot trigger reversals
- SLA deadlines displayed to encourage timely responses

**Dispute Types**:
- `chargeback` - Customer disputed with bank
- `fraud` - Fraudulent transaction claim
- `product_not_received` - Product delivery issue
- `product_defective` - Quality/defect issue
- `unauthorized_transaction` - Transaction not authorized
- `duplicate_charge` - Double charging
- `other` - Other reasons

---

### 6. Daily Operations Tab

**Purpose**: Real-time operational monitoring for today and yesterday.

**Features**:
- **Today's Activity**:
  - Total Transactions
  - Successful Transactions
  - Failed Transactions
  - Pending Transactions
  - Total Amount (Revenue)

- **Yesterday's Activity**:
  - Same metrics as today for comparison

- **Pending Items**:
  - Pending Refunds (count and total amount)
  - Open Disputes (count and total amount)

**API Endpoints**:
- `GET /api/merchant/analytics/daily-operations` - Get daily stats
  - Returns today, yesterday, and pending items data

**Use Cases**:
- Morning operations check
- Compare today vs yesterday performance
- Monitor pending items requiring attention
- Quick health check of payment operations

---

### 7. Reports Tab (Downloadable Statements)

**Purpose**: Generate and download statements for accounting and reconciliation.

**Features**:
- **Statement Configuration**:
  - Statement Type selector:
    - Transaction Statement
    - Settlement Statement
    - Refund Statement
  - Date Range selector (start date, end date)
  - Format selector:
    - JSON (for API integration)
    - CSV (Excel-compatible)

- **Export Functionality**:
  - Download as CSV file
  - View as JSON data
  - Includes all relevant fields per statement type

**API Endpoints**:
- `GET /api/merchant/analytics/statements` - Generate statement
  - Query params: `merchantId`, `type`, `startDate`, `endDate`, `format`

**Statement Types**:

1. **Transaction Statement**:
   - ID, Order ID, Transaction Ref, Payment Method, Gateway
   - Amount, Currency, Status, Customer Email, Date

2. **Settlement Statement**:
   - ID, Settlement Ref, Settlement Date
   - Gross Amount, Fees Amount, Net Amount, Status, Bank Account

3. **Refund Statement**:
   - Refund ID, Refund Ref, Amount, Type, Status
   - Initiated Date, Order ID, Transaction Ref

**Use Cases**:
- Monthly reconciliation with accounting system
- Tax filing and reporting
- Audit trail documentation
- Financial planning and analysis

---

### 8. Settings Tab

**Purpose**: Manage merchant profile and configuration.

**Features**:
- Merchant Name
- Email
- Phone
- Business Type
- Website URL
- Callback URL

**API Endpoints**:
- `GET /api/merchants/:id` - Load merchant settings
- `PUT /api/merchants/:id` - Update merchant settings

---

### 9. API Keys Tab

**Purpose**: Generate, rotate, and revoke API keys for payment integration.

**Features**:
- **API Key Generation**:
  - Key Name input
  - Automatic generation of API Key and Secret
  - One-time display of API Secret

- **API Key Listing**:
  - Key Name
  - API Key (visible)
  - Status (active/revoked)
  - Created Date
  - Expiration Date
  - Revoke action

**API Endpoints**:
- `POST /api/merchants/:id/api-keys` - Generate new API key
- `GET /api/merchants/:id` - List API keys (included in merchant details)
- `DELETE /api/merchants/:id/api-keys/:keyId` - Revoke API key

**Security Notes**:
- API Secret shown only once on creation
- Secrets encrypted at rest
- 1-year default expiration
- Immediate revocation capability

---

### 10. Webhooks Tab

**Purpose**: Configure webhook endpoints for event notifications.

**Features**:
- **Webhook Configuration**:
  - Webhook URL
  - Event selection (payment.success, payment.failed, refund.processed, etc.)
  - Webhook secret generation

- **Webhook Listing**:
  - Webhook URL
  - Subscribed Events
  - Status (active/inactive)
  - Success/Failure counts
  - Enable/Disable toggle

**API Endpoints**:
- `POST /api/merchants/:id/webhooks` - Configure webhook
- `GET /api/merchants/:id` - List webhooks
- `PUT /api/merchants/:id/webhooks/:webhookId` - Update webhook status

---

### 11. Rate Limits Tab

**Purpose**: Configure API rate limiting per endpoint.

**Features**:
- Endpoint Pattern (wildcard support)
- Max Requests
- Time Window (milliseconds)
- Status display

**API Endpoints**:
- `POST /api/merchants/:id/rate-limits` - Configure rate limit
- `GET /api/merchants/:id` - List rate limits

---

### 12. IP Whitelist Tab

**Purpose**: Restrict API access to specific IP addresses.

**Features**:
- IP Address management
- Description/label for each IP
- Status and last used timestamp
- Add/Remove capabilities

**API Endpoints**:
- `POST /api/merchants/:id/ip-whitelist` - Add IP
- `GET /api/merchants/:id` - List whitelisted IPs
- `DELETE /api/merchants/:id/ip-whitelist/:ipId` - Remove IP

---

## Database Schema

### New Tables Created

#### 1. refunds Table
- id (UUID, primary key)
- tenant_id (UUID, indexed)
- merchant_id (UUID, indexed)
- transaction_id (UUID, foreign key)
- refund_ref (string, unique)
- refund_amount (decimal)
- original_amount (decimal)
- currency (string)
- refund_type (enum: full, partial)
- status (enum: initiated, processing, completed, failed, cancelled)
- reason (string)
- notes (text)
- gateway_refund_id (string)
- initiated_by (string)
- initiated_at, completed_at (timestamps)

#### 2. disputes Table
- id (UUID, primary key)
- tenant_id (UUID, indexed)
- merchant_id (UUID, indexed)
- transaction_id (UUID, foreign key)
- dispute_ref (string, unique)
- disputed_amount (decimal)
- dispute_type (enum)
- status (enum)
- dispute_date (date)
- response_due_date (date)
- resolved_date (date)
- customer_reason (text)
- merchant_response (text)

---

## Security & Compliance

### What Merchants CAN Do:
✅ View their own transactions, refunds, settlements, disputes
✅ Initiate refunds (via API calls, not direct ledger access)
✅ Download statements for reconciliation
✅ Manage API keys and webhooks
✅ Configure rate limits and IP whitelists
✅ Update merchant profile settings

### What Merchants CANNOT Do:
❌ Trigger settlements manually
❌ View or edit ledger entries
❌ Access accounting periods
❌ Modify settlement dates or amounts
❌ Confirm or reject settlements
❌ View cross-merchant data
❌ Access finance admin workflows
❌ Change dispute status (Phase 1)
❌ Trigger payment reversals

### RBI Compliance:
- **Separation of Duties**: Strict separation between merchant operations and finance controls
- **Audit Trail**: All actions logged via audit_logs table
- **Data Isolation**: Multi-tenancy enforced at database level
- **Read-Only Finance Data**: Settlements visible but not modifiable
- **No Finance Authority**: Merchants cannot affect settlement timing or ledger balances

---

## Testing Checklist

### Manual Testing:

#### Transaction Features:
- [ ] Load transactions list
- [ ] Filter by status
- [ ] Filter by date range
- [ ] View transaction details
- [ ] Verify pagination works
- [ ] Quick refund from transaction view

#### Refund Features:
- [ ] Initiate full refund
- [ ] Initiate partial refund
- [ ] Verify amount validation
- [ ] Verify over-refund prevention
- [ ] Track refund status
- [ ] View refund details

#### Settlement Features:
- [ ] View settlements list
- [ ] Filter by date range
- [ ] View settlement details
- [ ] Verify read-only (no edit/trigger buttons)
- [ ] Confirm only merchant's settlements shown

#### Dispute Features:
- [ ] View disputes list
- [ ] View dispute details
- [ ] Verify overdue dates highlighted
- [ ] Confirm read-only access

#### Daily Operations:
- [ ] Load today's stats
- [ ] Load yesterday's stats
- [ ] View pending refunds count
- [ ] View open disputes count

#### Reports:
- [ ] Generate transaction statement (CSV)
- [ ] Generate settlement statement (CSV)
- [ ] Generate refund statement (CSV)
- [ ] Download and verify CSV format
- [ ] Test with different date ranges

#### Security:
- [ ] Verify no cross-merchant data visibility
- [ ] Verify no finance controls exposed
- [ ] Verify no ledger access
- [ ] Verify no settlement trigger capability
- [ ] Test with invalid merchant ID

---

## Support & Troubleshooting

### Common Issues:

1. **"Merchant ID is required" error**:
   - Ensure merchantId is passed in URL query string
   - Format: `?merchantId=<your-uuid>`

2. **"Transaction not found" error**:
   - Verify transaction belongs to your merchant account
   - Check transaction ID format (must be UUID)

3. **"Refund amount exceeds transaction amount" error**:
   - Check remaining refundable amount
   - Account for previous partial refunds

4. **Empty data tables**:
   - Verify date range filters
   - Check if any transactions exist in selected period
   - Clear filters to see all data

5. **CSV download not working**:
   - Check browser popup blocker
   - Verify date range is valid
   - Ensure statement type is selected

---

## Version History

### Version 1.0.0 (Current)
- Initial release with core features
- Transaction listing and search
- Refund initiation and tracking
- Settlement visibility (read-only)
- Dispute visibility (read-only)
- Daily operations view
- Downloadable statements (CSV/JSON)
- Analytics split: Operations vs Reports

### Migration Notes:
- Database migration: `20240106000000_merchant_dashboard_enhancements.js`
- New API routes: `/api/merchant/*`
- Backward compatible with existing `/api/merchants/*` routes
