# Repository Map - Payment Gateway (PG)

## Overview
This is a comprehensive fintech payment gateway platform built with Node.js/Express, supporting multiple payment methods, gateways, and financial services. The system is designed with a microservices-inspired architecture for scalability, security, and maintainability.

---

## 1. Backend Architecture

### 1.1 Technology Stack
- **Runtime**: Node.js (>= 14.0.0)
- **Framework**: Express.js 4.x
- **Primary Database**: PostgreSQL 12+
- **Cache Layer**: Redis 6+
- **Authentication**: JWT (JSON Web Tokens)
- **Encryption**: AES-256, HMAC signatures
- **API Style**: RESTful with versioning support

### 1.2 Architecture Pattern
**Modular Service-Oriented Architecture**
- Each payment feature is encapsulated in its own service module
- Shared core components (payment-gateway, security, config)
- Centralized API routing layer
- Gateway abstraction pattern for multi-provider support

### 1.3 Core Backend Components

#### Entry Point
- **`src/index.js`**: Main server initialization
  - Express app setup
  - Middleware configuration (CORS, security headers, body parsing)
  - Static file serving for frontend
  - Health check endpoint (`/health`)
  - Graceful shutdown handling

#### Configuration Layer
- **`src/config/config.js`**: Centralized configuration
  - Environment variable management
  - Database, Redis, and gateway credentials
  - Feature flags for enabling/disabling services
  - Security settings (encryption keys, JWT secrets)
  - Compliance settings (PCI-DSS, KYC, AML)
  - Rate limiting and transaction limits

#### Core Payment Processing
- **`src/core/payment-gateway.js`**: Main payment gateway orchestrator
  - Multi-gateway support and abstraction
  - Payment data validation
  - Gateway selection based on routing rules
  - Transaction logging and error handling
  - Sensitive data encryption

- **`src/core/gateways/`**: Gateway implementations
  - `razorpay.js`: Razorpay integration
  - `payu.js`: PayU integration
  - `ccavenue.js`: CCAvenue integration
  - Each implements standard interface for payment processing

### 1.4 Service Modules

#### Payment Services
1. **UPI Service** (`src/upi/upi-service.js`)
   - VPA validation
   - Collect request management
   - QR code generation for UPI
   - Intent-based payment processing

2. **Pay-in Service** (`src/payin/payin-service.js`)
   - Payment order creation
   - Multi-method payment processing
   - Order status tracking
   - Settlement reconciliation

3. **Payout Service** (`src/payout/payout-service.js`)
   - Beneficiary management
   - Individual and bulk payouts
   - Payout status tracking
   - Settlement processing

4. **PAPG Service** (`src/papg/papg-service.js`)
   - Payment Aggregator Payment Gateway
   - Smart routing algorithms
   - Gateway load balancing
   - Automatic failover handling
   - Cost optimization

5. **QR Code Service** (`src/qr/qr-service.js`)
   - Static QR generation
   - Dynamic QR generation
   - UPI QR integration

6. **Wallet Service** (`src/wallet/wallet-service.js`)
   - Digital wallet integration (Paytm, PhonePe, Google Pay, Amazon Pay)
   - Balance management
   - Wallet payment processing

7. **BNPL Service** (`src/bnpl/bnpl-service.js`)
   - Credit eligibility assessment
   - Buy Now Pay Later order creation
   - Installment plan management
   - Partner integration

8. **EMI Service** (`src/emi/emi-service.js`)
   - EMI calculation
   - Available plan retrieval
   - EMI transaction processing
   - Repayment schedule management

9. **Biometric Service** (`src/biometric/biometric-service.js`)
   - Biometric registration
   - Authentication (fingerprint, facial recognition, Aadhaar)
   - Biometric payment processing

#### Security & Compliance
10. **Security Service** (`src/security/security-service.js`)
    - JWT generation and verification
    - KYC verification
    - AML (Anti-Money Laundering) checks
    - Data encryption/decryption
    - HMAC signature generation

