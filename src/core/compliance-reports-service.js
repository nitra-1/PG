/**
 * Compliance Reports Service
 * 
 * Generates RBI-compliant, regulator-friendly reports
 * 
 * Report Types:
 * 1. Escrow Balance - Daily snapshot of escrow accounts
 * 2. Merchant Outstanding - Amounts pending settlement
 * 3. Platform Revenue - Fee collection summary
 * 4. Settlement Aging - How long settlements are pending
 * 5. Open Disputes - Provisional exposure summary
 * 
 * Key Principles:
 * - Derived from ledger (single source of truth)
 * - Time-bounded and reproducible
 * - Cached for performance
 * - Read-only (no data manipulation)
 */

const db = require('../database');
const { v4: uuidv4 } = require('uuid');

class ComplianceReportsService {
  constructor() {
    this.REPORT_TYPES = {
      ESCROW_BALANCE: 'ESCROW_BALANCE',
      MERCHANT_OUTSTANDING: 'MERCHANT_OUTSTANDING',
      PLATFORM_REVENUE: 'PLATFORM_REVENUE',
      SETTLEMENT_AGING: 'SETTLEMENT_AGING',
      OPEN_DISPUTES: 'OPEN_DISPUTES'
    };
    
    // Cache TTL for different report types (in minutes)
    this.CACHE_TTL = {
      ESCROW_BALANCE: 60,        // 1 hour
      MERCHANT_OUTSTANDING: 30,   // 30 minutes
      PLATFORM_REVENUE: 60,       // 1 hour
      SETTLEMENT_AGING: 30,       // 30 minutes
      OPEN_DISPUTES: 15           // 15 minutes
    };
  }
  
  /**
   * Generate Escrow Balance Report
   * Daily snapshot of escrow accounts per RBI guidelines
   * 
   * @param {Object} params - Report parameters
   * @returns {Object} Escrow balance report
   */
  async generateEscrowBalanceReport(params) {
    const { tenantId, reportDate = new Date(), useCache = true } = params;
    
    // Check cache first
    if (useCache) {
      const cached = await this.getCachedReport({
        tenantId,
        reportType: this.REPORT_TYPES.ESCROW_BALANCE,
        reportDate
      });
      
      if (cached) return cached;
    }
    
    const startTime = Date.now();
    
    try {
      // Get escrow account balances from the account_balances view
      // The view already calculates balances and includes currency from ledger_entries
      const escrowAccounts = await db.knex('account_balances')
        .where('tenant_id', tenantId)
        .where('account_type', 'escrow')
        .select('account_id', 'account_code', 'account_name', 'balance', 'currency')
        .whereRaw('balance > 0');
      
      const balances = escrowAccounts.map(account => ({
        accountCode: account.account_code,
        accountName: account.account_name,
        currency: account.currency || 'INR',
        balance: (account.balance || 0).toString(),
        asOfDate: reportDate
      }));
      
      // Calculate total escrow balance
      const totalBalance = balances.reduce((sum, acc) => 
        sum + parseFloat(acc.balance), 0
      );
      
      const reportData = {
        reportType: this.REPORT_TYPES.ESCROW_BALANCE,
        reportDate,
        tenantId,
        escrowAccounts: balances,
        totalEscrowBalance: totalBalance.toString(),
        currency: 'INR',
        generatedAt: new Date().toISOString(),
        note: 'This report shows escrow balances as required by RBI guidelines'
      };
      
      // Cache the report
      await this.cacheReport({
        tenantId,
        reportType: this.REPORT_TYPES.ESCROW_BALANCE,
        reportDate,
        reportData,
        generationDuration: Date.now() - startTime
      });
      
      return reportData;
    } catch (error) {
      console.error('Error generating escrow balance report:', error);
      throw error;
    }
  }
  
