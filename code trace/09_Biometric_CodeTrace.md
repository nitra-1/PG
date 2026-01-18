# Biometric Authentication - Code Trace Document

## Overview
**Payment Type**: Biometric Authentication for Payments  
**Purpose**: Secure biometric-based payment authentication  
**Entry Point**: Biometric Service API  
**Primary File**: `/src/biometric/biometric-service.js`

---

## Supported Biometric Types
- **Fingerprint**: Most common, device-based
- **Face Recognition**: Camera-based facial authentication
- **Aadhaar**: India-specific, UIDAI biometric auth
- **Iris**: High-security iris scanning

---

## Execution Flow

### 1. REGISTER BIOMETRIC
**Function**: `registerBiometric(biometricData)`  
**Entry Point**: Customer enrolls biometric for payments

#### Flow Steps:
1. **Input Validation** (`validateBiometricData`)
   - Required: customerId, biometricType, biometricTemplate
   - Validate: biometricType in ['fingerprint', 'face', 'aadhaar', 'iris']

2. **Biometric Template Encryption** (`encryptBiometricTemplate`)
   - **Security**: AES-256-GCM encryption
   - **Purpose**: Secure storage of biometric data
   - Encrypt raw biometric template
   - **Mock**: Base64 encoding (in production: use AES-256)

3. **Registration Creation**
   - Generate registrationId: `BIO_REG_{timestamp}`
   - Store: customerId, biometricType, encryptedTemplate
   - Store: deviceId, deviceInfo (for device binding)
   - Status: 'ACTIVE'

4. **Database Operations** (if implemented)
   - **Table**: `biometric_registrations`
   - **Operation**: INSERT
   - Store encrypted template, device info

5. **Response**
   - Returns: registrationId, biometricType, status, timestamp

---

### 2. AUTHENTICATE WITH BIOMETRIC
**Function**: `authenticateWithBiometric(authData)`  
**Entry Point**: Customer authenticates payment with biometric

#### Flow Steps:
1. **Input Validation**
   - Required: customerId, biometricType, biometricSample
   - Optional: deviceId, transactionAmount

2. **Retrieve Stored Template** (`getStoredBiometricTemplate`)
   - **Table**: `biometric_registrations`
   - **Query**: WHERE customer_id = customerId AND biometric_type = biometricType AND status = 'ACTIVE'
   - Decrypt stored template

3. **Biometric Verification** (`verifyBiometric`)
   - **Interface Point**: Biometric Matching Algorithm
   - **External Libraries**: 
     - Fingerprint: libfprint, FingerprintJS
     - Face: Face-api.js, AWS Rekognition
     - Aadhaar: UIDAI Authentication API
     - Iris: IrisCore SDK
   - Compare sample with stored template
   - Calculate confidence score (0-100)
   - Threshold: 85% (configurable)

4. **Liveness Detection** (`performLivenessDetection`)
   - **Purpose**: Prevent spoofing attacks
   - **Techniques**:
     - Fingerprint: Pulse detection, pressure variance
     - Face: Eye blink, head movement, challenge-response
     - Iris: Pupil dilation
   - Validate sample is from live person

5. **Authentication Token Generation** (`generateAuthToken`)
   - Generate JWT token with biometric auth claim
   - Token format: `BIO_TOKEN_{customerId}_{timestamp}`
   - Expiry: 5 minutes (short-lived for security)

6. **Response**
   - Returns: authenticated (true), authToken, biometricType, confidenceScore, timestamp

---

### 3. PROCESS BIOMETRIC PAYMENT
**Function**: `processBiometricPayment(paymentData)`  
**Entry Point**: Complete payment with biometric auth

#### Flow Steps:
1. **Input Validation**
   - Required: customerId, orderId, amount, biometricAuthToken

2. **Token Verification**
   - Validate authToken is valid and not expired
   - Extract customerId from token

3. **Payment Processing**
   - **Interface Point**: Payment Gateway
   - Include biometric auth confirmation in payment request
   - Generate paymentId: `BIO_PAY_{timestamp}`
   - Status: 'SUCCESS' after gateway confirmation