---

## 2. Frontend Architecture

### 2.1 Structure
- **Static File Serving**: Express serves static files from `public/` directory
- **Simple HTML/CSS/JavaScript**: No complex framework, vanilla JS for simplicity
- **Location**: `/public` directory

### 2.2 Frontend Components
1. **`public/checkout.html`**: Sample checkout page
   - Fully functional payment demo interface
   - All 8 payment methods UI (UPI, Card, Net Banking, Wallets, QR, BNPL, EMI, Biometric)
   - Real-time API integration
   - Modern, responsive design
   - Client-side form validation
   - Auto-generated demo tokens for testing

2. **`public/README.md`**: Frontend documentation

### 2.3 Client-Side Flow
```
User Browser → checkout.html → JavaScript API calls → Backend API → Payment Processing
```

### 2.4 Key Features
- Responsive UI for all device sizes
- Real-time payment status updates
- Error handling and user feedback
- Secure token-based authentication
- Direct integration with backend REST APIs

---

## 3. Key Modules

### 3.1 Module Directory Structure
```
src/
├── api/                    # API routing layer
│   └── routes.js          # All REST endpoints
├── core/                   # Core payment processing
│   ├── payment-gateway.js # Main gateway orchestrator
│   └── gateways/          # Gateway implementations
│       ├── razorpay.js
│       ├── payu.js
│       └── ccavenue.js
├── config/                 # Configuration
│   └── config.js          # Centralized config
├── upi/                    # UPI payment module
├── payin/                  # Pay-in services
├── payout/                 # Payout services
├── papg/                   # Payment aggregator
├── qr/                     # QR code services
├── wallet/                 # Wallet integration
├── bnpl/                   # Buy Now Pay Later
├── emi/                    # EMI processing
├── biometric/              # Biometric authentication
├── security/               # Security & compliance
└── index.js               # Application entry point
```

### 3.2 Module Responsibilities

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| **API** | Route handling & request validation | All HTTP endpoints, middleware |
| **Core** | Payment gateway abstraction | Multi-gateway support, routing |
| **Config** | Configuration management | Environment variables, settings |
| **UPI** | UPI payment processing | VPA validation, collect, QR, intent |
| **Pay-in** | Customer payment collection | Order creation, payment processing |
| **Payout** | Disbursement services | Beneficiary management, bulk payouts |
| **PAPG** | Gateway aggregation | Smart routing, load balancing |
| **QR** | QR code generation | Static/dynamic QR codes |
| **Wallet** | Digital wallet integration | Wallet payments, balance checks |
| **BNPL** | Credit services | Eligibility, installments |
| **EMI** | Installment processing | EMI calculation, plans |
| **Biometric** | Biometric authentication | Registration, authentication |
| **Security** | Security & compliance | JWT, KYC, AML, encryption |

### 3.3 Shared Dependencies
- **Express**: Web framework
- **jsonwebtoken**: JWT authentication
- **bcrypt**: Password hashing
- **crypto**: Encryption operations
- **pg**: PostgreSQL client
- **redis**: Redis client
- **qrcode**: QR generation
- **axios**: HTTP requests to external gateways
- **winston**: Logging
- **helmet**: Security headers
- **express-rate-limit**: Rate limiting

---

## 4. API Structure

### 4.1 API Organization
- **Base Path**: `/api`
- **Authentication**: Bearer token (JWT) in Authorization header
- **Content Type**: `application/json`
- **Versioning**: Ready for versioning (e.g., `/api/v1`, `/api/v2`)

### 4.2 API Endpoint Categories

#### 4.2.1 Core Payment APIs
```
POST   /api/payments/process                    # Process payment
GET    /api/payments/:transactionId             # Get transaction status
POST   /api/payments/:transactionId/refund      # Refund transaction
```

