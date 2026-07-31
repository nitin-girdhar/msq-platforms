-- ===================================================================
-- 23_tenant_scope_admin_roles.sql
--
-- Finishes what 19_tenant_scope_ladder_roles.sql started: move the three
-- remaining non-super_admin anchors to tenant level, so EVERY role a tenant
-- assigns is owned by that tenant and can be renamed, re-ranked or
-- re-permissioned without touching another tenant.
--
-- Stays GLOBAL (tenant_id IS NULL) — super_admin (1000) alone. It is the one
-- genuine platform contract: a super_admin acts ACROSS tenants by design (the
-- Capability Matrix screen edits tenants they are not a member of), so a
-- per-tenant copy is a contradiction — there is no single tenant it could
-- belong to. It is also hidden from the admin UI's role lists so it cannot be
-- handed out by accident.
--
-- Becomes TENANT-SCOPED — one identical copy per tenant:
--   tenant_admin (990), org_admin (980), read_only (0), plus any ladder role
--   that a re-run of 07_seed_lookup_data.sql resurrected globally after 19
--   already moved it (the set is discovered, not hard-coded — see step 1).
--
-- 19's header warned that a per-tenant copy of these "would fork a platform-wide
-- invariant" because they drive iam.users.platform_role and PG-role selection in
-- withRoleTx. Re-checked before writing this, and that is not the case — both
-- paths key on the role NAME, never on tenant_id:
--   * iam.set_user_platform_role() switches on ur.name (02_schema.sql).
--   * withRoleTx switches on ctx.role, the platform_role string off the JWT
--     (packages/db/src/transaction.ts).
--   * the tenant-admin guard trigger matches name = 'tenant_admin'.
-- A clone keeps its name, so every one of those still resolves identically.
-- What the warning correctly protects is super_admin, which this script leaves
-- exactly where it is.
--
-- Each copy carries department_id = NULL (these are tenant-wide roles, not the
-- department-scoped ladder seeded alongside them) and a full copy of the global
-- role's capability grants, so authorization is unchanged on day one.
--
-- Idempotent: re-running finds no matching global rows and does nothing.
-- Run inside one transaction — a partial apply would leave users pointing at a
-- role that is about to be deleted.
-- ===================================================================

BEGIN;

