/**
 * Add COMPLIANCE_ADMIN Role to Platform Users
 * 
 * This migration adds the COMPLIANCE_ADMIN role to the platform_users_role enum.
 * The COMPLIANCE_ADMIN role is used for maker-checker workflows in financial operations,
 * allowing separation of duties between FINANCE_ADMIN (who can initiate) and 
 * COMPLIANCE_ADMIN (who can approve).
 * 
 * COMPLIANCE_ADMIN can be created via Ops Console for compliance workflows.
 */

exports.up = async function(knex) {
  // Add COMPLIANCE_ADMIN to platform_users_role enum
  // This uses a safe approach that checks if the value already exists
  await knex.raw(`
    DO $$ 
    BEGIN
      -- Check if platform_users_role type exists
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_users_role') THEN
        -- Type exists, check if COMPLIANCE_ADMIN value already exists in the enum
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'COMPLIANCE_ADMIN' 
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'platform_users_role'
          )
        ) THEN
          -- Add COMPLIANCE_ADMIN to the existing enum
          ALTER TYPE platform_users_role ADD VALUE 'COMPLIANCE_ADMIN';
        END IF;
      ELSE
        -- Type doesn't exist, create it with all roles including COMPLIANCE_ADMIN
        CREATE TYPE platform_users_role AS ENUM (
          'PLATFORM_ADMIN', 
          'OPS_ADMIN', 
          'FINANCE_ADMIN', 
          'MERCHANT', 
          'AUDITOR',
          'COMPLIANCE_ADMIN'
        );
      END IF;
    END $$;
  `);
};

exports.down = async function(knex) {
  // Note: PostgreSQL doesn't support removing enum values directly
  // We can't safely rollback this migration without potentially breaking existing data
  // If rollback is needed, a new enum type would need to be created and data migrated
  console.warn('Warning: Rollback of COMPLIANCE_ADMIN role addition is not supported.');
  console.warn('Enum values cannot be removed in PostgreSQL without recreating the type.');
};
