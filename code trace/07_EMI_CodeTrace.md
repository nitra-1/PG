# EMI (Equated Monthly Installment) - Code Trace Document

## Overview
**Payment Type**: EMI (Equated Monthly Installment)  
**Purpose**: Card-based EMI with bank partner integration  
**Entry Point**: EMI Service API  
**Primary File**: `/src/emi/emi-service.js`

---

## Supported Bank Partners
- **HDFC Bank**
- **ICICI Bank**
- **SBI (State Bank of India)**
- **Axis Bank**
- **Kotak Mahindra Bank**

---

## EMI Plans
- **3 months** - 12% interest (min ₹2,500)
- **6 months** - 13% interest (min ₹5,000)
- **9 months** - 14% interest (min ₹10,000)
- **12 months** - 15% interest (min ₹10,000)
- **18 months** - 16% interest (min ₹20,000)
- **24 months** - 17% interest (min ₹20,000)

---

## Execution Flow

### 1. CALCULATE EMI
**Function**: `calculateEMI(emiData)`  
**Entry Point**: Display EMI breakdown to customer

#### Flow Steps:
1. **Input Validation**
   - Required: principal, rateOfInterest, tenure
   - Validate: principal > 0, rateOfInterest >= 0, tenure > 0

2. **Monthly Interest Rate Calculation**
   - monthlyRate = rateOfInterest / 12 / 100

3. **EMI Calculation**
   - **Formula**: `EMI = P × r × (1+r)^n / ((1+r)^n - 1)`
   - P = Principal amount
   - r = Monthly interest rate
   - n = Tenure in months
   
   **Special Case**: If interest = 0
   - EMI = principal / tenure

4. **Total Calculation**
   - totalPayment = emi × tenure
   - totalInterest = totalPayment - principal

5. **Response**
   - Returns: emi, principal, rateOfInterest, tenure, totalPayment, totalInterest (rounded to 2 decimals)

**Example**:
```
Principal: ₹30,000
Rate: 15% annual
Tenure: 12 months
Monthly EMI: ₹2,650
Total Payment: ₹31,800
Total Interest: ₹1,800
```

---

### 2. GET AVAILABLE EMI PLANS
**Function**: `getAvailableEMIPlans(queryData)`  
**Entry Point**: Show EMI options at checkout

#### Flow Steps:
1. **Input Validation**
   - Required: amount
   - Validate: amount > 0

2. **Plan Generation**
   - Based on amount thresholds:
     - ≥₹2,500: 3-month plan (12% interest)
     - ≥₹5,000: 6-month plan (13% interest)
     - ≥₹10,000: 9-month and 12-month plans (14-15% interest)
     - ≥₹20,000: 18-month and 24-month plans (16-17% interest)

3. **EMI Calculation**
   - For each eligible plan, calculate EMI using `calculateEMI()`
   - Add bank info (default: 'hdfc')

4. **Response**
   - Returns: Array of plans with tenure, rateOfInterest, bank, emi, totalPayment, totalInterest

---

### 3. CREATE EMI TRANSACTION
**Function**: `createEMITransaction(emiData)`  
**Entry Point**: Customer selects EMI option

#### Flow Steps:
1. **Input Validation** (`validateEMIData`)
   - Required: customerId, orderId, amount, cardNumber, bank, tenure
   - Validate:
     - amount >= 2500 (minimum EMI amount)
     - bank in ['hdfc', 'icici', 'sbi', 'axis', 'kotak']

2. **EMI Eligibility Check** (`checkEMIEligibility`)
   - **Interface Point**: Bank EMI Eligibility API
   - **External System**: Partner Bank
   - Validate:
     - Card is EMI-eligible
     - Card limit sufficient for transaction
     - Customer creditworthiness
   
   **Request**:
   ```json
   POST https://api.hdfc.com/v1/emi/check-eligibility
   {
     "cardNumber": "************1234",
     "amount": 30000,
     "tenure": 12,
     "merchantId": "MERCHANT_001"
   }
   ```
   
   **Response**:
   ```json
   {
     "eligible": true,
     "processingFee": 199,
     "effectiveInterestRate": 15.0,
     "emiAmount": 2650
   }
   ```

3. **EMI Calculation**
   - Use provided rateOfInterest and tenure
   - Calculate monthly EMI, totalPayment, totalInterest

4. **EMI Transaction Creation**
   - Generate emiTransactionId: `EMI_{timestamp}`
   - Store: orderId, customerId, amount
   - Card: Last 4 digits only (PCI-DSS compliance)
   - Bank, tenure, rateOfInterest
   - monthlyEMI, totalPayment, totalInterest
   - Status: 'APPROVED'
   - startDate: Current date

5. **Repayment Schedule Generation**
   (`generateRepaymentSchedule`)
   - Create array of installments (tenure count)
   - Each installment:
     - installmentNumber (1 to tenure)
     - amount: monthlyEMI
     - dueDate: startDate + N months
     - status: 'PENDING'
     - paidAmount: 0
     - paidDate: null