-- Everything global EXCEPT super_admin, discovered rather than listed.
--
-- A literal list ('tenant_admin','org_admin','read_only') was the obvious
-- shape, but it cannot survive the state a real database is actually in:
-- 07_seed_lookup_data.sql seeds the ladder roles globally with
-- `ON CONFLICT (name) WHERE tenant_id IS NULL DO UPDATE`, so RE-RUNNING 07
-- after 19 has already moved them re-creates the global originals. Those
-- resurrected rows are orphans (19 repointed every user off them), but they
-- would still trip this script's own "only super_admin may be global" check.
-- Selecting the set instead of naming it makes 23 mop them up in the same pass
-- and keeps it correct on a database where 07 is re-run again later.
CREATE TEMP TABLE _movable(name TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _movable(name)
SELECT name FROM iam.user_roles WHERE tenant_id IS NULL AND name <> 'super_admin';

-- old global role id -> (tenant, the tenant's own role id for that name)
CREATE TEMP TABLE _role_map(old_id UUID, tenant_id UUID, new_id UUID, is_new BOOLEAN) ON COMMIT DROP;

-- ── 1. Give every tenant its own copy of each global role ──────────
-- A tenant that ALREADY owns a role of that name (the 19-then-re-run-07 case
-- above) maps onto its existing row rather than gaining a duplicate — inserting
-- one would violate uix_user_roles_tenant_name anyway.
WITH src AS (
  SELECT ur.id AS old_id, t.id AS tid,
         ur.name, ur.label, ur.description, ur.rank, ur.is_active,
         existing.id AS existing_id
  FROM iam.user_roles ur
  JOIN _movable m ON m.name = ur.name
  CROSS JOIN entity.tenants t
  LEFT JOIN iam.user_roles existing
         ON existing.tenant_id = t.id AND existing.name = ur.name
  WHERE ur.tenant_id IS NULL
), prepared AS (
  SELECT old_id, tid, name, label, description, rank, is_active, existing_id,
         COALESCE(existing_id, public.gen_uuidv7()) AS new_id
  FROM src
), ins AS (
  INSERT INTO iam.user_roles (id, tenant_id, department_id, name, label, description, rank, is_active)
  SELECT new_id, tid, NULL, name, label, description, rank, is_active
  FROM prepared WHERE existing_id IS NULL
  RETURNING id
)
INSERT INTO _role_map
SELECT old_id, tid, new_id, existing_id IS NULL FROM prepared;

-- ── 2a. Rescue the tenant's OWN saved overrides ────────────────────
-- A tenant override is (tenant_id = T, role_id = <the global role>) — that is
-- the exact row the Capability Matrix screen writes when an admin grants or
-- revokes something for org_admin in one tenant. It points at the GLOBAL role
-- id, so step 4's DELETE would cascade it away: every customisation an admin
-- ever saved against these three roles, silently gone, with the resolved matrix
-- quietly falling back to the platform defaults.
--
-- Repointing must come BEFORE the defaults are copied in 2b, so the override
-- occupies the (tenant, role, capability) slot and the default cannot overwrite
-- the admin's decision.
UPDATE iam.role_capabilities rc
SET role_id = rm.new_id
FROM _role_map rm
WHERE rc.role_id = rm.old_id
  AND rc.tenant_id = rm.tenant_id;

-- ── 2b. Carry the platform defaults across ─────────────────────────
-- Without this the cloned roles would exist but grant nothing, silently
-- demoting every tenant_admin and org_admin on the platform to no permissions.
-- ON CONFLICT DO NOTHING so that neither an override rescued in 2a nor the
-- grants of a pre-existing role we mapped onto get overwritten by a default.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rm.tenant_id, rm.new_id, rc.capability_id, rc.is_granted
FROM iam.role_capabilities rc
JOIN _role_map rm ON rm.old_id = rc.role_id
WHERE rc.tenant_id IS NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL DO NOTHING;

-- ── 2c. Nothing may still hang off a role we are about to delete ───
-- Checked HERE, not in the verify block at the end: step 4's DELETE cascades
-- iam.role_capabilities, so by then any grant 2a missed is already gone and the
-- evidence with it. This is the guard that would have caught the tenant
-- overrides being lost.
DO $grants$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM iam.role_capabilities rc
  JOIN _role_map rm ON rm.old_id = rc.role_id
  WHERE rc.tenant_id IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % tenant grants still point at a role being removed', v_bad;
  END IF;
END $grants$;

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
  -- Every user must hold either super_admin or a role owned by their own tenant.
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

  -- super_admin is now the ONLY role permitted to be global.
  SELECT count(*) INTO v_bad
  FROM iam.user_roles
  WHERE tenant_id IS NULL AND name <> 'super_admin';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % non-super_admin roles are still global', v_bad;
  END IF;

  -- A cloned role with no capabilities would be a silent permission wipe.
  SELECT count(*) INTO v_bad
  FROM iam.user_roles ur
  WHERE ur.tenant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM iam.role_capabilities rc WHERE rc.role_id = ur.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % tenant roles have no capability grants', v_bad;
  END IF;

  -- Every tenant must still have its own admin ladder — a tenant that somehow
  -- received no clone would lock out its admins entirely.
  SELECT count(*) INTO v_bad
  FROM entity.tenants t
  WHERE EXISTS (SELECT 1 FROM iam.user_roles ur WHERE ur.tenant_id = t.id)
    AND NOT EXISTS (
      SELECT 1 FROM iam.user_roles ur
      WHERE ur.tenant_id = t.id AND ur.name = 'tenant_admin'
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'aborting: % tenants have no tenant_admin role', v_bad;
  END IF;
END $verify$;

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.23.0', 'Anchor roles tenant_admin/org_admin/read_only cloned per tenant (with capability grants) and repointed; super_admin is now the only global role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
