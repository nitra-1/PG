# FinOps Intelligence — Agent Design Document

> **Purpose**: Define the architecture, business context, data requirements, and MVP plan for AI agents that deliver financial decision intelligence across the payment gateway platform.

---

## 1️⃣ Business Layer (Most Important)

### Primary Customer

**PSP (Payment Service Provider)** — The platform operates as a PSP, serving Merchants as the end customers who process payments through the gateway.

---

### Top 3 Business Problems We Are Solving

| # | Problem | Impact |
|---|---------|--------|
| 1 | **Settlement Risk & Delays** | Funds stuck in transit, reconciliation gaps, merchant complaints |
| 2 | **Fee Leakage & Pricing Inconsistency** | Incorrect MDR application, undetected overcharges/undercharges |
| 3 | **Reconciliation Mismatches** | Transactions present in gateway but missing in bank/ledger, or vice versa |

---

### What Decisions We Ask AI to Support

| Decision Type | Description | Examples |
|---------------|-------------|---------|
| **Detect Issue** | Identify anomalies, mismatches, and risks automatically | Flag unsettled transactions older than SLA, detect fee deviation |
| **Recommend Action** | Suggest corrective action with reasoning | "Re-trigger settlement for TXN-XXX; bank ACK missing" |
| **Auto-Execute** | Trigger low-risk actions without human approval | Mark matched records, update reconciliation status, send alerts |

---

### Tolerance for Automation

| Layer | Mode | Rationale |
|-------|------|-----------|
| Risk Detection | **Full Automation** | High volume; real-time flagging needed |
| Reconciliation Matching | **Full Automation** | Deterministic rule-based + ML matching |
| Settlement Retry | **Human Approval** | Financial impact; requires ops sign-off |
| Fee Adjustment | **Human Approval** | Compliance-sensitive; audit trail required |
| Reporting & Alerts | **Full Automation** | Low risk; informational |
| Chargeback Response | **Advisory Only** | Legal implications; human must decide |

---

## 🔄 2️⃣ Process / Lifecycle Layer

### Payment Lifecycle Flow

```
Customer Initiates Payment
        │
        ▼
  [PAYMENT CREATED]
        │
        ▼
  [AUTHORIZATION]  ◄── Risk check, fraud screen
        │
        ▼
  [CAPTURE]        ◄── Amount locked from customer
        │
        ▼
  [SETTLEMENT]     ◄── Funds moved to merchant pool
        │
        ▼
  [RECONCILIATION] ◄── Gateway vs Bank vs Ledger match
        │
        ▼
  [ACCOUNTING]     ◄── Ledger entries posted, books closed
        │
        ▼
  [CLOSED / EXCEPTION]
```

---

### Settlement Lifecycle States

```
PENDING → INITIATED → PROCESSING → SETTLED → RECONCILED
                                          └──► FAILED → RETRY → SETTLED / MANUAL
```

| State | Meaning |
|-------|---------|
| `PENDING` | Transaction captured; awaiting settlement batch |
| `INITIATED` | Settlement batch created and sent to bank |
| `PROCESSING` | Bank acknowledged; funds in transit |
| `SETTLED` | Bank confirmed credit to merchant |
| `RECONCILED` | Gateway + Bank + Ledger all match |
| `FAILED` | Bank rejection or timeout |
| `RETRY` | Auto or manual re-attempt |
| `MANUAL` | Escalated for human intervention |

---

### Reconciliation Flow

**Inputs:**
- Gateway transaction records (`transactions` table)
- Bank settlement reports (file/API — CSV, MT940, NEFT/RTGS advice)
- Internal ledger entries (`ledger_entries` table)
- Refund and chargeback records

**Processing Steps:**
1. Ingest all three data sources for a given settlement date
2. Normalize transaction IDs, amounts, currencies, timestamps
3. Match on: `(transaction_id, amount, merchant_id, settlement_date)`
4. Classify each record:
   - ✅ **Matched** — present in all three sources
   - ⚠️ **Partial Match** — present in two of three
   - ❌ **Unmatched** — present in only one source
