-- ===================================================================
-- 13_backfill_per_product_roles.sql  (historically 18_backfill-per-product-roles.sql)
--
-- P1.1 — Phase B (BACKFILL). Populates iam.users.platform_role from the
-- authoritative source (iam.user_org_mapping + iam.users). Idempotent and
-- re-runnable: running it again reconciles platform_role to whatever the
-- ladder currently says.
--
-- HISTORY — this script also used to backfill the per-product
-- lms/hr/task.member_roles grants. Those tables were dropped when Tier C
-- consolidated all role/rank resolution onto the single iam ladder
-- (iam.user_roles + iam.fn_user_org_role), so only the platform_role backfill
-- remains. See db_scripts/15_drop_per_product_roles.sql.
--
-- Mapping rule:
--   platform_role  = super_admin | tenant_admin | org_admin from the matching
--                    role, else 'member' (hr_admin + sales ladder + read_only).
-- ===================================================================

BEGIN;

-- ===================================================================
-- 1. iam.users.platform_role — from the user's DEFAULT (home) role.
-- ===================================================================
UPDATE iam.users u
SET platform_role = CASE ur.name
  WHEN 'super_admin'  THEN 'super_admin'
  WHEN 'tenant_admin' THEN 'tenant_admin'
  WHEN 'org_admin'    THEN 'org_admin'
  ELSE 'member'
END
FROM iam.user_roles ur
WHERE ur.id = u.role_id
  AND u.platform_role IS DISTINCT FROM CASE ur.name
        WHEN 'super_admin'  THEN 'super_admin'
        WHEN 'tenant_admin' THEN 'tenant_admin'
        WHEN 'org_admin'    THEN 'org_admin'
        ELSE 'member'
      END;


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.12.0', 'P1.1 Phase B (backfill): iam.users.platform_role populated from the iam.user_org_mapping ladder; idempotent (per-product member_roles backfill since removed with those tables)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
