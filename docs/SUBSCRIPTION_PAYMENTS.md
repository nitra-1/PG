# Subscription Payments Documentation

## Overview

The Payment Gateway now supports recurring subscription payments, enabling merchants to implement subscription-based business models for SaaS platforms, memberships, and other recurring services.

## Features

- **Flexible Billing Intervals**: Daily, Weekly, Monthly, Yearly
- **Trial Periods**: Configurable trial days for new subscriptions
- **Payment Methods**: Support for all payment methods (UPI, Cards, Wallets, etc.)
- **Subscription Management**: Pause, resume, cancel, and update subscriptions
- **Billing History**: Complete transaction history for each subscription
- **Automated Payments**: Automatic recurring payment processing
- **Proration**: Support for mid-cycle plan changes

## Subscription Plans

### Default Plans

Three default plans are available:

1. **Basic Monthly**
   - Amount: ₹999/month
   - Trial: 7 days
   - Interval: MONTHLY

2. **Pro Monthly**
   - Amount: ₹2,999/month
   - Trial: 14 days
   - Interval: MONTHLY

3. **Basic Yearly**
   - Amount: ₹9,999/year
   - Trial: 14 days
   - Interval: YEARLY

## API Endpoints

### 1. Create Subscription Plan

Create a custom subscription plan.

**Endpoint**: `POST /api/subscriptions/plans`

**Request**:
```json
{
  "name": "Premium Monthly",
  "amount": 4999,
  "currency": "INR",
  "interval": "MONTHLY",
  "intervalCount": 1,
  "trialDays": 30,
  "features": [
    "Unlimited API calls",
    "Priority support",
    "Advanced analytics"
  ]
}
```

**Response**:
```json
{
  "success": true,
  "plan": {
    "planId": "PLAN_1704456000000",
    "name": "Premium Monthly",
    "amount": 4999,
    "currency": "INR",
    "interval": "MONTHLY",
    "intervalCount": 1,
    "trialDays": 30,
    "features": [
      "Unlimited API calls",
      "Priority support",
      "Advanced analytics"
    ],
    "status": "ACTIVE",
    "createdAt": "2024-01-05T12:00:00Z"
  }
}
```

### 2. List Subscription Plans

**Endpoint**: `GET /api/subscriptions/plans`

**Query Parameters**:
- `status` (optional): Filter by status (ACTIVE, INACTIVE)
- `interval` (optional): Filter by interval (DAILY, WEEKLY, MONTHLY, YEARLY)

**Response**:
```json
{
  "success": true,
  "plans": [
    {
      "planId": "BASIC_MONTHLY",
      "name": "Basic Monthly",
      "amount": 999,
      "currency": "INR",
      "interval": "MONTHLY",
      "intervalCount": 1,
      "trialDays": 7,
      "features": ["Feature 1", "Feature 2"]
    }
  ],
  "total": 3
}
```

### 3. Get Subscription Plan

**Endpoint**: `GET /api/subscriptions/plans/:planId`

**Response**:
```json
{
  "success": true,
  "plan": {
    "planId": "BASIC_MONTHLY",
    "name": "Basic Monthly",
    "amount": 999,
    "currency": "INR",
    "interval": "MONTHLY",
    "intervalCount": 1,
    "trialDays": 7,
    "features": ["Feature 1", "Feature 2"]
  }
}
```

### 4. Create Subscription

Create a new subscription for a customer.

**Endpoint**: `POST /api/subscriptions`

**Request**:
```json
{
  "customerId": "CUST_001",
  "customerEmail": "customer@example.com",
  "planId": "BASIC_MONTHLY",
  "paymentMethod": {
    "type": "card",
    "cardId": "CARD_001"
  },
  "startDate": "2024-01-05T00:00:00Z",
  "metadata": {
    "userId": "user_123",
    "source": "website"
  }
}
```

**Response**:
```json
{
  "success": true,
  "subscription": {
    "subscriptionId": "SUB_1704456000000",
    "customerId": "CUST_001",
    "customerEmail": "customer@example.com",
    "planId": "BASIC_MONTHLY",
    "plan": {
      "name": "Basic Monthly",
      "amount": 999,
      "currency": "INR",
      "interval": "MONTHLY",
      "intervalCount": 1
    },
    "status": "TRIALING",
    "paymentMethod": {
      "type": "card",
      "cardId": "CARD_001"
    },
    "startDate": "2024-01-05T00:00:00Z",
    "trialEnd": "2024-01-12T00:00:00Z",
    "currentPeriodStart": "2024-01-05T00:00:00Z",
    "currentPeriodEnd": "2024-02-05T00:00:00Z",
    "nextBillingDate": "2024-02-05T00:00:00Z",
    "metadata": {
      "userId": "user_123",
      "source": "website"
    },
    "createdAt": "2024-01-05T12:00:00Z"
  }
}
```

