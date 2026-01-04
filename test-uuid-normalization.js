#!/usr/bin/env node

/**
 * Test UUID normalization functionality
 * This tests the fix for the "Merchant not found" issue
 */

const config = require('./src/config/config');
const MerchantService = require('./src/merchant/merchant-service');

async function testUUIDNormalization() {
  console.log('🧪 Testing UUID Normalization Fix\n');
  
  const merchantService = new MerchantService(config);
  
  // Test cases for UUID validation and normalization
  const testCases = [
    {
      description: 'Valid UUID with lowercase',
      uuid: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61',
      shouldPass: true
    },
    {
      description: 'Valid UUID with uppercase',
      uuid: '04A8BAAE-3E0A-467E-AA5A-83D7B12C6B61',
      shouldPass: true
    },
    {
      description: 'Valid UUID with mixed case',
      uuid: '04a8BaAe-3E0a-467e-AA5a-83D7b12c6b61',
      shouldPass: true
    },
    {
      description: 'Valid UUID with leading whitespace',
      uuid: '  04a8baae-3e0a-467e-aa5a-83d7b12c6b61',
      shouldPass: true
    },
    {
      description: 'Valid UUID with trailing whitespace',
      uuid: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61  ',
      shouldPass: true
    },
    {
      description: 'Valid UUID with both leading and trailing whitespace',
      uuid: '  04a8baae-3e0a-467e-aa5a-83d7b12c6b61  ',
      shouldPass: true
    },
    {
      description: 'Invalid UUID - too short',
      uuid: '04a8baae-3e0a-467e-aa5a',
      shouldPass: false
    },
    {
      description: 'Invalid UUID - wrong format',
      uuid: '04a8baae_3e0a_467e_aa5a_83d7b12c6b61',
      shouldPass: false
    },
    {
      description: 'Invalid UUID - null',
      uuid: null,
      shouldPass: false
    },
    {
      description: 'Invalid UUID - empty string',
      uuid: '',
      shouldPass: false
    }
  ];
  
  console.log('Testing UUID normalization and validation:\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    try {
      const normalized = merchantService._normalizeUUID(testCase.uuid, 'Test UUID');
      
      if (testCase.shouldPass) {
        console.log(`✓ ${testCase.description}`);
        console.log(`  Input:  "${testCase.uuid}"`);
        console.log(`  Output: "${normalized}"`);
        passed++;
      } else {
        console.log(`✗ ${testCase.description} - SHOULD HAVE FAILED`);
        console.log(`  Input:  "${testCase.uuid}"`);
        console.log(`  Output: "${normalized}"`);
        failed++;
      }
    } catch (error) {
      if (!testCase.shouldPass) {
        console.log(`✓ ${testCase.description}`);
        console.log(`  Input:  "${testCase.uuid}"`);
        console.log(`  Error:  ${error.message}`);
        passed++;
      } else {
        console.log(`✗ ${testCase.description} - SHOULD HAVE PASSED`);
        console.log(`  Input:  "${testCase.uuid}"`);
        console.log(`  Error:  ${error.message}`);
        failed++;
      }
    }
    console.log();
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (failed > 0) {
    console.error('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    
    console.log('\n📝 Summary of the fix:');
    console.log('  1. UUIDs are now normalized (trimmed and lowercased)');
    console.log('  2. UUIDs are validated against proper format');
    console.log('  3. Database queries use explicit type casting (::text)');
    console.log('  4. This fixes the "Merchant not found" issue for valid UUIDs');
    console.log('     with different casing or whitespace\n');
    
    process.exit(0);
  }
}

testUUIDNormalization().catch((error) => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});
