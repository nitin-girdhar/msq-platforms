-- ===================================================================
-- 04_roles_and_grants.sql
-- Consolidated DDL: per-product role catalogs and member_roles grant
-- tables (lms/hr/task), the shared member-role tenant_id trigger, resolver
-- views, the per-product-role rank resolver function, and per-product-login
-- DB grants (lms_svc / hr_svc / task_svc / root_service).
-- lms.roles / hr.roles / task.roles carry tenant_id directly in their
-- CREATE TABLE (historically added via 22_tenant-scope-lookups.sql ALTER).
-- iam.users.platform_role now lives directly on iam.users (02_schema.sql).
-- Idempotent: safe to re-run.
-- ===================================================================

-- ===================================================================
-- 17_init-per-product-roles.sql
--
-- P1.1 — Phase A (EXPAND, additive only): introduce per-product role
-- ladders and grants that will replace the single global iam.user_roles
-- ladder. NOTHING existing is modified or read here: the old ladder stays
-- fully authoritative until the flip (Phase D). This script is safe to
-- deploy on its own.
--
-- Creates, per product schema (lms | hr | task):
--   <product>.roles         — global role CATALOG lookup, own rank scale
--   <product>.member_roles  — (user, org) role GRANT, tenant-isolated + RLS
--   <product>.fn_member_rank(user, org) — SECURITY DEFINER own-rank helper
--   <product>.vw_member_roles           — security_invoker resolver view
-- Plus:
--   public.set_member_role_tenant_id()  — shared trigger: derive tenant_id
--                                          from org_id so clients can't spoof it
--   iam.users.platform_role             — nullable now; backfilled in script 18,
--                                          made NOT NULL in the Phase E contract
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE for triggers
-- & policies / ON CONFLICT DO NOTHING. Style mirrors db_scripts/01_init-db.sql
-- and 10_init-hr-task-schemas.sql.
-- ===================================================================

BEGIN;

-- ===================================================================
-- SHARED TRIGGER FUNCTION — derive member_roles.tenant_id from org_id
-- tenant_id is denormalized onto member_roles so the tenant_admin RLS
-- policy needs no join. This trigger sets it authoritatively from the
-- org's real tenant on every INSERT/UPDATE, so an app_user cannot write
-- a spoofed tenant_id to escape isolation.
-- ===================================================================
CREATE OR REPLACE FUNCTION public.set_member_role_tenant_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM entity.organizations
  WHERE id = NEW.org_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'org_id % does not resolve to a tenant', NEW.org_id;
  END IF;
  RETURN NEW;
END; $$;


-- ===================================================================
-- PER-PRODUCT ROLE CATALOGS  (global reference data, no RLS — same
-- management model as hr.employment_types / lms.lead_stage). Each product
-- owns its own rank scale; ranks are only comparable WITHIN a product.
-- ===================================================================

