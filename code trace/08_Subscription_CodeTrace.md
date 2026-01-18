# Subscription/Recurring - Code Trace Document

## Overview
**Payment Type**: Subscription/Recurring Payments  
**Purpose**: Automated recurring billing for SaaS and subscription-based services  
**Entry Point**: Subscription Service API  
**Primary File**: `/src/subscription/subscription-service.js`

---

## Default Subscription Plans
1. **BASIC_MONTHLY**: ₹999/month, 7-day trial, Features: [Feature 1, Feature 2]
2. **PRO_MONTHLY**: ₹2,999/month, 14-day trial, Features: [All Basic, Feature 3, Feature 4]
3. **BASIC_YEARLY**: ₹9,999/year, 14-day trial, Features: [Feature 1, Feature 2]

---

## Subscription Intervals
- **DAILY**: Daily billing
- **WEEKLY**: Weekly billing
- **MONTHLY**: Monthly billing (most common)
- **YEARLY**: Yearly billing

---

## Execution Flow

### 1. CREATE SUBSCRIPTION PLAN
**Function**: `createPlan(planData)`  
**Entry Point**: Admin creates new plan

#### Flow Steps:
1. **Input Validation**
   - Required: name, amount, interval
   - Optional: currency ('INR'), intervalCount (1), trialDays (0), features ([])
   - Validate: interval in ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
   - Validate: amount > 0

2. **Plan Creation**
   - Generate planId: `PLAN_{timestamp}`
   - Set status: 'ACTIVE'
   - Store in plans Map (in-memory)

3. **Response**
   - Returns: { success: true, plan: {...} }

---

### 2. GET SUBSCRIPTION PLAN
**Function**: `getPlan(planId)`  
**Entry Point**: Retrieve plan details

#### Flow Steps:
1. **Plan Retrieval**
   - Fetch from plans Map
   - Throw error if not found

2. **Response**
   - Returns: Plan object

---

### 3. LIST SUBSCRIPTION PLANS
**Function**: `listPlans(filters)`  
**Entry Point**: Display available plans

#### Flow Steps:
1. **Filter Application**
   - Optional filters: status, interval
   - Filter plans array based on criteria

2. **Response**
   - Returns: { success: true, plans: [...], total: N }

---

### 4. CREATE SUBSCRIPTION
**Function**: `createSubscription(subscriptionData)`  
**Entry Point**: Customer subscribes to plan

#### Flow Steps:
1. **Input Validation**
   - Required: customerId, planId, paymentMethod
   - Optional: startDate, metadata

2. **Plan Retrieval** (`getPlan`)
   - Fetch plan details
   - Validate plan exists

3. **Billing Date Calculation**
   - startDate: Provided or current date
   - trialEnd: If trialDays > 0, calculate trial end date
   - firstBillingDate: trialEnd OR startDate
   - nextBillingDate: Calculate using `calculateNextBillingDate()`

4. **Subscription Creation**
   - Generate subscriptionId: `SUB_{timestamp}`
   - Status: 'TRIALING' (if trial) OR 'ACTIVE'
   - Set currentPeriodStart, currentPeriodEnd
   - Store in subscriptions Map (in-memory)

5. **Response**
   - Returns: { success: true, subscription: {...} }

**Date Calculation Logic**:
```javascript
// Trial: 7 days from start
trialEnd = startDate + 7 days

// First billing after trial
firstBillingDate = trialEnd

// Next billing based on interval
if interval = MONTHLY:
  nextBillingDate = firstBillingDate + 1 month
if interval = YEARLY:
  nextBillingDate = firstBillingDate + 1 year
```

---

### 5. PROCESS RECURRING PAYMENT
**Function**: `processRecurringPayment(subscriptionId)`  
**Entry Point**: Scheduled job (cron) on billing date

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription from subscriptions Map
   - Validate status = 'ACTIVE'