5. Apply business rules to determine exception type
6. Route exceptions to appropriate agent or queue

**Outputs:**
- Reconciliation report (matched/unmatched counts and amounts)
- Exception list with root cause classification
- Recommended actions per exception
- Audit log of reconciliation run

**Exception Handling:**

| Exception Type | Root Cause | Agent Action |
|----------------|------------|--------------|
| Gateway hit, bank missing | Settlement not processed | Flag for retry; alert ops |
| Bank hit, gateway missing | Duplicate or ghost transaction | Flag for investigation |
| Amount mismatch | Fee error or FX rounding | Calculate delta; recommend adjustment |
| Timing mismatch | Cutoff time differences | Auto-resolve with T+1 carry-forward |
| Refund not reflected | Refund processing lag | Monitor and alert after SLA breach |

---

### Where Manual Intervention Happens Today

| Stage | Manual Touch Point | Pain |
|-------|-------------------|------|
| Settlement | Ops team manually checks stuck settlements | Slow, reactive |
| Reconciliation | Finance team manually compares reports | Error-prone, time-consuming |
| Exception handling | Tickets raised per exception | No pattern detection |
| Fee validation | Periodic audits only | Leakage goes undetected |
| Chargeback matching | Manual lookup | High effort, slow response |

---

## 📊 3️⃣ Data Layer

### A. Data Sources

| Source | Format | Delivery |
|--------|--------|----------|
| Gateway transaction records | Database tables (PostgreSQL) | Real-time API |
| Bank settlement reports | CSV / MT940 / PDF | Batch (T+1), SFTP or email |
| Internal ledger | Database tables | Real-time |
| Refund / chargeback data | Database tables + bank files | Batch + real-time |
| Fee / pricing rules | Database tables (`merchant_config`) | Real-time |
| Audit logs | Database / log files | Real-time |

---

### B. Key Entities

#### Transaction
| Field | Type | Description |
|-------|------|-------------|
| `transaction_id` | UUID | Unique gateway transaction ID |
| `merchant_id` | UUID | Merchant reference |
| `tenant_id` | UUID | Multi-tenant identifier |
| `amount` | Decimal | Transaction amount |
| `currency` | String | ISO 4217 currency code |
| `status` | Enum | `pending`, `authorized`, `captured`, `failed`, `refunded` |
| `payment_method` | String | UPI, card, wallet, BNPL, QR |
| `gateway_reference` | String | Internal gateway ref |
| `bank_reference` | String | Bank-assigned ref |
| `created_at` | Timestamp | Transaction initiation time |
| `updated_at` | Timestamp | Last status update |
| `settled_at` | Timestamp | Settlement timestamp (nullable) |

#### Settlement
| Field | Type | Description |
|-------|------|-------------|
| `settlement_id` | UUID | Unique settlement record ID |
| `merchant_id` | UUID | Merchant reference |
| `settlement_date` | Date | Date settlement was processed |
| `gross_amount` | Decimal | Total before deductions |
| `fee_amount` | Decimal | Platform / MDR fee |
| `net_amount` | Decimal | Amount credited to merchant |
| `status` | Enum | See settlement lifecycle states |
| `bank_utr` | String | Unique Transaction Reference from bank |
| `batch_id` | String | Settlement batch grouping |
| `initiated_at` | Timestamp | When settlement was sent |
| `settled_at` | Timestamp | Bank confirmation time |

#### Ledger Entry
| Field | Type | Description |
|-------|------|-------------|
| `ledger_id` | UUID | Unique ledger entry ID |
| `transaction_id` | UUID | Reference to transaction |
| `entry_type` | Enum | `debit`, `credit` |
| `account_type` | Enum | `merchant_pool`, `platform_fee`, `settlement`, `refund` |
| `amount` | Decimal | Entry amount |
| `currency` | String | Currency |
| `accounting_period` | String | Period (YYYY-MM) |
| `posted_at` | Timestamp | Ledger posting time |
| `reconciled` | Boolean | Whether matched with bank |