### 5. Get Subscription Details

**Endpoint**: `GET /api/subscriptions/:subscriptionId`

**Response**:
```json
{
  "success": true,
  "subscription": {
    "subscriptionId": "SUB_1704456000000",
    "customerId": "CUST_001",
    "status": "ACTIVE",
    "plan": {
      "name": "Basic Monthly",
      "amount": 999,
      "currency": "INR",
      "interval": "MONTHLY"
    },
    "nextBillingDate": "2024-02-05T00:00:00Z",
    "lastPaymentDate": "2024-01-05T12:00:00Z"
  }
}
```

### 6. Update Subscription

**Endpoint**: `PUT /api/subscriptions/:subscriptionId`

**Request**:
```json
{
  "paymentMethod": {
    "type": "upi",
    "vpa": "customer@upi"
  },
  "metadata": {
    "userId": "user_123_updated"
  }
}
```

**Response**:
```json
{
  "success": true,
  "subscription": {
    "subscriptionId": "SUB_1704456000000",
    "paymentMethod": {
      "type": "upi",
      "vpa": "customer@upi"
    },
    "updatedAt": "2024-01-05T12:00:00Z"
  }
}
```

### 7. Cancel Subscription

**Endpoint**: `POST /api/subscriptions/:subscriptionId/cancel`

**Request**:
```json
{
  "cancelAtPeriodEnd": true,
  "reason": "CUSTOMER_REQUEST"
}
```

**Response**:
```json
{
  "success": true,
  "subscriptionId": "SUB_1704456000000",
  "status": "ACTIVE",
  "cancelAt": "2024-02-05T00:00:00Z"
}
```

If `cancelAtPeriodEnd` is false:
```json
{
  "success": true,
  "subscriptionId": "SUB_1704456000000",
  "status": "CANCELLED",
  "cancelledAt": "2024-01-05T12:00:00Z"
}
```

### 8. Pause Subscription

**Endpoint**: `POST /api/subscriptions/:subscriptionId/pause`

**Request**:
```json
{
  "reason": "CUSTOMER_REQUEST"
}
```

**Response**:
```json
{
  "success": true,
  "subscriptionId": "SUB_1704456000000",
  "status": "PAUSED",
  "pausedAt": "2024-01-05T12:00:00Z"
}
```

### 9. Resume Subscription

**Endpoint**: `POST /api/subscriptions/:subscriptionId/resume`

**Response**:
```json
{
  "success": true,
  "subscriptionId": "SUB_1704456000000",
  "status": "ACTIVE",
  "resumedAt": "2024-01-05T12:00:00Z"
}
```

### 10. Process Recurring Payment

Manually trigger a recurring payment (normally done automatically).

**Endpoint**: `POST /api/subscriptions/:subscriptionId/process-payment`

**Response**:
```json
{
  "success": true,
  "payment": {
    "paymentId": "PAY_1704456000000",
    "subscriptionId": "SUB_1704456000000",
    "customerId": "CUST_001",
    "amount": 999,
    "currency": "INR",
    "status": "SUCCESS",
    "billingPeriodStart": "2024-01-05T00:00:00Z",
    "billingPeriodEnd": "2024-02-05T00:00:00Z",
    "processedAt": "2024-01-05T12:00:00Z"
  },
  "subscription": {
    "subscriptionId": "SUB_1704456000000",
    "nextBillingDate": "2024-03-05T00:00:00Z",
    "status": "ACTIVE"
  }
}
```

### 11. Get Billing History

**Endpoint**: `GET /api/subscriptions/:subscriptionId/billing-history`

**Response**:
```json
{
  "success": true,
  "subscriptionId": "SUB_1704456000000",
  "billingHistory": [
    {
      "date": "2024-01-05T12:00:00Z",
      "amount": 999,
      "status": "PAID",
      "invoiceUrl": "https://api.example.com/invoices/INV_001"
    }
  ],
  "upcomingInvoice": {
    "date": "2024-02-05T00:00:00Z",
    "amount": 999,
    "status": "UPCOMING"
  }
}
```

### 12. List Customer Subscriptions

**Endpoint**: `GET /api/customers/:customerId/subscriptions`

**Query Parameters**:
- `status` (optional): Filter by status (ACTIVE, PAUSED, CANCELLED, TRIALING)

