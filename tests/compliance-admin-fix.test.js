/**
 * Compliance Admin Portal Fixes - Unit Test
 * 
 * Tests the fixes for:
 * 1. audit_logs entity_type constraint violation
 * 2. settlements updated_at column reference
 */

const fs = require('fs');
const path = require('path');

// Read the compliance-admin-routes.js file
const routesFilePath = path.join(__dirname, '../src/api/compliance-admin-routes.js');
const routesContent = fs.readFileSync(routesFilePath, 'utf8');

/**
 * Test 1: Verify audit_logs insert includes entity_type field
 */
function testAuditLogsEntityType() {
  console.log('Test 1: Checking audit_logs insert includes entity_type...');
  
  // Check that the logComplianceAction function includes entity_type in the insert
  const hasEntityType = routesContent.includes("entity_type: 'compliance_action'");
  
  if (hasEntityType) {
    console.log('✓ PASS: entity_type field is included in audit_logs insert');
    return true;
  } else {
    console.log('✗ FAIL: entity_type field is missing from audit_logs insert');
    return false;
  }
}

/**
 * Test 2: Verify audit_logs insert includes entity_id field
 */
function testAuditLogsEntityId() {
  console.log('Test 2: Checking audit_logs insert includes entity_id...');
  
  // Check that entity_id is properly handled (not null)
  const hasEntityId = routesContent.includes('entity_id: entityId');
  const hasDummyUUID = routesContent.includes("'00000000-0000-0000-0000-000000000000'");
  
  if (hasEntityId && hasDummyUUID) {
    console.log('✓ PASS: entity_id field is properly handled with fallback UUID');
    return true;
  } else {
    console.log('✗ FAIL: entity_id field is not properly handled');
    return false;
  }
}

/**
 * Test 3: Verify audit_logs insert includes action field
 */
function testAuditLogsAction() {
  console.log('Test 3: Checking audit_logs insert includes action field...');
  
  // Check that action is included
  const hasAction = routesContent.includes("action: 'read'");
  
  if (hasAction) {
    console.log('✓ PASS: action field is included in audit_logs insert');
    return true;
  } else {
    console.log('✗ FAIL: action field is missing from audit_logs insert');
    return false;
  }
}

/**
 * Test 4: Verify settlements query uses created_at instead of updated_at
 */
function testSettlementsCreatedAt() {
  console.log('Test 4: Checking settlements query uses created_at...');
  
  // Check that settlements queries use created_at, not updated_at
  const hasUpdatedAt = routesContent.includes('settlements.*updated_at') || 
                       routesContent.includes("settlements', 'updated_at");
  
  const hasCreatedAtInQuery = routesContent.includes('settlements') && 
                               routesContent.includes('created_at >= ?');
  
  if (!hasUpdatedAt && hasCreatedAtInQuery) {
    console.log('✓ PASS: settlements query correctly uses created_at instead of updated_at');
    return true;
  } else {
    console.log('✗ FAIL: settlements query still references updated_at or missing created_at');
    return false;
  }
}

/**
 * Test 5: Verify high-risk-actions endpoint uses created_at for settlements
 */
function testHighRiskActionsSettlements() {
  console.log('Test 5: Checking high-risk-actions endpoint settlements query...');
  
  // Find the settlementRetries query
  const settlementRetriesMatch = routesContent.match(/const settlementRetries[\s\S]*?\.orderBy\([^)]+\)/);
  
  if (settlementRetriesMatch) {
    const queryText = settlementRetriesMatch[0];
    const hasCreatedAt = queryText.includes('created_at');
    const hasUpdatedAt = queryText.includes('updated_at');
    
    if (hasCreatedAt && !hasUpdatedAt) {
      console.log('✓ PASS: settlementRetries query uses created_at instead of updated_at');
      return true;
    } else {
      console.log('✗ FAIL: settlementRetries query incorrect');
      return false;
    }
  } else {
    console.log('✗ FAIL: Could not find settlementRetries query');
    return false;
  }
}

// Run all tests
function runAllTests() {
  console.log('='.repeat(60));
  console.log('Compliance Admin Portal Fixes - Unit Tests');
  console.log('='.repeat(60));
  console.log('');
  
  const results = [
    testAuditLogsEntityType(),
    testAuditLogsEntityId(),
    testAuditLogsAction(),
    testSettlementsCreatedAt(),
    testHighRiskActionsSettlements()
  ];
  
  console.log('');
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