4. **Database Operations**
   - **Table**: `transactions`
   - **Operation**: INSERT
   - **Fields**:
     - transaction_ref: paymentId
     - order_id: orderId
     - payment_method: 'biometric'
     - amount, currency
     - metadata: {biometricType, authToken, confidenceScore}
     - status: 'success'

5. **Audit Logging**
   - **Table**: `audit_trail`
   - Log biometric authentication event
   - Fields: customerId, biometricType, timestamp, success/failure

6. **Response**
   - Returns: paymentId, orderId, amount, status, timestamp

---

## Biometric Types Deep Dive

### 1. Fingerprint Authentication
**Technology**: Capacitive/Optical fingerprint sensors  
**Accuracy**: 99.5%  
**Speed**: <1 second  
**Use Case**: Mobile payments, POS terminals

**Process**:
1. Capture fingerprint image
2. Extract minutiae points (ridge endings, bifurcations)
3. Create template (typically 250-1000 bytes)
4. Match against stored template
5. Liveness check (pulse, temperature)

**Vendors**:
- Goodix
- Synaptics
- Precise Biometrics

---

### 2. Face Recognition
**Technology**: 2D/3D facial feature analysis  
**Accuracy**: 99.0%  
**Speed**: <2 seconds  
**Use Case**: Mobile banking apps, ATMs

**Process**:
1. Capture face image/video
2. Detect face landmarks (68-point model)
3. Extract facial features (embedding vector)
4. Match against stored template
5. Liveness check (eye blink, head movement)

**Vendors**:
- AWS Rekognition
- Microsoft Face API
- Face++

---

### 3. Aadhaar Authentication (India-Specific)
**Technology**: UIDAI biometric database  
**Accuracy**: 99.8%  
**Speed**: 2-5 seconds  
**Use Case**: Government payments, KYC, e-KYC

**Process**:
1. Capture fingerprint/iris
2. Send to UIDAI server with Aadhaar number
3. **Interface Point**: UIDAI Authentication API
4. UIDAI matches against national database
5. Return success/failure with authentication code

**UIDAI Auth API**:
```xml
POST https://auth.uidai.gov.in/auth/2.5/{ac}/{uid}/{tid}/{ver}
Headers: 
  Content-Type: application/xml

<Auth xmlns="http://www.uidai.gov.in/authentication/uid-auth-request/2.0">
  <Uses pi="y" pa="n" pfa="y" bio="y" />
  <Tkn type="AUA">...</Tkn>
  <Data type="X">...</Data> <!-- Encrypted biometric + PID -->
  <Hmac>...</Hmac>
  <Skey ci="...">...</Skey>
</Auth>

Response:
<AuthRes xmlns="http://www.uidai.gov.in/authentication/uid-auth-response/2.0" 
  ret="y" code="0" txn="..." ts="2024-01-18T10:00:00" />
```

---

### 4. Iris Recognition
**Technology**: Iris pattern analysis  
**Accuracy**: 99.9%  
**Speed**: 1-2 seconds  
**Use Case**: High-security payments, border control

**Process**:
1. Capture iris image (infrared camera)
2. Detect iris boundaries
3. Normalize iris region
4. Extract iris code (2048-bit template)
5. Hamming distance matching

**Vendors**:
- IrisGuard
- IrisID
- Iris ID R&D

---

## External System Interfaces

### 1. Biometric Device APIs
**Interface Point**: Device SDK integration

**Android FingerPrint API**:
```java
FingerprintManager fingerprintManager = 
  (FingerprintManager) getSystemService(Context.FINGERPRINT_SERVICE);

fingerprintManager.authenticate(
  cryptoObject,
  cancellationSignal,
  flags,
  authenticationCallback,
  handler
);
```

**iOS Touch ID/Face ID**:
```swift
let context = LAContext()
context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics) {
  success, error in
  if success {
    // Authentication successful
  }
}
```

---

### 2. UIDAI Aadhaar Authentication API
**Interface Point**: `authenticateWithAadhaar()`

