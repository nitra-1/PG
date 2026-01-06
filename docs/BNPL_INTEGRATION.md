# BNPL Provider Integration Guide

## Overview

The Payment Gateway now supports multiple Buy Now Pay Later (BNPL) providers, including Afterpay and Klarna, in addition to existing partners like Simpl, LazyPay, ZestMoney, FlexMoney, and Payl8r.

## Supported Providers

### 1. Afterpay
- **Supported Regions**: US, UK, AU, NZ, CA
- **Amount Limits**: ₹100 - ₹50,000
- **Payment Plans**: PAY_IN_4, PAY_IN_6
- **Settlement**: T+1

### 2. Klarna
- **Supported Regions**: Global
- **Amount Limits**: ₹50 - ₹1,00,000
- **Payment Plans**: PAY_IN_3, PAY_IN_4, PAY_IN_30
- **Settlement**: T+2

### 3. Internal Partners
- Simpl, LazyPay, ZestMoney, FlexMoney, Payl8r
- Credit score-based eligibility
- Amount Limits: Based on credit score (up to ₹50,000)

## Configuration

Add provider credentials to your `.env` file:

```bash
# Afterpay Configuration
AFTERPAY_API_URL=https://api.afterpay.com/v2
AFTERPAY_MERCHANT_ID=your_merchant_id
AFTERPAY_SECRET_KEY=your_secret_key

# Klarna Configuration
KLARNA_API_URL=https://api.klarna.com/v1
KLARNA_MERCHANT_ID=your_merchant_id
KLARNA_SECRET_KEY=your_secret_key
```

## API Endpoints

### 1. Check Eligibility

Check if a customer is eligible for BNPL with a specific provider.

**Endpoint**: `POST /api/bnpl/eligibility`

**Request**:
```json
{
  "customerId": "CUST_001",
  "customerPhone": "+919876543210",
  "customerEmail": "customer@example.com",
  "amount": 15000,
  "partner": "afterpay"
}
```

**Response**:
```json
{
  "success": true,
  "provider": "afterpay",
  "isEligible": true,
  "availableLimit": 50000,
  "maxAmount": 15000,
  "minAmount": 100,
  "supportedPlans": ["PAY_IN_4", "PAY_IN_6"],
  "timestamp": "2024-01-05T12:00:00Z"
}
```

### 2. Create BNPL Order

Create a BNPL order with a specific provider.

**Endpoint**: `POST /api/bnpl/orders`

**Request**:
```json
{
  "customerId": "CUST_001",
  "customerEmail": "customer@example.com",
  "customerPhone": "+919876543210",
  "amount": 15000,
  "orderId": "ORDER_123",
  "merchantId": "MERCHANT_001",
  "partner": "klarna",
  "installmentPlan": "PAY_IN_3"
}
```

**Response**:
```json
{
  "success": true,
  "providerId": "KLN_1704456000000",
  "orderId": "ORDER_123",
  "amount": 15000,
  "provider": "klarna",
  "installmentPlan": "PAY_IN_3",
  "status": "APPROVED",
  "clientToken": "klarna_token_1704456000000",
  "timestamp": "2024-01-05T12:00:00Z"
}
```

### 3. Get BNPL Order Details

**Endpoint**: `GET /api/bnpl/orders/:bnplOrderId`

**Response**:
```json
{
  "bnplOrderId": "BNPL_1704456000000",
  "amount": 15000,
  "installmentPlan": "PAY_IN_3",
  "status": "ACTIVE",
  "paidInstallments": 1,
  "pendingInstallments": 2,
  "nextDueDate": "2024-02-05T12:00:00Z"
}
```

### 4. Process Installment Payment

**Endpoint**: `POST /api/bnpl/installments/process`

**Request**:
```json
{
  "bnplOrderId": "BNPL_1704456000000",
  "installmentNumber": 2,
  "amount": 5000,
  "paymentMethod": "upi"
}
```

**Response**:
```json
{
  "success": true,
  "paymentId": "BNPL_PAY_1704456000000",
  "installmentNumber": 2,
  "amount": 5000,
  "status": "SUCCESS",
  "timestamp": "2024-01-05T12:00:00Z"
}
```

### 5. Get Customer BNPL Summary

**Endpoint**: `GET /api/bnpl/customers/:customerId/summary`