  /**
   * Generate Merchant Outstanding Report
   * Shows amounts pending settlement per merchant
   * 
   * @param {Object} params - Report parameters
   * @returns {Object} Merchant outstanding report
   */
  async generateMerchantOutstandingReport(params) {
    const { tenantId, asOfDate = new Date(), useCache = true } = params;
    
    if (useCache) {
      const cached = await this.getCachedReport({
        tenantId,
        reportType: this.REPORT_TYPES.MERCHANT_OUTSTANDING,
        reportDate: asOfDate
      });
      
      if (cached) return cached;
    }
    
    const startTime = Date.now();
    
    try {
      // Get all merchants
      const merchants = await db.knex('merchants')
        .where('status', 'active')
        .select('id', 'merchant_code', 'merchant_name');
      
      const outstanding = [];
      
      for (const merchant of merchants) {
        // Get pending settlements for this merchant
        const unsettled = await db.knex('settlements')
          .where('tenant_id', tenantId)
          .where('merchant_id', merchant.id)
          .whereIn('status', ['pending', 'processing'])
          .where('created_at', '<=', asOfDate)
          .sum('net_amount as total_amount')
          .count('* as settlement_count')
          .first();
        
        if (unsettled && parseFloat(unsettled.total_amount || 0) > 0) {
          outstanding.push({
            merchantId: merchant.merchant_code,
            businessName: merchant.merchant_name,
            outstandingAmount: (unsettled.total_amount || 0).toString(),
            transactionCount: parseInt(unsettled.settlement_count || 0),
            currency: 'INR'
          });
        }
      }
      
      const totalOutstanding = outstanding.reduce((sum, m) => 
        sum + parseFloat(m.outstandingAmount), 0
      );
      
      const reportData = {
        reportType: this.REPORT_TYPES.MERCHANT_OUTSTANDING,
        asOfDate,
        tenantId,
        merchants: outstanding,
        totalOutstanding: totalOutstanding.toString(),
        merchantCount: outstanding.length,
        currency: 'INR',
        generatedAt: new Date().toISOString()
      };
      
      await this.cacheReport({
        tenantId,
        reportType: this.REPORT_TYPES.MERCHANT_OUTSTANDING,
        reportDate: asOfDate,
        reportData,
        generationDuration: Date.now() - startTime
      });
      
      return reportData;
    } catch (error) {
      console.error('Error generating merchant outstanding report:', error);
      throw error;
    }
  }
  
  /**
   * Generate Platform Revenue Report
   * Shows fee collection summary
   * 
   * @param {Object} params - Report parameters
   * @returns {Object} Platform revenue report
   */
  async generatePlatformRevenueReport(params) {
    const { 
      tenantId, 
      periodStart, 
      periodEnd = new Date(), 
      useCache = true 
    } = params;
    
    if (useCache) {
      const cached = await this.getCachedReport({
        tenantId,
        reportType: this.REPORT_TYPES.PLATFORM_REVENUE,
        periodStart,
        periodEnd
      });
      
      if (cached) return cached;
    }
    
    const startTime = Date.now();
    
    try {
      // Get fee revenue from ledger entries joined with transactions
      // Revenue is recorded as credits to platform_revenue accounts
      const feeRevenue = await db.knex('ledger_entries')
        .join('ledger_transactions', 'ledger_entries.transaction_id', 'ledger_transactions.id')
        .join('ledger_accounts', 'ledger_entries.account_id', 'ledger_accounts.id')
        .where('ledger_entries.tenant_id', tenantId)
        .whereBetween('ledger_transactions.created_at', [periodStart, periodEnd])
        .where('ledger_accounts.account_type', 'platform_revenue')
        .where('ledger_entries.entry_type', 'credit')
        .whereIn('ledger_transactions.event_type', ['platform_fee', 'gateway_fee'])
        .select('ledger_transactions.event_type')
        .sum('ledger_entries.amount as total')
        .groupBy('ledger_transactions.event_type');
      
      const breakdown = feeRevenue.map(fee => ({
        feeType: fee.event_type.toUpperCase(),
        amount: (fee.total || 0).toString(),
        currency: 'INR'
      }));
      
      const totalRevenue = breakdown.reduce((sum, fee) => 
        sum + parseFloat(fee.amount), 0
      );
      
      const reportData = {
        reportType: this.REPORT_TYPES.PLATFORM_REVENUE,
        periodStart,
        periodEnd,
        tenantId,
        revenueBreakdown: breakdown,
        totalRevenue: totalRevenue.toString(),
        currency: 'INR',
        generatedAt: new Date().toISOString()
      };
      
      await this.cacheReport({
        tenantId,
        reportType: this.REPORT_TYPES.PLATFORM_REVENUE,
        reportDate: periodEnd,
        periodStart,
        periodEnd,
        reportData,
        generationDuration: Date.now() - startTime
      });
      
      return reportData;
    } catch (error) {
      console.error('Error generating platform revenue report:', error);
      throw error;
    }
  }
  