6. **Response**
   - Returns: emiTransactionId, orderId, monthlyEMI, tenure, totalPayment, totalInterest, repaymentSchedule, status, timestamp

---

### 4. PROCESS EMI INSTALLMENT
**Function**: `processEMIInstallment(paymentData)`  
**Entry Point**: Monthly auto-debit or manual payment

#### Flow Steps:
1. **Input Validation**
   - Required: emiTransactionId, installmentNumber, amount
   - Optional: paymentMethod

2. **Payment Processing**
   - **Interface Point**: Payment Gateway / Bank Auto-Debit
   - Generate paymentId: `EMI_PAY_{timestamp}`
   - Deduct amount from card
   - Status: 'SUCCESS' after gateway confirmation

3. **Database Operations**
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - transaction_ref: paymentId
     - order_id: emiTransactionId
     - payment_method: 'emi'
     - gateway: 'emi'
     - amount, currency: 'INR'
     - status: 'success'
     - metadata: {emiTransactionId, installmentNumber, paymentMethod, paymentType: 'installment'}
     - gateway_transaction_id: paymentId
     - gateway_response_message: "EMI installment {N} payment"
     - initiated_at, completed_at: current timestamp

4. **Response**
   - Returns: paymentId, installmentNumber, amount, status, timestamp

---

### 5. GET EMI TRANSACTION
**Function**: `getEMITransaction(emiTransactionId)`  
**Entry Point**: Check EMI status

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Query**: WHERE order_id = emiTransactionId AND payment_method = 'emi'
   - Aggregate paid vs pending installments

2. **Response**
   - Returns: emiTransactionId, amount, monthlyEMI, tenure, status, paidInstallments, pendingInstallments, nextDueDate

---

### 6. FORECLOSE EMI
**Function**: `foreCloseEMI(foreClosureData)`  
**Entry Point**: Customer requests early closure

#### Flow Steps:
1. **Get EMI Transaction**
   - Fetch current EMI details

2. **Calculate Foreclosure Amount**
   - foreClosureCharges = monthlyEMI × 0.05 (5% of monthly EMI)
   - remainingAmount = monthlyEMI × pendingInstallments
   - totalForeclosureAmount = remainingAmount + foreClosureCharges

3. **Response**
   - Returns: emiTransactionId, foreClosureAmount, foreClosureCharges, remainingAmount, timestamp

---

### 7. GET CUSTOMER EMI SUMMARY
**Function**: `getCustomerEMISummary(customerId)`  
**Entry Point**: Customer EMI dashboard

#### Flow Steps:
1. **Database Query**
   - **Table**: `transactions`
   - **Query**: WHERE customer_id = customerId AND payment_method = 'emi'
   - Aggregate all EMI transactions

2. **Response**
   - Returns: totalEMIs, activeEMIs, totalOutstanding, monthlyDue, nextDueDate

---

## External System Interfaces

### 1. Bank EMI Eligibility API
**Interface Point**: `checkEMIEligibility(eligibilityData)`  
**Purpose**: Validate card eligibility for EMI

**HDFC Example**:
```json
POST https://api.hdfc.com/v1/emi/eligibility
Headers: 
  Authorization: Bearer <bank_api_key>
Body:
{
  "cardNumber": "************1234",
  "amount": 30000,
  "tenure": 12,
  "merchantId": "MERCHANT_001",
  "merchantCategory": "ELECTRONICS"
}
Response:
{
  "eligible": true,
  "minAmount": 2500,
  "maxAmount": 200000,
  "availableTenures": [3, 6, 9, 12, 18, 24],
  "processingFee": 199,
  "interestRate": 15.0
}
```

---

### 2. Bank EMI Conversion API
**Interface Point**: Called after transaction for EMI conversion

**Request**:
```json
POST https://api.hdfc.com/v1/emi/convert
{
  "transactionId": "TXN_123",
  "cardNumber": "************1234",
  "amount": 30000,
  "tenure": 12,
  "interestRate": 15.0,
  "startDate": "2024-02-01"
}
Response:
{
  "emiReferenceNumber": "EMI_HDFC_456",
  "monthlyEMI": 2650,
  "firstEMIDate": "2024-02-01",
  "lastEMIDate": "2025-01-01",
  "schedule": [...]
}
```

---

### 3. Auto-Debit Setup
**Interface Point**: For automatic monthly deductions

**Standing Instruction (SI) / NACH**:
- Bank sets up auto-debit
- Monthly EMI automatically deducted from card
- Customer notified via SMS/Email

---

## Database Tables & Operations

### 1. transactions
**Purpose**: Track EMI transactions and installment payments

**EMI-Specific Fields**:
- payment_method: 'emi'
- gateway: 'emi'
- metadata: {emiTransactionId, installmentNumber, paymentMethod, paymentType: 'installment', bank, tenure}
- order_id: emiTransactionId (for all installments of same EMI)

