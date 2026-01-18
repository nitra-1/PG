# BNPL (Buy Now Pay Later) - Code Trace Document

## Overview
**Payment Type**: BNPL (Buy Now Pay Later)  
**Purpose**: Credit-based payment with installment plans (Pay in 3/6/12)  
**Entry Point**: BNPL Service API  
**Primary File**: `/src/bnpl/bnpl-service.js`

---

## Supported BNPL Partners
**Internal Partners** (Credit scoring via service):
- Simpl
- LazyPay
- ZestMoney
- FlexMoney
- Payl8r

**External Providers** (Dedicated integration):
- **Afterpay** (`/src/bnpl/providers/afterpay-provider.js`)
- **Klarna** (`/src/bnpl/providers/klarna-provider.js`)

---

## Execution Flow

### 1. CHECK ELIGIBILITY
**Function**: `checkEligibility(customerData)`  
**Entry Point**: Before BNPL order creation

#### Flow Steps:
1. **Input Validation**
   - Required: customerId, customerPhone, amount
   - Validate amount > 0

2. **Provider Routing** (`getProvider`)
   - If partner = 'afterpay' or 'klarna':
     - Use dedicated provider class
     - Call `provider.checkEligibility(customerData)`
   - Else: Use internal credit scoring

3. **Credit Assessment** (Internal Partners)
   (`assessCreditScore`)
   - **Interface Point**: Credit Bureau APIs
   - **External Systems**: CIBIL, Experian, Equifax
   - Query customer credit score
   - Factors: Payment history, credit utilization, credit age
   - **Mock**: Returns 720

4. **Eligibility Determination**
   - isEligible: creditScore >= 650 AND amount <= 50000
   - availableLimit: Based on credit score:
     - 750+: ₹50,000
     - 700-749: ₹30,000
     - 650-699: ₹15,000
     - <650: ₹0

5. **Response**
   - Returns: isEligible, creditScore, availableLimit, maxAmount, partner, timestamp

---

### 2. CREATE BNPL ORDER
**Function**: `createBNPLOrder(orderData)`  
**Entry Point**: Customer selects BNPL at checkout

#### Flow Steps:
1. **Input Validation**
   - Required: customerId, amount, orderId, merchantId
   - Optional: partner, installmentPlan

2. **Provider Routing**
   - External provider (Afterpay/Klarna):
     - Check eligibility
     - Call `provider.createOrder(orderData)`
   - Internal partner:
     - Proceed to eligibility check

3. **Eligibility Check** (`checkEligibility`)
   - Validate customer is eligible
   - Validate amount <= availableLimit

4. **BNPL Order Creation**
   - Generate bnplOrderId: `BNPL_{timestamp}`
   - Set installmentPlan: 'PAY_IN_3' (default)
   - Status: 'APPROVED'

5. **Installment Schedule Generation**
   (`generateInstallmentSchedule`)
   - Plans: PAY_IN_3 (3 months), PAY_IN_6 (6 months), PAY_IN_12 (12 months)
   - Calculate per-installment amount: totalAmount / installments
   - Generate schedule with due dates (30 days apart)
   - Each installment: installmentNumber, amount, dueDate, status ('PENDING')

6. **Response**
   - Returns: bnplOrderId, orderId, amount, partner, installmentPlan, installmentSchedule, status, timestamp

---

### 3. PROCESS INSTALLMENT PAYMENT
**Function**: `processInstallment(paymentData)`  
**Entry Point**: Customer pays installment

#### Flow Steps:
1. **Input Validation**
   - Required: bnplOrderId, installmentNumber, amount
   - Optional: paymentMethod

2. **Payment Processing**
   - Generate paymentId: `BNPL_PAY_{timestamp}`
   - Process payment via card/UPI/netbanking
   - Status: 'SUCCESS' (after payment gateway confirmation)

3. **Database Operations**
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - transaction_ref: paymentId
     - order_id: bnplOrderId
     - payment_method: 'bnpl'
     - gateway: 'bnpl'
     - amount, currency: 'INR'
     - status: 'success'
     - metadata: {bnplOrderId, installmentNumber, paymentMethod, paymentType: 'installment'}
     - gateway_transaction_id: paymentId
     - gateway_response_message: "BNPL installment {N} payment"
     - initiated_at, completed_at: current timestamp

4. **Response**
   - Returns: paymentId, installmentNumber, amount, status, timestamp

---