  /**
   * Generate Settlement Aging Report
   * Shows how long settlements have been pending
   * 
   * @param {Object} params - Report parameters
   * @returns {Object} Settlement aging report
   */
  async generateSettlementAgingReport(params) {
    const { tenantId, asOfDate = new Date(), useCache = true } = params;
    
    if (useCache) {
      const cached = await this.getCachedReport({
        tenantId,
        reportType: this.REPORT_TYPES.SETTLEMENT_AGING,
        reportDate: asOfDate
      });
      
      if (cached) return cached;
    }
    
    const startTime = Date.now();
    
    try {
      // Get pending settlements
      const pendingSettlements = await db.knex('settlements')
        .where('tenant_id', tenantId)
        .whereIn('status', ['CREATED', 'FUNDS_RESERVED', 'SENT_TO_BANK'])
        .where('created_at', '<=', asOfDate)
        .select('*');
      
      // Categorize by age buckets
      const ageBuckets = {
        '0-1 days': [],
        '1-3 days': [],
        '3-7 days': [],
        '7+ days': []
      };
      
      const now = new Date(asOfDate);
      
      pendingSettlements.forEach(settlement => {
        const ageInDays = (now - new Date(settlement.created_at)) / (1000 * 60 * 60 * 24);
        const settlementInfo = {
          settlementRef: settlement.settlement_ref,
          merchantId: settlement.merchant_id,
          amount: settlement.net_amount,
          status: settlement.status,
          ageInDays: Math.floor(ageInDays)
        };
        
        if (ageInDays <= 1) {
          ageBuckets['0-1 days'].push(settlementInfo);
        } else if (ageInDays <= 3) {
          ageBuckets['1-3 days'].push(settlementInfo);
        } else if (ageInDays <= 7) {
          ageBuckets['3-7 days'].push(settlementInfo);
        } else {
          ageBuckets['7+ days'].push(settlementInfo);
        }
      });
      
      const reportData = {
        reportType: this.REPORT_TYPES.SETTLEMENT_AGING,
        asOfDate,
        tenantId,
        agingBuckets: ageBuckets,
        totalPendingCount: pendingSettlements.length,
        totalPendingAmount: pendingSettlements.reduce((sum, s) => 
          sum + parseFloat(s.net_amount || 0), 0
        ).toString(),
        currency: 'INR',
        generatedAt: new Date().toISOString()
      };
      
      await this.cacheReport({
        tenantId,
        reportType: this.REPORT_TYPES.SETTLEMENT_AGING,
        reportDate: asOfDate,
        reportData,
        generationDuration: Date.now() - startTime
      });
      
      return reportData;
    } catch (error) {
      console.error('Error generating settlement aging report:', error);
      throw error;
    }
  }
  
