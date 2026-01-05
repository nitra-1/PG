# PCI-DSS Compliance Guide

## Overview

This payment gateway is designed to comply with the Payment Card Industry Data Security Standard (PCI-DSS) v3.2.1 and above. This document outlines the implemented security controls and compliance measures.

## PCI-DSS Requirements Implementation

### Requirement 3: Protect Stored Cardholder Data

#### 3.2 - Do Not Store Sensitive Authentication Data After Authorization

**Implementation:**
- CVV/CVV2/CVC2/CID is **NEVER** stored after authorization
- PIN and PIN block data is **NEVER** stored
- Full track data from magnetic stripe is **NEVER** stored
- Automated validation in `PCIDSSComplianceService.validateCompliance()`

**Code Reference:** `src/security/pci-dss-compliance.js`

#### 3.3 - Mask PAN When Displayed

**Implementation:**
- Only last 4 digits of Primary Account Number (PAN) are displayed
- First 6 digits (BIN) retained for card brand identification only
- Tokenization service automatically masks card numbers
- Display format: `****-****-****-1111`

**Code Reference:** `src/security/tokenization-service.js`

#### 3.4 - Render PAN Unreadable

**Implementation:**
- **Tokenization**: All card numbers are tokenized using secure tokens
- **Encryption**: AES-256-GCM encryption for data at rest
- **Token Format**: `tok_card_[random]_[checksum]`
- Tokens stored in separate secure vault database
- Original card data never stored in application database

**Code Reference:** `src/security/tokenization-service.js`

### Requirement 4: Encrypt Transmission of Cardholder Data

#### 4.1 - Use Strong Cryptography and Security Protocols

**Implementation:**
- **TLS 1.3** enforced (with TLS 1.2 fallback for compatibility)
- TLS 1.0 and 1.1 **deprecated and blocked**
- Strong cipher suites:
  - TLS 1.3: `TLS_AES_256_GCM_SHA384`, `TLS_CHACHA20_POLY1305_SHA256`
  - TLS 1.2: `ECDHE-RSA-AES256-GCM-SHA384`, `ECDHE-RSA-AES128-GCM-SHA256`

**Code Reference:** `src/security/https-middleware.js`

#### 4.2 - Never Send Unprotected PANs

**Implementation:**
- HTTPS enforced for all sensitive endpoints
- HTTP requests automatically redirected to HTTPS in production
- Insecure endpoints blocked for payment operations
- Middleware validation before processing card data

**Configuration:**
```javascript
const sensitiveEndpoints = [
  '/api/payments',
  '/api/payin',
  '/api/payout',
  '/api/bnpl'
];
```

### Requirement 7: Restrict Access to Cardholder Data

#### 7.1 - Limit Access by Business Need-to-Know

**Implementation:**
- Role-based access control (RBAC)
- Privileged roles required for sensitive data access:
  - `ADMIN`
  - `SECURITY_ADMIN`
  - `COMPLIANCE_OFFICER`
- Business justification required for privileged access

**Code Reference:** `src/security/pci-dss-compliance.js` - `validateAccessControl()`

### Requirement 8: Identify and Authenticate Access

#### 8.1 - Assign Unique ID to Each User

**Implementation:**
- Unique user IDs required for all cardholder data access
- JWT token-based authentication
- API key authentication for merchants
- User identification logged in audit trail

#### 8.2 - Strong Authentication Controls

**Implementation:**
- Password requirements:
  - Minimum 12 characters (exceeds PCI-DSS minimum of 7)
  - Must contain uppercase, lowercase, numbers, and special characters
  - Password strength validation
- Multi-factor authentication (MFA) recommended for privileged operations

**Code Reference:** `src/security/pci-dss-compliance.js` - `validatePasswordCompliance()`

### Requirement 10: Track and Monitor All Access

#### 10.1-10.3 - Implement Audit Trails

**Implementation:**
- Comprehensive audit trail system
- All cardholder data access logged
- Tamper-proof logging with SHA-256 hashing
- Audit events include:
  - Data access (read/write/update/delete)
  - Authentication attempts (success/failure)
  - Payment transactions
  - Configuration changes
  - Security events

**Database Tables:**
- `audit_trail` - All audit events
- `sensitive_data_access` - Specific PCI data access
- `security_alerts` - Security incidents

**Code Reference:** `src/security/audit-trail-service.js`

#### 10.6 - Review Logs Daily

**Implementation:**
- Automated suspicious activity detection
- Real-time security alerts for high-severity events
- Audit report generation: `pciComplianceService.generateAuditReport()`
- Query capabilities for audit investigation

### Requirement 12: Maintain Information Security Policy

**Implementation:**
- PCI-DSS compliance report generation
- Compliance status tracking
- Regular security reviews (90-day cycle)
- Documented security controls

**API Endpoint:** `GET /api/compliance/report`

## Tokenization System

### Token Generation

Tokens are generated using the following format:
```
tok_[type]_[32-hex-random]_[8-hex-checksum]
```

**Types:**
- `card` - Card numbers
- `email` - Email addresses
- `phone` - Phone numbers
- `name` - Customer names
- `address` - Address information

### Token Lifecycle

1. **Generation**: Secure random token with checksum
2. **Storage**: Encrypted data stored in token vault
3. **Usage**: Token used in place of sensitive data
4. **Expiration**: Optional expiration date
5. **Revocation**: Tokens can be revoked when needed

### Security Features

- **Luhn Algorithm Validation**: All card numbers validated
- **Checksum Verification**: Token integrity validation
- **Vault Encryption**: AES-256-GCM for vault data
- **Access Tracking**: All token access logged

