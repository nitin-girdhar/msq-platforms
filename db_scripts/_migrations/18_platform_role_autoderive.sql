-- ===================================================================
-- 18_platform_role_autoderive.sql
--
-- Fixes: every platform-tier gate in the shared services (the entire
-- lookup-admin surface) returned 403 for super_admin / tenant_admin.
--
-- Cause: iam.users.platform_role is a denormalisation of role_id, but nothing
-- kept it in sync. Script 13's backfill is a one-shot UPDATE, and every writer
-- that runs after it — seed script 08's unified-role-hierarchy block, and
-- identity-service's user create/update — inserts users without the column. It
-- stays NULL, identity-service's platformRoleOf() reads NULL as 'member', the
-- gateway injects X-Platform-Role: member, and admin-service's
-- `rank < RANKS.SUPER_ADMIN` check rejects the request. The lookup-admin page
-- then turns that 403 into a bare "404 This page could not be found".
--
-- Fix: derive the column in a BEFORE INSERT/UPDATE trigger (the canonical shape
-- now lives in 02_schema.sql), then reconcile the rows that were left NULL or
-- stale by the pre-trigger writers.
--
-- Idempotent and re-runnable. A guarded no-op on a fresh install, where
-- 02_schema.sql already creates the trigger and no row can be inconsistent.
-- ===================================================================

BEGIN;

-- ── 1. The trigger (identical to the 02_schema.sql definition) ──────────────
CREATE OR REPLACE FUNCTION iam.set_user_platform_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_derived TEXT;
BEGIN
  IF NEW.role_id IS NULL THEN
    NEW.platform_role := COALESCE(NEW.platform_role, 'member');
    RETURN NEW;
  END IF;

  SELECT CASE ur.name
           WHEN 'super_admin'  THEN 'super_admin'
           WHEN 'tenant_admin' THEN 'tenant_admin'
           WHEN 'org_admin'    THEN 'org_admin'
           ELSE 'member'
         END
    INTO v_derived
  FROM iam.user_roles ur WHERE ur.id = NEW.role_id;

  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    NEW.platform_role := COALESCE(v_derived, 'member');
  ELSE
    NEW.platform_role := COALESCE(NEW.platform_role, v_derived, 'member');
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_02_users_platform_role ON iam.users;
CREATE TRIGGER trg_02_users_platform_role
  BEFORE INSERT OR UPDATE OF role_id, platform_role ON iam.users
  FOR EACH ROW EXECUTE FUNCTION iam.set_user_platform_role();


-- ── 2. Reconcile existing rows ──────────────────────────────────────────────
-- Unlike script 13 this also corrects rows that hold a WRONG tier (a role
-- change applied while the column was unmaintained), not just NULL ones.
UPDATE iam.users u
SET platform_role = v.derived
FROM (
  SELECT u2.id,
         CASE ur.name
           WHEN 'super_admin'  THEN 'super_admin'
           WHEN 'tenant_admin' THEN 'tenant_admin'
           WHEN 'org_admin'    THEN 'org_admin'
           ELSE 'member'
         END AS derived
  FROM iam.users u2
  JOIN iam.user_roles ur ON ur.id = u2.role_id
) v
WHERE v.id = u.id
  AND u.platform_role IS DISTINCT FROM v.derived;

-- Users with no role at all fail closed as 'member' rather than NULL.
UPDATE iam.users SET platform_role = 'member'
WHERE role_id IS NULL AND platform_role IS NULL;


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.19.0', 'iam.users.platform_role is derived from role_id by trigger (trg_02_users_platform_role) and reconciled; fixes NULL platform_role authenticating super_admin/tenant_admin as member')
ON CONFLICT (version) DO NOTHING;

COMMIT;
