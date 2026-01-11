-- Verification Script for Finance Admin TenantId Fix
-- Run this to check your setup is correct

-- 1. Check if you have merchants
SELECT 
    'Checking Merchants' as step,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 0 THEN '❌ No merchants found! Create at least one merchant.'
        ELSE '✅ Merchants exist'
    END as status
FROM merchants;

-- 2. List all merchants
SELECT 
    id,
    merchant_code,
    merchant_name,
    status,
    email,
    created_at
FROM merchants
ORDER BY created_at DESC;

-- 3. Check if FINANCE_ADMIN user exists
SELECT 
    'Checking FINANCE_ADMIN Users' as step,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 0 THEN '❌ No FINANCE_ADMIN users found!'
        ELSE '✅ FINANCE_ADMIN users exist'
    END as status
FROM platform_users
WHERE role = 'FINANCE_ADMIN';

-- 4. List FINANCE_ADMIN users
SELECT 
    id,
    username,
    email,
    role,
    status,
    last_login_at
FROM platform_users
WHERE role IN ('FINANCE_ADMIN', 'COMPLIANCE_ADMIN')
ORDER BY created_at DESC;

-- 5. Sample: Create a test merchant if none exist
-- Uncomment the lines below if you need to create a test merchant

-- INSERT INTO merchants (merchant_code, merchant_name, email, status)
-- VALUES ('TEST001', 'Test Merchant', 'test@example.com', 'active')
-- RETURNING id, merchant_code, merchant_name;

-- 6. Sample: Create a FINANCE_ADMIN user if none exist
-- First generate a password hash using: node generate-password-hash.js YourPassword123!
-- Then uncomment and update the INSERT below:

-- INSERT INTO platform_users (username, email, password_hash, role, status)
-- VALUES (
--   'finadmin',
--   'finadmin@example.com',
--   '$2b$10$YOUR_BCRYPT_HASH_HERE',
--   'FINANCE_ADMIN',
--   'active'
-- )
-- RETURNING id, username, email, role;

-- 7. Verify UUID format for all merchants (should all return true)
SELECT 
    id,
    merchant_code,
    id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' as is_valid_uuid
FROM merchants;

-- 8. Summary
SELECT 
    'SUMMARY' as section,
    (SELECT COUNT(*) FROM merchants) as total_merchants,
    (SELECT COUNT(*) FROM platform_users WHERE role = 'FINANCE_ADMIN') as total_finance_admins,
    CASE 
        WHEN (SELECT COUNT(*) FROM merchants) > 0 
         AND (SELECT COUNT(*) FROM platform_users WHERE role = 'FINANCE_ADMIN') > 0
        THEN '✅ Setup looks good!'
        ELSE '❌ Setup incomplete - see messages above'
    END as status;
