#!/usr/bin/env node
/**
 * Verify Ops Console Login Setup
 * This script checks if the login system is properly configured
 */

const bcrypt = require('bcrypt');

console.log('\n========================================');
console.log('Ops Console Login Setup Verification');
console.log('========================================\n');

let allChecksPass = true;

// Check 1: Verify bcrypt is available
console.log('✓ Check 1: bcrypt module is available');

// Check 2: Verify files exist
const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'public/platform-login.html',
  'public/ops-console.html',
  'src/ops-console/auth-routes.js',
  'src/ops-console/index.js',
  'generate-password-hash.js',
  'OPS_CONSOLE_LOGIN_SETUP.md'
];

console.log('\n✓ Check 2: Required files exist');
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${file}`);
  } else {
    console.log(`  ✗ ${file} - MISSING`);
    allChecksPass = false;
  }
});

// Check 3: Verify password hash generation works
console.log('\n✓ Check 3: Password hash generation works');
bcrypt.hash('test', 10, (err, hash) => {
  if (err) {
    console.log('  ✗ Error generating hash:', err.message);
    allChecksPass = false;
  } else {
    console.log(`  ✓ Generated test hash: ${hash.substring(0, 20)}...`);
    console.log(`  ✓ Hash length: ${hash.length} (expected: 60)`);
    
    // Check 4: Verify password comparison works
    console.log('\n✓ Check 4: Password comparison works');
    bcrypt.compare('test', hash, (err, result) => {
      if (err) {
        console.log('  ✗ Error comparing password:', err.message);
        allChecksPass = false;
      } else if (result) {
        console.log('  ✓ Password comparison successful');
      } else {
        console.log('  ✗ Password comparison failed');
        allChecksPass = false;
      }
      
      // Check 5: Verify auth routes file has correct structure
      console.log('\n✓ Check 5: Auth routes file structure');
      const authRoutesContent = fs.readFileSync(path.join(__dirname, 'src/ops-console/auth-routes.js'), 'utf8');
      
      if (authRoutesContent.includes('router.post(\'/login\'')) {
        console.log('  ✓ Login route exists');
      } else {
        console.log('  ✗ Login route missing');
        allChecksPass = false;
      }
      
      if (authRoutesContent.includes('bcrypt.compare')) {
        console.log('  ✓ Password verification logic exists');
      } else {
        console.log('  ✗ Password verification logic missing');
        allChecksPass = false;
      }
      
      if (authRoutesContent.includes('router.post(\'/logout\'')) {
        console.log('  ✓ Logout route exists');
      } else {
        console.log('  ✗ Logout route missing');
        allChecksPass = false;
      }
      
      // Check 6: Verify ops-console index.js mounts auth routes
      console.log('\n✓ Check 6: Ops console index.js configuration');
      const indexContent = fs.readFileSync(path.join(__dirname, 'src/ops-console/index.js'), 'utf8');
      
      if (indexContent.includes('require(\'./auth-routes\')')) {
        console.log('  ✓ Auth routes are imported');
      } else {
        console.log('  ✗ Auth routes import missing');
        allChecksPass = false;
      }
      
      if (indexContent.includes('router.use(\'/auth\', authRoutes)')) {
        console.log('  ✓ Auth routes are mounted');
      } else {
        console.log('  ✗ Auth routes not mounted');
        allChecksPass = false;
      }
      
      // Check 7: Verify login page has correct structure
      console.log('\n✓ Check 7: Login page structure');
      const loginPageContent = fs.readFileSync(path.join(__dirname, 'public/platform-login.html'), 'utf8');
      
      if (loginPageContent.includes('id="username"')) {
        console.log('  ✓ Username field exists');
      } else {
        console.log('  ✗ Username field missing');
        allChecksPass = false;
      }
      
      if (loginPageContent.includes('id="password"')) {
        console.log('  ✓ Password field exists');
      } else {
        console.log('  ✗ Password field missing');
        allChecksPass = false;
      }
      
      if (loginPageContent.includes('/api/ops/auth/login')) {
        console.log('  ✓ Login API endpoint is called');
      } else {
        console.log('  ✗ Login API endpoint call missing');
        allChecksPass = false;
      }
      
      if (loginPageContent.includes('localStorage.setItem')) {
        console.log('  ✓ localStorage is used for authentication');
      } else {
        console.log('  ✗ localStorage usage missing');
        allChecksPass = false;
      }
      
      // Check 8: Verify ops-console has logout functionality
      console.log('\n✓ Check 8: Ops console logout functionality');
      const opsConsoleContent = fs.readFileSync(path.join(__dirname, 'public/ops-console.html'), 'utf8');
      
      if (opsConsoleContent.includes('onclick="logout()"')) {
        console.log('  ✓ Logout button exists');
      } else {
        console.log('  ✗ Logout button missing');
        allChecksPass = false;
      }
      
      if (opsConsoleContent.includes('function logout()')) {
        console.log('  ✓ Logout function exists');
      } else {
        console.log('  ✗ Logout function missing');
        allChecksPass = false;
      }
      
      if (opsConsoleContent.includes('platform-login.html')) {
        console.log('  ✓ Redirects to login page when not authenticated');
      } else {
        console.log('  ✗ Login page redirect missing');
        allChecksPass = false;
      }
      
      // Final summary
      console.log('\n========================================');
      if (allChecksPass) {
        console.log('✓ All checks passed!');
        console.log('========================================\n');
        console.log('Next steps:');
        console.log('1. Ensure database is running with migrations applied');
        console.log('2. Generate a password hash:');
        console.log('   node generate-password-hash.js "yourpassword"');
        console.log('3. Update admin user with the hash (see fix-admin-password.sql)');
        console.log('4. Start the server: npm start');
        console.log('5. Navigate to http://localhost:3000/platform-login.html');
        console.log('6. Login with your credentials\n');
        process.exit(0);
      } else {
        console.log('✗ Some checks failed!');
        console.log('========================================\n');
        console.log('Please review the errors above and fix the issues.\n');
        process.exit(1);
      }
    });
  }
});
