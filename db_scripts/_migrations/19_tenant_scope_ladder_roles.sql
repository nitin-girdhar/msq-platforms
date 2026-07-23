-- ===================================================================
-- 19_tenant_scope_ladder_roles.sql
--
-- Move the non-anchor global ladder roles to tenant level, so every role a
-- tenant actually assigns is owned by that tenant and can be renamed, re-ranked
-- or re-permissioned without touching another tenant.
--
-- Stays GLOBAL (tenant_id IS NULL) — the four anchors:
--   super_admin (1000), tenant_admin (990), org_admin (980), read_only (0)
-- These are platform contracts: super_admin/tenant_admin/org_admin drive
-- iam.users.platform_role and PG-role selection in withRoleTx, and read_only is
-- the floor of the ladder. A per-tenant copy of any of them would fork a
-- platform-wide invariant.
--
-- Becomes TENANT-SCOPED — one identical copy per tenant:
--   hr_admin (75), org_sr_manager (70), org_manager (60),
--   senior_sales_executive (40), sales_representative (20)
--
-- Each copy carries department_id = NULL (these are org-wide ladder roles, not
-- the department-scoped roles seeded alongside them) and a full copy of the
-- global role's capability grants, so authorization is unchanged on day one.
--
-- Idempotent: re-running finds no matching global rows and does nothing.
-- Run inside one transaction — a partial apply would leave users pointing at a
-- role that is about to be deleted.
-- ===================================================================

BEGIN;

-- The roles being moved, in one place so every step below agrees.
CREATE TEMP TABLE _movable(name TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _movable(name) VALUES
  ('hr_admin'), ('org_sr_manager'), ('org_manager'),
  ('senior_sales_executive'), ('sales_representative');

-- old global role id -> (tenant, new per-tenant role id)
CREATE TEMP TABLE _role_map(old_id UUID, tenant_id UUID, new_id UUID) ON COMMIT DROP;

-- ── 1. Clone each global ladder role for every tenant ──────────────
WITH src AS (
  SELECT ur.id AS old_id, t.id AS tid, public.gen_uuidv7() AS new_id,
         ur.name, ur.label, ur.description, ur.rank, ur.is_active
  FROM iam.user_roles ur
  JOIN _movable m ON m.name = ur.name
  CROSS JOIN entity.tenants t
  WHERE ur.tenant_id IS NULL
), ins AS (
  INSERT INTO iam.user_roles (id, tenant_id, department_id, name, label, description, rank, is_active)
  SELECT new_id, tid, NULL, name, label, description, rank, is_active FROM src
  RETURNING id
)
INSERT INTO _role_map SELECT old_id, tid, new_id FROM src;

-- ── 2. Carry the capability grants across ──────────────────────────
-- Without this the cloned roles would exist but grant nothing, silently
-- demoting 60 users to no permissions. Tenant-scoped grants carry tenant_id,
-- matching how the department roles already store theirs.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rm.tenant_id, rm.new_id, rc.capability_id, rc.is_granted
FROM iam.role_capabilities rc
JOIN _role_map rm ON rm.old_id = rc.role_id
WHERE rc.tenant_id IS NULL;

-- ── 3. Repoint everything that references the global role ──────────
-- The tenant comes from the row's own org, so each user lands on their own
-- tenant's copy.
UPDATE iam.users u
SET role_id = rm.new_id
FROM entity.organizations o, _role_map rm
WHERE o.id = u.org_id
  AND rm.old_id = u.role_id
  AND rm.tenant_id = o.tenant_id;

UPDATE iam.user_org_mapping uom
SET role_id = rm.new_id
FROM entity.organizations o, _role_map rm
WHERE o.id = uom.org_id
  AND rm.old_id = uom.role_id
  AND rm.tenant_id = o.tenant_id;

-- ── 4. Drop the global originals ───────────────────────────────────
-- role_capabilities cascades. This must come after step 3, and the FKs from
-- iam.users / iam.user_org_mapping are ON DELETE RESTRICT, so any row we failed
-- to repoint aborts the migration here rather than losing a grant silently.
DELETE FROM iam.user_roles ur
USING _movable m
WHERE ur.name = m.name AND ur.tenant_id IS NULL;

-- ── 5. Refuse to leave a half-migrated database ────────────────────
DO $verify$
DECLARE
  v_bad INT;
BEGIN
  -- Every user must hold either a global anchor or a role owned by their own tenant.
  SELECT count(*) INTO v_bad
  FROM iam.users u
  JOIN iam.user_roles ur ON ur.id = u.role_id
  JOIN entity.organizations o ON o.id = u.org_id
  WHERE ur.tenant_id IS NOT NULL AND ur.tenant_id <> o.tenant_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % users hold a role belonging to another tenant', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM iam.user_org_mapping uom
  JOIN iam.user_roles ur ON ur.id = uom.role_id
  JOIN entity.organizations o ON o.id = uom.org_id
  WHERE ur.tenant_id IS NOT NULL AND ur.tenant_id <> o.tenant_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % org mappings hold a role belonging to another tenant', v_bad;
  END IF;

  -- Only the four anchors may remain global.
  SELECT count(*) INTO v_bad
  FROM iam.user_roles
  WHERE tenant_id IS NULL
    AND name NOT IN ('super_admin', 'tenant_admin', 'org_admin', 'read_only');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % non-anchor roles are still global', v_bad;
  END IF;

  -- A cloned role with no capabilities would be a silent permission wipe.
  SELECT count(*) INTO v_bad
  FROM iam.user_roles ur
  WHERE ur.tenant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM iam.role_capabilities rc WHERE rc.role_id = ur.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % tenant roles have no capability grants', v_bad;
  END IF;
END $verify$;

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.20.0', 'Ladder roles hr_admin/org_sr_manager/org_manager/senior_sales_executive/sales_representative cloned per tenant (with capability grants) and repointed; only the four anchors super_admin/tenant_admin/org_admin/read_only remain global')
ON CONFLICT (version) DO NOTHING;

COMMIT;