**Operations**:
- **INSERT**: New EMI transaction and each installment payment
- **SELECT**: Get EMI transaction details, customer summary

---

### 2. emi_transactions (Optional - if implemented)
**Purpose**: Store EMI master data

**Schema**:
```sql
- id (UUID)
- tenant_id (UUID)
- emi_transaction_id (VARCHAR, unique)
- customer_id (VARCHAR, indexed)
- order_id (VARCHAR)
- amount (DECIMAL)
- card_last_4 (VARCHAR) - Last 4 digits only
- card_type (VARCHAR) - credit/debit
- bank (VARCHAR)
- tenure (INT) - months
- rate_of_interest (DECIMAL)
- monthly_emi (DECIMAL)
- total_payment (DECIMAL)
- total_interest (DECIMAL)
- status (ENUM: approved, active, completed, foreclosed, defaulted)
- start_date (DATE)
- created_at, updated_at (TIMESTAMP)
```

---

### 3. emi_installments (Optional - if implemented)
**Purpose**: Track individual EMI installments

**Schema**:
```sql
- id (UUID)
- emi_transaction_id (VARCHAR, foreign key)
- installment_number (INT)
- amount (DECIMAL)
- due_date (DATE)
- status (ENUM: pending, paid, late, defaulted)
- paid_at (TIMESTAMP)
- paid_amount (DECIMAL)
- late_fee (DECIMAL)
```

---

## Security & Compliance

### 1. PCI-DSS Compliance
- Store only last 4 digits of card
- Never store CVV
- Tokenize card data with bank

### 2. Auto-Debit Authorization
- Customer consent required
- NPCI NACH mandate
- Can be cancelled by customer anytime

### 3. RBI Guidelines
- Clear disclosure of interest rate
- Processing fees transparency
- Foreclosure terms disclosure

---

## Error Handling

### Common Errors:
1. **Minimum amount not met**: amount < 2500
2. **Bank not supported**: bank not in partner list
3. **Card not EMI-eligible**: Bank returns not eligible
4. **Insufficient credit limit**: Card limit < amount
5. **Invalid tenure**: Tenure not available for amount
6. **EMI transaction not found**: Invalid emiTransactionId
7. **Installment already paid**: Duplicate payment attempt

### Retry Logic:
- Bank API failures: Retry 3 times with exponential backoff
- Payment failures: Standard payment retry logic

---

## EMI Calculation Example

### Scenario:
- Principal: ₹30,000
- Interest: 15% annual
- Tenure: 12 months

### Calculation:
```
Monthly Rate (r) = 15 / 12 / 100 = 0.0125
Factor = (1 + 0.0125)^12 = 1.1608
EMI = 30000 × 0.0125 × 1.1608 / (1.1608 - 1)
EMI = 30000 × 0.0145 / 0.1608
EMI = ₹2,650.19

Total Payment = 2650 × 12 = ₹31,800
Total Interest = 31800 - 30000 = ₹1,800
```

---

## Configuration Requirements

```javascript
{
  bankPartners: ['hdfc', 'icici', 'sbi', 'axis', 'kotak'],
  minEMIAmount: 2500,
  tenantId: '<merchant_tenant_id>',
  bankApiKeys: {
    hdfc: '<hdfc_api_key>',
    icici: '<icici_api_key>',
    // ... other bank keys
  }
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - EMI as payment method option

2. **Ledger Service** (`/src/core/ledger/ledger-service.js`)
   - Record EMI transactions and installments

3. **Notification Service**
   - Send EMI payment reminders
   - Late payment alerts

---

## Monitoring & Analytics

### Key Metrics:
- EMI conversion rate
- Average EMI tenure
- On-time installment payment rate
- Foreclosure rate
- Default rate
- Bank-wise success rate

### Logs:
- EMI transaction created: `emiTransactionId, amount, tenure, bank`
- Installment paid: `paymentId, installmentNumber, amount`
- Foreclosure requested: `emiTransactionId, foreClosureAmount`

---

## API Endpoints (Typical Integration)

```
POST /api/emi/calculate - Calculate EMI
GET  /api/emi/plans - Get available EMI plans
POST /api/emi/create - Create EMI transaction
POST /api/emi/pay-installment - Pay installment
GET  /api/emi/transactions/:emiTransactionId - Get EMI details
POST /api/emi/foreclose - Foreclose EMI
GET  /api/emi/customer/:customerId/summary - Customer EMI summary
```

---

## EMI vs BNPL Comparison

| Feature | EMI | BNPL |
|---------|-----|------|
| Payment Method | Card-based | Order-based |
| Interest | 12-17% | 0% (usually) |
| Eligibility | Card-dependent | Credit score-based |
| Provider | Bank | BNPL platform |
| Setup | Instant | Instant |
| Tenure Options | 3-24 months | 3-12 months |
| Processing Fee | ₹99-199 | Usually ₹0 |
| Foreclosure | Allowed (with charges) | Pay all installments |
