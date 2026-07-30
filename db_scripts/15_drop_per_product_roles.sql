-- ===================================================================
-- 15_drop_per_product_roles.sql
--
-- TEARDOWN of the per-product role ladders (P1.1 Phase A/B), superseded by
-- Tier C's single iam ladder (iam.user_roles + iam.fn_user_org_role).
--
-- What this removes, per product schema (lms | hr | task):
--   <product>.member_roles        the (user, org) role GRANT table
--   <product>.roles               the per-product role CATALOG
--   <product>.fn_member_rank      own-rank helper
--   <product>.fn_member_role      (role, rank) resolver
--   <product>.vw_member_roles     resolver view
-- Plus:
--   public.set_member_role_tenant_id()   trigger fn used only by member_roles
--   entity.catalog_defaults rows         for lms/hr/task.roles
--   entity.catalog_versions rows         for lms/hr/task.roles
--   entity.tenant_catalog_versions rows  for lms/hr/task.roles
--
-- Why this is safe: nothing reads these objects any more. The last application
-- reader was the gateway's communicationSendGuard, which now resolves rank from
-- iam.fn_user_org_role (see api-gateway/src/middleware/comms-send-guard.ts).
-- Role assignment has always continued to run on iam.user_org_mapping.
--
-- Order matters: member_roles FKs <product>.roles ON DELETE RESTRICT, and the
-- views + fn_member_rank/fn_member_role depend on both, so views and functions
-- go first, then member_roles, then the catalogs.
--
-- Idempotent: every statement is IF EXISTS, so re-running is a no-op. Safe on a
-- fresh database where 04 never created these objects in the first place.
--
-- IRREVERSIBLE: this drops role-grant DATA. The grants were derived from
-- iam.user_org_mapping (see 13_backfill_per_product_roles.sql, which used to
-- rebuild them), so the iam ladder remains the source of truth — but take a
-- backup before running this in production if you want the history.
-- ===================================================================

BEGIN;

-- ── 1. Resolver views (depend on member_roles + roles) ─────────────
DROP VIEW IF EXISTS lms.vw_member_roles;
DROP VIEW IF EXISTS hr.vw_member_roles;
DROP VIEW IF EXISTS task.vw_member_roles;

-- ── 2. Resolver functions ──────────────────────────────────────────
DROP FUNCTION IF EXISTS lms.fn_member_rank(UUID, UUID);
DROP FUNCTION IF EXISTS hr.fn_member_rank(UUID, UUID);
DROP FUNCTION IF EXISTS task.fn_member_rank(UUID, UUID);

DROP FUNCTION IF EXISTS lms.fn_member_role(UUID, UUID);
DROP FUNCTION IF EXISTS hr.fn_member_role(UUID, UUID);
DROP FUNCTION IF EXISTS task.fn_member_role(UUID, UUID);

-- ── 3. Grant tables (their triggers/policies/indexes go with them) ──
DROP TABLE IF EXISTS lms.member_roles;
DROP TABLE IF EXISTS hr.member_roles;
DROP TABLE IF EXISTS task.member_roles;

-- ── 4. Shared trigger function — only ever used by member_roles ─────
DROP FUNCTION IF EXISTS public.set_member_role_tenant_id();

-- ── 5. Role catalogs ────────────────────────────────────────────────
DROP TABLE IF EXISTS lms.roles;
DROP TABLE IF EXISTS hr.roles;
DROP TABLE IF EXISTS task.roles;

-- ── 6. Catalog-seeding metadata for the dropped catalogs ────────────
-- tenant_catalog_versions first (it is the per-tenant provisioning record),
-- then the version registry, then the immutable default rows.
DELETE FROM entity.tenant_catalog_versions
 WHERE catalog_key IN ('lms.roles', 'hr.roles', 'task.roles');

DELETE FROM entity.catalog_versions
 WHERE catalog_key IN ('lms.roles', 'hr.roles', 'task.roles');

DELETE FROM entity.catalog_defaults
 WHERE catalog_key IN ('lms.roles', 'hr.roles', 'task.roles');


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.19.0', 'Tier C cleanup: dropped the per-product role ladders — lms/hr/task.roles + .member_roles, fn_member_rank, fn_member_role, vw_member_roles, set_member_role_tenant_id() and their catalog_defaults/versions seed rows; all role/rank resolution now runs on the single iam ladder via iam.fn_user_org_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
