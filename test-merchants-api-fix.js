#!/usr/bin/env node

/**
 * Integration test for merchants API fix
 * Verifies that the 404 error is resolved and endpoint works correctly
 */

const http = require('http');

const API_BASE_URL = 'http://localhost:3000';
const TEST_MERCHANT_ID = '04a8baae-3e0a-467e-aa5a-83d7b12c6b61';

/**
 * Make HTTP GET request
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Test the merchants API endpoint
 */
async function runTests() {
  console.log('🧪 Testing Merchants API Fix\n');
  
  let passedTests = 0;
  let failedTests = 0;

  try {
    // Test 1: Access merchant with lowercase UUID
    console.log('Test 1: GET /api/merchants/:id with lowercase UUID');
    const test1 = await httpGet(`${API_BASE_URL}/api/merchants/${TEST_MERCHANT_ID}`);
    if (test1.status === 200 && test1.data.success === true) {
      console.log('  ✓ Status: 200 OK');
      console.log('  ✓ Merchant found:', test1.data.data.merchant_name);
      console.log('  ✓ Merchant ID:', test1.data.data.id);
      passedTests++;
    } else {
      console.log('  ✗ Expected 200 OK but got:', test1.status);
      failedTests++;
    }
    console.log();

    // Test 2: Access merchant with uppercase UUID
    console.log('Test 2: GET /api/merchants/:id with uppercase UUID');
    const uppercaseId = TEST_MERCHANT_ID.toUpperCase();
    const test2 = await httpGet(`${API_BASE_URL}/api/merchants/${uppercaseId}`);
    if (test2.status === 200 && test2.data.success === true) {
      console.log('  ✓ Status: 200 OK');
      console.log('  ✓ UUID normalization working');
      console.log('  ✓ Same merchant returned:', test2.data.data.id === TEST_MERCHANT_ID);
      passedTests++;
    } else {
      console.log('  ✗ Expected 200 OK but got:', test2.status);
      failedTests++;
    }
    console.log();

    // Test 3: Access merchant with mixed case UUID
    console.log('Test 3: GET /api/merchants/:id with mixed case UUID');
    const mixedCaseId = '04a8BaAe-3E0a-467e-AA5a-83D7b12c6b61';
    const test3 = await httpGet(`${API_BASE_URL}/api/merchants/${mixedCaseId}`);
    if (test3.status === 200 && test3.data.success === true) {
      console.log('  ✓ Status: 200 OK');
      console.log('  ✓ UUID normalization working');
      console.log('  ✓ Same merchant returned:', test3.data.data.id === TEST_MERCHANT_ID);
      passedTests++;
    } else {
      console.log('  ✗ Expected 200 OK but got:', test3.status);
      failedTests++;
    }
    console.log();

    // Test 4: Verify merchant data structure
    console.log('Test 4: Verify merchant data structure');
    const merchant = test1.data.data;
    const requiredFields = ['id', 'merchant_code', 'merchant_name', 'email', 'status'];
    const hasAllFields = requiredFields.every(field => merchant.hasOwnProperty(field));
    if (hasAllFields) {
      console.log('  ✓ All required fields present');
      console.log('  ✓ Merchant code:', merchant.merchant_code);
      console.log('  ✓ Merchant name:', merchant.merchant_name);
      console.log('  ✓ Email:', merchant.email);
      console.log('  ✓ Status:', merchant.status);
      passedTests++;
    } else {
      console.log('  ✗ Missing required fields');
      failedTests++;
    }
    console.log();

    // Test 5: Verify related data is included
    console.log('Test 5: Verify related data is included');
    const hasRelatedData = ['apiKeys', 'webhooks', 'rateLimits', 'ipWhitelist'].every(
      field => Array.isArray(merchant[field])
    );
    if (hasRelatedData) {
      console.log('  ✓ API Keys array present:', merchant.apiKeys.length, 'items');
      console.log('  ✓ Webhooks array present:', merchant.webhooks.length, 'items');
      console.log('  ✓ Rate Limits array present:', merchant.rateLimits.length, 'items');
      console.log('  ✓ IP Whitelist array present:', merchant.ipWhitelist.length, 'items');
      passedTests++;
    } else {
      console.log('  ✗ Related data arrays missing');
      failedTests++;
    }
    console.log();

    // Test 6: Access non-existent merchant (should return 404)
    console.log('Test 6: GET /api/merchants/:id with non-existent UUID');
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const test6 = await httpGet(`${API_BASE_URL}/api/merchants/${nonExistentId}`);
    if (test6.status === 404) {
      console.log('  ✓ Status: 404 Not Found (as expected)');
      console.log('  ✓ Error message:', test6.data.error);
      passedTests++;
    } else {
      console.log('  ✗ Expected 404 but got:', test6.status);
      failedTests++;
    }
    console.log();

    // Summary
    console.log('='.repeat(70));
    console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
    console.log('='.repeat(70));
    console.log();

    if (failedTests === 0) {
      console.log('✅ All tests passed!');
      console.log();
      console.log('📝 Fix verification summary:');
      console.log('  1. Merchant API endpoint returns 200 OK for valid UUID');
      console.log('  2. UUID normalization works (uppercase, lowercase, mixed case)');
      console.log('  3. Merchant data structure is correct');
      console.log('  4. Related data (API keys, webhooks, etc.) is included');
      console.log('  5. Non-existent merchants return 404 as expected');
      console.log();
      console.log('🎉 The 404 error for /api/merchants/:id is fixed!');
      process.exit(0);
    } else {
      console.error('❌ Some tests failed!');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    console.error('\n💡 Make sure the server is running: npm start');
    process.exit(1);
  }
}

// Run tests
runTests();
