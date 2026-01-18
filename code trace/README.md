# Payment Gateway - Code Trace Documentation

## Overview
This directory contains comprehensive code tracing documents for all payment types supported by the Payment Gateway system. Each document provides a detailed execution flow from entry point to completion, including external system interfaces, database operations, and error handling.

---

## Document List

### 1. [PayIn (Collections)](./01_PayIn_CodeTrace.md)
**Payment Type**: Customer payment collection  
**Methods**: Card, UPI, Netbanking, Wallet  
**Key Features**:
- Payment order creation with 30-min expiry
- Multi-gateway routing via PAPG
- Webhook callback handling
- Payment link generation

**External Interfaces**:
- Razorpay, PayU, CCAvenue (via PAPG)
- Merchant webhook callbacks

**Database Tables**:
- `payment_orders` - Order management
- `transactions` - Transaction tracking
- `audit_logs` - Compliance logging

---

### 2. [PayOut (Disbursements)](./02_PayOut_CodeTrace.md)
**Payment Type**: Vendor/beneficiary payouts  
**Methods**: IMPS, NEFT, RTGS, UPI  
**Key Features**:
- Beneficiary management with penny drop verification
- Single and bulk payouts
- Balance checking
- UTR (Unique Transaction Reference) tracking

**External Interfaces**:
- Bank verification APIs (Penny Drop)
- Banking partner payout APIs (RazorpayX, Cashfree)

**Database Tables**:
- `beneficiaries` - Verified bank accounts
- `transactions` - Payout tracking
- `merchants` - Balance management

---

### 3. [UPI](./03_UPI_CodeTrace.md)
**Payment Type**: UPI payments  
**Methods**: Collect request, QR code, Intent  
**Key Features**:
- VPA validation via NPCI
- UPI collect requests (15-min expiry)
- Dynamic QR code generation
- Deep link intent for UPI apps

**External Interfaces**:
- NPCI VPA validation API
- UPI Payment Service Provider (Razorpay, PayU)

**Database Tables**:
- `transactions` - UPI payment tracking

---

### 4. [QR Code](./04_QR_CodeTrace.md)
**Payment Type**: QR code payments  
**Types**: Static QR, Dynamic QR  
**Key Features**:
- Static QR (reusable, no amount)
- Dynamic QR (single-use, with amount, 30-min expiry)
- Real-time transaction tracking (in-memory + database)
- Webhook callback processing
- QR analytics and usage stats

**External Interfaces**:
- UPI Payment Service Provider webhooks
- QRCode library (npm)

**Database Tables**:
- `transactions` - QR payment tracking

---

### 5. [Wallet](./05_Wallet_CodeTrace.md)
**Payment Type**: Digital wallet payments  
**Supported**: Paytm, PhonePe, Google Pay, Amazon Pay, MobiKwik, Freecharge  
**Key Features**:
- Wallet payment initiation with deep links
- Balance checking
- P2P wallet transfers
- Add money to wallet
- Wallet linking with OTP

**External Interfaces**:
- Paytm API
- PhonePe deep links
- Google Pay deep links
- Amazon Pay API
- MobiKwik API
- Freecharge API

**Database Tables**:
- `transactions` - Wallet payment tracking
- `wallet_links` - Merchant-customer wallet associations

---

### 6. [BNPL (Buy Now Pay Later)](./06_BNPL_CodeTrace.md)
**Payment Type**: Credit-based installment payments  
**Partners**: Simpl, LazyPay, ZestMoney, FlexMoney, Payl8r, Afterpay, Klarna  
**Key Features**:
- Credit eligibility checking (650+ credit score)
- BNPL order creation with installment plans (Pay in 3/6/12)
- Installment processing
- Late payment handling with fees
- Credit score impact tracking

**External Interfaces**:
- CIBIL, Experian credit bureau APIs
- Afterpay API (dedicated provider)
- Klarna API (dedicated provider)
- SMS/Email service for reminders

**Database Tables**:
- `transactions` - BNPL order and installment tracking
- `bnpl_orders` - Master order data
- `bnpl_installments` - Individual installment tracking

---

### 7. [EMI (Equated Monthly Installment)](./07_EMI_CodeTrace.md)
**Payment Type**: Card-based EMI  
**Bank Partners**: HDFC, ICICI, SBI, Axis, Kotak  
**Key Features**:
- EMI calculation using formula: P × r × (1+r)^n / ((1+r)^n - 1)
- Available EMI plans (3-24 months)
- EMI eligibility checking with banks
- Repayment schedule generation
- EMI foreclosure with charges

