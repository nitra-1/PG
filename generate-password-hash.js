/**
 * Utility script to generate bcrypt password hash
 * Usage: node generate-password-hash.js <password>
 */

const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
  console.error('Error: Please provide a password');
  console.log('Usage: node generate-password-hash.js <password>');
  process.exit(1);
}

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    process.exit(1);
  }
  
  console.log('\n========================================');
  console.log('Password Hash Generated Successfully!');
  console.log('========================================\n');
  console.log('Hash:', hash);
  console.log('\nUse this hash in your INSERT statement:');
  console.log(`
INSERT INTO platform_users (username, email, password_hash, role, status)
VALUES (
  'admin',
  'admin@example.com',
  '${hash}',
  'PLATFORM_ADMIN',
  'active'
);
  `);
  console.log('========================================\n');
});