#### 4.2.2 UPI APIs
```
POST   /api/upi/validate-vpa                    # Validate UPI VPA
POST   /api/upi/collect                         # Create collect request
POST   /api/upi/qr/generate                     # Generate UPI QR
POST   /api/upi/intent                          # Process UPI intent
```

#### 4.2.3 Pay-in APIs
```
POST   /api/payin/orders                        # Create payment order
POST   /api/payin/orders/:orderId/pay           # Process payment
GET    /api/payin/orders/:orderId/status        # Get payment status
```

#### 4.2.4 Payout APIs
```
POST   /api/payout/beneficiaries                # Create beneficiary
POST   /api/payout/payouts                      # Create payout
POST   /api/payout/payouts/bulk                 # Bulk payout
GET    /api/payout/payouts/:payoutId            # Get payout status
```

#### 4.2.5 QR Code APIs
```
POST   /api/qr/static                           # Generate static QR
POST   /api/qr/dynamic                          # Generate dynamic QR
```

#### 4.2.6 Wallet APIs
```
POST   /api/wallet/payment/initiate             # Initiate wallet payment
GET    /api/wallet/balance                      # Check wallet balance
```

#### 4.2.7 BNPL APIs
```
POST   /api/bnpl/eligibility                    # Check BNPL eligibility
POST   /api/bnpl/orders                         # Create BNPL order
```

#### 4.2.8 EMI APIs
```
POST   /api/emi/calculate                       # Calculate EMI
GET    /api/emi/plans                           # Get EMI plans
POST   /api/emi/transactions                    # Create EMI transaction
```

#### 4.2.9 Biometric APIs
```
POST   /api/biometric/register                  # Register biometric
POST   /api/biometric/authenticate              # Authenticate with biometric
POST   /api/biometric/payment                   # Process biometric payment
```

#### 4.2.10 Security APIs
```
POST   /api/security/kyc                        # Perform KYC verification
POST   /api/security/aml-check                  # Perform AML check
```

#### 4.2.11 Demo/Testing APIs
```
POST   /api/demo/token                          # Generate demo JWT token
```

### 4.3 API Authentication Flow
```
1. Client requests demo token: POST /api/demo/token
2. Server generates JWT with user info
3. Client includes token in subsequent requests: Authorization: Bearer <token>
4. Middleware validates token and extracts user info
5. Request proceeds to service layer
```

### 4.4 API Response Format
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-01-03T16:02:07.984Z"
}
```

Error Response:
```json
{
  "error": "Error message",
  "timestamp": "2026-01-03T16:02:07.984Z"
}
```

---

## 5. Build & Deployment Flow

### 5.1 Development Workflow
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 3. Start development server
npm run dev        # Uses nodemon for auto-reload

# 4. Run tests
npm test           # Jest unit tests
npm run test:coverage

# 5. Lint code
npm run lint       # ESLint
npm run format     # Prettier
```

### 5.2 Build Process
This is a Node.js application without a traditional "build" step, but the deployment preparation includes:

1. **Dependency Installation**: `npm install --production`
2. **Environment Configuration**: Setup `.env` with production values
3. **Security Checks**: Ensure all secrets are properly configured
4. **Database Migration**: Initialize PostgreSQL schema
5. **Redis Setup**: Configure Redis connection

### 5.3 Deployment Options

#### Option 1: Direct Deployment (VM/Bare Metal)
```bash
# 1. Clone repository
git clone https://github.com/nitra-1/PG.git
cd PG

# 2. Install production dependencies
npm install --production

# 3. Configure environment
cp .env.example .env
# Edit .env with production settings

# 4. Start production server
npm start
```

#### Option 2: Docker Deployment
```bash
# 1. Build Docker image
docker build -t payment-gateway .

# 2. Run with environment file
docker run -p 3000:3000 --env-file .env payment-gateway
```

#### Option 3: Docker Compose (Full Stack)
```bash
# Includes app, PostgreSQL, and Redis
docker-compose up -d

# Services started:
# - app:      Port 3000 (Payment Gateway)
# - postgres: Port 5432 (Database)
# - redis:    Port 6379 (Cache)
```