2. **Payment Processing**
   - Generate paymentId: `PAY_{timestamp}`
   - **Interface Point**: Payment Gateway Auto-Charge API
   - **External System**: Payment Gateway (Razorpay Subscriptions, Stripe, etc.)
   - Charge saved payment method
   - Status: 'SUCCESS' or 'FAILED'

   **Request**:
   ```json
   POST https://api.razorpay.com/v1/subscriptions/{subscriptionId}/charge
   {
     "amount": 999,
     "currency": "INR",
     "paymentMethod": "card_token_123"
   }
   ```

3. **Database Operations** (if implemented)
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - transaction_ref: paymentId
     - order_id: subscriptionId
     - payment_method: 'subscription'
     - amount, currency
     - status: 'success' or 'failed'
     - metadata: {subscriptionId, billingPeriodStart, billingPeriodEnd}

4. **Subscription Update**
   - Calculate nextBillingDate (add interval to current)
   - Update currentPeriodStart, currentPeriodEnd
   - Set lastPaymentDate
   - Update updatedAt

5. **Response**
   - Returns: { success: true, payment: {...}, subscription: {...} }

---

### 6. GET SUBSCRIPTION
**Function**: `getSubscription(subscriptionId)`  
**Entry Point**: View subscription details

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch from subscriptions Map
   - Throw error if not found

2. **Response**
   - Returns: { success: true, subscription: {...} }

---

### 7. UPDATE SUBSCRIPTION
**Function**: `updateSubscription(subscriptionId, updateData)`  
**Entry Point**: Customer updates payment method or metadata

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription from subscriptions Map

2. **Update Allowed Fields**
   - paymentMethod: Update saved payment method
   - metadata: Merge with existing metadata
   - Update updatedAt

3. **Response**
   - Returns: { success: true, subscription: {...} }

---

### 8. CANCEL SUBSCRIPTION
**Function**: `cancelSubscription(subscriptionId, options)`  
**Entry Point**: Customer cancels subscription

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription
   - Validate not already cancelled

2. **Cancellation Options**
   - **Immediate** (cancelAtPeriodEnd = false):
     - status = 'CANCELLED'
     - cancelledAt = current timestamp
   - **At Period End** (cancelAtPeriodEnd = true):
     - cancelAtPeriodEnd = true
     - cancelAt = currentPeriodEnd
     - Status remains 'ACTIVE' until period end

3. **Update Fields**
   - cancellationReason: options.reason or 'CUSTOMER_REQUEST'
   - updatedAt: current timestamp

4. **Response**
   - Returns: { success: true, subscriptionId, status, cancelledAt, cancelAt }

---

### 9. PAUSE SUBSCRIPTION
**Function**: `pauseSubscription(subscriptionId, options)`  
**Entry Point**: Customer pauses subscription

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription
   - Validate status = 'ACTIVE'

2. **Pause Subscription**
   - status = 'PAUSED'
   - pausedAt = current timestamp
   - pauseReason = options.reason or 'CUSTOMER_REQUEST'
   - updatedAt = current timestamp

3. **Response**
   - Returns: { success: true, subscriptionId, status, pausedAt }

---

### 10. RESUME SUBSCRIPTION
**Function**: `resumeSubscription(subscriptionId)`  
**Entry Point**: Customer resumes paused subscription

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription
   - Validate status = 'PAUSED'

2. **Resume Subscription**
   - status = 'ACTIVE'
   - resumedAt = current timestamp
   - updatedAt = current timestamp

3. **Response**
   - Returns: { success: true, subscriptionId, status, resumedAt }

---

### 11. LIST CUSTOMER SUBSCRIPTIONS
**Function**: `listCustomerSubscriptions(customerId, filters)`  
**Entry Point**: Customer subscription dashboard

#### Flow Steps:
1. **Filter Subscriptions**
   - Filter by customerId
   - Optional: Filter by status

2. **Response**
   - Returns: { success: true, subscriptions: [...], total: N }

---

### 12. GET BILLING HISTORY
**Function**: `getSubscriptionBillingHistory(subscriptionId)`  
**Entry Point**: View past invoices

