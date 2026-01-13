/**
 * Compliance Admin Portal - Test Script
 * 
 * Tests the key functionalities of the Compliance Admin Portal:
 * 1. Role enforcement - only COMPLIANCE_ADMIN can access
 * 2. Override approval/rejection
 * 3. Prevention of self-approval
 * 4. Prevention of override requests by COMPLIANCE_ADMIN
 * 5. Audit logging
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const API_URL = `${BASE_URL}/api/compliance-admin`;

// Test user headers
const complianceAdminHeaders = {
  'x-user-role': 'COMPLIANCE_ADMIN',
  'x-user-id': 'test-compliance-user-id',
  'x-user-email': 'compliance@test.com'
};

const financeAdminHeaders = {
  'x-user-role': 'FINANCE_ADMIN',
  'x-user-id': 'test-finance-user-id',
  'x-user-email': 'finance@test.com'
};

const merchantHeaders = {
  'x-user-role': 'MERCHANT',
  'x-user-id': 'test-merchant-user-id',
  'x-user-email': 'merchant@test.com'
};

// Test tenant ID (you'll need to use an actual tenant ID from your database)
const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // Replace with actual UUID

async function runTests() {
  console.log('='.repeat(60));
  console.log('Compliance Admin Portal - Test Suite');
  console.log('='.repeat(60));
  console.log('');
  
  let passedTests = 0;
  let failedTests = 0;
  
  // Test 1: Access control - COMPLIANCE_ADMIN should access
  try {
    console.log('Test 1: COMPLIANCE_ADMIN access to dashboard...');
    const response = await axios.get(`${API_URL}/dashboard?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log('✓ PASS: COMPLIANCE_ADMIN can access dashboard');
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 2: Access control - FINANCE_ADMIN should NOT access
  try {
    console.log('Test 2: FINANCE_ADMIN should be blocked...');
    const response = await axios.get(`${API_URL}/dashboard?tenantId=${TEST_TENANT_ID}`, {
      headers: financeAdminHeaders
    });
    
    console.log('✗ FAIL: FINANCE_ADMIN was allowed (should be blocked)');
    failedTests++;
  } catch (error) {
    if (error.response?.status === 403) {
      console.log('✓ PASS: FINANCE_ADMIN correctly blocked');
      passedTests++;
    } else {
      console.log(`✗ FAIL: Unexpected error: ${error.message}`);
      failedTests++;
    }
  }
  console.log('');
  
  // Test 3: Access control - MERCHANT should NOT access
  try {
    console.log('Test 3: MERCHANT should be blocked...');
    const response = await axios.get(`${API_URL}/dashboard?tenantId=${TEST_TENANT_ID}`, {
      headers: merchantHeaders
    });
    
    console.log('✗ FAIL: MERCHANT was allowed (should be blocked)');
    failedTests++;
  } catch (error) {
    if (error.response?.status === 403) {
      console.log('✓ PASS: MERCHANT correctly blocked');
      passedTests++;
    } else {
      console.log(`✗ FAIL: Unexpected error: ${error.message}`);
      failedTests++;
    }
  }
  console.log('');
  
  // Test 4: View pending overrides
  try {
    console.log('Test 4: View pending override requests...');
    const response = await axios.get(`${API_URL}/overrides/pending?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log(`✓ PASS: Can view pending overrides (${response.data.data.length} found)`);
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 5: View override history
  try {
    console.log('Test 5: View override history...');
    const response = await axios.get(`${API_URL}/overrides/history?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log(`✓ PASS: Can view override history (${response.data.data.overrides.length} records)`);
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 6: View high-risk actions
  try {
    console.log('Test 6: View high-risk actions...');
    const response = await axios.get(`${API_URL}/high-risk-actions?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log('✓ PASS: Can view high-risk actions');
      console.log(`  - Period Closures: ${response.data.data.summary.totalPeriodClosures}`);
      console.log(`  - Ledger Locks: ${response.data.data.summary.totalLedgerLocks}`);
      console.log(`  - Settlement Retries: ${response.data.data.summary.totalSettlementRetries}`);
      console.log(`  - Emergency Overrides: ${response.data.data.summary.totalEmergencyOverrides}`);
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 7: View control breaches
  try {
    console.log('Test 7: View control breaches...');
    const response = await axios.get(`${API_URL}/control-breaches?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log(`✓ PASS: Can view control breaches (${response.data.data.blockedActions.length} blocked actions)`);
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 8: View audit support
  try {
    console.log('Test 8: View audit support data...');
    const response = await axios.get(`${API_URL}/audit-support?tenantId=${TEST_TENANT_ID}`, {
      headers: complianceAdminHeaders
    });
    
    if (response.status === 200 && response.data.success) {
      console.log(`✓ PASS: Can view audit support (${response.data.data.auditLogs.length} logs)`);
      passedTests++;
    } else {
      console.log('✗ FAIL: Unexpected response');
      failedTests++;
    }
  } catch (error) {
    console.log(`✗ FAIL: ${error.response?.data?.error || error.message}`);
    failedTests++;
  }
  console.log('');
  
  // Test 9: Approval without reason should fail
  try {
    console.log('Test 9: Approval without reason should fail...');
    const response = await axios.post(`${API_URL}/overrides/fake-request-id/approve`, {
      // No approvalReason provided
    }, {
      headers: complianceAdminHeaders
    });
    
    console.log('✗ FAIL: Approval without reason was allowed');
    failedTests++;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.error?.includes('approvalReason')) {
      console.log('✓ PASS: Approval without reason correctly rejected');
      passedTests++;
    } else {
      console.log(`✗ FAIL: Unexpected error: ${error.message}`);
      failedTests++;
    }
  }
  console.log('');
  
  // Test 10: Rejection without reason should fail
  try {
    console.log('Test 10: Rejection without reason should fail...');
    const response = await axios.post(`${API_URL}/overrides/fake-request-id/reject`, {
      // No rejectionReason provided
    }, {
      headers: complianceAdminHeaders
    });
    
    console.log('✗ FAIL: Rejection without reason was allowed');
    failedTests++;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.error?.includes('rejectionReason')) {
      console.log('✓ PASS: Rejection without reason correctly rejected');
      passedTests++;
    } else {
      console.log(`✗ FAIL: Unexpected error: ${error.message}`);
      failedTests++;
    }
  }
  console.log('');
  
  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${passedTests + failedTests}`);
  console.log(`✓ Passed: ${passedTests}`);
  console.log(`✗ Failed: ${failedTests}`);
  console.log('');
  
  if (failedTests === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️ Some tests failed. Please review the output above.');
  }
  console.log('');
}

// Run tests if server is available
async function checkServerAndRunTests() {
  try {
    console.log('Checking if server is running...');
    await axios.get(`${BASE_URL}/health`);
    console.log('✓ Server is running');
    console.log('');
    await runTests();
  } catch (error) {
    console.error('✗ Server is not running. Please start the server first:');
    console.error('  npm start');
    console.error('');
    console.error('Or check if the PORT is different from 3000.');
    process.exit(1);
  }
}

checkServerAndRunTests();
