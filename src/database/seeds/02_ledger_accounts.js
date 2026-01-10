/**
 * Seed Ledger Accounts - Chart of Accounts for RBI-Compliant PA
 * 
 * This seed file creates the initial chart of accounts following double-entry accounting principles.
 * 
 * Four Ledger Categories:
 * 1. Merchant Ledger - Tracks merchant receivables and payouts
 * 2. Gateway Ledger - Tracks gateway collections and fees  
 * 3. Escrow Ledger - RBI-mandated nodal/escrow account
 * 4. Platform Revenue Ledger - Tracks MDR, commissions, and fees
 */

exports.seed = async function(knex) {
  // Clear existing data (in development only)
  await knex('ledger_accounts').del();
  
  // Seed ledger accounts
  await knex('ledger_accounts').insert([
    // =====================================================
    // ESCROW LEDGER ACCOUNTS
    // RBI-mandated nodal/escrow account - holds customer funds temporarily
    // =====================================================
    {
      account_code: 'ESC-001',
      account_name: 'Escrow Bank Account - Nodal Account',
      account_type: 'escrow',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Main escrow/nodal bank account as per RBI guidelines',
        bank_account: 'XXXXX',
        bank_name: 'Nodal Bank',
        rbi_requirement: 'Mandatory for PA license'
      }),
      created_by: 'system'
    },
    {
      account_code: 'ESC-002',
      account_name: 'Customer Deposits Liability',
      account_type: 'escrow',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Liability for customer funds held in escrow',
        contra_account: 'ESC-001'
      }),
      created_by: 'system'
    },
    
    // =====================================================
    // MERCHANT LEDGER ACCOUNTS
    // Tracks merchant receivables and payouts
    // =====================================================
    {
      account_code: 'MER-001',
      account_name: 'Merchant Receivables',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Amount owed to merchants from successful transactions',
        settlement_cycle: 'T+1 or T+2'
      }),
      created_by: 'system'
    },
    {
      account_code: 'MER-002',
      account_name: 'Merchant Payables',
      account_type: 'merchant',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Amount to be paid to merchants (before settlement)',
        contra_account: 'MER-001'
      }),
      created_by: 'system'
    },
    {
      account_code: 'MER-003',
      account_name: 'Merchant Settlement Account',
      account_type: 'merchant',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Tracks actual settlements paid to merchants',
        payment_method: 'NEFT/RTGS/IMPS'
      }),
      created_by: 'system'
    },
    
    // =====================================================
    // GATEWAY LEDGER ACCOUNTS
    // Tracks gateway collections and fees
    // =====================================================
    {
      account_code: 'GTW-001-RZP',
      account_name: 'Gateway Collections - Razorpay',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'asset',
      gateway_name: 'razorpay',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Collections received through Razorpay gateway',
        settlement_account: 'Bank A/c for Razorpay'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-002-PAYU',
      account_name: 'Gateway Collections - PayU',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'asset',
      gateway_name: 'payu',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Collections received through PayU gateway',
        settlement_account: 'Bank A/c for PayU'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-003-CCA',
      account_name: 'Gateway Collections - CCAvenue',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'asset',
      gateway_name: 'ccavenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Collections received through CCAvenue gateway',
        settlement_account: 'Bank A/c for CCAvenue'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-FEE-001',
      account_name: 'Gateway Fee Expense - Razorpay',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'expense',
      gateway_name: 'razorpay',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Fees charged by Razorpay gateway',
        fee_structure: 'Transaction percentage + fixed fee'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-FEE-002',
      account_name: 'Gateway Fee Expense - PayU',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'expense',
      gateway_name: 'payu',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Fees charged by PayU gateway',
        fee_structure: 'Transaction percentage + fixed fee'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-FEE-003',
      account_name: 'Gateway Fee Expense - CCAvenue',
      account_type: 'gateway',
      normal_balance: 'debit',
      category: 'expense',
      gateway_name: 'ccavenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Fees charged by CCAvenue gateway',
        fee_structure: 'Transaction percentage + fixed fee'
      }),
      created_by: 'system'
    },
    {
      account_code: 'GTW-PAY-001',
      account_name: 'Gateway Payables',
      account_type: 'gateway',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Amount payable to all gateways for fees'
      }),
      created_by: 'system'
    },
    
    // =====================================================
    // PLATFORM REVENUE LEDGER ACCOUNTS
    // Tracks MDR, commissions, and fees earned by platform
    // =====================================================
    {
      account_code: 'REV-001',
      account_name: 'Platform Revenue - MDR',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Merchant Discount Rate (MDR) earned from transactions',
        calculation: 'Percentage of transaction value'
      }),
      created_by: 'system'
    },
    {
      account_code: 'REV-002',
      account_name: 'Platform Revenue - Commission',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Commission earned from merchants',
        calculation: 'Fixed or percentage based'
      }),
      created_by: 'system'
    },
    {
      account_code: 'REV-003',
      account_name: 'Platform Revenue - Convenience Fee',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Convenience fees charged to customers',
        application: 'Optional, based on payment method'
      }),
      created_by: 'system'
    },
    {
      account_code: 'REV-004',
      account_name: 'Platform Revenue - Settlement Fee',
      account_type: 'platform_revenue',
      normal_balance: 'credit',
      category: 'revenue',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Fees for settlement services to merchants',
        application: 'Per settlement or monthly'
      }),
      created_by: 'system'
    },
    {
      account_code: 'REV-REC-001',
      account_name: 'Platform Receivables',
      account_type: 'platform_revenue',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Platform fees receivable from various sources',
        contra_accounts: ['REV-001', 'REV-002', 'REV-003', 'REV-004']
      }),
      created_by: 'system'
    },
    
    // =====================================================
    // REFUND AND CHARGEBACK ACCOUNTS
    // =====================================================
    {
      account_code: 'REF-001',
      account_name: 'Refunds Payable',
      account_type: 'escrow',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Liability for refunds to be processed',
        processing: 'Deducted from escrow and returned to customer'
      }),
      created_by: 'system'
    },
    {
      account_code: 'CHB-001',
      account_name: 'Chargeback Liability',
      account_type: 'merchant',
      normal_balance: 'credit',
      category: 'liability',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Liability for chargebacks to be recovered from merchants',
        recovery: 'Deducted from future settlements'
      }),
      created_by: 'system'
    },
    
    // =====================================================
    // ADJUSTMENT ACCOUNTS
    // For manual corrections and reconciliation
    // =====================================================
    {
      account_code: 'ADJ-001',
      account_name: 'Manual Adjustments',
      account_type: 'platform_revenue',
      normal_balance: 'debit',
      category: 'expense',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Manual adjustments for reconciliation and corrections',
        approval_required: true,
        audit_critical: true
      }),
      created_by: 'system'
    },
    {
      account_code: 'ADJ-002',
      account_name: 'Reconciliation Suspense',
      account_type: 'platform_revenue',
      normal_balance: 'debit',
      category: 'asset',
      status: 'active',
      metadata: JSON.stringify({
        description: 'Temporary account for unreconciled items',
        clearing_frequency: 'Daily review required'
      }),
      created_by: 'system'
    }
  ]);
  
  console.log('✅ Ledger accounts seeded successfully');
  console.log('📊 Created accounts for:');
  console.log('   - Escrow Ledger (RBI-compliant nodal account)');
  console.log('   - Merchant Ledger (receivables & payouts)');
  console.log('   - Gateway Ledger (collections & fees)');
  console.log('   - Platform Revenue Ledger (MDR & commissions)');
};
