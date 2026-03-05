/**
 * CLI script to reset the platform-admin password directly in the database.
 *
 * Use this when you have lost access to the admin account and cannot log in
 * through the normal UI/API flow.
 *
 * Usage:
 *   node reset-admin-password.js <new-password> [username]
 *
 * Examples:
 *   node reset-admin-password.js "MyNewPass123!"
 *   node reset-admin-password.js "MyNewPass123!" admin
 *
 * The script will:
 *   1. Hash the provided password with bcrypt (cost factor 10)
 *   2. Update the platform_users row for the given username (default: 'admin')
 *   3. Ensure the account status is 'active' and the role is 'PLATFORM_ADMIN'
 *   4. Print the result to stdout
 *
 * Prerequisites:
 *   - DATABASE_URL (or individual PG* env vars) must point to the running database
 *   - Run `npm install` to ensure bcrypt and pg are available
 */

'use strict';

const bcrypt = require('bcrypt');
const { Client } = require('pg');
require('dotenv').config();

const newPassword = process.argv[2];
const username = process.argv[3] || 'admin';

if (!newPassword) {
  console.error('Error: new password is required.\n');
  console.log('Usage: node reset-admin-password.js <new-password> [username]');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('Error: password must be at least 8 characters long.');
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Individual env vars are used as fallback by the pg client automatically
    // (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD)
  });

  try {
    await client.connect();

    // Verify the user exists
    const checkResult = await client.query(
      'SELECT id, username, role, status FROM platform_users WHERE username = $1',
      [username]
    );

    if (checkResult.rows.length === 0) {
      console.error(`Error: no platform user found with username '${username}'.`);
      console.log('\nExisting platform users:');
      const allUsers = await client.query(
        'SELECT username, role, status FROM platform_users ORDER BY created_at'
      );
      if (allUsers.rows.length === 0) {
        console.log('  (none — run migrations and seeds first)');
      } else {
        allUsers.rows.forEach(u => {
          console.log(`  ${u.username}  role=${u.role}  status=${u.status}`);
        });
      }
      process.exit(1);
    }

    const user = checkResult.rows[0];
    console.log(`\nFound user: ${user.username}  role=${user.role}  status=${user.status}`);

    // Hash the new password
    console.log('Hashing password ...');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update the user
    const updateResult = await client.query(
      `UPDATE platform_users
          SET password_hash = $1,
              status        = 'active',
              role          = 'PLATFORM_ADMIN',
              updated_at    = NOW()
        WHERE username = $2
        RETURNING id, username, role, status, updated_at`,
      [passwordHash, username]
    );

    const updated = updateResult.rows[0];
    console.log('\n========================================');
    console.log('Password reset successfully!');
    console.log('========================================');
    console.log(`  Username : ${updated.username}`);
    console.log(`  Role     : ${updated.role}`);
    console.log(`  Status   : ${updated.status}`);
    console.log(`  Updated  : ${updated.updated_at}`);
    console.log('\nYou can now log in with the new password.');
    console.log('========================================\n');
  } catch (err) {
    console.error('Error resetting password:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