  /**
   * Calculate account balance as of a specific date
   * 
   * @param {string} accountId - Ledger account ID
   * @param {Date} asOfDate - Calculate balance as of this date
   * @returns {number} Account balance
   */
  async calculateAccountBalance(accountId, asOfDate) {
    try {
      const result = await db.knex('ledger_entries')
        .where('account_id', accountId)
        .where('created_at', '<=', asOfDate)
        .select(
          db.knex.raw('COALESCE(SUM(CASE WHEN entry_type = \'debit\' THEN amount ELSE 0 END), 0) as total_debits'),
          db.knex.raw('COALESCE(SUM(CASE WHEN entry_type = \'credit\' THEN amount ELSE 0 END), 0) as total_credits')
        )
        .first();
      
      const totalDebits = parseFloat(result?.total_debits || 0);
      const totalCredits = parseFloat(result?.total_credits || 0);
      
      // Balance = Credits - Debits (for asset/escrow accounts)
      return totalCredits - totalDebits;
    } catch (error) {
      console.error('Error calculating account balance:', error);
      return 0;
    }
  }
  
  /**
   * Get cached report if available and not expired
   * 
   * @param {Object} params - Cache lookup parameters
   * @returns {Object|null} Cached report or null
   */
  async getCachedReport(params) {
    const { tenantId, reportType, reportDate, periodStart, periodEnd } = params;
    
    try {
      let query = db.knex('compliance_reports_cache')
        .where('tenant_id', tenantId)
        .where('report_type', reportType)
        .where('expires_at', '>', db.knex.fn.now());
      
      if (reportDate) {
        query = query.where('report_date', reportDate);
      }
      
      if (periodStart && periodEnd) {
        query = query.where('period_start', periodStart)
          .where('period_end', periodEnd);
      }
      
      const cached = await query.first();
      
      if (cached) {
        return cached.report_data;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting cached report:', error);
      return null;
    }
  }
  
  /**
   * Cache a generated report
   * 
   * @param {Object} params - Cache parameters
   */
  async cacheReport(params) {
    const {
      tenantId,
      reportType,
      reportDate,
      periodStart,
      periodEnd,
      reportData,
      generationDuration,
      isFinal = false
    } = params;
    
    try {
      const ttlMinutes = this.CACHE_TTL[reportType] || 30;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
      
      await db.knex('compliance_reports_cache').insert({
        id: uuidv4(),
        tenant_id: tenantId,
        report_type: reportType,
        report_date: reportDate || new Date(),
        period_start: periodStart,
        period_end: periodEnd,
        report_data: JSON.stringify(reportData),
        generated_at: db.knex.fn.now(),
        generation_duration_ms: generationDuration,
        expires_at: expiresAt,
        is_final: isFinal
      });
    } catch (error) {
      console.error('Error caching report:', error);
      // Don't throw - caching is optional
    }
  }
  
  /**
   * List available reports for a tenant
   * 
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Available report types
   */
  getAvailableReports() {
    return [
      {
        type: this.REPORT_TYPES.ESCROW_BALANCE,
        name: 'Escrow Balance Report',
        description: 'Daily snapshot of escrow accounts per RBI guidelines',
        parameters: ['reportDate'],
        updateFrequency: 'Hourly'
      },
      {
        type: this.REPORT_TYPES.MERCHANT_OUTSTANDING,
        name: 'Merchant Outstanding Report',
        description: 'Amounts pending settlement per merchant',
        parameters: ['asOfDate'],
        updateFrequency: 'Every 30 minutes'
      },
      {
        type: this.REPORT_TYPES.PLATFORM_REVENUE,
        name: 'Platform Revenue Report',
        description: 'Fee collection summary for a period',
        parameters: ['periodStart', 'periodEnd'],
        updateFrequency: 'Hourly'
      },
      {
        type: this.REPORT_TYPES.SETTLEMENT_AGING,
        name: 'Settlement Aging Report',
        description: 'How long settlements have been pending',
        parameters: ['asOfDate'],
        updateFrequency: 'Every 30 minutes'
      }
    ];
  }
}

module.exports = ComplianceReportsService;