**Response**:
```json
{
  "customerId": "CUST_001",
  "totalOrders": 5,
  "activeOrders": 2,
  "totalOutstanding": 25000,
  "totalLimit": 50000,
  "availableLimit": 25000,
  "creditScore": 720,
  "paymentHistory": {
    "onTime": 12,
    "late": 1,
    "missed": 0
  }
}
```

### 6. Get Available BNPL Providers

**Endpoint**: `GET /api/bnpl/providers`

**Response**:
```json
{
  "success": true,
  "providers": [
    "simpl",
    "lazypay",
    "zestmoney",
    "flexmoney",
    "payl8r",
    "afterpay",
    "klarna"
  ]
}
```

## Integration Flow

### 1. Eligibility Check Flow

```
Customer Checkout
    ↓
Check BNPL Eligibility (POST /api/bnpl/eligibility)
    ↓
Display Available Providers & Limits
    ↓
Customer Selects Provider
    ↓
Create BNPL Order
```

### 2. Order Creation Flow

```
Customer Selects BNPL
    ↓
Create BNPL Order (POST /api/bnpl/orders)
    ↓
Provider Approval
    ↓
Display Installment Schedule
    ↓
Order Confirmed
```

### 3. Payment Flow

```
Installment Due Date Approaches
    ↓
Send Payment Reminder
    ↓
Process Installment Payment (POST /api/bnpl/installments/process)
    ↓
Update Payment Status
    ↓
Send Payment Confirmation
```

## Error Handling

Common error scenarios:

### Customer Not Eligible
```json
{
  "error": "Customer not eligible for BNPL"
}
```

### Amount Exceeds Limit
```json
{
  "error": "Amount exceeds available limit"
}
```

### Invalid Provider
```json
{
  "error": "Eligibility check failed: Invalid provider"
}
```

### Amount Out of Range
```json
{
  "error": "Afterpay order creation failed: Amount must be between 100 and 50000"
}
```

## Webhook Notifications

Configure webhooks to receive real-time updates:

### BNPL Order Status Update
```json
{
  "event": "bnpl.order.status_updated",
  "data": {
    "bnplOrderId": "BNPL_1704456000000",
    "status": "ACTIVE",
    "updatedAt": "2024-01-05T12:00:00Z"
  }
}
```

### Installment Payment Success
```json
{
  "event": "bnpl.installment.paid",
  "data": {
    "bnplOrderId": "BNPL_1704456000000",
    "installmentNumber": 2,
    "amount": 5000,
    "paidAt": "2024-01-05T12:00:00Z"
  }
}
```

### Late Payment Alert
```json
{
  "event": "bnpl.installment.late",
  "data": {
    "bnplOrderId": "BNPL_1704456000000",
    "installmentNumber": 2,
    "daysLate": 5,
    "lateFee": 100
  }
}
```

## Best Practices

1. **Always Check Eligibility First**: Before creating a BNPL order, always check customer eligibility
2. **Display Clear Terms**: Show customers the installment schedule before order confirmation
3. **Send Reminders**: Configure automated payment reminders before due dates
4. **Handle Failures Gracefully**: Implement proper error handling and fallback options
5. **Monitor Credit Impact**: Track customer payment history to maintain credit scores
6. **Compliance**: Ensure compliance with local BNPL regulations and lending laws
7. **Data Security**: Store customer financial data securely and comply with PCI-DSS

## Testing

Use the following test credentials:

### Test Customer IDs
- `TEST_ELIGIBLE_001` - High credit score (750+)
- `TEST_ELIGIBLE_002` - Medium credit score (650-749)
- `TEST_INELIGIBLE_001` - Low credit score (<650)

### Test Amounts
- ₹5,000 - Should work with all providers
- ₹60,000 - Should only work with Klarna
- ₹150,000 - Should fail with all providers

## Provider-Specific Notes

### Afterpay
- Requires customer redirect for authentication
- Auto-approves orders under certain thresholds
- Supports instant refunds

### Klarna
- Uses client token for frontend integration
- Requires authorization before capture
- Supports partial captures and refunds

### Internal Partners
- Credit score-based approval
- No external redirects required
- Faster settlement times

## Support

For issues or questions:
- Email: bnpl-support@paymentgateway.com
- Documentation: https://docs.paymentgateway.com/bnpl
- API Status: https://status.paymentgateway.com