**Response**:
```json
{
  "success": true,
  "subscriptions": [
    {
      "subscriptionId": "SUB_1704456000000",
      "planId": "BASIC_MONTHLY",
      "status": "ACTIVE",
      "nextBillingDate": "2024-02-05T00:00:00Z"
    }
  ],
  "total": 1
}
```

## Subscription Lifecycle

### Status Flow

```
TRIALING → ACTIVE → PAUSED → ACTIVE
    ↓         ↓         ↓
CANCELLED  CANCELLED  CANCELLED
```

### Status Definitions

- **TRIALING**: Subscription is in trial period (no payment yet)
- **ACTIVE**: Subscription is active and billing
- **PAUSED**: Subscription temporarily paused (no billing)
- **CANCELLED**: Subscription permanently cancelled

## Integration Flow

### 1. Create Subscription Flow

```
Customer Signup
    ↓
Display Available Plans (GET /api/subscriptions/plans)
    ↓
Customer Selects Plan
    ↓
Customer Adds Payment Method
    ↓
Create Subscription (POST /api/subscriptions)
    ↓
Start Trial Period (if applicable)
    ↓
Activate Subscription
```

### 2. Recurring Payment Flow

```
Subscription Active
    ↓
Next Billing Date Approaches
    ↓
Send Payment Reminder (24 hours before)
    ↓
Process Recurring Payment (on billing date)
    ↓
Payment Success → Update Next Billing Date
    ↓
Payment Failure → Retry Logic → Notify Customer
```

### 3. Cancellation Flow

```
Customer Requests Cancellation
    ↓
Cancel at Period End? (Yes/No)
    ↓
Yes: Mark for cancellation, continue service until period end
No: Cancel immediately, stop service
```

## Webhook Notifications

### Subscription Created
```json
{
  "event": "subscription.created",
  "data": {
    "subscriptionId": "SUB_1704456000000",
    "customerId": "CUST_001",
    "planId": "BASIC_MONTHLY",
    "status": "TRIALING",
    "createdAt": "2024-01-05T12:00:00Z"
  }
}
```

### Trial Ending Soon
```json
{
  "event": "subscription.trial_ending",
  "data": {
    "subscriptionId": "SUB_1704456000000",
    "trialEnd": "2024-01-12T00:00:00Z",
    "daysRemaining": 3
  }
}
```

### Payment Success
```json
{
  "event": "subscription.payment_succeeded",
  "data": {
    "subscriptionId": "SUB_1704456000000",
    "paymentId": "PAY_1704456000000",
    "amount": 999,
    "nextBillingDate": "2024-03-05T00:00:00Z"
  }
}
```

### Payment Failed
```json
{
  "event": "subscription.payment_failed",
  "data": {
    "subscriptionId": "SUB_1704456000000",
    "amount": 999,
    "reason": "Insufficient funds",
    "retryDate": "2024-01-06T12:00:00Z"
  }
}
```

### Subscription Cancelled
```json
{
  "event": "subscription.cancelled",
  "data": {
    "subscriptionId": "SUB_1704456000000",
    "cancelledAt": "2024-01-05T12:00:00Z",
    "reason": "CUSTOMER_REQUEST"
  }
}
```

## Error Handling

### Common Errors

```json
{
  "error": "Plan not found"
}
```

```json
{
  "error": "Missing required subscription details"
}
```

```json
{
  "error": "Cannot process payment for subscription with status: PAUSED"
}
```

```json
{
  "error": "Can only pause active subscriptions"
}
```

## Best Practices

1. **Trial Periods**: Offer trial periods to increase conversion
2. **Payment Reminders**: Send reminders before billing dates
3. **Graceful Degradation**: Handle payment failures gracefully with retry logic
4. **Clear Communication**: Keep customers informed about billing dates and amounts
5. **Easy Cancellation**: Make it easy for customers to cancel or pause subscriptions
6. **Proration**: Handle mid-cycle plan changes with proper proration
7. **Dunning Management**: Implement automated retry logic for failed payments
8. **Data Retention**: Keep subscription data for compliance and analytics

## Testing

### Test Plans
Use the default plans for testing:
- `BASIC_MONTHLY` - ₹999/month with 7-day trial
- `PRO_MONTHLY` - ₹2,999/month with 14-day trial
- `BASIC_YEARLY` - ₹9,999/year with 14-day trial

### Test Customer IDs
- `TEST_CUST_001` - Valid payment method
- `TEST_CUST_002` - Will fail first payment attempt
- `TEST_CUST_003` - Will fail all payment attempts

## Support

For issues or questions:
- Email: subscriptions-support@paymentgateway.com
- Documentation: https://docs.paymentgateway.com/subscriptions
- API Status: https://status.paymentgateway.com