### 4. GET BNPL ORDER
**Function**: `getBNPLOrder(bnplOrderId)`  
**Entry Point**: Check BNPL order status

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions` or dedicated BNPL table
   - **Query**: WHERE order_id = bnplOrderId AND payment_method = 'bnpl'
   - Aggregate installments paid

2. **Response**
   - Returns: bnplOrderId, amount, installmentPlan, status, paidInstallments, pendingInstallments, nextDueDate

---

### 5. GET CUSTOMER BNPL SUMMARY
**Function**: `getCustomerBNPLSummary(customerId)`  
**Entry Point**: Customer BNPL dashboard

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Query**: WHERE customer_id = customerId AND payment_method = 'bnpl'
   - Aggregate all BNPL orders

2. **Credit Score Fetch**
   - Query latest credit score

3. **Response**
   - Returns: totalOrders, activeOrders, totalOutstanding, totalLimit, availableLimit, creditScore, paymentHistory{onTime, late, missed}

---

### 6. SEND PAYMENT REMINDER
**Function**: `sendPaymentReminder(bnplOrderId, installmentNumber)`  
**Entry Point**: Scheduled job for due installments

#### Flow Steps:
1. **Notification Sending**
   - **Interface Point**: SMS/Email service
   - Send reminder to customer
   - Include: dueDate, amount, paymentLink

2. **Response**
   - Returns: reminderSent (true), timestamp

---

### 7. HANDLE LATE PAYMENT
**Function**: `handleLatePayment(latePaymentData)`  
**Entry Point**: System detects overdue installment

#### Flow Steps:
1. **Late Fee Calculation** (`calculateLateFee`)
   - 1-7 days late: ₹100
   - 8-15 days late: ₹250
   - 15+ days late: ₹500

2. **Credit Score Update** (`updateCreditScore`)
   - Negative impact: -10 points per late payment
   - **Interface Point**: Credit Bureau API
   - Report late payment to CIBIL

3. **Response**
   - Returns: lateFee, creditScoreImpact (-10), timestamp

---

## External System Interfaces

### 1. Credit Bureau APIs (CIBIL, Experian)
**Interface Point**: `assessCreditScore(customerId)`  
**Purpose**: Fetch customer credit score

**Request**:
```json
POST https://api.cibil.com/v1/credit-score
{
  "customerId": "CUST_001",
  "customerPAN": "ABCDE1234F",
  "customerPhone": "9876543210"
}
```

**Response**:
```json
{
  "creditScore": 720,
  "creditHistory": {
    "onTimePayments": 24,
    "latePayments": 2,
    "missedPayments": 0
  },
  "creditUtilization": 35,
  "availableLimit": 30000
}
```

---

### 2. Afterpay Provider API
**Interface Point**: `AfterpayProvider.checkEligibility()`, `AfterpayProvider.createOrder()`  
**File**: `/src/bnpl/providers/afterpay-provider.js`

**Eligibility Check**:
```json
POST https://api.afterpay.com/v2/checkout/eligibility
{
  "email": "customer@example.com",
  "phone": "9876543210",
  "amount": 15000,
  "currency": "INR"
}
Response:
{
  "eligible": true,
  "maxAmount": 50000
}
```

**Create Order**:
```json
POST https://api.afterpay.com/v2/checkout/orders
{
  "amount": 15000,
  "currency": "INR",
  "consumer": {...},
  "merchant": {...},
  "billing": {...},
  "items": [...]
}
Response:
{
  "token": "afterpay_token_123",
  "expires": "2024-01-18T10:30:00Z",
  "redirectCheckoutUrl": "https://portal.afterpay.com/checkout?token=..."
}
```

---

### 3. Klarna Provider API
**Interface Point**: `KlarnaProvider.checkEligibility()`, `KlarnaProvider.createOrder()`  
**File**: `/src/bnpl/providers/klarna-provider.js`

Similar to Afterpay, Klarna provides:
- Eligibility check API
- Order creation API
- Payment capture API
- Customer management API

---

### 4. SMS/Email Service
**Interface Point**: `sendPaymentReminder()`  
**Purpose**: Send installment reminders

**SMS Example**:
```
Hi {customerName}, 
Your BNPL installment of ₹{amount} is due on {dueDate}.
Pay now: {paymentLink}
- {merchantName}
```

---

## Database Tables & Operations

### 1. transactions
**Purpose**: Track BNPL orders and installment payments

**BNPL-Specific Fields**:
- payment_method: 'bnpl'
- gateway: 'bnpl'
- metadata: {bnplOrderId, installmentNumber, paymentMethod, paymentType: 'installment'}
- order_id: bnplOrderId (for all installments of same order)

**Operations**:
- **INSERT**: New BNPL order and each installment payment
- **SELECT**: Get BNPL order details, customer summary

---

### 2. bnpl_orders (Optional - if implemented)
**Purpose**: Store BNPL order master data

**Schema**:
```sql
- id (UUID)
- tenant_id (UUID)
- bnpl_order_id (VARCHAR, unique)
- customer_id (VARCHAR, indexed)
- merchant_id (VARCHAR)
- amount (DECIMAL)
- partner (VARCHAR) - simpl, lazypay, etc.
- installment_plan (VARCHAR) - PAY_IN_3/6/12
- credit_score (INT)
- status (ENUM: approved, active, completed, defaulted)
- created_at, updated_at (TIMESTAMP)
```

---

### 3. bnpl_installments (Optional - if implemented)
**Purpose**: Track individual installments

**Schema**:
```sql
- id (UUID)
- bnpl_order_id (VARCHAR, foreign key)
- installment_number (INT)
- amount (DECIMAL)
- due_date (DATE)
- status (ENUM: pending, paid, late, defaulted)
- paid_at (TIMESTAMP)
- late_fee (DECIMAL)
```

---

## Credit Score Integration

### CIBIL (Credit Information Bureau India Limited)
- Score Range: 300-900
- Good: 750+
- Fair: 650-749
- Poor: <650

### Experian
- Similar scoring model to CIBIL
- Real-time credit score API

### Equifax
- Credit score and report API

---

## Security & Compliance

### 1. Credit Score Privacy
- Encrypted storage of credit scores
- Secure API communication with credit bureaus

### 2. RBI Compliance
- BNPL regulations compliance
- Customer consent for credit checks

### 3. Late Payment Reporting
- Timely reporting to credit bureaus
- Customer notification before reporting

---

## Error Handling

### Common Errors:
1. **Eligibility check failed**: Customer not eligible (credit score <650 or amount > limit)
2. **Amount exceeds limit**: Requested amount > availableLimit
3. **Invalid installment plan**: Plan not in [PAY_IN_3, PAY_IN_6, PAY_IN_12]
4. **BNPL order not found**: Invalid bnplOrderId
5. **Credit bureau timeout**: API timeout or network error
6. **Late payment**: Installment overdue

### Retry Logic:
- Credit bureau API: Retry 3 times on network error
- Payment processing: Standard payment retry logic

---

## BNPL Limits & Terms

### Amount Limits:
- Minimum: ₹2,500
- Maximum: ₹50,000 (based on credit score)

### Installment Plans:
- **PAY_IN_3**: 3 monthly installments (most common)
- **PAY_IN_6**: 6 monthly installments
- **PAY_IN_12**: 12 monthly installments

### Interest:
- 0% interest (for most partners)
- Late fee: ₹100-500 based on days overdue

### Credit Score Impact:
- On-time payment: +5 points
- Late payment: -10 points
- Missed payment: -25 points

---

## Configuration Requirements

```javascript
{
  partners: ['simpl', 'lazypay', 'zestmoney', 'flexmoney', 'payl8r', 'afterpay', 'klarna'],
  providers: {
    afterpay: new AfterpayProvider(config),
    klarna: new KlarnaProvider(config)
  },
  creditBureauApiKey: '<cibil_api_key>',
  minCreditScore: 650,
  maxAmount: 50000,
  tenantId: '<merchant_tenant_id>'
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - BNPL as payment method option

2. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record BNPL transactions and installments

3. **Notification Service**
   - Send payment reminders
   - Late payment alerts

---

## Monitoring & Analytics

### Key Metrics:
- Eligibility approval rate
- BNPL order conversion rate
- On-time payment rate
- Late payment rate
- Default rate
- Average credit score

### Logs:
- Eligibility checked: `customerId, eligible, creditScore, availableLimit`
- BNPL order created: `bnplOrderId, amount, installmentPlan`
- Installment paid: `paymentId, installmentNumber, amount`
- Late payment: `bnplOrderId, daysLate, lateFee`

---

## API Endpoints (Typical Integration)

```
POST /api/bnpl/check-eligibility - Check customer eligibility
POST /api/bnpl/create-order - Create BNPL order
POST /api/bnpl/pay-installment - Pay installment
GET  /api/bnpl/orders/:bnplOrderId - Get BNPL order details
GET  /api/bnpl/customer/:customerId/summary - Customer BNPL summary
POST /api/bnpl/send-reminder - Send payment reminder (internal)
```

---

## BNPL vs Traditional Credit

| Feature | BNPL | Traditional Credit Card |
|---------|------|------------------------|
| Credit Check | Soft check (no impact) | Hard check (impacts score) |
| Interest | 0% (usually) | 18-36% annual |
| Approval | Instant | 1-7 days |
| Limit | Order-based | Pre-approved limit |
| Late Fee | ₹100-500 | ₹500+ |
| Credit Impact | Minimal | Significant |
