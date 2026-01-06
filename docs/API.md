# API Documentation

## Overview

The Payment Gateway API provides comprehensive endpoints for payment processing, payouts, and financial services.

## Base URL

```
Production: https://api.paymentgateway.com/v1
Staging: https://staging-api.paymentgateway.com/v1
```

## Authentication

All API requests require authentication using JWT tokens:

```
Authorization: Bearer <your-jwt-token>
```

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Rate Limiting

- Default: 100 requests per minute per API key
- Headers returned:
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Time when limit resets

## Core Endpoints

### Payment Gateway

#### Process Payment
```bash
POST /api/payments/process
```

#### Get Transaction Status
```bash
GET /api/payments/:transactionId
```

#### Refund Transaction
```bash
POST /api/payments/:transactionId/refund
```

### UPI Services

#### Validate VPA
```bash
POST /api/upi/validate-vpa
```

#### Create Collect Request
```bash
POST /api/upi/collect
```

#### Generate QR Code
```bash
POST /api/upi/qr/generate
```

### Pay-in Services

#### Create Payment Order
```bash
POST /api/payin/orders
```

#### Process Payment
```bash
POST /api/payin/orders/:orderId/pay
```

### Payout Services

#### Create Beneficiary
```bash
POST /api/payout/beneficiaries
```

#### Create Payout
```bash
POST /api/payout/payouts
```

#### Create Bulk Payout
```bash
POST /api/payout/payouts/bulk
```

### BNPL Services

#### Check Eligibility
```bash
POST /api/bnpl/eligibility
```

#### Create BNPL Order
```bash
POST /api/bnpl/orders
```

### EMI Services

#### Calculate EMI
```bash
POST /api/emi/calculate
```

#### Get EMI Plans
```bash
GET /api/emi/plans
```

### Biometric Services

#### Register Biometric
```bash
POST /api/biometric/register
```

#### Authenticate with Biometric
```bash
POST /api/biometric/authenticate
```

### Subscription Services

For complete subscription payment documentation, see [SUBSCRIPTION_PAYMENTS.md](SUBSCRIPTION_PAYMENTS.md)

#### Create Subscription Plan
```bash
POST /api/subscriptions/plans
```

#### List Subscription Plans
```bash
GET /api/subscriptions/plans
```

#### Create Subscription
```bash
POST /api/subscriptions
```

#### Get Subscription
```bash
GET /api/subscriptions/:subscriptionId
```

#### Cancel Subscription
```bash
POST /api/subscriptions/:subscriptionId/cancel
```

#### Pause Subscription
```bash
POST /api/subscriptions/:subscriptionId/pause
```

#### Resume Subscription
```bash
POST /api/subscriptions/:subscriptionId/resume
```

#### Process Recurring Payment
```bash
POST /api/subscriptions/:subscriptionId/process-payment
```

#### Get Billing History
```bash
GET /api/subscriptions/:subscriptionId/billing-history
```

#### List Customer Subscriptions
```bash
GET /api/customers/:customerId/subscriptions
```

### Enhanced BNPL Services

For complete BNPL integration documentation, see [BNPL_INTEGRATION.md](BNPL_INTEGRATION.md)

#### Check Eligibility (with Provider Support)
```bash
POST /api/bnpl/eligibility
```
Supports: simpl, lazypay, zestmoney, flexmoney, payl8r, afterpay, klarna

#### Create BNPL Order
```bash
POST /api/bnpl/orders
```

#### Get BNPL Order
```bash
GET /api/bnpl/orders/:bnplOrderId
```

#### Process Installment Payment
```bash
POST /api/bnpl/installments/process
```

#### Get Customer Summary
```bash
GET /api/bnpl/customers/:customerId/summary
```

#### Get Available Providers
```bash
GET /api/bnpl/providers
```

### Enhanced QR Code Services

For complete QR code integration documentation, see [QR_CODE_INTEGRATION.md](QR_CODE_INTEGRATION.md)

#### Generate Static QR
```bash
POST /api/qr/static
```

#### Generate Dynamic QR
```bash
POST /api/qr/dynamic
```

#### Process QR Payment (with Real-time Linking)
```bash
POST /api/qr/:qrCodeId/payment
```

#### Get QR Code Details
```bash
GET /api/qr/:qrCodeId
```

#### Get QR Transactions
```bash
GET /api/qr/:qrCodeId/transactions
```

## Additional Resources

- [BNPL Integration Guide](BNPL_INTEGRATION.md) - Comprehensive guide for BNPL providers
- [Subscription Payments Guide](SUBSCRIPTION_PAYMENTS.md) - Complete subscription billing documentation
- [QR Code Integration Guide](QR_CODE_INTEGRATION.md) - QR code payment implementation guide

For detailed request/response examples, see the full API documentation at https://docs.paymentgateway.com