#### Option 4: Kubernetes Deployment
```bash
# Apply Kubernetes manifests
kubectl apply -f deployment/kubernetes/

# Check deployment
kubectl get pods
kubectl get services

# Access via LoadBalancer or Ingress
```

### 5.4 Deployment Architecture
```
┌─────────────────────────────────────────────────────────┐
│                     Load Balancer                        │
│                  (HTTPS/TLS Termination)                 │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐         ┌────────▼───────┐
│  App Instance 1 │         │ App Instance 2  │
│  (Node.js)      │         │ (Node.js)       │
└───────┬────────┘         └────────┬───────┘
        │                           │
        └─────────────┬─────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐         ┌────────▼───────┐
│   PostgreSQL    │         │     Redis      │
│   (Database)    │         │    (Cache)     │
└────────────────┘         └────────────────┘
```

### 5.5 CI/CD Pipeline (Suggested)
```yaml
# GitHub Actions / Jenkins Pipeline
1. Code Push to Repository
   ↓
2. Run Linting (ESLint)
   ↓
3. Run Tests (Jest)
   ↓
4. Security Scan (npm audit)
   ↓
5. Build Docker Image
   ↓
6. Push to Container Registry
   ↓
7. Deploy to Staging
   ↓
8. Run Integration Tests
   ↓
9. Manual Approval (Optional)
   ↓
10. Deploy to Production
```

### 5.6 Environment Requirements

#### Production
- **Node.js**: >= 14.0.0
- **PostgreSQL**: >= 12 (with SSL)
- **Redis**: >= 6 (with persistence)
- **Memory**: 2GB+ per instance
- **CPU**: 2+ cores
- **Storage**: 20GB+ for logs and data
- **Network**: HTTPS/TLS 1.3 required

#### Development
- **Node.js**: >= 14.0.0
- **PostgreSQL**: >= 12 (can be local)
- **Redis**: >= 6 (can be local)
- **Memory**: 1GB+
- **Storage**: 10GB+

---

## 6. Data Flow

### 6.1 High-Level Data Flow Architecture
```
┌──────────────┐
│    Client    │ (Browser/Mobile App)
│  (Frontend)  │
└──────┬───────┘
       │ HTTPS
       │ (JSON)
       ▼
┌──────────────────────────────────────────┐
│         Express.js Server                 │
│  ┌────────────────────────────────────┐  │
│  │     Middleware Layer               │  │
│  │  - CORS                            │  │
│  │  - Security Headers                │  │
│  │  - Body Parser                     │  │
│  │  - Authentication (JWT)            │  │
│  └────────────┬───────────────────────┘  │
│               │                           │
│  ┌────────────▼───────────────────────┐  │
│  │       API Routes Layer             │  │
│  │    (src/api/routes.js)            │  │
│  │  - Request validation             │  │
│  │  - Route to appropriate service   │  │
│  └────────────┬───────────────────────┘  │
│               │                           │
│  ┌────────────▼───────────────────────┐  │
│  │      Service Layer                 │  │
│  │  - Business logic                  │  │
│  │  - Data validation                 │  │
│  │  - Processing orchestration        │  │
│  └────────────┬───────────────────────┘  │
└───────────────┼───────────────────────────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ PostgreSQL  │   │   Redis     │
│ (Persistent)│   │   (Cache)   │
└─────────────┘   └─────────────┘
       │
       ▼
┌──────────────────────┐
│  External Payment    │
│    Gateways          │
│  - Razorpay          │
│  - PayU              │
│  - CCAvenue          │
└──────────────────────┘
```

### 6.2 Payment Processing Data Flow