#### Fees / Pricing Rules
| Field | Type | Description |
|-------|------|-------------|
| `fee_rule_id` | UUID | Pricing rule ID |
| `merchant_id` | UUID | Merchant this applies to |
| `payment_method` | String | Applicable payment type |
| `mdr_percentage` | Decimal | Merchant Discount Rate (%) |
| `flat_fee` | Decimal | Fixed fee per transaction |
| `currency` | String | Fee currency |
| `effective_from` | Date | Rule start date |
| `effective_to` | Date | Rule end date (nullable) |

#### Merchant Config
| Field | Type | Description |
|-------|------|-------------|
| `merchant_id` | UUID | Merchant reference |
| `tenant_id` | UUID | Tenant reference |
| `settlement_cycle` | Enum | `T+1`, `T+2`, `weekly` |
| `settlement_account` | String | Bank account for settlement |
| `ifsc_code` | String | Bank IFSC |
| `status` | Enum | `active`, `suspended`, `kyc_pending` |
| `auto_settlement` | Boolean | Whether auto-settlement is enabled |

---

### C. Data Availability

| Data Type | Availability | Channel |
|-----------|-------------|---------|
| Transactions | Real-time | Internal API / DB |
| Settlements | Real-time (status) + Batch (bank confirm) | DB + SFTP |
| Ledger entries | Real-time | DB |
| Bank statements | Batch (T+1 / T+2) | SFTP / Email / API |
| Historical data | Available (varies by table) | DB |
| Refunds | Real-time | DB |
| Chargebacks | Batch (bank cycle) | SFTP / Portal |

---

### D. Current Pain in Data

| Pain Point | Description |
|------------|-------------|
| Missing `bank_reference` | Many transactions lack bank UTR, making matching impossible |
| Inconsistent formats | Bank reports vary by bank (NEFT advice ≠ RTGS advice ≠ IMPS report) |
| Timing gaps | Gateway records at T+0; bank confirms at T+1 or T+2 |
| Duplicate detection | No deduplication on inbound bank files |
| Amount rounding | Fee calculation rounding differs between gateway and bank |
| No correlation ID | No single ID that flows across gateway → bank → ledger |
| Status lag | Settlement `status` in DB not updated promptly from bank ACK |

---

## ⚙️ 4️⃣ System / Architecture Layer

### Current Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | PostgreSQL (via Knex.js ORM) |
| Auth | JWT (JSON Web Tokens) |
| Containerization | Docker + Docker Compose |
| API Style | REST |
| Frontend | Static HTML / JS (ops console, merchant portal) |

---

### Service Structure

The platform is structured as a **modular monolith** with domain-separated modules:

```
src/
├── api/          # Route handlers and middleware
├── core/         # Core business logic
├── merchant/     # Merchant management
├── payin/        # Payment ingestion
├── payout/       # Payout processing
├── settlement/   # Settlement workflows
├── ledger/       # Ledger management
├── reconciliation/ # Reconciliation engine (target for agents)
├── qr/           # QR code payments
├── upi/          # UPI payment handling
├── wallet/       # Wallet operations
├── bnpl/         # Buy Now Pay Later
├── emi/          # EMI processing
├── subscription/ # Recurring payments
├── security/     # Auth, compliance, audit
└── ops-console/  # Operations dashboard
```

---

### Existing Infrastructure

| Component | Present? | Details |
|-----------|----------|---------|
| Event system | ❌ Not yet | No pub/sub or event bus currently |
| Message queues | ❌ Not yet | No Kafka / RabbitMQ |
| Audit logging | ✅ Yes | `audit_logs` table in DB |
| API layer | ✅ Yes | Express REST API |
| Async jobs | ⚠️ Partial | Some batch scripts exist; no scheduler |
| Monitoring | ❌ Not yet | No centralized observability |

---

### Where Agents Can Plug In

