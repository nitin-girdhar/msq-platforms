-- ===================================================================
-- 21_role_nav_denies.sql
--
-- TEMPLATE, run on demand. Not part of db_deploy.ps1, not needed by a fresh
-- install. Edit the three declarations at the top, run it, done.
--
-- WHAT PROBLEM THIS SOLVES
--
-- Hiding a page or tab from a role is not done by deleting its grant row.
-- iam.fn_role_capability_matrix resolves nav nodes like this:
--
--     WHEN NOT w.granted            THEN FALSE
--     WHEN c.kind IN ('page','tab') THEN COALESCE(g.is_granted, w.nav_inherited)
--     ELSE                               COALESCE(g.is_granted, FALSE)
--
-- so for a PAGE or TAB, "no row" means INHERIT FROM THE PARENT, not "denied".
-- Deleting the row REVEALS the page. Only tools (roots) and operations/scopes
-- fail closed the way people expect.
--
-- This bites hardest on org_admin and tenant_admin: neither holds a single
-- explicit page/tab row in 07_seed_lookup_data.sql, so every CRM page they see
-- is on purely because the `lms` tool is granted. There is nothing to delete.
-- The fix is an explicit is_granted = FALSE row, which is what this writes.
--
-- SCOPE — tenant override vs platform default
--
--   v_tenant_id = '<uuid>'  writes a TENANT OVERRIDE. Affects that customer
--                           only, and is the same row the Capability Matrix
--                           screen writes, so it can be reversed from the admin
--                           UI later without SQL. Prefer this.
--   v_tenant_id = NULL      writes a PLATFORM DEFAULT. Affects every tenant on
--                           the deployment. Invisible to the Capability Matrix
--                           screen, which only reads and writes overlays on top
--                           of it — reversing needs SQL. Product decisions only.
--
-- KNOCK-ON EFFECT — denying a page prunes its whole subtree. Denying lms.users
-- also switches off lms.users.view, lms.users.manage and their scopes, so the
-- service gates behind that page start refusing, not just the tab disappearing.
-- That is normally the intent; make sure it is.
--
-- PROPAGATION — the write fires trg_notify_capability_change, so every service
-- drops its cached matrix within the statement. Browsers pick it up on their
-- next /auth/me (5-minute TTL worst case, see packages/db/src/capability-cache.ts).
-- Nobody has to log out.
--
-- Idempotent: upserts, never inserts blindly. Safe to re-run.
-- ===================================================================

BEGIN;

DO $migration$
DECLARE
  -- ── EDIT THESE THREE ──────────────────────────────────────────────
  v_role_name TEXT   := 'org_admin';

  -- The tenant to scope the deny to. NULL = every tenant (see SCOPE above).
  v_tenant_id UUID   := NULL;  -- e.g. '00000000-0000-0000-0000-000000000000'

  -- Page/tab (or tool) keys to take away. Page keys, not operation keys —
  -- denying the page prunes the operations under it anyway.
  v_deny_keys TEXT[] := ARRAY[
    'lms.users',
    'lms.analytics',
    'lms.apiclients'
  ];
  -- ── END EDIT ──────────────────────────────────────────────────────

  v_unknown TEXT;
  v_odd     TEXT;
  v_roles   INT;
  v_written INT;
BEGIN
  IF v_deny_keys IS NULL OR array_length(v_deny_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'Nothing to do: v_deny_keys is empty. Edit it before running.';
  END IF;

  -- A key that does not exist would silently match zero rows and look like a
  -- success — the exact failure mode this file exists to stop. Fail loudly.
  SELECT string_agg(k, ', ') INTO v_unknown
  FROM unnest(v_deny_keys) AS k
  WHERE NOT EXISTS (SELECT 1 FROM iam.capabilities c WHERE c.key = k);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown capability key(s): %. Check iam.capabilities.', v_unknown;
  END IF;

  -- Denying an operation or scope is legal but usually a mistake: those are
  -- already denied unless granted, so a deny row changes nothing you could not
  -- get by removing the grant.
  SELECT string_agg(c.key || ' (' || c.kind || ')', ', ') INTO v_odd
  FROM iam.capabilities c
  WHERE c.key = ANY(v_deny_keys) AND c.kind NOT IN ('tool', 'page', 'tab');
  IF v_odd IS NOT NULL THEN
    RAISE NOTICE 'Not a nav node, so a deny row here is redundant: %', v_odd;
  END IF;

  -- Ladder roles were cloned per tenant by 19_tenant_scope_ladder_roles.sql;
  -- only the four anchors (super_admin, tenant_admin, org_admin, read_only) are
  -- still global. Matching both shapes means this works for either.
  SELECT count(*) INTO v_roles
  FROM iam.user_roles r
  WHERE r.name = v_role_name
    AND (r.tenant_id IS NULL OR v_tenant_id IS NULL OR r.tenant_id = v_tenant_id);
  IF v_roles = 0 THEN
    RAISE EXCEPTION 'No role named % in scope.', v_role_name;
  END IF;

  IF v_tenant_id IS NULL THEN
    -- Platform default. Partial unique index uix_role_capabilities_default.
    INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
    SELECT NULL, r.id, c.id, FALSE
    FROM iam.user_roles r
    JOIN iam.capabilities c ON c.key = ANY(v_deny_keys)
    WHERE r.name = v_role_name AND r.tenant_id IS NULL
    ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
    DO UPDATE SET is_granted = FALSE;
  ELSE
    -- Tenant override. Partial unique index uix_role_capabilities_tenant.
    INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
    SELECT v_tenant_id, r.id, c.id, FALSE
    FROM iam.user_roles r
    JOIN iam.capabilities c ON c.key = ANY(v_deny_keys)
    WHERE r.name = v_role_name
      AND (r.tenant_id IS NULL OR r.tenant_id = v_tenant_id)
    ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
    DO UPDATE SET is_granted = FALSE;
  END IF;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RAISE NOTICE 'Denied % capability/ies for role % (% deny row(s) written, tenant %).',
    array_length(v_deny_keys, 1), v_role_name, v_written, COALESCE(v_tenant_id::TEXT, 'ALL');
END $migration$;

COMMIT;


-- ── Verify ──────────────────────────────────────────────────────────
-- 1. What the role can see now. This function is the authoritative answer —
--    every service gate and /auth/me resolve through it.
--
-- SELECT capability_key, kind, granted
--   FROM iam.fn_role_capability_matrix('<tenant-uuid>')
--  WHERE role_name = 'org_admin' AND kind IN ('tool','page','tab')
--  ORDER BY capability_key;
--
-- 2. Grants now stranded under a denied ancestor — same rule the seed's own
--    self-check applies (07_seed_lookup_data.sql). Rows here are EXPECTED after
--    a page deny: they are lms.users.view and friends going quiet, which is the
--    deny working, not a fault.
--
-- SELECT r.name, c.key
--   FROM iam.role_capabilities rc
--   JOIN iam.user_roles   r ON r.id = rc.role_id
--   JOIN iam.capabilities c ON c.id = rc.capability_id
--   JOIN iam.fn_role_capability_matrix('<tenant-uuid>') m
--     ON m.role_name = r.name AND m.capability_key = c.key
--  WHERE rc.is_granted AND NOT m.granted AND r.name = 'org_admin';
--
-- 3. To reverse: untick the same node in the Capability Matrix screen (tenant
--    overrides only), or flip is_granted back to TRUE with the same upsert.