#### 6.2.1 Standard Payment Flow
```
┌─────────────────────────────────────────────────────────────────┐
│                    Payment Processing Flow                       │
└─────────────────────────────────────────────────────────────────┘

1. Client Request
   ├─ POST /api/payments/process
   ├─ Headers: Authorization: Bearer <JWT>
   ├─ Body: { amount, currency, customerId, paymentMethod, ... }
   └─ → Express Server

2. Authentication Middleware
   ├─ Extract JWT from Authorization header
   ├─ Verify JWT signature (SecurityService.verifyJWT)
   ├─ Decode user information
   └─ → If valid: Attach user to request, proceed
       → If invalid: Return 401 Unauthorized

3. API Route Handler (routes.js)
   ├─ Receive authenticated request
   ├─ Extract payment data from req.body
   └─ → Call PaymentGateway.processPayment(paymentData)

4. Payment Gateway Core
   ├─ Validate payment data
   │  ├─ Check required fields (amount, currency, customerId, paymentMethod)
   │  ├─ Validate amount against limits (min, max, daily, monthly)
   │  └─ Validate currency and payment method
   ├─ Select gateway
   │  ├─ Apply routing rules (amount-based, method-based, currency-based)
   │  ├─ Check gateway availability
   │  └─ Fallback to default gateway if needed
   ├─ Encrypt sensitive data (card numbers, CVV, etc.)
   │  └─ Use AES-256 encryption with configured key
   ├─ Call selected gateway
   │  ├─ Format data for gateway API
   │  ├─ Send HTTP request to gateway (Razorpay/PayU/CCAvenue)
   │  └─ Receive gateway response
   ├─ Process gateway response
   │  ├─ Extract transaction ID, status, and metadata
   │  ├─ Decrypt sensitive information if needed
   │  └─ Format response for client
   └─ Log transaction
      ├─ Store in PostgreSQL
      │  ├─ Transaction ID
      │  ├─ Customer ID
      │  ├─ Amount, currency
      │  ├─ Status (pending, success, failed)
      │  ├─ Gateway used
      │  ├─ Timestamps
      │  └─ Encrypted payment details
      └─ Cache in Redis (for quick status lookups)
         └─ Key: transaction:<transactionId>
            Value: { status, amount, gateway, timestamp }

5. Response to Client
   └─ JSON: { success, transactionId, status, gateway, timestamp }
```

#### 6.2.2 UPI Payment Data Flow
```
1. Client: POST /api/upi/validate-vpa
   └─ Body: { vpa: "user@bank" }

2. UPIService.validateVPA(vpa)
   ├─ Check VPA format (regex validation)
   ├─ Optional: Call external VPA validation API
   └─ Return: { valid: true/false }

3. Client: POST /api/upi/collect
   └─ Body: { vpa, amount, description, ... }

4. UPIService.createCollectRequest(data)
   ├─ Validate VPA
   ├─ Create collect request in gateway
   ├─ Store request in database
   │  └─ PostgreSQL: upi_collect_requests table
   └─ Return: { collectRequestId, status: "pending" }

5. Gateway Callback (Async)
   ├─ Gateway sends webhook notification
   ├─ Update transaction status in database
   ├─ Update Redis cache
   └─ Notify client via webhook (if configured)
```

#### 6.2.3 Pay-in Order Data Flow
```
1. Create Order
   Client → POST /api/payin/orders
   ├─ Body: { amount, customerId, customerEmail, ... }
   └─ PayInService.createPaymentOrder(orderData)
      ├─ Validate order data
      ├─ Generate orderId: ORD_<timestamp>
      ├─ Store order in database
      │  └─ PostgreSQL: payment_orders table
      │     ├─ orderId, amount, currency
      │     ├─ customerId, customerEmail, customerPhone
      │     ├─ status: "CREATED"
      │     ├─ expiryTime (30 minutes)
      │     └─ createdAt
      └─ Return: { orderId, amount, status, expiryTime }

2. Process Payment
   Client → POST /api/payin/orders/:orderId/pay
   ├─ Body: { paymentMethod, ... }
   └─ PayInService.processPayment({ orderId, paymentMethod, ... })
      ├─ Retrieve order from database
      ├─ Validate order (exists, not expired, status = "CREATED")
      ├─ Call PaymentGateway.processPayment(...)
      ├─ Update order status in database
      │  └─ status: "PROCESSING" | "SUCCESS" | "FAILED"
      └─ Return: { transactionId, status, ... }

3. Check Status
   Client → GET /api/payin/orders/:orderId/status
   └─ PayInService.getPaymentStatus(orderId)
      ├─ Check Redis cache first
      │  └─ Key: order:<orderId>
      ├─ If not in cache, query database
      └─ Return: { orderId, status, amount, transactionId }
```