#### Flow Steps:
1. **Subscription Retrieval**
   - Fetch subscription

2. **Query Database** (if implemented)
   - **Table**: `transactions`
   - **Query**: WHERE order_id = subscriptionId AND payment_method = 'subscription'

3. **Response**
   - Returns: { success: true, subscriptionId, billingHistory: [...], upcomingInvoice: {...} }

---

## External System Interfaces

### 1. Payment Gateway Subscription API
**Interface Point**: Create recurring charge, manage subscriptions

**Razorpay Subscriptions**:
```json
POST https://api.razorpay.com/v1/subscriptions
{
  "plan_id": "plan_xyz",
  "customer_id": "cust_123",
  "total_count": 12,
  "quantity": 1,
  "start_at": 1609459200,
  "customer_notify": 1
}
Response:
{
  "id": "sub_abc",
  "status": "created",
  "current_start": 1609459200,
  "current_end": 1612137600,
  "charge_at": 1612137600
}
```

**Auto-Charge**:
```json
POST https://api.razorpay.com/v1/subscriptions/{subscriptionId}/charge
{
  "amount": 99900,
  "currency": "INR"
}
Response:
{
  "id": "inv_123",
  "amount": 99900,
  "status": "paid",
  "paid_at": 1612137650
}
```

---

### 2. Notification Service
**Interface Point**: Send billing reminders, payment success/failure notifications

**Email Example**:
```
Subject: Your subscription has been renewed

Hi {customerName},

Your {planName} subscription has been successfully renewed.

Amount: ₹{amount}
Next billing date: {nextBillingDate}

Thank you for your continued subscription!
```

---

## Database Tables & Operations

### 1. subscriptions (Optional - if implemented)
**Purpose**: Store subscription master data

**Schema**:
```sql
- id (UUID)
- tenant_id (UUID)
- subscription_id (VARCHAR, unique)
- customer_id (VARCHAR, indexed)
- plan_id (VARCHAR)
- plan_name (VARCHAR)
- amount (DECIMAL)
- currency (VARCHAR)
- interval (ENUM: DAILY, WEEKLY, MONTHLY, YEARLY)
- interval_count (INT)
- status (ENUM: trialing, active, paused, cancelled)
- payment_method (VARCHAR) - Tokenized payment method
- start_date (DATE)
- trial_end (DATE)
- current_period_start (DATE)
- current_period_end (DATE)
- next_billing_date (DATE)
- billing_cycle_anchor (DATE)
- cancel_at_period_end (BOOLEAN)
- cancelled_at (TIMESTAMP)
- cancellation_reason (VARCHAR)
- metadata (JSONB)
- created_at, updated_at (TIMESTAMP)
```

---

### 2. transactions
**Purpose**: Track subscription payment transactions

**Subscription-Specific Fields**:
- payment_method: 'subscription'
- order_id: subscriptionId
- metadata: {subscriptionId, billingPeriodStart, billingPeriodEnd, planName}

**Operations**:
- **INSERT**: Each recurring payment
- **SELECT**: Billing history query

---

### 3. subscription_plans (Optional - if implemented)
**Purpose**: Store subscription plan definitions

**Schema**:
```sql
- id (UUID)
- plan_id (VARCHAR, unique)
- name (VARCHAR)
- amount (DECIMAL)
- currency (VARCHAR)
- interval (ENUM: DAILY, WEEKLY, MONTHLY, YEARLY)
- interval_count (INT)
- trial_days (INT)
- features (JSONB)
- status (ENUM: active, archived)
- created_at, updated_at (TIMESTAMP)
```

---

## Subscription Lifecycle States

```
TRIALING → ACTIVE → PAUSED → ACTIVE
                  ↓
              CANCELLED
```

- **TRIALING**: In trial period, no charge yet
- **ACTIVE**: Regular billing active
- **PAUSED**: Temporarily suspended, no charges
- **CANCELLED**: Permanently stopped

---

## Security & Compliance

