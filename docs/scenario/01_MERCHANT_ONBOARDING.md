# Merchant Onboarding Process

## Table of Contents
1. [Overview](#overview)
2. [Pre-Onboarding Phase](#pre-onboarding-phase)
3. [Onboarding Steps](#onboarding-steps)
4. [Post-Onboarding Activities](#post-onboarding-activities)
5. [Timeline](#timeline)
6. [Merchant-Specific Examples](#merchant-specific-examples)

## Overview

The merchant onboarding process is designed to be comprehensive yet efficient, ensuring that merchants can start accepting payments within 7-10 business days while maintaining strict security and compliance standards.

### Onboarding Objectives
- Verify merchant identity and business legitimacy
- Assess risk profile
- Configure payment methods and pricing
- Set up technical integration
- Ensure compliance with regulations
- Enable merchant for live transactions

## Pre-Onboarding Phase

### Initial Contact and Requirements Gathering

#### 1. Business Information Required
- **Business Details**
  - Legal business name
  - Business type (Pvt Ltd, LLP, Partnership, Proprietorship)
  - Date of incorporation
  - Business address (registered and operational)
  - Website URL
  - Business description and category
  - Expected monthly transaction volume
  - Average ticket size

- **Contact Information**
  - Primary contact person (Owner/Director)
  - Technical contact person
  - Finance/Accounts contact person
  - Phone numbers and email addresses

#### 2. Documentation Checklist

**For Private Limited Companies:**
- Certificate of Incorporation
- PAN Card of the company
- GST Registration Certificate
- Current account statement (last 6 months)
- Board resolution for payment gateway integration
- MOA/AOA
- Directors' KYC (PAN, Aadhaar, Address proof)

**For Partnerships/Proprietorships:**
- Partnership deed / Proprietorship proof
- PAN Card
- GST Registration Certificate
- Bank account statement
- Partners'/Proprietor's KYC documents

**For All Business Types:**
- Cancelled cheque (for settlement account)
- Website screenshots
- Product/Service catalog
- Privacy policy and Terms & Conditions URLs

#### 3. Technical Requirements
- Website/Application details
- Expected integration timeline
- Development team contact
- Server and hosting information
- SSL certificate status
- Preferred integration method (API, SDK, Plugin)

## Onboarding Steps

### Step 1: Application Submission (Day 0)
**Duration**: 30 minutes

1. **Access Merchant Portal**
   - Visit: https://merchant.paymentgateway.com/signup
   - Create merchant account with email verification

2. **Fill Application Form**
   ```
   - Business Information
   - Contact Details
   - Bank Account Information
   - Expected Transaction Volume
   - Payment Methods Required
   ```

3. **Upload Documents**
   - Use document upload portal
   - Ensure all documents are clear and valid
   - Maximum file size: 5MB per document

4. **Submit Application**
   - Review all information
   - Accept terms and conditions
   - Submit for review

**Output**: Application ID generated (e.g., APP-2024-12345)

---

### Step 2: Initial Review and Due Diligence (Day 1-2)
**Duration**: 1-2 business days

**Our Team Activities:**

1. **Document Verification**
   - Verify authenticity of submitted documents
   - Cross-check with government databases
   - Validate business registration

2. **Risk Assessment**
   - Business category risk evaluation
   - Transaction volume analysis
   - Fraud risk scoring
   - AML screening

3. **Website/Product Review**
   - Verify business operations
   - Check for prohibited products/services
   - Ensure compliance with policies

4. **Credit Check**
   - Business credit score
   - Promoter/Director background check
   - Banking relationship verification

**Merchant Communication:**
- Email notification of initial review status
- Request for additional information if needed
- Estimated timeline provided

---

### Step 3: KYC Verification (Day 2-3)
**Duration**: 1 business day

1. **Video KYC (for Directors/Proprietors)**
   - Schedule video call with compliance team
   - Identity verification
   - Business location verification
   - Duration: 15-20 minutes

2. **Bank Account Verification**
   - Penny drop test (₹1 deposit)
   - Account holder name match
   - Account status verification

3. **Business Verification**
   - Physical address verification (if required)
   - Phone verification
   - Email verification

**Verification Methods:**
```json
{
  "panVerification": "DigiLocker API / NSDL",
  "gstVerification": "GST API",
  "bankVerification": "Penny Drop / Bank Statement",
  "addressVerification": "Google Maps / Physical Visit",
  "identityVerification": "Aadhaar eKYC / Video KYC"
}
```

---

### Step 4: Agreement and Pricing (Day 3-4)
**Duration**: 1 business day

1. **Pricing Structure Determination**

Based on business volume and type:

| Merchant | Monthly Volume | Pricing Tier | MDR Rate |
|----------|---------------|--------------|----------|
| FashionHub | ₹50 lakhs | Standard | UPI: 0%, Cards: 1.8% |
| TechGadgets | ₹1.2 crores | Premium | UPI: 0%, Cards: 1.5% |
| GroceryQuick | ₹80 lakhs | Standard | UPI: 0%, Cards: 1.8% |
| BookWorld | ₹30 lakhs | Basic | UPI: 0%, Cards: 2.0% |
| HomeDecor | ₹2 crores | Enterprise | UPI: 0%, Cards: 1.2% |

2. **Service Agreement**
   - Digital agreement sent via email
   - Terms and conditions
   - Pricing details
   - Service level agreement (SLA)
   - Settlement terms

3. **Agreement Signing**
   - eSign using Aadhaar eKYC
   - Or physical signature with stamp
   - Upload signed copy

---

### Step 5: Account Configuration (Day 4-5)
**Duration**: 1 business day

1. **Merchant Account Creation**
   ```json
   {
     "merchantId": "MERCH_FH_001",
     "merchantName": "FashionHub Pvt Ltd",
     "status": "active",
     "tier": "standard",
     "createdAt": "2024-01-15T10:00:00Z"
   }
   ```

2. **Payment Methods Configuration**
   ```json
   {
     "enabledMethods": [
       "upi",
       "credit_card",
       "debit_card",
       "net_banking",
       "wallet",
       "bnpl"
     ],
     "cardNetworks": ["visa", "mastercard", "rupay", "amex"],
     "upiProviders": ["phonepe", "gpay", "paytm"],
     "wallets": ["paytm", "phonepe", "amazonpay"]
   }
   ```

3. **Settlement Configuration**
   ```json
   {
     "settlementCycle": "T+1",
     "settlementAccount": {
       "accountNumber": "1234567890",
       "ifscCode": "HDFC0001234",
       "accountHolderName": "FashionHub Pvt Ltd"
     },
     "minimumSettlementAmount": 100,
     "autoSettlement": true
   }
   ```

4. **Security Configuration**
   ```json
   {
     "ipWhitelist": ["203.0.113.10", "203.0.113.11"],
     "webhookUrl": "https://fashionhub.com/webhook/payment",
     "webhookSecret": "generated_secret_key",
     "encryptionEnabled": true,
     "twoFactorAuth": true
   }
   ```

---

### Step 6: API Credentials Generation (Day 5)
**Duration**: Few hours

1. **Generate API Keys**
   ```json
   {
     "environment": "sandbox",
     "apiKey": "pk_test_FH_abc123def456",
     "apiSecret": "sk_test_FH_xyz789uvw456",
     "webhookSecret": "whsec_FH_test_secret123"
   }
   ```

2. **Merchant Dashboard Access**
   - Login credentials sent to registered email
   - Two-factor authentication setup
   - Dashboard URL: https://merchant.paymentgateway.com

3. **Developer Documentation Access**
   - API documentation
   - Integration guides
   - SDK downloads
   - Code samples

---

### Step 7: Sandbox Testing (Day 5-7)
**Duration**: 2-3 business days

1. **Technical Integration Setup**

Merchant's technical team activities:

```javascript
// Step 1: Install SDK
npm install @paymentgateway/node-sdk

// Step 2: Initialize
const PaymentGateway = require('@paymentgateway/node-sdk');
const pg = new PaymentGateway({
  apiKey: 'pk_test_FH_abc123def456',
  apiSecret: 'sk_test_FH_xyz789uvw456',
  environment: 'sandbox'
});

// Step 3: Create test order
const order = await pg.orders.create({
  amount: 1000,
  currency: 'INR',
  customerId: 'CUST_TEST_001',
  customerEmail: 'test@fashionhub.com',
  customerPhone: '+919876543210',
  description: 'Test Order #1'
});

console.log('Order ID:', order.id);
```

2. **Test Scenarios**
   - ✅ Successful UPI payment
   - ✅ Successful card payment
   - ✅ Failed payment handling
   - ✅ Refund processing
   - ✅ Webhook notifications
   - ✅ Order status check
   - ✅ Settlement report generation

3. **Test Cards Provided**
   ```
   Success Card:
   Number: 4111 1111 1111 1111
   CVV: 123
   Expiry: 12/25
   
   Failure Card:
   Number: 4000 0000 0000 0002
   CVV: 123
   Expiry: 12/25
   
   Test UPI IDs:
   success@pgtestupi
   failure@pgtestupi
   ```

4. **Integration Checklist**
   - [ ] Order creation successful
   - [ ] Payment processing working
   - [ ] Webhook receiving events
   - [ ] Refund API working
   - [ ] Error handling implemented
   - [ ] Security best practices followed
   - [ ] HTTPS enabled on website
   - [ ] Signature verification implemented

---

### Step 8: UAT (User Acceptance Testing) (Day 7-8)
**Duration**: 1-2 business days

1. **Merchant Testing**
   - End-to-end payment flow testing
   - UI/UX validation
   - Mobile responsiveness check
   - All payment methods testing

2. **Our Team Review**
   - Integration quality check
   - Security audit
   - Performance testing
   - Error handling review

3. **Sign-off**
   - Merchant confirms UAT success
   - Technical checklist completion
   - Go-live readiness assessment

---

### Step 9: Production Credentials (Day 9)
**Duration**: Few hours

1. **Generate Production Keys**
   ```json
   {
     "environment": "production",
     "apiKey": "pk_live_FH_abc123def456prod",
     "apiSecret": "sk_live_FH_xyz789uvw456prod",
     "webhookSecret": "whsec_FH_live_secret123prod"
   }
   ```

2. **Production Configuration**
   - Update webhook URLs
   - Verify IP whitelist
   - Enable production payment methods
   - Configure settlement accounts

3. **Security Hardening**
   - SSL certificate verification
   - API rate limiting configuration
   - DDoS protection enabled
   - Fraud detection rules activated

---

### Step 10: Go-Live (Day 10)
**Duration**: 1 business day

1. **Production Deployment**
   - Merchant updates credentials to production keys
   - Deploys to production environment
   - Smoke testing in production

2. **Go-Live Checklist**
   - [ ] Production credentials configured
   - [ ] Webhook receiving live events
   - [ ] SSL certificate valid
   - [ ] Domain verified
   - [ ] Support team notified
   - [ ] Monitoring enabled
   - [ ] First transaction completed successfully

3. **First Transaction Monitoring**
   - Our team monitors first 10 transactions
   - Immediate support for any issues
   - Performance metrics review

4. **Go-Live Communication**
   ```
   Subject: Congratulations! FashionHub is now LIVE 🎉
   
   Dear FashionHub Team,
   
   Your payment gateway integration is now live and ready to accept payments!
   
   Merchant ID: MERCH_FH_001
   Go-Live Date: January 15, 2024
   Enabled Payment Methods: UPI, Cards, Wallets, Net Banking
   
   Dashboard: https://merchant.paymentgateway.com
   Support: merchant-support@paymentgateway.com
   
   Your dedicated account manager: John Doe (+91-98765-43210)
   
   Thank you for choosing us!
   ```

## Post-Onboarding Activities

### Week 1: Close Monitoring
- Daily transaction monitoring
- Daily settlement verification
- Quick support response
- Technical assistance if needed

### Month 1: Regular Check-ins
- Weekly calls with merchant
- Performance review
- Address any concerns
- Optimize payment methods

### Ongoing Support
- 24/7 technical support
- Dedicated account manager
- Quarterly business review
- Feature updates and improvements

## Timeline

### Complete Onboarding Timeline

```
Day 0:   Application Submission
Day 1-2: Document Verification & Risk Assessment
Day 3:   KYC Completion
Day 4:   Agreement Signing
Day 5:   Account Setup & API Credentials
Day 5-7: Sandbox Testing
Day 7-8: UAT
Day 9:   Production Credentials
Day 10:  Go-Live

Total: 10 business days
```

### Fast Track (Premium Merchants)
For high-volume merchants (like TechGadgets and HomeDecor):
- 5-7 business days timeline
- Dedicated onboarding manager
- Priority support

## Merchant-Specific Examples

### Example 1: FashionHub Onboarding Journey

**Business Profile:**
- Category: Fashion & Apparel
- Monthly Volume: ₹50 lakhs
- Average Ticket: ₹2,500

**Onboarding Timeline:**
- Application: January 5, 2024
- KYC Complete: January 7, 2024
- Sandbox Testing: January 8-10, 2024
- Go-Live: January 15, 2024

**Configuration:**
```json
{
  "merchantId": "MERCH_FH_001",
  "paymentMethods": ["upi", "cards", "wallets"],
  "settlementCycle": "T+1",
  "mdrRates": {
    "upi": "0%",
    "cards": "1.8%",
    "wallets": "1.5%"
  }
}
```

### Example 2: TechGadgets Onboarding Journey

**Business Profile:**
- Category: Electronics
- Monthly Volume: ₹1.2 crores
- Average Ticket: ₹8,000

**Special Requirements:**
- EMI options needed
- Higher ticket size
- COD to prepaid conversion

**Onboarding Timeline:**
- Fast-track: 7 days
- Additional EMI setup: 2 days

**Configuration:**
```json
{
  "merchantId": "MERCH_TG_002",
  "paymentMethods": ["cards", "emi", "netbanking", "upi"],
  "emiTenures": [3, 6, 9, 12, 18, 24],
  "minimumEmiAmount": 5000,
  "settlementCycle": "T+1",
  "mdrRates": {
    "upi": "0%",
    "cards": "1.5%",
    "emi": "varies by tenure"
  }
}
```

### Example 3: GroceryQuick Onboarding Journey

**Business Profile:**
- Category: Grocery & Food
- Monthly Volume: ₹80 lakhs
- Average Ticket: ₹1,200

**Special Requirements:**
- High transaction frequency
- BNPL integration
- Quick settlement needed

**Configuration:**
```json
{
  "merchantId": "MERCH_GQ_003",
  "paymentMethods": ["upi", "wallets", "bnpl", "cards"],
  "bnplProvider": "integrated",
  "maxBnplAmount": 5000,
  "settlementCycle": "T+1",
  "highVolumeDiscounts": true
}
```

## Compliance Requirements

### Mandatory Compliance
- PCI-DSS Level 1 (handled by platform)
- RBI Payment Aggregator Guidelines
- Data Privacy (GDPR, DPDP Act)
- KYC/AML regulations
- GST compliance

### Merchant Responsibilities
- Maintain valid business licenses
- Update KYC documents when changed
- Comply with refund policies
- Provide accurate product/service information
- Respond to chargebacks promptly

## Support During Onboarding

### Dedicated Support Team
- Onboarding Manager: Assigned from Day 1
- Technical Support: 24/7 availability
- Compliance Team: For documentation queries
- Account Manager: Post go-live support

### Communication Channels
- Email: onboarding@paymentgateway.com
- Phone: +91-80-1234-5678
- WhatsApp: +91-98765-43210
- Slack: Dedicated channel for each merchant

### Resources
- Onboarding Portal: https://onboard.paymentgateway.com
- Documentation: https://docs.paymentgateway.com
- Video Tutorials: https://learn.paymentgateway.com
- Developer Community: https://community.paymentgateway.com

---

**Next Steps**: After successful onboarding, proceed to [Payment Processing Flow](02_PAYMENT_PROCESSING.md) to understand how payments are processed.
