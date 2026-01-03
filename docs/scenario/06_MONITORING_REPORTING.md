# Monitoring and Reporting

## Table of Contents
1. [Overview](#overview)
2. [Real-time Transaction Monitoring](#real-time-transaction-monitoring)
3. [Merchant Dashboards](#merchant-dashboards)
4. [Reporting and Analytics](#reporting-and-analytics)
5. [Alert and Notification System](#alert-and-notification-system)
6. [Performance Metrics](#performance-metrics)
7. [SLA Monitoring](#sla-monitoring)

## Overview

Comprehensive monitoring and reporting capabilities enable merchants to track transactions, analyze performance, and make data-driven decisions. This document covers all monitoring and reporting features available to merchants.

### Monitoring Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    MONITORING STACK                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Metrics Collection                                            │
│  ├─ Application Metrics (Prometheus)                          │
│  ├─ System Metrics (Node Exporter)                            │
│  ├─ Database Metrics (PostgreSQL Exporter)                    │
│  └─ Business Metrics (Custom Exporters)                       │
│                                                                 │
│  Log Aggregation                                               │
│  ├─ Application Logs (Winston → Elasticsearch)                │
│  ├─ Access Logs (NGINX → Elasticsearch)                       │
│  ├─ Audit Logs (PostgreSQL → Elasticsearch)                   │
│  └─ Error Logs (Sentry)                                       │
│                                                                 │
│  Visualization                                                  │
│  ├─ Grafana (Metrics Dashboard)                               │
│  ├─ Kibana (Log Analysis)                                     │
│  ├─ Custom Merchant Dashboard                                 │
│  └─ Mobile Apps                                                │
│                                                                 │
│  Alerting                                                       │
│  ├─ Prometheus Alertmanager                                   │
│  ├─ PagerDuty                                                  │
│  ├─ Email/SMS Notifications                                   │
│  └─ Slack/Discord Integration                                 │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Real-time Transaction Monitoring

### Live Transaction Feed

**Merchant Dashboard - Live View:**

```javascript
// WebSocket connection for real-time updates
const ws = new WebSocket('wss://api.paymentgateway.com/ws');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    token: merchantJWT
  }));
  
  // Subscribe to transaction updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    channels: ['transactions', 'settlements', 'refunds']
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'transaction.created':
      updateTransactionList(data.transaction);
      break;
      
    case 'transaction.updated':
      updateTransactionStatus(data.transaction);
      break;
      
    case 'settlement.processed':
      updateSettlementInfo(data.settlement);
      break;
  }
};

// Display format
function updateTransactionList(transaction) {
  const row = {
    orderId: transaction.orderId,
    amount: `₹${transaction.amount.toFixed(2)}`,
    paymentMethod: transaction.paymentMethod.toUpperCase(),
    status: transaction.status,
    customer: maskEmail(transaction.customerEmail),
    timestamp: formatTimestamp(transaction.createdAt),
    statusBadge: getStatusBadge(transaction.status)
  };
  
  // Add to live feed
  liveTransactionFeed.prepend(row);
}
```

### Transaction Dashboard Layout

```
┌────────────────────────────────────────────────────────────────┐
│  FashionHub Dashboard              Today | This Week | Month   │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Summary Cards                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │ Total Sales │ │ Transactions│ │ Success Rate│             │
│  │ ₹3,68,500   │ │     156     │ │   94.87%    │             │
│  │ ▲ 15.2%     │ │  ▲ 12.5%    │ │  ▼ 1.2%     │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │ Avg Ticket  │ │   Refunds   │ │  Pending    │             │
│  │   ₹2,362    │ │      8      │ │      4      │             │
│  │ ▲ 8.5%      │ │  ▼ 20%      │ │  ▬ 0%       │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│                                                                 │
│  Sales Chart                                                    │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │     ▁▂▄▅▇█▇▅▄▂▁   Transaction Volume (Last 24h)           ││
│  │    ▁▃▅█▇▅▃▁                                               ││
│  │   ▂▅█▇▅▂                                                   ││
│  │  ▁▄█▇▅▃▁                                                   ││
│  │  0    6    12    18    24                                  ││
│  │                                                             ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Recent Transactions                          [View All >]     │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Order ID        Amount    Method    Status      Time       ││
│  ├────────────────────────────────────────────────────────────┤│
│  │ FH12345        ₹2,500    UPI       ✓ Paid     10:45 AM    ││
│  │ FH12346        ₹1,800    Card      ✓ Paid     10:42 AM    ││
│  │ FH12347        ₹3,200    Wallet    ⏳ Pending 10:40 AM    ││
│  │ FH12348          ₹950    UPI       ✓ Paid     10:38 AM    ││
│  │ FH12349        ₹4,500    Card      ✗ Failed   10:35 AM    ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Transaction Details View

```javascript
// Fetch detailed transaction information
async function getTransactionDetails(orderId) {
  const response = await fetch(
    `https://api.paymentgateway.com/v1/api/orders/${orderId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  return await response.json();
}

// Example response
{
  "orderId": "order_FH_1234567890",
  "merchantOrderId": "FH12345",
  "status": "paid",
  "timeline": [
    {
      "event": "order.created",
      "timestamp": "2024-01-15T10:30:00Z",
      "description": "Order created"
    },
    {
      "event": "payment.initiated",
      "timestamp": "2024-01-15T10:30:15Z",
      "description": "Payment initiated via UPI"
    },
    {
      "event": "payment.authorized",
      "timestamp": "2024-01-15T10:30:50Z",
      "description": "Payment authorized by bank"
    },
    {
      "event": "payment.captured",
      "timestamp": "2024-01-15T10:30:55Z",
      "description": "Payment captured successfully"
    }
  ],
  "payment": {
    "paymentId": "pay_FH_9876543210",
    "amount": 2500.00,
    "currency": "INR",
    "paymentMethod": "upi",
    "paymentDetails": {
      "vpa": "customer@upi",
      "bankReference": "012345678901"
    },
    "gateway": "razorpay",
    "gatewayTransactionId": "rzp_abc123def456"
  },
  "customer": {
    "customerId": "CUST_FH_12345",
    "email": "c***@example.com",
    "phone": "+91******10"
  },
  "settlement": {
    "settlementId": "settle_FH_20240116",
    "settlementDate": "2024-01-16",
    "grossAmount": 2500.00,
    "mdr": 45.00,
    "gst": 8.10,
    "netAmount": 2446.90,
    "status": "completed"
  }
}
```

## Merchant Dashboards

### Dashboard Types

#### 1. Overview Dashboard
```yaml
Purpose: High-level business metrics
Refresh: Real-time
Access: All merchant users

Widgets:
  - Total sales (today, week, month)
  - Transaction count
  - Success rate
  - Average ticket size
  - Payment method breakdown
  - Hourly transaction volume
  - Top products/categories
```

#### 2. Transaction Dashboard
```yaml
Purpose: Detailed transaction monitoring
Refresh: Real-time
Access: All merchant users

Features:
  - Live transaction feed
  - Advanced filters (status, method, date range)
  - Search functionality
  - Export to CSV/Excel
  - Transaction details drill-down
  - Refund management
```

#### 3. Analytics Dashboard
```yaml
Purpose: Business intelligence and insights
Refresh: Hourly
Access: Admin users

Analytics:
  - Revenue trends
  - Customer behavior analysis
  - Payment method preferences
  - Peak transaction times
  - Geographic distribution
  - Success rate analysis
  - Conversion funnel
```

#### 4. Settlement Dashboard
```yaml
Purpose: Financial reconciliation
Refresh: Daily
Access: Finance users

Information:
  - Settlement schedule
  - Settlement history
  - MDR and fees breakdown
  - GST details
  - Bank transfer status
  - Reconciliation reports
```

### Dashboard API Endpoints

```javascript
// Dashboard metrics API
const dashboardAPI = {
  // Overview metrics
  'GET /api/dashboard/overview': {
    params: {
      period: 'today|week|month',
      timezone: 'Asia/Kolkata'
    },
    response: {
      totalSales: 368500.00,
      transactionCount: 156,
      successRate: 94.87,
      avgTicketSize: 2362.18,
      refundCount: 8,
      pendingCount: 4
    }
  },
  
  // Transaction list
  'GET /api/dashboard/transactions': {
    params: {
      page: 1,
      perPage: 20,
      status: 'paid|failed|pending',
      paymentMethod: 'upi|card|wallet',
      startDate: '2024-01-15',
      endDate: '2024-01-15'
    },
    response: {
      transactions: [...],
      pagination: {
        total: 156,
        page: 1,
        perPage: 20,
        pages: 8
      }
    }
  },
  
  // Payment method breakdown
  'GET /api/dashboard/payment-methods': {
    response: {
      breakdown: [
        { method: 'upi', count: 85, amount: 142500, percentage: 38.7 },
        { method: 'card', count: 45, amount: 189000, percentage: 51.3 },
        { method: 'wallet', count: 12, amount: 24500, percentage: 6.6 },
        { method: 'netbanking', count: 6, amount: 12500, percentage: 3.4 }
      ]
    }
  },
  
  // Hourly volume
  'GET /api/dashboard/hourly-volume': {
    params: {
      date: '2024-01-15'
    },
    response: {
      hourlyData: [
        { hour: 0, count: 2, amount: 3500 },
        { hour: 1, count: 1, amount: 1200 },
        // ... 24 hours
        { hour: 23, count: 3, amount: 4800 }
      ]
    }
  }
};
```

### Custom Dashboard Widgets

```javascript
// Widget configuration
const widgetConfig = {
  // Sales chart widget
  salesChart: {
    type: 'line',
    title: 'Sales Trend',
    dataSource: '/api/dashboard/sales-trend',
    refreshInterval: 60000, // 1 minute
    options: {
      xAxis: 'date',
      yAxis: 'amount',
      groupBy: 'day'
    }
  },
  
  // Payment method pie chart
  paymentMethodChart: {
    type: 'pie',
    title: 'Payment Methods',
    dataSource: '/api/dashboard/payment-methods',
    refreshInterval: 300000, // 5 minutes
    options: {
      labelField: 'method',
      valueField: 'amount'
    }
  },
  
  // Success rate gauge
  successRateGauge: {
    type: 'gauge',
    title: 'Success Rate',
    dataSource: '/api/dashboard/success-rate',
    refreshInterval: 60000,
    options: {
      min: 0,
      max: 100,
      thresholds: {
        red: [0, 80],
        yellow: [80, 95],
        green: [95, 100]
      }
    }
  }
};
```

## Reporting and Analytics

### Report Types

#### 1. Transaction Report
```javascript
// Generate transaction report
const transactionReport = {
  reportType: 'transaction',
  period: {
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  },
  filters: {
    status: ['paid', 'refunded'],
    paymentMethod: ['upi', 'card']
  },
  groupBy: 'date',
  format: 'xlsx', // or 'csv', 'pdf'
  
  columns: [
    'orderId',
    'date',
    'time',
    'amount',
    'paymentMethod',
    'status',
    'customerEmail',
    'paymentId',
    'bankReference'
  ]
};

// API call
const report = await pgClient.reports.generate(transactionReport);
console.log('Report URL:', report.downloadUrl);
```

**Sample Report Output:**

```
Transaction Report
Merchant: FashionHub (MERCH_FH_001)
Period: January 1-31, 2024
Generated: February 1, 2024 10:00 AM

┌──────────────┬────────────┬──────────┬────────┬─────────┬────────┐
│ Date         │ Order ID   │  Amount  │ Method │  Status │  Count │
├──────────────┼────────────┼──────────┼────────┼─────────┼────────┤
│ 2024-01-01   │ Multiple   │ 45,600   │ All    │  Paid   │   23   │
│ 2024-01-02   │ Multiple   │ 52,300   │ All    │  Paid   │   28   │
│ 2024-01-03   │ Multiple   │ 48,900   │ All    │  Paid   │   25   │
│ ...          │ ...        │ ...      │ ...    │  ...    │  ...   │
├──────────────┼────────────┼──────────┼────────┼─────────┼────────┤
│ Total        │            │1,245,680 │        │         │  645   │
└──────────────┴────────────┴──────────┴────────┴─────────┴────────┘

Payment Method Breakdown:
- UPI: ₹485,200 (38.9%)
- Card: ₹625,480 (50.2%)
- Wallet: ₹95,000 (7.6%)
- Net Banking: ₹40,000 (3.2%)

Success Rate: 96.2%
```

#### 2. Settlement Report
```javascript
// Settlement report
const settlementReport = await pgClient.reports.generate({
  reportType: 'settlement',
  period: {
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  },
  format: 'pdf',
  includeDetails: true
});

// Sample output structure
{
  summary: {
    totalSettlements: 31,
    grossAmount: 1245680.00,
    totalMDR: 22422.24,
    totalGST: 4035.96,
    netAmount: 1219221.80,
    averageSettlement: 39329.09
  },
  settlements: [
    {
      settlementId: 'settle_FH_20240101',
      date: '2024-01-02',
      transactions: 23,
      grossAmount: 45600.00,
      mdr: 820.80,
      gst: 147.74,
      netAmount: 44631.46,
      utr: 'NEFT20240102123456',
      status: 'completed'
    },
    // ... more settlements
  ]
}
```

#### 3. Reconciliation Report
```javascript
// Reconciliation report
const reconciliationReport = {
  reportType: 'reconciliation',
  date: '2024-01-15',
  
  expectedTransactions: 156,
  successfulTransactions: 148,
  failedTransactions: 8,
  
  expectedAmount: 368500.00,
  receivedAmount: 368500.00,
  variance: 0.00,
  
  settlementBreakdown: {
    gross: 368500.00,
    mdr: 3994.50,
    gst: 718.81,
    net: 363786.69
  },
  
  discrepancies: [],
  status: 'matched'
};
```

#### 4. Refund Report
```javascript
// Refund report
const refundReport = await pgClient.reports.generate({
  reportType: 'refund',
  period: {
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  },
  
  summary: {
    totalRefunds: 24,
    totalAmount: 45600.00,
    avgRefundAmount: 1900.00,
    refundRate: 3.72, // percentage of total transactions
    
    byReason: [
      { reason: 'customer_request', count: 12, amount: 22800 },
      { reason: 'out_of_stock', count: 8, amount: 15200 },
      { reason: 'damaged_product', count: 4, amount: 7600 }
    ],
    
    processingTime: {
      avg: 5.2, // days
      min: 2,
      max: 10
    }
  }
});
```

### Scheduled Reports

```javascript
// Configure scheduled reports
const scheduledReports = [
  {
    name: 'Daily Transaction Report',
    schedule: '0 1 * * *', // Daily at 1 AM
    reportType: 'transaction',
    period: 'yesterday',
    format: 'csv',
    recipients: ['accounts@fashionhub.com']
  },
  {
    name: 'Weekly Performance Report',
    schedule: '0 9 * * 1', // Every Monday at 9 AM
    reportType: 'analytics',
    period: 'last_week',
    format: 'pdf',
    recipients: ['ceo@fashionhub.com', 'cfo@fashionhub.com']
  },
  {
    name: 'Monthly Settlement Report',
    schedule: '0 10 1 * *', // 1st of every month at 10 AM
    reportType: 'settlement',
    period: 'last_month',
    format: 'xlsx',
    recipients: ['finance@fashionhub.com']
  }
];

// Register scheduled reports
await pgClient.reports.schedule(scheduledReports);
```

## Alert and Notification System

### Alert Types

```javascript
const alertRules = {
  // High-value transaction
  highValueTransaction: {
    condition: 'amount > 50000',
    channels: ['email', 'sms', 'dashboard'],
    recipients: ['owner@fashionhub.com'],
    priority: 'high',
    message: 'High-value transaction of ₹{amount} detected'
  },
  
  // Unusual failure rate
  highFailureRate: {
    condition: 'failure_rate > 10% in last 1 hour',
    channels: ['email', 'sms', 'slack'],
    recipients: ['tech@fashionhub.com', 'owner@fashionhub.com'],
    priority: 'critical',
    message: 'Payment failure rate is {failure_rate}%, above normal threshold'
  },
  
  // Settlement completed
  settlementCompleted: {
    condition: 'settlement.status = completed',
    channels: ['email', 'dashboard'],
    recipients: ['accounts@fashionhub.com'],
    priority: 'normal',
    message: 'Settlement of ₹{amount} has been completed. UTR: {utr}'
  },
  
  // Refund processed
  refundProcessed: {
    condition: 'refund.status = processed',
    channels: ['email'],
    recipients: ['support@fashionhub.com'],
    priority: 'normal',
    message: 'Refund of ₹{amount} for order {orderId} has been processed'
  },
  
  // Chargeback received
  chargebackReceived: {
    condition: 'chargeback.received',
    channels: ['email', 'sms', 'dashboard'],
    recipients: ['owner@fashionhub.com', 'accounts@fashionhub.com'],
    priority: 'high',
    message: 'Chargeback received for order {orderId}. Amount: ₹{amount}'
  }
};
```

### Notification Channels

```javascript
// Email notification
async function sendEmailNotification(alert) {
  await emailService.send({
    to: alert.recipients,
    subject: `Payment Alert: ${alert.title}`,
    template: 'payment-alert',
    data: {
      alertType: alert.type,
      message: alert.message,
      severity: alert.priority,
      timestamp: new Date(),
      actionUrl: alert.actionUrl
    }
  });
}

// SMS notification
async function sendSMSNotification(alert) {
  await smsService.send({
    to: alert.recipients,
    message: `[${alert.priority.toUpperCase()}] ${alert.message}`,
    sender: 'PYMTGW'
  });
}

// Dashboard notification
async function sendDashboardNotification(alert) {
  await websocket.broadcast({
    type: 'notification',
    data: {
      id: alert.id,
      type: alert.type,
      priority: alert.priority,
      message: alert.message,
      timestamp: new Date(),
      read: false
    }
  }, alert.merchantId);
}

// Slack notification
async function sendSlackNotification(alert) {
  await slackClient.chat.postMessage({
    channel: '#payments',
    text: alert.message,
    attachments: [{
      color: alert.priority === 'critical' ? 'danger' : 'warning',
      fields: [
        { title: 'Type', value: alert.type, short: true },
        { title: 'Priority', value: alert.priority, short: true },
        { title: 'Merchant', value: alert.merchantName, short: true },
        { title: 'Time', value: new Date().toISOString(), short: true }
      ]
    }]
  });
}
```

### Notification Preferences

```javascript
// Merchant notification preferences
const notificationPreferences = {
  merchantId: 'MERCH_FH_001',
  preferences: {
    email: {
      enabled: true,
      addresses: ['owner@fashionhub.com', 'accounts@fashionhub.com'],
      alerts: ['all']
    },
    sms: {
      enabled: true,
      numbers: ['+919876543210'],
      alerts: ['high', 'critical']
    },
    dashboard: {
      enabled: true,
      alerts: ['all']
    },
    slack: {
      enabled: true,
      webhook: 'https://hooks.slack.com/services/...',
      alerts: ['high', 'critical']
    },
    webhook: {
      enabled: true,
      url: 'https://fashionhub.com/webhook/alerts',
      alerts: ['all']
    }
  },
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '08:00',
    excludeAlerts: ['critical']
  }
};
```

## Performance Metrics

### System Performance Metrics

```javascript
// Key performance indicators
const performanceMetrics = {
  // Response time
  responseTime: {
    p50: 145, // ms
    p95: 320, // ms
    p99: 580, // ms
    avg: 185  // ms
  },
  
  // Throughput
  throughput: {
    transactionsPerSecond: 45,
    peakTPS: 120,
    avgTPS: 38
  },
  
  // Success rate
  successRate: {
    overall: 96.8,
    byMethod: {
      upi: 98.2,
      card: 95.6,
      wallet: 97.1,
      netbanking: 94.8
    }
  },
  
  // Availability
  availability: {
    uptime: 99.99,
    downtimeMinutes: 4.32, // per month
    mtbf: 720, // hours
    mttr: 15   // minutes
  },
  
  // Gateway performance
  gatewayPerformance: {
    razorpay: {
      successRate: 98.5,
      avgResponseTime: 2.3,
      availability: 99.99
    },
    payu: {
      successRate: 97.8,
      avgResponseTime: 2.8,
      availability: 99.95
    },
    ccavenue: {
      successRate: 96.2,
      avgResponseTime: 3.5,
      availability: 99.90
    }
  }
};
```

### Business Metrics

```javascript
// Business KPIs
const businessMetrics = {
  // Revenue metrics
  revenue: {
    today: 368500,
    wtd: 2456780,
    mtd: 10234560,
    ytd: 125456780,
    growth: {
      daily: 15.2,
      weekly: 12.8,
      monthly: 18.5,
      yearly: 42.3
    }
  },
  
  // Customer metrics
  customers: {
    total: 45678,
    active: 12345,
    new: 234,
    returning: 89.2, // percentage
    avgLifetimeValue: 5680
  },
  
  // Transaction metrics
  transactions: {
    total: 645,
    successful: 621,
    failed: 24,
    pending: 4,
    avgTicketSize: 2362,
    largestTransaction: 45000,
    smallestTransaction: 250
  },
  
  // Refund metrics
  refunds: {
    count: 24,
    amount: 45600,
    rate: 3.72, // percentage
    avgProcessingTime: 5.2 // days
  }
};
```

### Custom Metrics

```javascript
// Define custom business metrics
const customMetrics = [
  {
    name: 'conversion_rate',
    description: 'Percentage of orders that complete payment',
    calculation: '(paid_orders / total_orders) * 100',
    unit: 'percentage',
    target: 95
  },
  {
    name: 'avg_cart_value',
    description: 'Average value of shopping carts',
    calculation: 'sum(order_amount) / count(orders)',
    unit: 'currency',
    target: 2500
  },
  {
    name: 'repeat_customer_rate',
    description: 'Percentage of customers who make repeat purchases',
    calculation: '(repeat_customers / total_customers) * 100',
    unit: 'percentage',
    target: 60
  }
];

// Track custom metrics
await pgClient.metrics.track({
  merchantId: 'MERCH_FH_001',
  metric: 'conversion_rate',
  value: 96.5,
  timestamp: new Date()
});
```

## SLA Monitoring

### Service Level Agreements

```yaml
Payment Gateway SLA:
  Availability: 99.99%
  Response Time: < 200ms (p95)
  Success Rate: > 95%
  Support Response: < 1 hour
  
Uptime Calculation:
  Monthly Minutes: 43,200 (30 days)
  Allowed Downtime: 4.32 minutes
  Actual Uptime: 99.99%

Performance Targets:
  API Response Time:
    - p50: < 100ms
    - p95: < 200ms
    - p99: < 500ms
  
  Payment Processing Time:
    - UPI: < 30 seconds
    - Card: < 45 seconds
    - Net Banking: < 2 minutes
  
  Webhook Delivery:
    - First Attempt: < 5 seconds
    - Retry Interval: Exponential backoff
    - Max Retries: 5
```

### SLA Monitoring Dashboard

```javascript
// SLA monitoring metrics
const slaMetrics = {
  currentMonth: {
    availability: 99.99,
    uptimeMinutes: 43195.68,
    downtimeMinutes: 4.32,
    slaStatus: 'met',
    incidents: [
      {
        date: '2024-01-15',
        duration: 4.32,
        reason: 'Database maintenance',
        impact: 'minimal'
      }
    ]
  },
  
  responseTime: {
    current: {
      p50: 98,
      p95: 185,
      p99: 420
    },
    target: {
      p50: 100,
      p95: 200,
      p99: 500
    },
    status: 'met'
  },
  
  successRate: {
    current: 96.8,
    target: 95.0,
    status: 'met'
  }
};

// SLA breach alerts
if (slaMetrics.availability < 99.99) {
  await alertSLABreach({
    type: 'availability',
    current: slaMetrics.availability,
    target: 99.99,
    severity: 'critical'
  });
}
```

### Historical SLA Reports

```javascript
// Generate SLA report
const slaReport = await pgClient.reports.generate({
  reportType: 'sla',
  period: {
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  },
  
  metrics: [
    'availability',
    'response_time',
    'success_rate',
    'support_response_time'
  ],
  
  format: 'pdf'
});

// Sample SLA report
{
  period: 'January 2024',
  overall: {
    availabilityMet: true,
    responseTimeMet: true,
    successRateMet: true,
    supportMet: true,
    slaCompliance: 100
  },
  
  details: {
    availability: {
      target: 99.99,
      actual: 99.99,
      downtime: '4.32 minutes',
      incidents: 1
    },
    
    responseTime: {
      target: '< 200ms (p95)',
      actual: '185ms',
      trend: 'improving'
    },
    
    successRate: {
      target: '> 95%',
      actual: '96.8%',
      trend: 'stable'
    }
  }
}
```

---

**Conclusion**: This comprehensive monitoring and reporting system provides merchants with complete visibility into their payment operations, enabling data-driven decisions and proactive issue resolution.