**Request**:
```xml
<Auth xmlns="http://www.uidai.gov.in/authentication/uid-auth-request/2.0"
  uid="123456789012" tid="public" ac="public" sa="public" ver="2.5" txn="TXN123">
  <Uses pi="n" pa="n" pfa="y" bio="y" bt="FMR" />
  <Meta udc="..." fdc="..." idc="..." pip="..." lot="..." lov="..." />
  <Skey ci="...">encrypted_session_key</Skey>
  <Data type="X">encrypted_pid_data</Data>
  <Hmac>hmac_value</Hmac>
</Auth>
```

**Response**:
```xml
<AuthRes xmlns="http://www.uidai.gov.in/authentication/uid-auth-response/2.0"
  ret="y" code="0" txn="TXN123" ts="2024-01-18T10:00:00" 
  err="null" info="null" />
```

**Response Codes**:
- `ret="y"`: Authentication success
- `ret="n"`: Authentication failed
- Error codes: 300-399 (technical errors), 500-599 (auth failures)

---

### 3. Cloud-Based Face Recognition APIs

**AWS Rekognition**:
```json
POST https://rekognition.us-east-1.amazonaws.com/
X-Amz-Target: RekognitionService.CompareFaces

{
  "SourceImage": {
    "Bytes": "base64_image_data"
  },
  "TargetImage": {
    "Bytes": "base64_stored_template"
  },
  "SimilarityThreshold": 85
}

Response:
{
  "FaceMatches": [{
    "Similarity": 95.8,
    "Face": {...}
  }],
  "UnmatchedFaces": []
}
```

---

## Database Tables & Operations

### 1. biometric_registrations
**Purpose**: Store encrypted biometric templates

**Schema**:
```sql
- id (UUID, primary key)
- tenant_id (UUID)
- registration_id (VARCHAR, unique)
- customer_id (VARCHAR, indexed)
- biometric_type (ENUM: fingerprint, face, aadhaar, iris)
- encrypted_template (BYTEA) - AES-256 encrypted
- encryption_key_id (VARCHAR) - Key management reference
- device_id (VARCHAR)
- device_info (JSONB) - Device make, model, OS
- status (ENUM: active, inactive, expired)
- confidence_threshold (DECIMAL) - Min match confidence
- registered_at (TIMESTAMP)
- last_used_at (TIMESTAMP)
- created_at, updated_at (TIMESTAMP)

UNIQUE INDEX: (customer_id, biometric_type, device_id)
```

**Operations**:
- **INSERT**: New biometric registration
- **SELECT**: Retrieve template for authentication
- **UPDATE**: Update last_used_at on successful auth
- **DELETE/DEACTIVATE**: Customer removes biometric

---

### 2. biometric_auth_logs
**Purpose**: Audit trail for biometric authentication attempts

**Schema**:
```sql
- id (UUID)
- customer_id (VARCHAR, indexed)
- biometric_type (VARCHAR)
- auth_success (BOOLEAN)
- confidence_score (DECIMAL)
- device_id (VARCHAR)
- ip_address (VARCHAR)
- user_agent (VARCHAR)
- failure_reason (VARCHAR)
- timestamp (TIMESTAMP)

INDEX: (customer_id, timestamp)
INDEX: (timestamp) for purging old logs
```

**Operations**:
- **INSERT**: Log every auth attempt (success/failure)
- **SELECT**: Fraud detection, customer auth history

---

### 3. transactions
**Purpose**: Track biometric-authenticated payments

**Biometric-Specific Fields**:
- payment_method: 'biometric'
- metadata: {biometricType, authToken, confidenceScore, deviceId}

---

## Security & Compliance

### 1. Template Encryption
- **Algorithm**: AES-256-GCM
- **Key Management**: Hardware Security Module (HSM) or KMS
- **Key Rotation**: Every 90 days
- Never store raw biometric data

### 2. Liveness Detection
- Prevents spoofing with photos, videos, 3D masks
- Multi-modal liveness (challenge-response)
- Anti-spoofing AI models

### 3. Privacy Regulations
- **GDPR**: Right to erasure, consent required
- **CCPA**: Consumer data rights
- **IT Act 2000 (India)**: Biometric data protection
- **UIDAI Act**: Aadhaar data privacy

