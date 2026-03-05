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
 *   - Run `npm install` to ensure bcrypt and pg are available
 *   - Set database credentials via environment variables (in your .env file):
 *       DATABASE_URL=postgres://user:password@host:5432/dbname
 *     OR individual variables:
 *       DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
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
  // Build connection config: prefer DATABASE_URL, then fall back to DB_* env
  // vars (matching the rest of the application's configuration).
  const clientConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: (() => {
          const p = parseInt(process.env.DB_PORT, 10);
          if (process.env.DB_PORT && (isNaN(p) || p < 1 || p > 65535)) {
            console.error(`Error: DB_PORT '${process.env.DB_PORT}' is not a valid port number.`);
            process.exit(1);
          }
          return p || 5432;
        })(),
        database: process.env.DB_NAME || 'payment_gateway',
        user: process.env.DB_USER || 'postgres',
        ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      };

  const client = new Client(clientConfig);

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
    console.error('Error resetting password:', err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
