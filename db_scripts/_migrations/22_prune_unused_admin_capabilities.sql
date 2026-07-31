-- ===================================================================
-- 22 — PRUNE THE UNUSED admin.* CAPABILITY KEYS
-- ===================================================================
-- Removes eleven nodes from the `admin` subtree that no app or service ever
-- read. They appeared on the Capability Matrix screen as tickable boxes that
-- changed nothing:
--
--   admin.orgs, admin.orgs.view, admin.orgs.manage
--   admin.users, admin.users.manage, admin.users.mappings.manage,
--   admin.users.password.reset
--   admin.lookups.view
--   admin.config.lms.manage
--   admin.meta.manage
--   admin.comms.send
--
-- WHY they were dead: the surfaces they name (branch admin, user admin, LMS
-- config catalogs, Meta integration, comms) live in admin-service,
-- identity-service and communication-service. None of those services calls
-- requireCapability on any route — they gate on RANK only (see
-- capabilities.controller.ts's own comment). So denying one of these keys never
-- blocked anything, and granting it never opened anything.
--
-- admin.lookups.view goes with them for a different reason: lookup-admin's
-- layout gates on admin.lookups.MANAGE. A view-only grant passed filterNav
-- (which wants any granted descendant of the page node) and then landed on the
-- "Access restricted" screen — a link that its own page bounces, which is the
-- exact failure holdsUsableNode() exists to prevent.
--
-- WHAT SURVIVES: `admin` (tool), `admin.lookups` (page),
-- `admin.lookups.manage`, `admin.roles.manage`. Those four are the real gates
-- on the super_admin lookup-admin console. Nothing here touches the HR or Tasks
-- admin tabs — those are `hr.attendance.admin.*` / `hr.leave.admin.*` /
-- `tasks.lists.*`, which ARE enforced route-by-route in hr-service and
-- tasks-service.
--
-- Grants disappear with the nodes: iam.role_capabilities.capability_id is
-- ON DELETE CASCADE, as is iam.capabilities.parent_key, so deleting the two
-- page nodes would take their operations even if they were not listed. They are
-- listed anyway so the intent is readable and the row count is checkable.
--
-- Idempotent, and safe to run on a fresh install (07 no longer seeds these, so
-- it finds nothing). Run it on any database seeded before this change; a
-- re-run of 07 alone will NOT remove them, because its ON CONFLICT clause only
-- ever upserts and sets is_active = TRUE.
--
-- REVERSING: re-add the key to 07_seed_lookup_data.sql AND write the
-- requireCapability gate that makes it mean something, in the same change.
-- Re-seeding the key on its own puts the misleading checkbox back.

BEGIN;

DO $$
DECLARE
  v_keys   TEXT[] := ARRAY[
    'admin.orgs.view', 'admin.orgs.manage', 'admin.orgs',
    'admin.users.manage', 'admin.users.mappings.manage',
    'admin.users.password.reset', 'admin.users',
    'admin.lookups.view',
    'admin.config.lms.manage',
    'admin.meta.manage',
    'admin.comms.send'
  ];
  v_grants INT;
  v_nodes  INT;
BEGIN
  -- Count first: after the DELETE the cascade has already taken these rows, so
  -- there is nothing left to count for the notice.
  SELECT COUNT(*) INTO v_grants
  FROM iam.role_capabilities rc
  JOIN iam.capabilities c ON c.id = rc.capability_id
  WHERE c.key = ANY (v_keys);

  DELETE FROM iam.capabilities WHERE key = ANY (v_keys);
  GET DIAGNOSTICS v_nodes = ROW_COUNT;

  RAISE NOTICE '[22] pruned % capability node(s) and % dependent grant row(s)', v_nodes, v_grants;
END $$;

-- Leftover GRANTS of the surviving four to roles that cannot use them.
--
-- The four survivors gate one thing: the lookup-admin console, which requires
-- the super_admin RANK on every route behind it and at its own door. So an
-- admin.* grant on any lower-ranked role opens nothing — and admin-service's
-- putGrants now refuses to write one (assertGrantsAssignable). This clears the
-- rows written before that rule existed, so the database matches the invariant
-- the API enforces rather than carrying grants that can no longer be re-made.
--
-- Rank is read from the role itself. After _migrations/23 only super_admin is a
-- global row, so this correctly spares it and sweeps every per-tenant copy of
-- tenant_admin / org_admin / the ladder roles.
--
-- DENIES ARE LEFT ALONE (`AND rc.is_granted`). An is_granted = FALSE row on a
-- page node is load-bearing: deleting it means INHERIT, which for a nav node
-- REVEALS the page rather than hiding it (see 21_role_nav_denies.sql). org_admin
-- explicitly denies admin.lookups; that row stays.
DELETE FROM iam.role_capabilities rc
USING iam.capabilities c, iam.user_roles r
WHERE c.id = rc.capability_id
  AND r.id = rc.role_id
  AND rc.is_granted
  AND (c.key = 'admin' OR c.key LIKE 'admin.%')
  AND r.rank < 1000;   -- ANCHOR_RANK.SUPER_ADMIN

COMMIT;

-- Services cache the resolved matrix for up to 5 minutes. The statement-level
-- trigger on iam.role_capabilities / iam.capabilities fires
-- 'rbac_capabilities_changed' on the deletes above, so a listening service drops
-- its cache within a second; one that never managed to LISTEN picks this up at
-- the TTL. No restart required either way.
