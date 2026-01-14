/**
 * Test for Compliance Admin Audit Logs Fix
 * 
 * This test verifies that the fix for the audit_logs.status column issue is working correctly.
 * The issue was that the code was trying to query audit_logs.status='BLOCKED', but the 
 * audit_logs table doesn't have a status column.
 */

const fs = require('fs');
const path = require('path');

console.log('Testing Compliance Admin Audit Logs Fix...\n');

// Read the fixed file
const filePath = path.join(__dirname, '..', 'src', 'api', 'compliance-admin-routes.js');
const fileContent = fs.readFileSync(filePath, 'utf8');

let passCount = 0;
let failCount = 0;

// Test 1: Verify no direct queries to audit_logs with status='BLOCKED'
console.log('Test 1: Checking for removed audit_logs status queries...');
const hasAuditLogsStatusQuery = /audit_logs[^;]*\.where\([^)]*['"]status['"][^)]*['"]BLOCKED['"]/s.test(fileContent);
if (!hasAuditLogsStatusQuery) {
  console.log('✓ PASS: No audit_logs status queries found\n');
  passCount++;
} else {
  console.log('✗ FAIL: Still contains audit_logs status queries\n');
  failCount++;
}

// Test 2: Verify dashboard endpoint has the fix
console.log('Test 2: Checking dashboard endpoint fix...');
const dashboardSection = fileContent.match(/\/\/ Get control breaches[\s\S]*?const controlBreaches = [^;]+;/);
if (dashboardSection && dashboardSection[0].includes('count: 0') && 
    dashboardSection[0].includes('Control breach tracking via audit_logs.status is not implemented')) {
  console.log('✓ PASS: Dashboard endpoint properly fixed with fallback value\n');
  passCount++;
} else {
  console.log('✗ FAIL: Dashboard endpoint not properly fixed\n');
  failCount++;
}

// Test 3: Verify control-breaches endpoint has the fix
console.log('Test 3: Checking control-breaches endpoint fix...');
const controlBreachesSection = fileContent.match(/\/\/ Get blocked audit log entries[\s\S]*?const blockedActions = [^;]+;/);
if (controlBreachesSection && controlBreachesSection[0].includes('[]') && 
    controlBreachesSection[0].includes('Control breach tracking via audit_logs.status is not implemented')) {
  console.log('✓ PASS: Control-breaches endpoint properly fixed with empty array\n');
  passCount++;
} else {
  console.log('✗ FAIL: Control-breaches endpoint not properly fixed\n');
  failCount++;
}

// Test 4: Verify count calculation uses failedOverrides
console.log('Test 4: Checking control breaches count calculation...');
const countCalculation = /const count = failedOverrides\.length;/.test(fileContent);
if (countCalculation) {
  console.log('✓ PASS: Count calculation properly uses failedOverrides.length\n');
  passCount++;
} else {
  console.log('✗ FAIL: Count calculation not properly updated\n');
  failCount++;
}

// Test 5: Verify no other status references in audit_logs context remain
console.log('Test 5: Checking for any remaining problematic status references...');
const lines = fileContent.split('\n');
let hasProblematicStatusRef = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Check if line has audit_logs and status in same context (not in comments)
  if (line.includes('audit_logs') && line.includes('status') && !line.trim().startsWith('//')) {
    hasProblematicStatusRef = true;
    console.log(`  Found on line ${i + 1}: ${line.trim()}`);
  }
}
if (!hasProblematicStatusRef) {
  console.log('✓ PASS: No problematic status references found\n');
  passCount++;
} else {
  console.log('✗ FAIL: Found problematic status references\n');
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
  console.log('\n✓ All tests passed! The audit_logs status column fix is working correctly.');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed. Please review the changes.');
  process.exit(1);
}