| Integration Point | Method | Use Case |
|------------------|--------|----------|
| API layer hooks | Express middleware | Pre/post payment processing hooks |
| Database polling | Scheduled job (cron) | Detect stale settlements, unreconciled records |
| Reconciliation module | Direct integration | Drive matching logic with AI classification |
| Settlement module | Event hook / job | Monitor settlement lifecycle, trigger alerts |
| Ledger module | Post-entry analysis | Verify ledger balance, detect anomalies |
| Ops console | API endpoints | Surface agent insights in dashboard |

---

## 🤖 5️⃣ Sample Scenarios

### Example Mismatch Scenario

> **Scenario**: Settlement batch #B-2024-0310 was initiated for Merchant M-001 on March 10.
> - Gateway shows: `gross = ₹1,00,000 | fee = ₹2,000 | net = ₹98,000`
> - Bank statement shows: `credit = ₹97,500`
> - Ledger shows: `credit posted = ₹98,000`
>
> **Delta**: ₹500 unaccounted — possible fee rounding or undisclosed bank charge.
>
> **Agent Action**: Flag for fee audit; correlate with pricing rule for merchant; raise exception ticket.

---

### Example Reconciliation Report Structure

```
Settlement Date : 2024-03-10
Merchant        : M-001 (Acme Retail)
Batch ID        : B-2024-0310

────────────────────────────────────────────────────
Category              Count     Amount (INR)
────────────────────────────────────────────────────
Total Transactions     1,250    12,50,000.00
Matched                1,235    12,34,500.00  ✅
Partial Match             10       9,800.00  ⚠️
Unmatched (Gateway)        3       3,200.00  ❌
Unmatched (Bank)           2       2,500.00  ❌
────────────────────────────────────────────────────
Net Variance                     -1,000.00
```

---

## 🎯 Agent Design

### Agent Types

#### 1. Risk Agent
- **Trigger**: Every transaction authorization
- **Evaluates**: Velocity, amount deviation, merchant risk profile, geolocation anomalies
- **Output**: Risk score (0–100), `APPROVE` / `REVIEW` / `DECLINE` recommendation

#### 2. Settlement Agent
- **Trigger**: Scheduled (every hour) + settlement status change events
- **Evaluates**: Settlements older than SLA, missing bank UTR, amount mismatches
- **Output**: Alert with severity, recommended action (retry / escalate / auto-close)

#### 3. Reconciliation Agent
- **Trigger**: On bank file ingestion + end-of-day batch
- **Evaluates**: Three-way match (gateway ↔ bank ↔ ledger), exception classification
- **Output**: Reconciliation report, exception list, auto-resolved matches, items needing human review

#### 4. Pricing / Fee Agent
- **Trigger**: Post-settlement, periodic audit
- **Evaluates**: Applied fee vs configured pricing rule, MDR accuracy, fee leakage patterns
- **Output**: Fee variance report, flagged transactions, recommended corrections

#### 5. Finance Copilot
- **Trigger**: On-demand (ops console query)
- **Evaluates**: Any financial question posed in natural language
- **Output**: Answer with supporting data, chart, or recommended action

---

### Agent Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT PLATFORM                           │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ Data         │   │ Feature      │   │ Decision Engine    │  │
│  │ Ingestion    │──►│ Extraction   │──►│ (Rules + ML)       │  │
│  │ Layer        │   │ Layer        │   │                    │  │
│  └──────────────┘   └──────────────┘   └────────────────────┘  │
│         │                  │                      │             │
│   ┌─────┴──────┐     ┌─────┴──────┐       ┌──────┴──────┐      │
│   │ DB tables  │     │ Normalized │       │ Action      │      │
│   │ Bank files │     │ features   │       │ Layer       │      │
│   │ API feeds  │     │ + context  │       │ (alert/exec)│      │
│   └────────────┘     └────────────┘       └─────────────┘      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Agent Registry & Orchestrator              │    │
│  │  Risk Agent | Settlement Agent | Recon Agent | Copilot  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   Ops Console UI           Audit Log / DB
   (alerts, reports)        (all decisions)