-- lms.roles / hr.roles / task.roles are tenant-scoped (historically added
-- via 22_tenant-scope-lookups.sql ALTER; folded directly into the CREATE
-- TABLE here). No un-scoped seed INSERT: per-tenant default rows are
-- provisioned by entity.seed_tenant_defaults() (05_catalogs.sql) at
-- tenant-creation time, not at DDL time (no tenant exists yet when this
-- script runs).
CREATE TABLE IF NOT EXISTS lms.roles (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,   -- machine key, stable
  label       TEXT    NOT NULL,
  description TEXT,
  rank        INT     NOT NULL DEFAULT 0
                      CONSTRAINT chk_lms_roles_rank CHECK (rank >= 0 AND rank <= 100),
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_lms_roles_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE lms.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON lms.roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON lms.roles;
CREATE POLICY org_isolation_policy ON lms.roles AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON lms.roles AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS hr.roles (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  rank        INT     NOT NULL DEFAULT 0
                      CONSTRAINT chk_hr_roles_rank CHECK (rank >= 0 AND rank <= 100),
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_hr_roles_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE hr.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.roles;
CREATE POLICY org_isolation_policy ON hr.roles AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON hr.roles AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS task.roles (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  rank        INT     NOT NULL DEFAULT 0
                      CONSTRAINT chk_task_roles_rank CHECK (rank >= 0 AND rank <= 100),
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_task_roles_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE task.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.roles;
CREATE POLICY org_isolation_policy ON task.roles AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON task.roles AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Catalog grants (readable by every subject role; only root_service writes)
GRANT SELECT         ON lms.roles, hr.roles, task.roles TO app_user;
GRANT SELECT         ON lms.roles, hr.roles, task.roles TO tenant_admin;
GRANT ALL PRIVILEGES ON lms.roles, hr.roles, task.roles TO root_service;


-- ===================================================================
-- PER-PRODUCT MEMBER_ROLES  (the (user, product, role) grant).
-- Org-grained (preserves multi-org users), tenant-isolated via RLS.
-- Shape and grant model mirror iam.user_org_mapping.
-- ===================================================================

-- ── lms.member_roles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lms.member_roles (
  user_id    UUID        NOT NULL REFERENCES iam.users(id)            ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES entity.organizations(id) ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES entity.tenants(id)       ON DELETE CASCADE,
  role_id    UUID        NOT NULL REFERENCES lms.roles(id)            ON DELETE RESTRICT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  granted_by UUID        REFERENCES iam.users(id)                     ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_member_roles_org_active
  ON lms.member_roles (org_id)    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_lms_member_roles_tenant_active
  ON lms.member_roles (tenant_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_lms_member_roles_role
  ON lms.member_roles (role_id);

DROP TRIGGER IF EXISTS trg_00_lms_member_roles_tenant_id ON lms.member_roles;
CREATE TRIGGER trg_00_lms_member_roles_tenant_id
  BEFORE INSERT OR UPDATE ON lms.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_member_role_tenant_id();

DROP TRIGGER IF EXISTS trg_lms_member_roles_updated_at ON lms.member_roles;
CREATE TRIGGER trg_lms_member_roles_updated_at
  BEFORE UPDATE ON lms.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE lms.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms.member_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON lms.member_roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON lms.member_roles;

CREATE POLICY org_isolation_policy ON lms.member_roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON lms.member_roles
  AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON lms.member_roles TO app_user;
GRANT SELECT, INSERT, UPDATE ON lms.member_roles TO tenant_admin;
GRANT ALL PRIVILEGES         ON lms.member_roles TO root_service;

-- ── hr.member_roles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.member_roles (
  user_id    UUID        NOT NULL REFERENCES iam.users(id)            ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES entity.organizations(id) ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES entity.tenants(id)       ON DELETE CASCADE,
  role_id    UUID        NOT NULL REFERENCES hr.roles(id)             ON DELETE RESTRICT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  granted_by UUID        REFERENCES iam.users(id)                     ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_member_roles_org_active
  ON hr.member_roles (org_id)    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_hr_member_roles_tenant_active
  ON hr.member_roles (tenant_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_hr_member_roles_role
  ON hr.member_roles (role_id);

DROP TRIGGER IF EXISTS trg_00_hr_member_roles_tenant_id ON hr.member_roles;
CREATE TRIGGER trg_00_hr_member_roles_tenant_id
  BEFORE INSERT OR UPDATE ON hr.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_member_role_tenant_id();

DROP TRIGGER IF EXISTS trg_hr_member_roles_updated_at ON hr.member_roles;
CREATE TRIGGER trg_hr_member_roles_updated_at
  BEFORE UPDATE ON hr.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE hr.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.member_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON hr.member_roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.member_roles;

CREATE POLICY org_isolation_policy ON hr.member_roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON hr.member_roles
  AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr.member_roles TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.member_roles TO tenant_admin;
GRANT ALL PRIVILEGES         ON hr.member_roles TO root_service;

-- ── task.member_roles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task.member_roles (
  user_id    UUID        NOT NULL REFERENCES iam.users(id)            ON DELETE CASCADE,
  org_id     UUID        NOT NULL REFERENCES entity.organizations(id) ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES entity.tenants(id)       ON DELETE CASCADE,
  role_id    UUID        NOT NULL REFERENCES task.roles(id)           ON DELETE RESTRICT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  granted_by UUID        REFERENCES iam.users(id)                     ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_task_member_roles_org_active
  ON task.member_roles (org_id)    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_task_member_roles_tenant_active
  ON task.member_roles (tenant_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_task_member_roles_role
  ON task.member_roles (role_id);

DROP TRIGGER IF EXISTS trg_00_task_member_roles_tenant_id ON task.member_roles;
CREATE TRIGGER trg_00_task_member_roles_tenant_id
  BEFORE INSERT OR UPDATE ON task.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_member_role_tenant_id();

DROP TRIGGER IF EXISTS trg_task_member_roles_updated_at ON task.member_roles;
CREATE TRIGGER trg_task_member_roles_updated_at
  BEFORE UPDATE ON task.member_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE task.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.member_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON task.member_roles;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.member_roles;

CREATE POLICY org_isolation_policy ON task.member_roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON task.member_roles
  AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON task.member_roles TO app_user;
GRANT SELECT, INSERT, UPDATE ON task.member_roles TO tenant_admin;
GRANT ALL PRIVILEGES         ON task.member_roles TO root_service;


-- ===================================================================
-- OWN-RANK HELPERS  (SECURITY DEFINER — bypass member_roles RLS so they
-- can be called inside OTHER tables' RLS policies without recursion.
-- Mirrors iam.fn_user_org_rank. Returns -1 when the user has no active
-- grant in that product+org, which is how "no product access" is encoded.
-- ===================================================================

CREATE OR REPLACE FUNCTION lms.fn_member_rank(p_user_id UUID, p_org_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_rank INT;
BEGIN
  SELECT r.rank INTO v_rank
  FROM lms.member_roles mr
  JOIN lms.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active;
  RETURN COALESCE(v_rank, -1);
END; $$;

CREATE OR REPLACE FUNCTION hr.fn_member_rank(p_user_id UUID, p_org_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_rank INT;
BEGIN
  SELECT r.rank INTO v_rank
  FROM hr.member_roles mr
  JOIN hr.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active;
  RETURN COALESCE(v_rank, -1);
END; $$;

CREATE OR REPLACE FUNCTION task.fn_member_rank(p_user_id UUID, p_org_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_rank INT;
BEGIN
  SELECT r.rank INTO v_rank
  FROM task.member_roles mr
  JOIN task.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active;
  RETURN COALESCE(v_rank, -1);
END; $$;


-- ===================================================================
-- RESOLVER VIEWS  (vw_ + security_invoker: RLS on member_roles applies
-- through the view for the calling role). Resolve role -> name/label/rank.
-- ===================================================================

CREATE OR REPLACE VIEW lms.vw_member_roles WITH (security_invoker = true) AS
SELECT
  mr.user_id,
  u.full_name  AS user_name,
  u.email      AS user_email,
  mr.org_id,
  o.name       AS org_name,
  mr.tenant_id,
  mr.role_id,
  r.name       AS role,
  r.label      AS role_label,
  r.rank       AS rank,
  mr.is_active,
  mr.granted_by,
  mr.granted_at,
  mr.updated_at
FROM lms.member_roles mr
JOIN      iam.users            u ON u.id = mr.user_id
JOIN      entity.organizations o ON o.id = mr.org_id
JOIN      lms.roles            r ON r.id = mr.role_id;

CREATE OR REPLACE VIEW hr.vw_member_roles WITH (security_invoker = true) AS
SELECT
  mr.user_id,
  u.full_name  AS user_name,
  u.email      AS user_email,
  mr.org_id,
  o.name       AS org_name,
  mr.tenant_id,
  mr.role_id,
  r.name       AS role,
  r.label      AS role_label,
  r.rank       AS rank,
  mr.is_active,
  mr.granted_by,
  mr.granted_at,
  mr.updated_at
FROM hr.member_roles mr
JOIN      iam.users            u ON u.id = mr.user_id
JOIN      entity.organizations o ON o.id = mr.org_id
JOIN      hr.roles             r ON r.id = mr.role_id;

CREATE OR REPLACE VIEW task.vw_member_roles WITH (security_invoker = true) AS
SELECT
  mr.user_id,
  u.full_name  AS user_name,
  u.email      AS user_email,
  mr.org_id,
  o.name       AS org_name,
  mr.tenant_id,
  mr.role_id,
  r.name       AS role,
  r.label      AS role_label,
  r.rank       AS rank,
  mr.is_active,
  mr.granted_by,
  mr.granted_at,
  mr.updated_at
FROM task.member_roles mr
JOIN      iam.users            u ON u.id = mr.user_id
JOIN      entity.organizations o ON o.id = mr.org_id
JOIN      task.roles           r ON r.id = mr.role_id;

GRANT SELECT ON lms.vw_member_roles, hr.vw_member_roles, task.vw_member_roles TO app_user;
GRANT SELECT ON lms.vw_member_roles, hr.vw_member_roles, task.vw_member_roles TO tenant_admin;


-- NOTE: iam.users.platform_role now lives directly in iam.users' CREATE
-- TABLE (02_schema.sql) -- originally added here via ALTER TABLE ... ADD
-- COLUMN IF NOT EXISTS.


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.11.0', 'P1.1 Phase A (expand): per-product role catalogs (lms/hr/task.roles) + grants (member_roles) with RLS + fn_member_rank + vw_member_roles + iam.users.platform_role (nullable); global iam.user_roles ladder untouched')
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ===================================================================
-- 19_init-per-product-db-grants.sql
--
-- P1.2 / D8 — Per-product DB role GRANTs. Today every service (leads,
-- hr, tasks) connects with a login that is a member of the single shared
-- `app_user` role and runs `SET LOCAL ROLE app_user` (see @platform/db's
-- withRoleTx), which grants access to EVERY schema app_user can touch —
-- lms, hr and task alike. `hr_svc` could physically read `lms.*` today.
-- This script closes that gap by giving each product service its own
-- direct, schema-scoped grants and making the app-layer skip the
-- `SET ROLE app_user` step for these three logins (see
-- packages/db/src/transaction.ts DB_PRODUCT_SCOPED_LOGIN).
--
-- Design (why this is safe even though hr_svc/task_svc/lms_svc remain
-- members of app_user):
--   - Row-Level-Security policies must NAME these roles explicitly. An
--     earlier version of this comment claimed a "TO app_user" policy matches
--     any member of app_user regardless of INHERIT; that is wrong. Postgres
--     decides policy applicability with the INHERIT-respecting check
--     (pg_has_role(role, 'app_user', 'USAGE')), not 'MEMBER'. Because every
--     login below is NOINHERIT, that check is FALSE, so no app_user policy
--     applied to any of them and every protected table returned ZERO rows --
--     silently, with no permission error, which made it surface as empty
--     module/tool lists rather than a failure. The tail of 06_rls.sql now
--     rewrites each policy to name the member roles alongside the role they
--     already target, which restores enforcement without granting privileges.
--   - Table-level privileges (SELECT/INSERT/UPDATE/DELETE) are NOT
--     automatically inherited through membership because these roles are
--     created NOINHERIT (same convention as lead_svc/hr_svc/task_svc
--     already use). They only have whatever is GRANTed to them directly
--     below — which is scoped to their own schema + a read-only slice of
--     the shared iam/entity/geo tables the product actually reads.
--   - Net effect: connect as hr_svc -> RLS still enforces tenant/org
--     isolation (via membership) AND hr_svc has zero privilege on
--     lms.*/task.* tables (never granted) -> product isolation is now
--     enforced at the GRANT level, not just by convention.
--
-- Scope: only the three product-operational logins (lms_svc / hr_svc /
-- task_svc — the "app_user pool" analogue). tenant_dash_svc (tenant_admin
-- pool) and root_service (BYPASSRLS) are unchanged — they are shared,
-- cross-product-by-design roles (tenant admin dashboards, internal
-- service jobs) and out of scope for this pass. identity-service /
-- notifications-service / admin-service / api-gateway keep using
-- lead_svc (unrestricted) for now — they are shared-repo/platform
-- services that legitimately manage iam/entity directly; re-plumbing
-- them is a separate, later concern.
--
-- Idempotent: CREATE ROLE guarded, GRANT/REVOKE are naturally idempotent.
-- Prerequisite: 01_init-db.sql, 10_init-hr-task-schemas.sql,
-- 11_init-leave-management.sql, 13_init-attendance.sql, 14_init-tasks.sql,
-- 17_init-per-product-roles.sql already applied.
-- ===================================================================

BEGIN;

-- ===================================================================
-- 1. lms_svc — new product login for the LMS product (leads-service,
-- meta-conversion-api). Mirrors the lead_svc/hr_svc/task_svc creation
-- pattern. lead_svc itself is left alone (still used, unrestricted, by
-- identity-service/notifications-service/admin-service/meta legacy path
-- until those are re-plumbed) — lms_svc is the new, scoped login that
-- leads-service and meta-conversion-api switch to.
-- ===================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_svc') THEN
    CREATE ROLE lms_svc WITH LOGIN PASSWORD 'LmsSvc_Dev2025' NOINHERIT;
  ELSE ALTER ROLE lms_svc WITH LOGIN PASSWORD 'LmsSvc_Dev2025' NOINHERIT; END IF;
END; $$;
-- Membership only (NOINHERIT role => no privilege leak) — satisfies every
-- RLS policy scoped "TO app_user" without needing SET ROLE. Mirrors the
-- `GRANT app_user TO hr_svc/task_svc` pattern from 10_init-hr-task-schemas.sql.
-- lms_svc does not use the tenant_admin pool (no DATABASE_URL_TENANT for
-- leads-service/meta-conversion-api), so it is not made a member of
-- tenant_admin — least privilege, nothing to gain from that membership today.
GRANT app_user TO lms_svc;

DO $$
DECLARE v_db TEXT := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lms_svc', v_db);
END; $$;

-- lms_svc write access to the 7 tenant-scoped LMS lookups (historically
-- `GRANT INSERT, UPDATE ON TABLE %s TO lms_svc` inside the per-table RLS loop
-- in 26_tenant-scope-lms-lookups.sql; moved here because lms_svc doesn't
-- exist yet when 02_schema.sql -- where those 7 tables are now created -- runs).
GRANT INSERT, UPDATE ON TABLE
  lms.lead_stage, lms.lead_stage_outcome, lms.interaction_types,
  lms.follow_up_statuses, lms.lead_sources,
  marketing.marketing_platforms, marketing.campaign_statuses
  TO lms_svc;


-- ===================================================================
-- 2. Schema USAGE — narrow every product login down to its own schema(s)
-- + the shared schemas it actually reads. hr_svc/task_svc previously got
-- blanket USAGE on every schema (10_init-hr-task-schemas.sql, run when
-- app_user was the only isolation mechanism); revoke that down now.
-- ===================================================================
REVOKE USAGE ON SCHEMA lms, marketing, ext, audit FROM hr_svc, task_svc;
REVOKE USAGE ON SCHEMA hr, task               FROM lms_svc;

GRANT USAGE ON SCHEMA public, iam, entity, geo, lms, marketing, ext TO lms_svc;
GRANT USAGE ON SCHEMA public, iam, entity, geo, hr                  TO hr_svc;
GRANT USAGE ON SCHEMA public, iam, entity, geo, task                TO task_svc;


-- ===================================================================
-- 3. Defense-in-depth — explicit REVOKE of all privileges on the OTHER
-- products' schemas. No-op today (nothing was ever GRANTed directly to
-- these roles on the wrong schema — they only ever had access via
-- SET ROLE app_user, which the app layer no longer does for them), but
-- this makes the isolation boundary an explicit, auditable statement
-- rather than an absence.
-- ===================================================================
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA hr, task            FROM lms_svc;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA hr, task            FROM lms_svc;
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA lms, marketing, ext FROM hr_svc, task_svc;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA lms, marketing, ext FROM hr_svc, task_svc;
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA hr                  FROM task_svc;
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA task                FROM hr_svc;


-- ===================================================================
-- 4. Shared schemas — READ-ONLY (D8: "read shared iam/entity/geo").
-- Two exceptions kept at SELECT+INSERT+UPDATE (iam.users,
-- iam.user_org_mapping) because product UIs today manage team-member
-- role assignment directly through these tables under app_user's
-- existing org_admin_manage_policy/org_admin_insert_policy/
-- org_admin_update_policy RLS policies (01_init-db.sql) — restricting
-- to read-only here would break existing "manage team" functionality in
-- every product. Revisit when P1.3 moves role assignment onto the
-- per-product member_roles tables (lms/hr/task.member_roles) exclusively.
-- ===================================================================
GRANT SELECT ON ALL TABLES IN SCHEMA geo, entity TO lms_svc, hr_svc, task_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA iam         TO lms_svc, hr_svc, task_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE iam.users, iam.user_org_mapping
  TO lms_svc, hr_svc, task_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA geo    GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA entity GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam    GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;


-- ===================================================================
-- 5. Own-schema DML — mirror exactly what app_user already has on each
-- product's own tables (same tiers as 01_init-db.sql / 10/11/13/14/17),
-- granted directly so it does not depend on SET ROLE app_user.
-- ===================================================================

-- ── lms_svc: lms / marketing / ext ─────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON TABLE
  lms.marketing_leads, lms.lead_interactions, lms.lead_follow_ups, marketing.ad_campaigns
  TO lms_svc;

GRANT SELECT ON TABLE
  lms.lead_stage, lms.lead_stage_outcome, lms.interaction_types, lms.follow_up_statuses,
  lms.lead_sources, marketing.marketing_platforms, marketing.campaign_statuses,
  lms.lead_assignment_log, lms.lead_status_log, audit.marketing_leads_history, audit.audit_log,
  lms.vw_dashboard_leads, lms.vw_lead_followup_timeline, lms.vw_lead_assignment_timeline,
  lms.vw_sales_follow_up_pipeline, lms.vw_followup_pipeline_enriched, lms.vw_org_performance_snapshot,
  lms.vw_rep_performance, marketing.vw_campaign_lookup,
  iam.vw_user_org_chart, iam.vw_user_team_members, iam.vw_user_org_access
  TO lms_svc;

GRANT SELECT, INSERT, UPDATE ON TABLE lms.lead_links TO lms_svc;
-- iam.api_clients / iam.api_client_orgs (N-4, moved from ext) are managed
-- exclusively by identity-service; lms_svc's blanket `SELECT ON ALL TABLES IN
-- SCHEMA iam` above already covers any incidental read, no product-specific
-- write grant needed.
GRANT EXECUTE ON FUNCTION iam.can_assign_to(UUID,UUID,UUID) TO lms_svc;

-- lms per-product role model (P1.1)
GRANT SELECT                 ON TABLE lms.roles         TO lms_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE lms.member_roles  TO lms_svc;
GRANT SELECT                 ON TABLE lms.vw_member_roles TO lms_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA lms       GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketing GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ext       GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;

-- ── hr_svc: hr ──────────────────────────────────────────────────────
GRANT SELECT         ON TABLE hr.employment_types, hr.leave_types, hr.leave_request_statuses, hr.attendance_statuses TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.departments, hr.designations, hr.employee_profiles TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.holiday_calendars, hr.holidays TO hr_svc;
GRANT SELECT                 ON TABLE hr.leave_policies, hr.hr_settings TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.leave_requests, hr.leave_request_approvals TO hr_svc;
GRANT SELECT                 ON TABLE hr.leave_request_status_log, hr.leave_ledger TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.attendance_rules, hr.shifts, hr.shift_assignments, hr.attendance_regularizations TO hr_svc;
GRANT SELECT, INSERT         ON TABLE hr.attendance_events TO hr_svc;
GRANT SELECT                 ON TABLE hr.attendance_days TO hr_svc;
GRANT SELECT ON TABLE
  hr.vw_leave_balances, hr.vw_leave_requests_enriched, hr.vw_team_leave_calendar,
  hr.vw_attendance_monthly_summary, hr.vw_org_attendance_today
  TO hr_svc;

-- hr per-product role model (P1.1)
GRANT SELECT                 ON TABLE hr.roles         TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.member_roles  TO hr_svc;
GRANT SELECT                 ON TABLE hr.vw_member_roles TO hr_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA hr GRANT SELECT, INSERT, UPDATE ON TABLES TO hr_svc;

-- ── task_svc: task ──────────────────────────────────────────────────
GRANT SELECT                 ON TABLE task.task_statuses, task.task_priorities TO task_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE task.task_lists, task.tasks TO task_svc;
GRANT SELECT                 ON TABLE task.task_status_log TO task_svc;
GRANT SELECT, INSERT         ON TABLE task.task_comments TO task_svc;
GRANT SELECT                 ON TABLE task.vw_tasks_enriched TO task_svc;

-- task per-product role model (P1.1)
GRANT SELECT                 ON TABLE task.roles         TO task_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE task.member_roles  TO task_svc;
GRANT SELECT                 ON TABLE task.vw_member_roles TO task_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA task GRANT SELECT, INSERT, UPDATE ON TABLES TO task_svc;


-- ===================================================================
-- 6. entity.tenant_modules — every product reads its own tenant's
-- entitlements (already SELECT-granted to app_user broadly above via
-- ALL TABLES IN SCHEMA entity; kept explicit here for clarity since it
-- is the one entity table every product genuinely depends on).
-- ===================================================================
-- (covered by step 4's `GRANT SELECT ON ALL TABLES IN SCHEMA entity`)


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.13.0', 'P1.2/D8: per-product DB role GRANTs — new lms_svc login; hr_svc/task_svc narrowed from blanket schema USAGE to own-schema DML + read-only iam/entity/geo; cross-product access explicitly revoked')
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ===================================================================
-- 20_member-role-resolver-fn.sql
--
-- P1.3 — per-product role RESOLVER. Each product service (leads/hr/tasks)
-- must resolve the acting user's PRODUCT role name + rank from its own
-- <product>.member_roles table instead of trusting a rank header from the
-- (now shrunk) JWT. fn_member_rank (script 17) returns only the rank; the
-- authz packages also need the role NAME (e.g. 'hr_admin'), so this adds a
-- sibling that returns both.
--
-- SECURITY DEFINER (like fn_member_rank / iam.fn_user_org_rank) so the
-- resolver bypasses member_roles RLS and can be called by app_user with no
-- session GUCs set. Returns (NULL, -1) when the user has no active grant in
-- that product+org — which the service treats as "not a member" (403).
--
-- Idempotent: CREATE OR REPLACE. Style mirrors iam.fn_user_org_rank in
-- db_scripts/01_init-db.sql and the fn_member_rank helpers in script 17.
-- ===================================================================

BEGIN;

CREATE OR REPLACE FUNCTION lms.fn_member_role(p_user_id UUID, p_org_id UUID)
RETURNS TABLE(role TEXT, rank INT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.name, r.rank
  FROM lms.member_roles mr
  JOIN lms.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  UNION ALL
  SELECT NULL::text, -1
  WHERE NOT EXISTS (
    SELECT 1 FROM lms.member_roles mr
    WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  )
$$;

CREATE OR REPLACE FUNCTION hr.fn_member_role(p_user_id UUID, p_org_id UUID)
RETURNS TABLE(role TEXT, rank INT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.name, r.rank
  FROM hr.member_roles mr
  JOIN hr.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  UNION ALL
  SELECT NULL::text, -1
  WHERE NOT EXISTS (
    SELECT 1 FROM hr.member_roles mr
    WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  )
$$;

CREATE OR REPLACE FUNCTION task.fn_member_role(p_user_id UUID, p_org_id UUID)
RETURNS TABLE(role TEXT, rank INT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.name, r.rank
  FROM task.member_roles mr
  JOIN task.roles r ON r.id = mr.role_id
  WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  UNION ALL
  SELECT NULL::text, -1
  WHERE NOT EXISTS (
    SELECT 1 FROM task.member_roles mr
    WHERE mr.user_id = p_user_id AND mr.org_id = p_org_id AND mr.is_active
  )
$$;

-- EXECUTE grants — the resolver runs on each caller's own login role (the *_svc
-- logins are NOINHERIT, so an app_user-only grant would NOT reach them via
-- membership without SET ROLE). Grant directly to every login that resolves that
-- product's rank, plus app_user/tenant_admin for SET ROLE paths. Mirrors the
-- explicit EXECUTE grants on iam.fn_user_org_rank (script 01).
--   lms.fn_member_role  → lms_svc (leads/meta), lead_svc (gateway + notifications)
--   hr.fn_member_role   → hr_svc
--   task.fn_member_role → task_svc
GRANT EXECUTE ON FUNCTION lms.fn_member_role(UUID, UUID)  TO app_user, tenant_admin, lms_svc, lead_svc;
GRANT EXECUTE ON FUNCTION hr.fn_member_role(UUID, UUID)   TO app_user, tenant_admin, hr_svc;
GRANT EXECUTE ON FUNCTION task.fn_member_role(UUID, UUID) TO app_user, tenant_admin, task_svc;

-- ===================================================================
-- readonly_user membership for every app-pool login (P0 #1 defense-in-depth)
--
-- withRoleTx does `SET LOCAL ROLE readonly_user` for read_only actors. A login
-- may only SET ROLE to a role it is a member of, so grant readonly_user to every
-- login that can currently become app_user. Done dynamically so future *_svc
-- logins are covered without editing this list. readonly_user is itself a member
-- of app_user (see 01) and is excluded.
-- ===================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT m.rolname
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
    WHERE g.rolname = 'app_user' AND m.rolname <> 'readonly_user'
  LOOP
    EXECUTE format('GRANT readonly_user TO %I', r.rolname);
  END LOOP;
END $$;

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.14.0', 'P1.3: <product>.fn_member_role(user,org) -> (role,rank) resolver for per-service product-role resolution')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.15.0', 'P0 #1: readonly_user role (INHERITs app_user) + read-only transaction for read_only actors')
ON CONFLICT (version) DO NOTHING;

COMMIT;