## HTTPS/TLS Enforcement

### Configuration

Set the following environment variables:

```bash
# HTTPS Configuration
SSL_CERT_PATH=/path/to/ssl/certificate.crt
SSL_KEY_PATH=/path/to/ssl/private.key
HTTPS_PORT=443
HSTS_ENABLED=true
TLS_MIN_VERSION=TLSv1.2
TLS_MAX_VERSION=TLSv1.3
```

### Middleware Stack

```javascript
// HTTPS Enforcement
app.use(enforceHTTPS);
app.use(enforceTLSVersion);
app.use(logInsecureRequests(auditTrailService));
app.use(blockInsecureEndpoints(sensitiveEndpoints));
app.use(addSecurityHeaders);
```

### Security Headers

- **Strict-Transport-Security (HSTS)**: 2-year max-age with includeSubDomains
- **Content-Security-Policy**: Restricts resource loading
- **X-Content-Type-Options**: Prevents MIME sniffing
- **X-Frame-Options**: Prevents clickjacking
- **X-XSS-Protection**: XSS filter enabled

## Audit Trail System

### Event Types

- `DATA_ACCESS` - Sensitive data access
- `AUTHENTICATION` - Login/logout events
- `TRANSACTION` - Payment transactions
- `CONFIGURATION_CHANGE` - System configuration changes
- `SECURITY_EVENT` - Security incidents
- `API_REQUEST` - API endpoint access

### Tamper Detection

Each audit entry includes a SHA-256 hash:
```javascript
hash = SHA256(auditEntry + hmacSecret)
```

This ensures audit logs cannot be modified without detection.

### Suspicious Activity Detection

Automated detection for:
- Excessive PCI data access (>10 accesses per minute)
- Brute force attempts (>5 failed logins in 5 minutes)
- Unusual access patterns
- Unauthorized access attempts

### Query Audit Trail

```javascript
// Query audit trail
const auditEntries = await auditTrailService.queryAuditTrail({
  userId: 'USER_123',
  eventType: 'DATA_ACCESS',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  limit: 100
});
```

## Data Retention

### Policy

- Default retention: 90 days (configurable)
- Automated deletion scheduling
- Secure data wiping for sensitive data
- Retention tracking in `data_retention_tracking` table

### Configuration

```bash
DATA_RETENTION_DAYS=90
```

### Implementation

```javascript
const retention = pciComplianceService.validateDataRetention(data);
if (!retention.shouldRetain) {
  // Schedule for deletion
}
```

## API Usage

### Tokenize Card Data

```javascript
const tokenizationService = app.locals.tokenizationService;

const tokenized = tokenizationService.tokenizeCard({
  cardNumber: '4111111111111111',
  cvv: '123',
  expiryMonth: 12,
  expiryYear: 2025,
  cardholderName: 'John Doe'
});

// Store only tokenized data
const safeData = {
  cardToken: tokenized.cardToken,
  last4: tokenized.last4,
  cardBrand: tokenized.cardBrand
  // Original card number and CVV are NOT stored
};
```

### Log Sensitive Data Access

```javascript
const auditTrailService = app.locals.auditTrailService;

await auditTrailService.logDataAccess({
  userId: req.user.userId,
  action: 'READ',
  resource: 'CARD_DATA',
  resourceId: cardToken,
  dataType: 'PCI_DATA',
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  success: true
});
```

### Validate Compliance

```javascript
const pciComplianceService = app.locals.pciComplianceService;

// Validate request data
const validation = pciComplianceService.validateCompliance(requestData);

if (!validation.compliant) {
  return res.status(400).json({
    error: 'PCI-DSS Compliance Violation',
    violations: validation.violations
  });
}

// Sanitize for storage
const safeData = pciComplianceService.sanitizeForStorage(requestData);
```

### Generate Compliance Report

```bash
GET /api/compliance/report
```

Returns comprehensive PCI-DSS compliance status.

## Testing

Run PCI-DSS compliance tests:

```bash
npm test -- tokenization.test.js
npm test -- https-middleware.test.js
```

## Security Best Practices

1. **Never Log Sensitive Data**
   - Use `redactSensitiveData()` before logging
   - CVV must never be logged

2. **Use Tokenization**
   - Always tokenize card numbers before storage
   - Never store full PAN in application database

3. **Enforce HTTPS**
   - Production must use HTTPS only
   - TLS 1.3 or 1.2 required

4. **Monitor Audit Logs**
   - Review security alerts daily
   - Investigate suspicious activity immediately

5. **Regular Security Reviews**
   - Quarterly PCI-DSS compliance reviews
   - Annual penetration testing
   - Vulnerability scanning

## Compliance Checklist

- [x] Card data tokenization implemented
- [x] CVV/PIN never stored
- [x] PAN masking in displays
- [x] AES-256-GCM encryption at rest
- [x] TLS 1.3/1.2 for transmission
- [x] HTTPS enforcement
- [x] Role-based access control
- [x] Strong password policy
- [x] Comprehensive audit trail
- [x] Tamper-proof logging
- [x] Suspicious activity detection
- [x] Data retention policy
- [x] Security alert system

## Support

For PCI-DSS compliance questions or security concerns:
- Email: security@paymentgateway.com
- Compliance Officer: compliance@paymentgateway.com
- Security Hotline: 1-800-SECURITY

## References

- [PCI-DSS v3.2.1](https://www.pcisecuritystandards.org/)
- [TLS Best Practices](https://wiki.mozilla.org/Security/Server_Side_TLS)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