```

---

### Workflow Design

#### Settlement Agent Workflow
```
Every 60 min:
  1. Query: settlements WHERE status = 'INITIATED' AND initiated_at < NOW() - SLA_HOURS
  2. For each:
     a. Check if bank_utr exists → if not, flag "Missing Bank ACK"
     b. Check bank file for matching UTR → if found, update status
     c. Calculate delay duration → if > 2x SLA, escalate severity
  3. Output: alert list with severity (INFO / WARNING / CRITICAL)
  4. Store alert in audit_logs
  5. Push to ops console notification queue
```

#### Reconciliation Agent Workflow
```
On bank file ingestion:
  1. Parse and normalize bank file → extract (utr, amount, date, merchant)
  2. Load gateway records for same settlement_date
  3. Load ledger entries for same accounting_period
  4. Run three-way match:
     - Exact match on (transaction_id OR bank_utr) + amount → ✅ MATCHED
     - Match on amount only (within tolerance) → ⚠️ PARTIAL
     - No match → ❌ UNMATCHED
  5. Classify exceptions (root cause tagging)
  6. Auto-resolve matched records (update reconciled = true)
  7. Generate exception report
  8. Route unresolved to human review queue
```

---

## 🚀 MVP Plan (2–3 Weeks)

### Week 1 — Foundation
- [ ] Set up `agents/` module structure in codebase
- [ ] Create data normalization utilities (bank file parsers for CSV/MT940)
- [ ] Build data access layer for agent queries (settlement, ledger, transaction reads)
- [ ] Implement **Settlement Monitoring Agent** (detect stale settlements)
- [ ] Add agent alert storage to `audit_logs` or new `agent_alerts` table

### Week 2 — Core Intelligence
- [ ] Implement **Reconciliation Agent** (three-way match engine)
- [ ] Add exception classification logic (rule-based first, ML later)
- [ ] Expose agent results via API endpoints
- [ ] Surface alerts on Ops Console dashboard
- [ ] Add **Fee Audit Agent** (compare applied fee vs pricing rule)

### Week 3 — Polish & Copilot
- [ ] Build **Finance Copilot** (query interface for ops team)
- [ ] Add confidence scores and reasoning to agent outputs
- [ ] Implement human-approval workflow for settlement retries
- [ ] End-to-end testing with real reconciliation scenarios
- [ ] Documentation and runbook

### What to Skip for MVP
- Risk Agent (needs ML model training data — Phase 2)
- Kafka / event streaming (overkill for current scale — Phase 2)
- Natural language processing for Copilot (use structured queries first)
- Full ML-based matching (rule-based covers 90%+ of cases initially)

### Maximum Impact Items (Do These First)
1. **Settlement delay detection** — immediate ops value, reduces escalations
2. **Three-way reconciliation match** — eliminates manual spreadsheet work
3. **Fee leakage alert** — direct revenue impact, high visibility with management

---

## 📁 Suggested Directory Structure

```
agents/
├── FINOPS_INTELLIGENCE_AGENTS.md     ← This document
├── core/
│   ├── agentRegistry.js              ← Agent registration and orchestration
│   ├── dataLayer.js                  ← Unified data access for agents
│   └── alertManager.js              ← Alert creation and routing
├── settlement/
│   └── settlementMonitorAgent.js    ← Settlement SLA monitoring
├── reconciliation/
│   ├── reconciliationAgent.js       ← Three-way match engine
│   ├── bankFileParser.js            ← CSV / MT940 parser
│   └── exceptionClassifier.js      ← Root cause classification
├── pricing/
│   └── feeAuditAgent.js             ← Fee validation against pricing rules
├── copilot/
│   └── financeCopilot.js            ← Query interface for ops team
└── README.md                        ← Quick start guide for agents module
```

---

*Document Version: 1.0 | Created: 2026-04-21 | Owner: FinOps Intelligence Initiative*