**External Interfaces**:
- Bank EMI eligibility APIs (HDFC, ICICI, SBI, Axis, Kotak)
- Bank EMI conversion APIs
- Auto-debit setup (Standing Instruction / NACH)

**Database Tables**:
- `transactions` - EMI transaction and installment tracking
- `emi_transactions` - Master EMI data
- `emi_installments` - Individual installment tracking

---

### 8. [Subscription/Recurring](./08_Subscription_CodeTrace.md)
**Payment Type**: Recurring billing  
**Intervals**: Daily, Weekly, Monthly, Yearly  
**Key Features**:
- Subscription plan creation
- Customer subscription management
- Recurring payment processing (auto-charge)
- Trial period support
- Subscription pause/resume/cancel
- Billing history and upcoming invoices

**External Interfaces**:
- Payment gateway subscription APIs (Razorpay, Stripe)
- Email notification service

**Database Tables**:
- `subscriptions` - Active subscriptions
- `subscription_plans` - Plan definitions
- `transactions` - Recurring payment tracking

---

### 9. [Biometric Authentication](./09_Biometric_CodeTrace.md)
**Payment Type**: Biometric-authenticated payments  
**Types**: Fingerprint, Face Recognition, Aadhaar, Iris  
**Key Features**:
- Biometric registration with encryption (AES-256-GCM)
- Biometric authentication with liveness detection
- Multi-modal biometric support
- Device binding
- Authentication token generation (5-min expiry)

**External Interfaces**:
- UIDAI Aadhaar authentication API
- AWS Rekognition (face recognition)
- Face-api.js
- Device fingerprint/Face ID APIs
- Iris recognition SDKs

**Database Tables**:
- `biometric_registrations` - Encrypted biometric templates
- `biometric_auth_logs` - Authentication attempt audit trail
- `transactions` - Biometric payment tracking

---

### 10. [PAPG (Payment Aggregator)](./10_PAPG_CodeTrace.md)
**Payment Type**: Smart gateway routing  
**Gateways**: Razorpay (95.5% success), PayU (94% success), CCAvenue (93% success)  
**Key Features**:
- Intelligent gateway selection based on:
  - Amount (>₹50k → Razorpay)
  - Payment method (UPI → PayU)
  - Performance (success rate + latency + cost)
- Automatic failover (max 2 retries)
- Circuit breaker pattern
- Real-time metrics update
- Cost optimization

**External Interfaces**:
- Razorpay API
- PayU API
- CCAvenue API

**Database Tables**:
- `circuit_breakers` - Gateway health state
- `gateway_metrics` - Historical performance
- `gateway_routing_logs` - Routing decision audit

---

## Document Structure

Each code trace document follows this consistent structure:

1. **Overview** - Payment type, purpose, entry point, primary file
2. **Execution Flow** - Step-by-step function execution with detailed flows
3. **External System Interfaces** - Gateway integrations, API calls, request/response formats
4. **Database Tables & Operations** - Table schemas, CRUD operations, indexes
5. **Security & Compliance** - Encryption, authentication, regulatory compliance
6. **Error Handling** - Common errors, retry logic, failure scenarios
7. **Configuration Requirements** - Required config parameters, API keys
8. **Related Services** - Dependencies on other services
9. **Monitoring & Analytics** - Key metrics, logs, dashboards
10. **API Endpoints** - Typical REST API endpoints for the payment type

---

## Key Statistics

- **Total Documents**: 10
- **Total Lines**: 5,326
- **Total Words**: 16,594
- **Average Document Size**: ~533 lines, ~1,659 words

---

## Payment Type Comparison

| Payment Type | Min Amount | Max Amount | Processing Time | Success Rate | Key Feature |
|--------------|------------|------------|-----------------|--------------|-------------|
| PayIn | ₹1 | No limit | 2-5 seconds | 94-96% (gateway-dependent) | Multi-method support |
| PayOut | ₹1 | No limit | 10-30 seconds (IMPS) | 98% | UTR tracking |
| UPI | ₹1 | ₹1,00,000 | 1-2 seconds | 96% | Instant transfer |
| QR Code | ₹1 | ₹1,00,000 | 1-2 seconds | 96% | Contactless |
| Wallet | ₹1 | ₹1,00,000 | 1-2 seconds | 95% | Pre-loaded balance |
| BNPL | ₹2,500 | ₹50,000 | 5-10 seconds | 90% | 0% interest |
| EMI | ₹2,500 | No limit | 5-10 seconds | 92% | Bank partnership |
| Subscription | ₹1 | No limit | 2-5 seconds | 94% | Automated billing |
| Biometric | ₹1 | No limit | 1-2 seconds | 99.5% | High security |
| PAPG | N/A | N/A | Variable | 95%+ | Smart routing |