#### 6.2.4 Payout Data Flow
```
1. Create Beneficiary
   Client → POST /api/payout/beneficiaries
   ├─ Body: { name, accountNumber, ifscCode, ... }
   └─ PayoutService.createBeneficiary(data)
      ├─ Validate beneficiary data
      ├─ Perform KYC check (if required)
      │  └─ SecurityService.performKYC(...)
      ├─ Store in database
      │  └─ PostgreSQL: beneficiaries table
      └─ Return: { beneficiaryId, status }

2. Create Payout
   Client → POST /api/payout/payouts
   ├─ Body: { beneficiaryId, amount, purpose, ... }
   └─ PayoutService.createPayout(data)
      ├─ Validate payout data
      ├─ Retrieve beneficiary details
      ├─ Check merchant balance (if applicable)
      ├─ Create payout request in gateway
      ├─ Store payout in database
      │  └─ PostgreSQL: payouts table
      │     ├─ payoutId, beneficiaryId, amount
      │     ├─ status: "INITIATED"
      │     ├─ gateway, gatewayPayoutId
      │     └─ createdAt
      └─ Return: { payoutId, status }

3. Bulk Payout
   Client → POST /api/payout/payouts/bulk
   ├─ Body: { payouts: [ {...}, {...}, ... ] }
   └─ PayoutService.createBulkPayout(data)
      ├─ Validate all payout records
      ├─ Process payouts in batch
      │  └─ For each payout: createPayout(...)
      ├─ Store bulk payout metadata
      └─ Return: { batchId, totalPayouts, status }
```

#### 6.2.5 PAPG Smart Routing Data Flow
```
Transaction Request
   ↓
PAPGService.selectGateway(transaction)
   ├─ Load routing rules
   ├─ Apply rules in order:
   │  ├─ Amount-based: High amounts → Razorpay
   │  ├─ Method-based: UPI → PayU
   │  ├─ Currency-based: Foreign currency → Razorpay
   │  └─ Performance-based: Select by success rate & cost
   ├─ Check gateway availability
   │  └─ Query Redis for gateway health status
   ├─ Select optimal gateway
   └─ Return selected gateway

Fallback & Retry Logic:
   ├─ If primary gateway fails
   ├─ Automatically retry with secondary gateway
   ├─ Log failure and routing decision
   └─ Update gateway health metrics in Redis
```

### 6.3 Data Storage Patterns

#### 6.3.1 PostgreSQL (Persistent Storage)
**Tables:**
- `transactions`: All payment transactions
  - Columns: id, transactionId, customerId, amount, currency, status, gateway, createdAt, updatedAt
- `payment_orders`: Pay-in orders
  - Columns: id, orderId, customerId, amount, status, expiryTime, createdAt
- `beneficiaries`: Payout beneficiaries
  - Columns: id, beneficiaryId, name, accountNumber, ifscCode, status
- `payouts`: Payout transactions
  - Columns: id, payoutId, beneficiaryId, amount, status, gateway, createdAt
- `upi_collect_requests`: UPI collect requests
- `bnpl_orders`: BNPL orders
- `emi_transactions`: EMI transactions
- `audit_logs`: Compliance and audit trail
- `webhook_logs`: Incoming webhook events

