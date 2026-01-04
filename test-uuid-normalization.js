#!/usr/bin/env node

/**
 * Test UUID normalization functionality
 * This tests the fix for the "Merchant not found" issue
 * 
 * NOTE: This test directly accesses the _normalizeUUID private method because:
 * 1. This is a critical bug fix that requires direct validation of the normalization logic
 * 2. The bug specifically relates to UUID handling, not the full getMerchant flow
 * 3. Testing via public APIs would require database setup and would test more than just the fix
 * 4. This is a focused unit test for the bug fix validation
 */

const config = require('./src/config/config');
const MerchantService = require('./src/merchant/merchant-service');

async function testUUIDNormalization() {
  console.log('🧪 Testing UUID Normalization Fix\n');
  
  const merchantService = new MerchantService(config);
  
  // Test the internal UUID normalization logic directly
  const testCases = [
    {
      description: 'Valid UUID with lowercase',
      uuid: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
    },
    {
      description: 'Valid UUID with uppercase',
      uuid: '04A8BAAE-3E0A-467E-AA5A-83D7B12C6B61',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
    },
    {
      description: 'Valid UUID with mixed case',
      uuid: '04a8BaAe-3E0a-467e-AA5a-83D7b12c6b61',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
    },
    {
      description: 'Valid UUID with leading whitespace',
      uuid: '  04a8baae-3e0a-467e-aa5a-83d7b12c6b61',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
    },
    {
      description: 'Valid UUID with trailing whitespace',
      uuid: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61  ',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
    },
    {
      description: 'Valid UUID with both leading and trailing whitespace',
      uuid: '  04a8baae-3e0a-467e-aa5a-83d7b12c6b61  ',
      shouldPass: true,
      expectedOutput: '04a8baae-3e0a-467e-aa5a-83d7b12c6b61'
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
  console.log('This tests the core fix for the "Merchant not found" issue.\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    try {
      const normalized = merchantService._normalizeUUID(testCase.uuid, 'Test UUID');
      
      if (testCase.shouldPass) {
        // Verify normalization works correctly
        if (normalized === testCase.expectedOutput) {
          console.log(`✓ ${testCase.description}`);
          console.log(`  Input:    "${testCase.uuid}"`);
          console.log(`  Output:   "${normalized}"`);
          console.log(`  Expected: "${testCase.expectedOutput}"`);
          passed++;
        } else {
          console.log(`✗ ${testCase.description} - INCORRECT OUTPUT`);
          console.log(`  Input:    "${testCase.uuid}"`);
          console.log(`  Output:   "${normalized}"`);
          console.log(`  Expected: "${testCase.expectedOutput}"`);
          failed++;
        }
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
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(70)}\n`);
  
  if (failed > 0) {
    console.error('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    
    console.log('\n📝 Summary of the fix:');
    console.log('  1. UUIDs are now normalized (trimmed and lowercased)');
    console.log('  2. UUIDs are validated against proper format BEFORE DB queries');
    console.log('  3. Database queries use explicit type casting (::text)');
    console.log('  4. This fixes the "Merchant not found" issue for valid UUIDs');
    console.log('     with different casing or whitespace');
    console.log('  5. Invalid UUIDs are rejected with clear error messages');
    console.log('\n🎯 Impact:');
    console.log('  - Merchant ID "04a8baae-3e0a-467e-aa5a-83d7b12c6b61" (lowercase)');
    console.log('  - Merchant ID "04A8BAAE-3E0A-467E-AA5A-83D7B12C6B61" (uppercase)');  
    console.log('  - Merchant ID " 04a8baae-3e0a-467e-aa5a-83d7b12c6b61 " (with spaces)');
    console.log('  All now resolve to the same normalized ID and will find the merchant!\n');
    
    process.exit(0);
  }
}

testUUIDNormalization().catch((error) => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});