---

## Gateway Integration Summary

### Primary Gateways
1. **Razorpay** - 95.5% success, ₹2.0/txn, 250ms latency
2. **PayU** - 94.0% success, ₹1.8/txn, 300ms latency
3. **CCAvenue** - 93.0% success, ₹2.2/txn, 350ms latency

### BNPL Providers
- Simpl, LazyPay, ZestMoney (internal credit scoring)
- Afterpay, Klarna (external providers with dedicated APIs)

### Bank Partners
- EMI: HDFC, ICICI, SBI, Axis, Kotak
- Payout: RazorpayX, Cashfree, Direct bank APIs

### Wallet Providers
- Paytm, PhonePe, Google Pay, Amazon Pay, MobiKwik, Freecharge

### Credit Bureaus
- CIBIL, Experian, Equifax

### Government APIs
- NPCI (UPI VPA validation)
- UIDAI (Aadhaar biometric authentication)

---

## Database Schema Overview

### Core Tables
- `transactions` - Universal transaction tracking (all payment types)
- `payment_orders` - Order management (PayIn)
- `merchants` - Merchant accounts and balances
- `audit_logs` - Compliance and security audit trail

### Payment-Specific Tables
- `beneficiaries` - Payout recipients
- `bnpl_orders`, `bnpl_installments` - BNPL tracking
- `emi_transactions`, `emi_installments` - EMI tracking
- `subscriptions`, `subscription_plans` - Recurring billing
- `biometric_registrations`, `biometric_auth_logs` - Biometric auth
- `circuit_breakers`, `gateway_metrics` - PAPG routing

### Ledger Tables
- `ledger_accounts` - Chart of accounts
- `ledger_transactions` - Double-entry transactions
- `ledger_entries` - Individual debit/credit entries
- `settlements` - Settlement tracking
- `reconciliation_batches` - Reconciliation management

---

## Security Features

### Encryption
- **Biometric Templates**: AES-256-GCM
- **Card Data**: Never stored, tokenized via gateway
- **PII**: Encrypted at rest, masked in logs

### Authentication
- **Webhooks**: HMAC-SHA256 signature verification
- **APIs**: JWT tokens, API key + secret
- **Biometric**: Multi-factor with liveness detection

### Compliance
- **PCI-DSS**: Level 1 compliant
- **RBI Guidelines**: BNPL, EMI, Payout regulations
- **GDPR/CCPA**: Data privacy and right to erasure
- **UIDAI Act**: Aadhaar data protection

---

## Monitoring & Observability

### Key Metrics
- Transaction success rate (overall and per payment type)
- Gateway performance (latency, success rate, cost)
- Circuit breaker events
- Failed payment reasons
- Fraud detection alerts
- Settlement reconciliation status

### Logging
- Transaction lifecycle events
- Gateway routing decisions
- Authentication attempts
- Error and exception tracking
- Audit trail for compliance

---

## Use This Documentation

### For Developers
- Understand execution flow for bug fixing
- Identify database tables for feature development
- Review external API integrations
- Implement error handling

### For System Architects
- Design new payment methods
- Optimize gateway routing
- Plan database schema changes
- Assess security requirements

### For QA Engineers
- Write test cases covering all flows
- Validate error scenarios
- Test external API mocks
- Verify data integrity

### For DevOps
- Configure monitoring alerts
- Set up API keys and secrets
- Deploy circuit breaker configuration
- Manage database migrations

---

## Version History

- **v1.0** (2024-01-18) - Initial release with 10 payment types
  - PayIn, PayOut, UPI, QR, Wallet
  - BNPL, EMI, Subscription
  - Biometric, PAPG

---

## Contributing

To add or update a code trace document:
1. Follow the established structure (10 sections)
2. Include execution flows with step-by-step details
3. Document all external API integrations
4. Specify database tables and operations
5. Add security and compliance considerations
6. Update this README with new payment type

---

## Contact

For questions or clarifications about these documents:
- Review the source code in `/src/<payment-type>/`
- Check database migrations in `/src/database/migrations/`
- Refer to API documentation in `/docs/`

---

**Last Updated**: 2024-01-18  
**Total Payment Types Documented**: 10  
**Documentation Coverage**: 100%
