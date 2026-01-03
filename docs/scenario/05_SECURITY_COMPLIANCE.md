# Security and Compliance

## Table of Contents
1. [Overview](#overview)
2. [PCI-DSS Compliance](#pci-dss-compliance)
3. [Data Security Measures](#data-security-measures)
4. [Merchant Isolation](#merchant-isolation)
5. [Fraud Prevention](#fraud-prevention)
6. [KYC/AML Requirements](#kycaml-requirements)
7. [Audit and Monitoring](#audit-and-monitoring)
8. [Incident Response](#incident-response)

## Overview

Security and compliance are paramount in payment processing. This document outlines the comprehensive security measures and compliance requirements for all merchants using our payment gateway.

### Security Framework

```
┌────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                          │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: Network Security                                 │
│  ├─ DDoS Protection (Cloudflare)                          │
│  ├─ Web Application Firewall (WAF)                        │
│  ├─ IP Whitelisting                                       │
│  └─ TLS 1.3 Encryption                                    │
│                                                             │
│  Layer 2: Application Security                             │
│  ├─ Authentication (JWT, OAuth 2.0)                       │
│  ├─ Authorization (RBAC)                                  │
│  ├─ Input Validation & Sanitization                      │
│  ├─ CSRF Protection                                       │
│  ├─ XSS Prevention                                        │
│  └─ Rate Limiting                                         │
│                                                             │
│  Layer 3: Data Security                                    │
│  ├─ Encryption at Rest (AES-256)                         │
│  ├─ Encryption in Transit (TLS 1.3)                      │
│  ├─ Tokenization (PCI-DSS compliant)                     │
│  ├─ Key Management (AWS KMS)                             │
│  └─ Data Masking                                          │
│                                                             │
│  Layer 4: Operational Security                             │
│  ├─ Access Control (MFA)                                  │
│  ├─ Audit Logging                                         │
│  ├─ Intrusion Detection                                   │
│  ├─ Vulnerability Scanning                               │
│  └─ Penetration Testing                                   │
│                                                             │
│  Layer 5: Compliance                                        │
│  ├─ PCI-DSS Level 1                                       │
│  ├─ GDPR / DPDP Act                                       │
│  ├─ RBI Guidelines                                        │
│  └─ ISO 27001                                             │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## PCI-DSS Compliance

### What is PCI-DSS?

Payment Card Industry Data Security Standard (PCI-DSS) is a set of security standards designed to ensure that all companies that accept, process, store, or transmit credit card information maintain a secure environment.

### Our PCI-DSS Level 1 Certification

```yaml
Certification: PCI-DSS Level 1 (Highest Level)
Certified By: Qualified Security Assessor (QSA)
Valid Until: December 2024
Annual Assessment: Yes
Quarterly Scans: Yes
```

### 12 PCI-DSS Requirements

#### 1. Install and Maintain a Firewall Configuration

```yaml
Implementation:
  - Multi-layer firewall architecture
  - Separate DMZ for public-facing services
  - Internal segmentation
  - Regular rule review and optimization
  
Tools:
  - AWS Security Groups
  - Network Access Control Lists (NACLs)
  - Web Application Firewall (WAF)
```

#### 2. Do Not Use Vendor-Supplied Defaults

```yaml
Implementation:
  - All default passwords changed
  - Unnecessary default accounts disabled
  - Custom configuration for all services
  - Regular security hardening
  
Example:
  - PostgreSQL: Custom admin credentials
  - Redis: Authentication required
  - SSH: Key-based authentication only
```

#### 3. Protect Stored Cardholder Data

```yaml
Implementation:
  - No storage of full card numbers (PAN)
  - Tokenization for card data
  - Encrypted storage of sensitive data
  - Strict data retention policies
  
Data Handling:
  Card Number: Tokenized (never stored)
  CVV: Never stored
  Expiry Date: Encrypted
  Cardholder Name: Encrypted
```

**Tokenization Process:**
```javascript
// Card data never touches merchant servers
const tokenization = {
  input: {
    cardNumber: '4111111111111111',
    cvv: '123',
    expiry: '12/25'
  },
  process: {
    step1: 'Send to PCI-compliant vault',
    step2: 'Generate unique token',
    step3: 'Return token to merchant'
  },
  output: {
    token: 'tok_abc123def456',
    last4: '1111',
    cardType: 'visa'
  }
};

// Merchant stores only the token
await db.savePaymentMethod({
  customerId: 'CUST_001',
  cardToken: 'tok_abc123def456',
  last4: '1111',
  cardType: 'visa'
});
```

#### 4. Encrypt Transmission of Cardholder Data

```yaml
Implementation:
  - TLS 1.3 for all communications
  - Strong cipher suites only
  - Certificate pinning
  - HSTS enabled
  
TLS Configuration:
  Protocol: TLS 1.3
  Cipher Suites:
    - TLS_AES_256_GCM_SHA384
    - TLS_CHACHA20_POLY1305_SHA256
  Certificate: Let's Encrypt (Auto-renewed)
```

#### 5. Protect All Systems Against Malware

```yaml
Implementation:
  - Anti-malware on all systems
  - Regular signature updates
  - Automated scanning
  - Quarantine mechanisms
  
Tools:
  - ClamAV for file scanning
  - AWS GuardDuty for threat detection
  - Regular vulnerability assessments
```

#### 6. Develop and Maintain Secure Systems

```yaml
Implementation:
  - Regular security patches
  - Automated vulnerability scanning
  - Secure development lifecycle
  - Code security reviews
  
Patch Management:
  - Critical patches: Within 24 hours
  - High priority: Within 7 days
  - Medium/Low: Within 30 days
```

#### 7. Restrict Access to Cardholder Data

```yaml
Implementation:
  - Role-Based Access Control (RBAC)
  - Principle of least privilege
  - Need-to-know basis
  - Regular access reviews
  
Access Levels:
  - System Admin: Full access (MFA required)
  - Developer: No production data access
  - Support: Read-only access (MFA required)
  - Merchant: Own data only
```

#### 8. Identify and Authenticate Access

```yaml
Implementation:
  - Multi-Factor Authentication (MFA)
  - Strong password policies
  - Account lockout mechanisms
  - Session management
  
Authentication Methods:
  - Password + OTP (SMS/Email)
  - Password + Authenticator App
  - Biometric (for mobile apps)
```

#### 9. Restrict Physical Access

```yaml
Implementation:
  - 24/7 security at data centers
  - Biometric access control
  - Video surveillance
  - Visitor logs
  
Data Center Security:
  - AWS SOC 2 certified facilities
  - Physical access limited to authorized personnel
  - Equipment destruction procedures
```

#### 10. Track and Monitor Network Access

```yaml
Implementation:
  - Comprehensive logging
  - Real-time monitoring
  - Log retention (1 year+)
  - SIEM integration
  
Monitoring Tools:
  - ELK Stack (Elasticsearch, Logstash, Kibana)
  - AWS CloudWatch
  - Prometheus + Grafana
```

#### 11. Regularly Test Security Systems

```yaml
Implementation:
  - Quarterly vulnerability scans
  - Annual penetration testing
  - Security code reviews
  - Incident response drills
  
Testing Schedule:
  - Vulnerability Scans: Quarterly
  - Penetration Testing: Annually
  - Code Security Review: Every release
```

#### 12. Maintain Information Security Policy

```yaml
Implementation:
  - Comprehensive security policy
  - Regular policy reviews
  - Employee training
  - Incident response plan
  
Policy Coverage:
  - Data handling procedures
  - Access control policies
  - Incident response procedures
  - Vendor management
```

### Merchant Responsibilities

As a merchant, you are responsible for:

```yaml
Responsibilities:
  1. Secure Website:
     - Valid SSL/TLS certificate
     - HTTPS for all pages
     - Regular security updates
  
  2. No Card Data Storage:
     - Never store full card numbers
     - Never store CVV
     - Use our tokenization service
  
  3. Secure Integration:
     - API key security
     - Webhook signature verification
     - Input validation
  
  4. Employee Training:
     - Security awareness
     - Data handling procedures
     - Incident reporting
  
  5. Incident Reporting:
     - Report security incidents within 24 hours
     - Cooperate with investigations
```

## Data Security Measures

### Encryption Standards

#### Data at Rest

```javascript
// Database encryption configuration
const dbConfig = {
  encryption: {
    algorithm: 'AES-256-GCM',
    keyManagement: 'AWS KMS',
    keyRotation: 'every 90 days',
    encryptedFields: [
      'customer_email',
      'customer_phone',
      'bank_account_number',
      'ifsc_code',
      'payment_details'
    ]
  }
};

// Example: Encrypting sensitive data
const crypto = require('crypto');
const AWS = require('aws-sdk');
const kms = new AWS.KMS();

async function encryptData(plaintext, keyId) {
  const params = {
    KeyId: keyId,
    Plaintext: plaintext
  };
  
  const encrypted = await kms.encrypt(params).promise();
  return encrypted.CiphertextBlob.toString('base64');
}

async function decryptData(ciphertext, keyId) {
  const params = {
    CiphertextBlob: Buffer.from(ciphertext, 'base64')
  };
  
  const decrypted = await kms.decrypt(params).promise();
  return decrypted.Plaintext.toString('utf8');
}
```

#### Data in Transit

```javascript
// TLS configuration
const https = require('https');
const fs = require('fs');

const tlsOptions = {
  key: fs.readFileSync('private-key.pem'),
  cert: fs.readFileSync('certificate.pem'),
  ca: fs.readFileSync('ca-certificate.pem'),
  
  // TLS 1.3 only
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
  
  // Strong ciphers only
  ciphers: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256'
  ].join(':'),
  
  // Enable HSTS
  honorCipherOrder: true
};

const server = https.createServer(tlsOptions, app);
```

### Data Minimization

```yaml
Principle: Collect only necessary data

Implementation:
  Order Creation:
    Required:
      - Amount
      - Currency
      - Customer ID
    Optional:
      - Customer email (for notifications)
      - Customer phone (for OTP)
    Never Collect:
      - Full card details
      - CVV
      - PIN
  
  Data Retention:
    Transaction Data: 7 years (regulatory requirement)
    Customer Data: Until account deletion
    Logs: 1 year
    Temporary Data: 30 days
```

### Secure Key Management

```yaml
Key Hierarchy:
  Master Key:
    - Stored in AWS KMS
    - Hardware Security Module (HSM)
    - Never exposed to application
  
  Data Encryption Keys:
    - Generated from master key
    - Rotated every 90 days
    - Encrypted at rest
  
  API Keys:
    - Hashed before storage
    - Time-limited tokens
    - Scoped permissions
```

## Merchant Isolation

### Data Isolation Architecture

```javascript
// Row-level security in PostgreSQL
CREATE POLICY merchant_isolation_policy ON orders
  FOR ALL
  TO merchant_role
  USING (merchant_id = current_setting('app.merchant_id')::VARCHAR);

// Application-level isolation
class MerchantContext {
  constructor(merchantId) {
    this.merchantId = merchantId;
  }
  
  async query(sql, params) {
    // Always inject merchant_id filter
    const merchantSql = `${sql} AND merchant_id = $${params.length + 1}`;
    const merchantParams = [...params, this.merchantId];
    
    return await db.query(merchantSql, merchantParams);
  }
}

// Usage
const merchantContext = new MerchantContext('MERCH_FH_001');
const orders = await merchantContext.query(
  'SELECT * FROM orders WHERE status = $1',
  ['paid']
);
// Automatically filters to MERCH_FH_001 orders only
```

### API Isolation

```javascript
// API middleware for merchant isolation
function merchantIsolationMiddleware(req, res, next) {
  // Extract merchant ID from JWT
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  // Set merchant context
  req.merchantId = decoded.merchantId;
  req.merchantTier = decoded.merchantTier;
  
  // Validate merchant status
  if (decoded.merchantStatus !== 'active') {
    return res.status(403).json({
      error: 'Merchant account is not active'
    });
  }
  
  // Set database session variable
  await db.query(
    "SET LOCAL app.merchant_id = $1",
    [req.merchantId]
  );
  
  next();
}

// Apply to all merchant routes
app.use('/api', merchantIsolationMiddleware);
```

## Fraud Prevention

### Multi-Layered Fraud Detection

```
┌────────────────────────────────────────────────────────────┐
│                  FRAUD DETECTION LAYERS                     │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: Rule-Based Detection                             │
│  ├─ Velocity checks (transactions per hour/day)           │
│  ├─ Amount limits                                          │
│  ├─ Geographic mismatch                                    │
│  └─ Blacklist checking                                     │
│                                                             │
│  Layer 2: Machine Learning                                 │
│  ├─ Behavioral analysis                                    │
│  ├─ Pattern recognition                                    │
│  ├─ Anomaly detection                                      │
│  └─ Risk scoring                                           │
│                                                             │
│  Layer 3: 3D Secure / OTP                                  │
│  ├─ Cardholder authentication                             │
│  ├─ Dynamic password                                       │
│  └─ Biometric verification                                │
│                                                             │
│  Layer 4: Manual Review                                    │
│  ├─ High-risk transactions                                 │
│  ├─ Suspicious patterns                                    │
│  └─ Customer verification                                  │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### Fraud Rules Implementation

```javascript
// Fraud detection rules
const fraudRules = {
  velocityCheck: {
    maxTransactionsPerHour: 10,
    maxTransactionsPerDay: 50,
    maxAmountPerDay: 100000
  },
  
  amountCheck: {
    maxSingleTransaction: 50000,
    suspiciousAmounts: [99, 999, 9999] // Common test amounts
  },
  
  geographicCheck: {
    allowedCountries: ['IN'],
    blockedCountries: []
  },
  
  cardCheck: {
    maxFailedAttempts: 3,
    blockDuration: 3600 // 1 hour
  }
};

// Fraud scoring
async function calculateFraudScore(transaction) {
  let score = 0;
  
  // Check transaction velocity
  const recentTransactions = await getRecentTransactions(
    transaction.customerId,
    24 // hours
  );
  if (recentTransactions.length > fraudRules.velocityCheck.maxTransactionsPerDay) {
    score += 30;
  }
  
  // Check amount patterns
  if (fraudRules.amountCheck.suspiciousAmounts.includes(transaction.amount)) {
    score += 25;
  }
  
  // Check geographic mismatch
  const customerLocation = await getCustomerLocation(transaction.customerId);
  const transactionLocation = transaction.ipAddress;
  if (locationMismatch(customerLocation, transactionLocation)) {
    score += 20;
  }
  
  // Check device fingerprint
  const deviceHistory = await getDeviceHistory(transaction.deviceId);
  if (deviceHistory.fraudReports > 0) {
    score += 35;
  }
  
  return {
    score: score,
    risk: score > 70 ? 'high' : score > 40 ? 'medium' : 'low',
    action: score > 70 ? 'block' : score > 40 ? 'review' : 'allow'
  };
}

// Apply fraud check
router.post('/payments/process', async (req, res) => {
  const transaction = req.body;
  
  // Calculate fraud score
  const fraudCheck = await calculateFraudScore(transaction);
  
  if (fraudCheck.action === 'block') {
    return res.status(403).json({
      success: false,
      error: 'Transaction blocked due to fraud risk',
      fraudScore: fraudCheck.score
    });
  }
  
  if (fraudCheck.action === 'review') {
    // Queue for manual review
    await queueForReview(transaction, fraudCheck);
    return res.status(202).json({
      success: true,
      status: 'pending_review',
      message: 'Transaction is under review'
    });
  }
  
  // Process transaction
  const result = await processPayment(transaction);
  res.json(result);
});
```

### Chargeback Prevention

```javascript
// Chargeback management
const chargebackPrevention = {
  // Clear descriptor
  merchantDescriptor: 'FASHIONHUB*ORDER12345',
  
  // Order confirmation
  sendOrderConfirmation: true,
  sendShippingNotification: true,
  
  // Customer communication
  enableCustomerSupport: true,
  respondWithin: 24, // hours
  
  // Documentation
  retainProofOfDelivery: true,
  retainCustomerCommunication: true,
  retentionPeriod: 180 // days
};

// Handle chargeback notification
async function handleChargeback(chargebackData) {
  const { paymentId, orderId, reason, amount } = chargebackData;
  
  // Retrieve supporting documents
  const documents = await gatherChargebackEvidence(orderId);
  
  // Submit representment
  await submitChargebackRepresentment({
    chargebackId: chargebackData.id,
    evidence: {
      proofOfDelivery: documents.deliveryProof,
      customerCommunication: documents.communications,
      trackingNumber: documents.trackingNumber,
      signedReceipt: documents.receipt
    }
  });
  
  // Notify merchant
  await notifyMerchant({
    merchantId: chargebackData.merchantId,
    type: 'chargeback.received',
    data: chargebackData
  });
}
```

## KYC/AML Requirements

### Know Your Customer (KYC)

```yaml
KYC Process:
  Individual Merchants:
    Required Documents:
      - PAN Card
      - Aadhaar Card
      - Bank Account Proof
      - Address Proof
    Verification:
      - DigiLocker integration
      - Aadhaar eKYC
      - Video KYC
  
  Business Entities:
    Required Documents:
      - Certificate of Incorporation
      - PAN Card (Company)
      - GST Certificate
      - Bank Account Statement
      - Directors' KYC
    Verification:
      - MCA database check
      - GST verification
      - Bank account verification
```

### Anti-Money Laundering (AML)

```javascript
// AML screening
async function performAMLCheck(merchantData) {
  const checks = {
    // 1. Sanctions screening
    sanctionsCheck: await checkSanctionsList(
      merchantData.businessName,
      merchantData.directors
    ),
    
    // 2. PEP (Politically Exposed Person) check
    pepCheck: await checkPEPDatabase(
      merchantData.directors
    ),
    
    // 3. Adverse media screening
    adverseMediaCheck: await screenAdverseMedia(
      merchantData.businessName
    ),
    
    // 4. High-risk jurisdiction check
    jurisdictionCheck: checkHighRiskJurisdiction(
      merchantData.address.country
    )
  };
  
  // Calculate AML risk score
  const riskScore = calculateAMLRisk(checks);
  
  return {
    passed: riskScore < 70,
    riskScore: riskScore,
    checks: checks,
    action: riskScore > 70 ? 'reject' : riskScore > 40 ? 'enhanced_dd' : 'approve'
  };
}

// Transaction monitoring
async function monitorTransaction(transaction) {
  const flags = [];
  
  // Large transaction
  if (transaction.amount > 200000) {
    flags.push('large_transaction');
  }
  
  // Rapid succession
  const recentCount = await countRecentTransactions(
    transaction.merchantId,
    60 // minutes
  );
  if (recentCount > 50) {
    flags.push('high_velocity');
  }
  
  // Unusual pattern
  const avgTicket = await getAverageTicketSize(transaction.merchantId);
  if (transaction.amount > avgTicket * 5) {
    flags.push('unusual_amount');
  }
  
  // Report suspicious activity
  if (flags.length >= 2) {
    await reportSuspiciousActivity({
      transactionId: transaction.id,
      merchantId: transaction.merchantId,
      flags: flags,
      amount: transaction.amount
    });
  }
}
```

## Audit and Monitoring

### Comprehensive Audit Trail

```javascript
// Audit logging implementation
class AuditLogger {
  async log(event) {
    const auditEntry = {
      eventId: generateUUID(),
      eventType: event.type,
      timestamp: new Date(),
      merchantId: event.merchantId,
      userId: event.userId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      changes: event.changes,
      result: event.result,
      errorMessage: event.errorMessage
    };
    
    // Store in database
    await db.query(
      'INSERT INTO audit_logs (...) VALUES (...)',
      Object.values(auditEntry)
    );
    
    // Index in Elasticsearch
    await elasticsearch.index({
      index: 'audit-logs',
      body: auditEntry
    });
    
    // Send to SIEM
    await sendToSIEM(auditEntry);
  }
}

// Usage
await auditLogger.log({
  type: 'payment.processed',
  merchantId: 'MERCH_FH_001',
  userId: 'user_123',
  ipAddress: '203.0.113.10',
  action: 'process_payment',
  resource: 'payment',
  resourceId: 'pay_FH_123',
  result: 'success'
});
```

### Real-Time Security Monitoring

```javascript
// Security event monitoring
const securityEvents = {
  // Failed login attempts
  'auth.login.failed': {
    threshold: 5,
    window: 300, // 5 minutes
    action: 'lock_account'
  },
  
  // Unusual API usage
  'api.rate_limit.exceeded': {
    threshold: 3,
    window: 3600, // 1 hour
    action: 'alert_security_team'
  },
  
  // Data access anomaly
  'data.access.unusual': {
    threshold: 1,
    window: 0,
    action: 'immediate_alert'
  }
};

// Monitor and respond
async function monitorSecurityEvent(event) {
  const rule = securityEvents[event.type];
  if (!rule) return;
  
  const recentEvents = await getRecentEvents(
    event.type,
    event.identifier,
    rule.window
  );
  
  if (recentEvents.length >= rule.threshold) {
    await executeAction(rule.action, event);
  }
}
```

## Incident Response

### Incident Response Plan

```yaml
Phase 1: Identification (0-15 minutes)
  - Detect security incident
  - Initial assessment
  - Determine severity
  - Alert response team

Phase 2: Containment (15-60 minutes)
  - Isolate affected systems
  - Prevent spread
  - Preserve evidence
  - Implement temporary fixes

Phase 3: Eradication (1-4 hours)
  - Identify root cause
  - Remove threat
  - Patch vulnerabilities
  - Verify remediation

Phase 4: Recovery (4-24 hours)
  - Restore services
  - Monitor for recurrence
  - Validate functionality
  - Update security measures

Phase 5: Post-Incident (24-72 hours)
  - Document incident
  - Analyze lessons learned
  - Update procedures
  - Report to stakeholders
```

### Incident Classification

```javascript
const incidentSeverity = {
  CRITICAL: {
    examples: [
      'Data breach',
      'Unauthorized access to payment data',
      'Service outage affecting all merchants'
    ],
    responseTime: '15 minutes',
    escalation: 'CEO, CISO, Legal'
  },
  
  HIGH: {
    examples: [
      'Failed authentication attempts',
      'Suspected fraud activity',
      'Service degradation'
    ],
    responseTime: '1 hour',
    escalation: 'CISO, Security Team'
  },
  
  MEDIUM: {
    examples: [
      'Policy violations',
      'Minor security alerts',
      'Configuration issues'
    ],
    responseTime: '4 hours',
    escalation: 'Security Team'
  },
  
  LOW: {
    examples: [
      'Informational security events',
      'Routine security scans'
    ],
    responseTime: '24 hours',
    escalation: 'Security Team'
  }
};
```

### Breach Notification

```javascript
// Data breach notification process
async function handleDataBreach(breachData) {
  // 1. Immediate containment
  await containBreach(breachData);
  
  // 2. Assess impact
  const impact = await assessBreachImpact(breachData);
  
  // 3. Notify authorities (within 72 hours)
  if (impact.personalDataAffected) {
    await notifyDataProtectionAuthority({
      breachType: breachData.type,
      affectedRecords: impact.recordCount,
      dataTypes: impact.dataTypes,
      actions: breachData.actions
    });
  }
  
  // 4. Notify affected merchants (within 24 hours)
  await notifyAffectedMerchants({
    merchantIds: impact.affectedMerchants,
    breachDescription: breachData.description,
    impact: impact,
    remediation: breachData.remediation
  });
  
  // 5. Public disclosure (if required)
  if (impact.severity === 'CRITICAL') {
    await publishSecurityAdvisory({
      title: breachData.title,
      description: breachData.publicDescription,
      impact: 'high',
      remediation: breachData.publicRemediation
    });
  }
}
```

---

**Next Steps**: Review [Monitoring and Reporting](06_MONITORING_REPORTING.md) for operational monitoring and reporting capabilities.
