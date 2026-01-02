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

For detailed request/response examples, see the full API documentation at https://docs.paymentgateway.com