### 4. Biometric Template Security
- Templates are one-way (cannot recreate original)
- Encrypted at rest and in transit
- Separate encryption keys per customer

---

## Error Handling

### Common Errors:
1. **Biometric not registered**: No template found for customer
2. **Authentication failed**: Sample doesn't match template
3. **Liveness detection failed**: Spoofing attempt detected
4. **Low confidence score**: Score below threshold (85%)
5. **Token expired**: Auth token no longer valid
6. **Device mismatch**: Biometric registered on different device
7. **Biometric type mismatch**: Sample type != registered type

### Retry Logic:
- Auth failures: Allow 3 attempts, then lock for 5 minutes
- Token generation: Single attempt (immediate failure if auth fails)

---

## Biometric Matching Thresholds

| Biometric Type | Threshold | False Accept Rate (FAR) | False Reject Rate (FRR) |
|----------------|-----------|-------------------------|-------------------------|
| Fingerprint    | 85%       | 1 in 10,000            | 1 in 100               |
| Face           | 90%       | 1 in 1,000             | 1 in 50                |
| Aadhaar        | 95%       | 1 in 100,000           | 1 in 1,000             |
| Iris           | 98%       | 1 in 1,000,000         | 1 in 10,000            |

---

## Configuration Requirements

```javascript
{
  supportedBiometrics: ['fingerprint', 'face', 'aadhaar', 'iris'],
  encryptionAlgorithm: 'AES-256-GCM',
  encryptionKeyId: '<kms_key_id>',
  confidenceThreshold: 85, // Minimum match confidence
  livenessDetection: true,
  authTokenExpiry: 300, // 5 minutes
  maxAuthAttempts: 3,
  lockoutDuration: 300, // 5 minutes
  aadhaarConfig: {
    auaCode: '<aua_code>',
    asaLicense: '<asa_license>',
    apiUrl: 'https://auth.uidai.gov.in/auth/2.5/'
  },
  tenantId: '<merchant_tenant_id>'
}
```

---

## Related Services

1. **PayIn Service** (`/src/payin/payin-service.js`)
   - Biometric as authentication method for payments

2. **Security Service** (`/src/security/`)
   - Token management
   - Encryption/Decryption

3. **Audit Service** (`/src/security/audit-trail-service.js`)
   - Log all biometric authentication attempts

---

## Monitoring & Analytics

### Key Metrics:
- Biometric authentication success rate
- Average authentication time
- Liveness detection success rate
- False acceptance rate (FAR)
- False rejection rate (FRR)
- Device-wise authentication stats

### Logs:
- Registration: `registrationId, customerId, biometricType, deviceId`
- Authentication: `customerId, biometricType, success, confidenceScore, timestamp`
- Payment: `paymentId, biometricType, authToken, amount`

---

## API Endpoints (Typical Integration)

```
POST /api/biometric/register - Register biometric
POST /api/biometric/authenticate - Authenticate with biometric
POST /api/biometric/payment - Process biometric payment
GET  /api/biometric/registrations/:customerId - List customer biometrics
DELETE /api/biometric/registrations/:registrationId - Remove biometric
POST /api/biometric/verify-liveness - Liveness detection check
```

---

## Use Cases

### 1. Mobile Payments
- Fingerprint/Face ID on smartphones
- Quick checkout without entering PIN/password

### 2. POS Terminals
- Fingerprint authentication at merchant location
- Aadhaar-based payments for unbanked

### 3. ATM Withdrawals
- Cardless cash withdrawal using biometric
- Face/iris recognition for high-value transactions

### 4. Age Verification
- Face recognition for age-restricted purchases
- Aadhaar verification for KYC

---

## Biometric vs Traditional Auth

| Factor | Biometric | PIN/Password |
|--------|-----------|--------------|
| Security | Very High (99%+) | Medium (70-80%) |
| Speed | Fast (<2 sec) | Moderate (5-10 sec) |
| User Experience | Excellent | Good |
| Forgettability | No | Yes |
| Spoofing Risk | Low (with liveness) | High (phishing) |
| Privacy Concerns | High | Low |
| Cost | High (hardware) | Low |