#### 6.3.2 Redis (Cache & Session Storage)
**Key Patterns:**
- `transaction:<transactionId>`: Transaction status cache (TTL: 1 hour)
- `order:<orderId>`: Order details cache (TTL: 30 minutes)
- `session:<sessionId>`: User session data (TTL: 24 hours)
- `gateway:<gatewayName>:health`: Gateway health status (TTL: 5 minutes)
- `rate_limit:<userId>`: Rate limiting counters (TTL: 1 minute)
- `kyc:<customerId>`: KYC verification results (TTL: 24 hours)

### 6.4 Data Security Flow

#### 6.4.1 Encryption
```
Sensitive Data (card number, CVV, etc.)
   ↓
SecurityService.encrypt(data)
   ├─ Use AES-256-CBC encryption
   ├─ Encryption key from config (ENCRYPTION_KEY)
   ├─ Generate random IV (Initialization Vector)
   └─ Return: { encryptedData, iv }
      ↓
Store in Database (encrypted form)
      ↓
Retrieve from Database
      ↓
SecurityService.decrypt(encryptedData, iv)
   ├─ Use same encryption key
   ├─ Decrypt using IV
   └─ Return: Original data
```

#### 6.4.2 Authentication Flow
```
1. Client requests token: POST /api/demo/token
   └─ Body: { userId, name }

2. SecurityService.generateJWT(payload, expiresIn)
   ├─ Create JWT payload: { userId, name, role, iat, exp }
   ├─ Sign with JWT_SECRET
   └─ Return: JWT token

3. Client sends token with requests
   └─ Header: Authorization: Bearer <token>

4. Authentication Middleware
   ├─ Extract token from header
   ├─ SecurityService.verifyJWT(token)
   │  ├─ Verify signature with JWT_SECRET
   │  ├─ Check expiration
   │  └─ Return decoded payload
   └─ Attach user to req.user
```

### 6.5 Webhook Data Flow
```
External Gateway (Razorpay/PayU/etc.)
   ↓ HTTP POST
Payment Gateway Server (Webhook Endpoint)
   ├─ Verify webhook signature (HMAC)
   │  └─ SecurityService.verifyHMAC(payload, signature, secret)
   ├─ Parse webhook payload
   │  ├─ Extract: transactionId, status, amount, timestamp
   │  └─ Validate data integrity
   ├─ Update transaction in database
   │  └─ UPDATE transactions SET status = ? WHERE transactionId = ?
   ├─ Update cache in Redis
   │  └─ SET transaction:<transactionId> { ... }
   ├─ Log webhook event
   │  └─ INSERT INTO webhook_logs (...)
   └─ Trigger customer notification
      ├─ Email (via email service)
      └─ SMS (via SMS service)
```

### 6.6 Data Flow Summary

**Request → Response Path:**
1. **Client** sends HTTP request (JSON)
2. **Express Middleware** processes headers, authentication
3. **API Routes** validates and routes to appropriate service
4. **Service Layer** executes business logic
5. **Database/Cache** stores/retrieves data
6. **External APIs** (payment gateways) are called when needed
7. **Response** formatted and sent back to client

**Key Data Flows:**
- **Synchronous**: Payment processing, status checks (request-response)
- **Asynchronous**: Webhooks, notifications, background jobs
- **Real-time**: Redis cache for fast lookups
- **Persistent**: PostgreSQL for transactional data
- **External**: API calls to payment gateways

---

## 7. Documentation

### 7.1 Available Documentation Files
- **README.md**: Project overview and quick start
- **ARCHITECTURE.md**: Detailed system architecture
- **CHECKOUT_QUICKSTART.md**: Sample checkout page guide
- **IMPLEMENTATION_SUMMARY.md**: Implementation details
- **CONTRIBUTING.md**: Contribution guidelines
- **CHANGELOG.md**: Version history
- **docs/API.md**: API reference
- **docs/QUICK_START.md**: 5-minute getting started guide
- **docs/ECOMMERCE_INTEGRATION.md**: E-commerce integration guide
- **docs/PAYMENT_FLOW_DIAGRAMS.md**: Visual flow diagrams
- **docs/SECURITY.md**: Security best practices
- **docs/DEPLOYMENT.md**: Deployment instructions
- **docs/WINDOWS_SETUP.md**: Windows 11 setup guide

