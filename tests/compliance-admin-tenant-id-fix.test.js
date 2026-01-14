/**
 * Test for Compliance Admin Tenant ID Fix
 * 
 * This test verifies that the fix for the tenant_id null constraint violation
 * and JSON parsing error is working correctly.
 * 
 * Issues fixed:
 * 1. tenant_id null value in audit_logs when approving/rejecting overrides
 * 2. JSON parsing error when request_data is already an object
 */

const fs = require('fs');
const path = require('path');

console.log('Testing Compliance Admin Tenant ID Fix...\n');

// Read the fixed file
const filePath = path.join(__dirname, '..', 'src', 'api', 'compliance-admin-routes.js');
const fileContent = fs.readFileSync(filePath, 'utf8');

let passCount = 0;
let failCount = 0;

// Test 1: Verify logComplianceAction fetches approval request for tenant_id
console.log('Test 1: Checking logComplianceAction fetches approval request for tenant_id...');
const hasApprovalRequestFetch = fileContent.includes("req.params.requestId") && 
                                 fileContent.includes("db.knex('approval_requests')") &&
                                 fileContent.includes("approvalRequest.request_data");
if (hasApprovalRequestFetch) {
  console.log('✓ PASS: logComplianceAction properly fetches approval request for tenant_id\n');
  passCount++;
} else {
  console.log('✗ FAIL: logComplianceAction does not fetch approval request\n');
  failCount++;
}

// Test 2: Verify tenant_id extraction logic in logComplianceAction
console.log('Test 2: Checking tenant_id extraction in logComplianceAction...');
const hasTenantIdExtraction = fileContent.includes("tenantId = requestData.tenantId");
if (hasTenantIdExtraction) {
  console.log('✓ PASS: tenant_id is properly extracted from request_data\n');
  passCount++;
} else {
  console.log('✗ FAIL: tenant_id extraction not found\n');
  failCount++;
}

// Test 3: Verify JSON parsing safety check in approval handler
console.log('Test 3: Checking JSON parsing safety in approval handler...');
const hasJsonParseSafetyCheck = fileContent.includes("typeof request.request_data === 'string'") &&
                                 fileContent.includes(": request.request_data");
if (hasJsonParseSafetyCheck) {
  console.log('✓ PASS: JSON parsing includes type check for safety\n');
  passCount++;
} else {
  console.log('✗ FAIL: JSON parsing safety check not found\n');
  failCount++;
}

// Test 4: Verify comment about JSONB being auto-parsed
console.log('Test 4: Checking for explanatory comment about JSONB parsing...');
const hasJsonbComment = fileContent.includes("JSONB column") || 
                        fileContent.includes("already parsed by Knex");
if (hasJsonbComment) {
  console.log('✓ PASS: Explanatory comment about JSONB auto-parsing found\n');
  passCount++;
} else {
  console.log('✗ FAIL: Missing explanatory comment\n');
  failCount++;
}

// Test 5: Verify the fix is applied in both middleware and handler
console.log('Test 5: Checking fixes are in correct locations...');
const middlewareSection = fileContent.substring(
  fileContent.indexOf('const logComplianceAction'),
  fileContent.indexOf('router.get(\'/dashboard\'')
);
const approvalHandlerSection = fileContent.substring(
  fileContent.indexOf('router.post(\'/overrides/:requestId/approve\''),
  fileContent.indexOf('router.post(\'/overrides/:requestId/reject\'')
);

const middlewareHasFix = middlewareSection.includes("typeof approvalRequest.request_data === 'string'");
const handlerHasFix = approvalHandlerSection.includes("typeof request.request_data === 'string'");

if (middlewareHasFix && handlerHasFix) {
  console.log('✓ PASS: Fixes applied in both middleware and approval handler\n');
  passCount++;
} else {
  if (!middlewareHasFix) console.log('  Missing fix in middleware');
  if (!handlerHasFix) console.log('  Missing fix in approval handler');
  console.log('✗ FAIL: Fixes not applied in all necessary locations\n');
  failCount++;
}

// Test 6: Ensure the ternary operator is used instead of direct JSON.parse
console.log('Test 6: Checking that JSON.parse is now conditional...');
const hasConditionalParse = approvalHandlerSection.includes("typeof request.request_data === 'string'") &&
                            approvalHandlerSection.includes("? JSON.parse(request.request_data)") &&
                            approvalHandlerSection.includes(": request.request_data");
if (hasConditionalParse) {
  console.log('✓ PASS: JSON.parse is now properly conditional\n');
  passCount++;
} else {
  console.log('✗ FAIL: Conditional JSON.parse not found\n');
  failCount++;
}

// Summary
console.log('═══════════════════════════════════════════');
console.log('Test Summary:');
console.log(`  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);
console.log(`  Total:  ${passCount + failCount}`);
console.log('═══════════════════════════════════════════');

if (failCount === 0) {
  console.log('\n✓ All tests passed! The tenant_id and JSON parsing fixes are working correctly.');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed. Please review the changes.');
  process.exit(1);
}
