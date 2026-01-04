# Merchant Onboarding System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Merchant Dashboard (Web UI)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │Overview  │ │Settings  │ │API Keys  │ │Webhooks  │ │Analytics │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API Gateway / Routes                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/merchants                    Register Merchant        │  │
│  │  GET/PUT/DELETE /api/merchants/:id      Manage Merchant          │  │
│  │  POST /api/merchants/:id/api-keys       Generate Keys            │  │
│  │  POST /api/merchants/:id/webhooks       Configure Webhooks       │  │
│  │  POST /api/merchants/:id/rate-limits    Set Rate Limits          │  │
│  │  POST /api/merchants/:id/ip-whitelist   Manage IP Whitelist      │  │
│  │  GET /api/merchants/:id/usage           Get Statistics           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
┌───────────────────────┐  ┌──────────────┐  ┌────────────────┐
│  Merchant Middleware  │  │   Merchant   │  │   Payment      │
│  ┌─────────────────┐  │  │   Service    │  │   Processing   │
│  │ Authenticate    │  │  │              │  │                │
│  │ Merchant        │  │  │              │  │  Uses merchant │
│  ├─────────────────┤  │  │              │  │  API keys for  │
│  │ Check IP        │  │  │              │  │  auth          │
│  │ Whitelist       │  │  │              │  │                │
│  ├─────────────────┤  │  │              │  └────────────────┘
│  │ Rate Limiting   │  │  │              │
│  ├─────────────────┤  │  │              │
│  │ Usage Tracking  │  │  │              │
│  └─────────────────┘  │  └──────────────┘
└───────────────────────┘          │
            │                      │
            │         ┌────────────┼────────────┐
            │         │            │            │
            ▼         ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          PostgreSQL Database                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  merchants   │  │merchant_api  │  │merchant_     │             │
│  │              │  │_keys         │  │webhooks      │             │
│  │ - id         │  │              │  │              │             │
│  │ - code       │  │ - api_key    │  │ - url        │             │
│  │ - name       │  │ - secret⚿   │  │ - secret     │             │
│  │ - email      │  │ - status     │  │ - events     │             │
│  │ - status     │  │ - expires_at │  │ - retries    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │merchant_rate │  │merchant_ip   │  │merchant_usage│             │
│  │_limits       │  │_whitelist    │  │_stats        │             │
│  │              │  │              │  │              │             │
│  │ - endpoint   │  │ - ip_address │  │ - date       │             │
│  │ - max_req    │  │ - status     │  │ - requests   │             │
│  │ - window_ms  │  │ - last_used  │  │ - amount     │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
            │
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Security Layer                               │
│  ┌────────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │  AES-256-GCM       │  │  Rate Limiting   │  │  IP Validation  │ │
│  │  Encryption        │  │                  │  │                 │ │
│  │                    │  │  - Per-merchant  │  │  - IPv4/IPv6    │ │
│  │  - API secrets     │  │  - Per-endpoint  │  │  - Whitelist    │ │
│  │  - Webhook secrets │  │  - Redis backed  │  │  - Proxy trust  │ │
│  └────────────────────┘  └──────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
            │
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         External Systems                             │
│  ┌────────────────────┐  ┌──────────────────┐                       │
│  │  Webhook Delivery  │  │  Redis Cache     │                       │
│  │                    │  │                  │                       │
│  │  - Event triggers  │  │  - Rate limit    │                       │
│  │  - Retry logic     │  │    counters      │                       │
│  │  - Delivery logs   │  │  - Session data  │                       │
│  └────────────────────┘  └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘


Legend:
  ⚿  = Encrypted data
  │  = Data flow
  ┌┐ = Component boundary
```

## Data Flow Examples

### 1. Merchant Registration Flow
```
Merchant Dashboard → POST /api/merchants → Merchant Service
                                          ↓
                              Generate API Key (encrypted)
                                          ↓
                              Store in Database
                                          ↓
                              Return credentials (secret shown once)
                                          ↓
                              Merchant Dashboard displays keys
```

### 2. Payment Request with API Key
```
Merchant System → POST /api/payments/process (with X-API-Key)
                                          ↓
                              authenticateMerchant middleware
                                          ↓
                              Verify API key from database
                                          ↓
                              checkIPWhitelist middleware
                                          ↓
                              Verify IP is allowed
                                          ↓
                              merchantRateLimit middleware
                                          ↓
                              Check rate limit (Redis)
                                          ↓
                              Process payment
                                          ↓
                              trackMerchantUsage middleware
                                          ↓
                              Log usage to database
                                          ↓
                              Return payment response
```

### 3. Usage Analytics Flow
```
Merchant Dashboard → GET /api/merchants/:id/usage
                                          ↓
                              Query merchant_usage_stats
                                          ↓
                              Aggregate statistics
                                          ↓
                              Return summary + details
                                          ↓
                              Dashboard visualizes data
```

## Security Layers

1. **Transport Security**: HTTPS/TLS 1.3
2. **Authentication**: API key verification
3. **Network Security**: IP whitelisting
4. **Rate Protection**: Per-merchant rate limiting
5. **Data Security**: AES-256-GCM encryption at rest
6. **Audit Trail**: Complete logging of all operations
7. **Input Validation**: Express-validator on all endpoints

## Scalability Features

- **Database**: Indexed tables for fast queries
- **Caching**: Redis for distributed rate limiting
- **Stateless**: Horizontally scalable API servers
- **Connection Pooling**: Efficient database connections
- **Async Processing**: Non-blocking usage tracking