---

## 8. Key Configuration Files

### 8.1 Application Configuration
- **package.json**: Dependencies and scripts
- **.env.example**: Environment variable template
- **.eslintrc.json**: Code linting rules
- **docker-compose.yml**: Multi-container Docker setup
- **Dockerfile**: Container image definition

### 8.2 Environment Variables
Key environment variables (see `.env.example`):
- `PORT`, `HOST`: Server configuration
- `DB_HOST`, `DB_PORT`, `DB_NAME`: Database connection
- `REDIS_HOST`, `REDIS_PORT`: Cache connection
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`: Gateway credentials
- `JWT_SECRET`, `ENCRYPTION_KEY`: Security keys
- `FEATURE_*`: Feature flags

---

## 9. Testing & Quality

### 9.1 Test Commands
```bash
npm test                 # Run all tests
npm run test:integration # Integration tests
npm run test:coverage    # Coverage report
```

### 9.2 Code Quality
```bash
npm run lint            # ESLint
npm run format          # Prettier
```

### 9.3 Test Structure
- Unit tests for individual services
- Integration tests for API endpoints
- Mock external gateway calls
- Test coverage reporting with Jest

---

## 10. Monitoring & Observability

### 10.1 Health Check
- **Endpoint**: `GET /health`
- **Response**: `{ status: "healthy", timestamp, uptime }`

### 10.2 Logging
- **Library**: Winston
- **Levels**: error, warn, info, debug
- **Output**: Console + log files
- **Format**: JSON structured logs

### 10.3 Metrics
- Transaction counts and success rates
- Gateway performance metrics
- Response time tracking
- Error rate monitoring
- (Prometheus integration ready via `/metrics` endpoint)

---

## 11. Security Features

### 11.1 Implemented Security
- ✅ JWT-based authentication
- ✅ AES-256 encryption for sensitive data
- ✅ HMAC signature verification
- ✅ Security headers (X-Frame-Options, X-XSS-Protection, etc.)
- ✅ CORS configuration
- ✅ Rate limiting support
- ✅ Input validation
- ✅ SQL injection prevention (parameterized queries)
- ✅ XSS prevention (output encoding)

### 11.2 Compliance
- PCI-DSS compliance ready
- KYC verification support
- AML checks integration
- Data encryption at rest and in transit
- Audit logging

---

## 12. Quick Reference

### 12.1 Start the Application
```bash
# Development
npm install
cp .env.example .env
npm run dev

# Production
npm install --production
npm start

# Docker
docker-compose up -d
```

### 12.2 Access Points
- **API**: `http://localhost:3000/api`
- **Health**: `http://localhost:3000/health`
- **Checkout Page**: `http://localhost:3000/checkout.html`
- **API Root**: `http://localhost:3000/`

### 12.3 Common Tasks
- **Get demo token**: `POST /api/demo/token`
- **Process payment**: `POST /api/payments/process` (requires auth)
- **Check transaction**: `GET /api/payments/:transactionId` (requires auth)

---

## Conclusion

This payment gateway repository is structured as a modular, service-oriented backend with a simple frontend demo. It emphasizes:
- **Modularity**: Each payment feature is a separate service
- **Scalability**: Designed for horizontal scaling with Redis caching
- **Security**: Encryption, JWT auth, compliance features
- **Flexibility**: Multi-gateway support with smart routing
- **Maintainability**: Clear separation of concerns, comprehensive documentation

The data flows through well-defined layers (API → Service → Database/Gateway → Response) with both synchronous and asynchronous processing capabilities.