### 1. Payment Method Security
- Store tokenized payment method (never raw card)
- PCI-DSS compliant token storage

### 2. Customer Consent
- Clear subscription terms disclosure
- Easy cancellation option required (consumer protection)

### 3. Failed Payment Handling
- Retry logic: 3 attempts over 7 days
- Dunning management (email reminders)
- Auto-cancel after repeated failures

---

## Error Handling

### Common Errors:
1. **Plan not found**: Invalid planId
2. **Missing required fields**: customerId, planId, paymentMethod
3. **Invalid interval**: Not in ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
4. **Amount must be > 0**: Invalid plan amount
5. **Subscription not found**: Invalid subscriptionId
6. **Cannot pause**: Subscription not active
7. **Cannot resume**: Subscription not paused
8. **Payment failed**: Card declined or insufficient funds

### Retry Logic:
- Payment failures: Retry 3 times (day 1, 3, 7)
- After 3 failures: Send final notice, cancel subscription

---

## Configuration Requirements

```javascript
{
  tenantId: '<merchant_tenant_id>',
  defaultTenantId: '<fallback_tenant_id>',
  paymentGatewayApiKey: '<gateway_api_key>',
  webhookSecret: '<webhook_secret>',
  defaultPlans: [
    { planId: 'BASIC_MONTHLY', amount: 999, ... },
    { planId: 'PRO_MONTHLY', amount: 2999, ... },
    { planId: 'BASIC_YEARLY', amount: 9999, ... }
  ]
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - One-time payment before subscription starts

2. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record subscription revenue
   - Monthly reconciliation

3. **Notification Service**
   - Payment success/failure emails
   - Renewal reminders
   - Cancellation confirmations

---

## Monitoring & Analytics

### Key Metrics:
- Monthly Recurring Revenue (MRR)
- Annual Recurring Revenue (ARR)
- Churn rate (cancellations / active subscriptions)
- Trial conversion rate
- Payment success rate
- Average subscription lifetime

### Logs:
- Subscription created: `subscriptionId, customerId, planId`
- Recurring payment processed: `paymentId, subscriptionId, amount, status`
- Subscription cancelled: `subscriptionId, reason`
- Subscription paused/resumed: `subscriptionId, action`

---

## API Endpoints (Typical Integration)

```
POST /api/subscriptions/plans - Create subscription plan
GET  /api/subscriptions/plans - List all plans
GET  /api/subscriptions/plans/:planId - Get plan details
POST /api/subscriptions/create - Create subscription
GET  /api/subscriptions/:subscriptionId - Get subscription
PUT  /api/subscriptions/:subscriptionId - Update subscription
POST /api/subscriptions/:subscriptionId/cancel - Cancel subscription
POST /api/subscriptions/:subscriptionId/pause - Pause subscription
POST /api/subscriptions/:subscriptionId/resume - Resume subscription
GET  /api/subscriptions/customer/:customerId - List customer subscriptions
GET  /api/subscriptions/:subscriptionId/billing-history - Get billing history
```

---

## Subscription Business Models

### SaaS (Software as a Service)
- Monthly/Annual plans
- Tiered pricing (Basic, Pro, Enterprise)
- Per-user pricing

### Membership
- Recurring access fees
- Community membership
- Gym memberships

### Content Streaming
- Monthly subscription
- Premium content access
- Netflix, Spotify model

### Subscription Box
- Monthly product deliveries
- Curated items

---

## Trial Period Best Practices

1. **Free Trial**: 7-14 days, no credit card required
2. **Paid Trial**: ₹1 for first month
3. **Freemium**: Free tier, upgrade to paid
4. **Money-back Guarantee**: 30-day refund policy

---

## Dunning Management

**Failed Payment Recovery**:
- Day 0: Payment attempt 1 (automatic)
- Day 1: Email notification + Retry attempt 2
- Day 3: Email reminder + Retry attempt 3
- Day 7: Final notice + Retry attempt 4
- Day 8: Subscription cancelled

**Recovery Rate**: ~30-40% with good dunning
