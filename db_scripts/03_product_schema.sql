-- ===================================================================
-- 03_product_schema.sql
-- Consolidated DDL (3/6): the FULL hr + task product schema union --
--   * hr/task foundation (entity.tenant_modules, HR lookups,
--     hr.departments/designations, hr.employee_profiles)  [once]
--   * leave management (+ leave_ledger idempotency)
--   * attendance (geofencing / shifts / regularizations)
--   * reporting lines
--   * the complete task.* model (task_lists, tasks, task_status_log,
--     task_comments, views)
-- The lookup tables tenant-scoped by the historical 22_tenant-scope-lookups.sql
-- carry tenant_id + their org/tenant SELECT policies directly in their CREATE
-- TABLE here: hr.leave_types / hr.employment_types / hr.attendance_statuses /
-- task.task_statuses / task.task_priorities (lms.roles / hr.roles / task.roles
-- live in 04_roles_and_grants.sql).
-- entity.organizations.geo_lat/geo_lng (historically an ALTER in
-- 13_init-attendance.sql) now lives in 02_schema.sql.
-- Idempotent: safe to re-run.
-- ===================================================================

-- ===================================================================
-- CRM Monorepo — HR + Task Platform Foundation (Phase 0, DB layer only)
-- Adds: hr + task schemas, hr_svc/task_svc login roles,
--       entity.tenant_modules (module entitlements),
--       HR global lookups, org-scoped hr.departments / hr.designations,
--       hr.employee_profiles (IAM↔HR bridge, incl. dormant face-verify cols).
-- Prerequisite: 01_init-db.sql + 01_init-lookup-data.sql already applied.
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING /
--             guarded DO blocks / DROP+CREATE for triggers & policies).
-- Style, guard patterns and ordering mirror db_scripts/01_init-db.sql.
-- No existing table, trigger or policy is modified.
-- ===================================================================


-- ── Schemas ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS task;   -- no tables yet — populated in a later increment


-- ===================================================================
-- NEW SERVICE LOGIN ROLES  (per-microservice credentials, via app_user)
-- Mirrors the lead_svc / meta_svc setup in 01_init-db.sql: each service
-- connects with its own login role, then does SET LOCAL ROLE app_user +
-- session GUCs so RLS + app_user grants apply.
-- ===================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr_svc') THEN
    CREATE ROLE hr_svc WITH LOGIN PASSWORD 'HrSvc_Dev2025' NOINHERIT;
  ELSE ALTER ROLE hr_svc WITH LOGIN PASSWORD 'HrSvc_Dev2025' NOINHERIT; END IF;
END; $$;
GRANT app_user TO hr_svc;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'task_svc') THEN
    CREATE ROLE task_svc WITH LOGIN PASSWORD 'TaskSvc_Dev2025' NOINHERIT;
  ELSE ALTER ROLE task_svc WITH LOGIN PASSWORD 'TaskSvc_Dev2025' NOINHERIT; END IF;
END; $$;
GRANT app_user TO task_svc;


-- ── Schema USAGE grants ────────────────────────────────────────────
-- New schemas usable by the standard subject roles + service superuser,
-- matching the "GRANT USAGE ON SCHEMA ..." block in 01_init-db.sql.
GRANT USAGE ON SCHEMA hr   TO app_user, tenant_admin, root_service;
GRANT USAGE ON SCHEMA task TO app_user, tenant_admin, root_service;

-- New service roles need USAGE on every schema they touch (they SET ROLE
-- app_user at runtime, but still connect as themselves first).
DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','geo','entity','iam','lms','marketing','audit','ext','hr','task'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO hr_svc, task_svc', s);
  END LOOP;
END; $$;

DO $$
DECLARE v_db TEXT := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO hr_svc',   v_db);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO task_svc', v_db);
END; $$;

-- root_service: unrestricted on the two new schemas + default privileges for
-- future tables. app_user / tenant_admin get SELECT-by-default (explicit DML
-- grants are declared per-table below, like every operational table in 01).
DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['hr','task'] LOOP
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA %I TO root_service', s);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I TO root_service', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL PRIVILEGES ON TABLES    TO root_service', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL PRIVILEGES ON SEQUENCES TO root_service', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO app_user', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO tenant_admin', s);
  END LOOP;
END; $$;


-- ===================================================================
-- entity.tenant_modules — per-tenant module entitlements (§4.4)
-- Gates which platform modules (crm | leave | attendance | tasks) a tenant
-- has licensed. Only root_service writes; tenant_admin + app_user read (so a
-- service can check entitlement for its current org's tenant).
-- ===================================================================
CREATE TABLE IF NOT EXISTS entity.tenant_modules (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  module      TEXT    NOT NULL CHECK (module IN ('lms','leave','attendance','tasks')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  enabled_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT uq_tenant_modules_tenant_module UNIQUE (tenant_id, module)
);

DROP TRIGGER IF EXISTS trg_tenant_modules_updated_at ON entity.tenant_modules;
CREATE TRIGGER trg_tenant_modules_updated_at
  BEFORE UPDATE ON entity.tenant_modules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant
  ON entity.tenant_modules (tenant_id) WHERE is_active;

ALTER TABLE entity.tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity.tenant_modules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON entity.tenant_modules;
DROP POLICY IF EXISTS org_isolation_policy    ON entity.tenant_modules;

-- tenant_admin: SELECT own tenant's rows.
CREATE POLICY tenant_isolation_policy ON entity.tenant_modules
  AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- app_user: SELECT rows for the tenant owning their current org. app_user
-- sessions never set app.current_tenant_id (see withRoleTx), so tenant is
-- derived from the current org — same convention as iam.api_clients in 01.
CREATE POLICY org_isolation_policy ON entity.tenant_modules
  AS PERMISSIVE FOR SELECT TO app_user
  USING (
    tenant_id = (
      SELECT tenant_id FROM entity.organizations
      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );

GRANT SELECT          ON entity.tenant_modules TO app_user;
GRANT SELECT          ON entity.tenant_modules TO tenant_admin;
GRANT ALL PRIVILEGES  ON entity.tenant_modules TO root_service;

-- Seed: every existing tenant gets an active 'lms' entitlement.
INSERT INTO entity.tenant_modules (tenant_id, module)
SELECT id, 'lms' FROM entity.tenants
ON CONFLICT (tenant_id, module) DO NOTHING;


-- ===================================================================
-- HR GLOBAL LOOKUP TABLES  (UUID PKs, same shape as lms.lead_stage — no RLS)
-- Managed globally (admin-service slugs); readable by every subject role.
-- ===================================================================

-- employment_types / leave_types / attendance_statuses are tenant-scoped
-- (historically added via 22_tenant-scope-lookups.sql ALTER; folded directly
-- into the CREATE TABLE here). No un-scoped seed INSERT: per-tenant default
-- rows are provisioned by entity.seed_tenant_defaults() (05_catalogs.sql) at
-- tenant-creation time, not at DDL time (no tenant exists yet when this
-- script runs). hr.leave_request_statuses is explicitly NOT tenant-scoped
-- (per 22's original scope note) and keeps its global seed data.
CREATE TABLE IF NOT EXISTS hr.employment_types (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_employment_types_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE hr.employment_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.employment_types;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.employment_types;
CREATE POLICY org_isolation_policy ON hr.employment_types AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON hr.employment_types AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS hr.leave_types (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  is_paid     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_leave_types_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE hr.leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_types;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_types;
CREATE POLICY org_isolation_policy ON hr.leave_types AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON hr.leave_types AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS hr.leave_request_statuses (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  name        TEXT    NOT NULL UNIQUE,
  label       TEXT    NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS hr.attendance_statuses (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_attendance_statuses_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE hr.attendance_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.attendance_statuses;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.attendance_statuses;
CREATE POLICY org_isolation_policy ON hr.attendance_statuses AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON hr.attendance_statuses AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Lookup grants ──────────────────────────────────────────────────
GRANT SELECT         ON hr.employment_types, hr.leave_types, hr.leave_request_statuses, hr.attendance_statuses TO app_user;
GRANT SELECT         ON hr.employment_types, hr.leave_types, hr.leave_request_statuses, hr.attendance_statuses TO tenant_admin;
GRANT ALL PRIVILEGES ON hr.employment_types, hr.leave_types, hr.leave_request_statuses, hr.attendance_statuses TO root_service;

-- ── Lookup seed data (hr.leave_request_statuses only — global, not tenant-scoped) ──
INSERT INTO hr.leave_request_statuses (name, label) VALUES
  ('draft',     'Draft'),
  ('pending',   'Pending'),
  ('approved',  'Approved'),
  ('rejected',  'Rejected'),
  ('cancelled', 'Cancelled'),
  ('withdrawn', 'Withdrawn')
ON CONFLICT (name) DO NOTHING;


-- ===================================================================
-- ORG-SCOPED HR REFERENCE TABLES
-- Standard operational-table recipe (copied from marketing.ad_campaigns):
-- UUIDv7 PK, org_id FK, soft-delete + audit columns, set_updated_at +
-- soft_delete_row + set_org_id + set_created_by + audit_row_changes triggers,
-- org_isolation_policy + tenant_isolation_policy RLS.
-- ===================================================================

-- ── hr.departments → MOVED to iam.departments (Tier C) ─────────────
-- Departments now live in IAM (see db_scripts/02_schema.sql: iam.departments),
-- tenant-scoped, so roles in every product can belong to a department.
-- hr.employee_profiles.department_id below references iam.departments.

-- ── hr.designations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.designations (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id      UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_designations_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_designations_updated_at        ON hr.designations;
CREATE TRIGGER trg_designations_updated_at
  BEFORE UPDATE ON hr.designations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_designations_soft_delete       ON hr.designations;
CREATE TRIGGER trg_designations_soft_delete
  BEFORE DELETE ON hr.designations FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_designations_set_org_id     ON hr.designations;
CREATE TRIGGER trg_00_designations_set_org_id
  BEFORE INSERT ON hr.designations FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_designations_set_created_by ON hr.designations;
CREATE TRIGGER trg_01_designations_set_created_by
  BEFORE INSERT ON hr.designations FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_designations_audit             ON hr.designations;
CREATE TRIGGER trg_designations_audit
  AFTER UPDATE OR DELETE ON hr.designations FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_designations_org
  ON hr.designations (org_id) WHERE NOT is_deleted;
CREATE UNIQUE INDEX IF NOT EXISTS uix_designations_org_name
  ON hr.designations (org_id, name) WHERE NOT is_deleted;

ALTER TABLE hr.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.designations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.designations;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.designations;
CREATE POLICY org_isolation_policy ON hr.designations AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.designations AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.designations TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.designations TO tenant_admin;
REVOKE DELETE                ON hr.designations FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.designations TO root_service;


-- ===================================================================
-- hr.employee_profiles — the IAM ↔ HR bridge (§4.1)
-- 1:1 with iam.users (PK = user_id). Holds employment facts; keeps
-- iam.users pure (auth + hierarchy). tenant_id is denormalized and kept
-- consistent with org_id by a BEFORE trigger so employee_code can be made
-- unique per tenant (a joined-scope index isn't possible).
-- Face-verification columns are created now but stay dormant until Prompt 11.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.employee_profiles (
  user_id             UUID    PRIMARY KEY REFERENCES iam.users(id)            ON DELETE RESTRICT,
  org_id              UUID    NOT NULL    REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  -- denormalized from entity.organizations.tenant_id via trigger (see below);
  -- exists solely to enforce employee_code uniqueness per tenant.
  tenant_id           UUID    NOT NULL    REFERENCES entity.tenants(id)       ON DELETE RESTRICT,
  employee_code       TEXT,
  date_of_joining     DATE    NOT NULL,
  date_of_exit        DATE,
  employment_type_id  UUID    REFERENCES hr.employment_types(id) ON DELETE RESTRICT,
  department_id       UUID    REFERENCES iam.departments(id)     ON DELETE RESTRICT,
  designation_id      UUID    REFERENCES hr.designations(id)     ON DELETE RESTRICT,
  probation_end_date  DATE,
  -- days of week off, 0=Sunday .. 6=Saturday; overridable by shift assignment
  weekly_off_pattern  SMALLINT[] NOT NULL DEFAULT '{0,6}',
  metadata            JSONB   NOT NULL DEFAULT '{}',
  -- ── Face-verification enrollment (dormant until Prompt 11) ──
  reference_photo_url TEXT,
  face_subject_id     TEXT,
  face_enrolled_at    TIMESTAMPTZ,
  face_consent_at     TIMESTAMPTZ,
  -- ── standard soft-delete / audit ──
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_employee_profiles_exit_after_joining
    CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining),
  CONSTRAINT chk_employee_profiles_active_deleted CHECK (NOT (is_active AND is_deleted))
);

-- Resolve tenant_id from the row's org_id, keeping the two consistent.
-- Runs after set_org_id (trg_00) has populated org_id from the GUC.
CREATE OR REPLACE FUNCTION hr.set_employee_profile_tenant_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM entity.organizations WHERE id = NEW.org_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'employee_profiles: cannot resolve tenant_id for org_id %', NEW.org_id;
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

-- Soft-delete keyed on user_id (public.soft_delete_row assumes an `id`
-- column, which this table does not have). Mirrors its behavior otherwise.
CREATE OR REPLACE FUNCTION hr.soft_delete_employee_profile()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_user_id UUID;
BEGIN
  IF current_user = 'root_service' THEN RETURN OLD; END IF;
  BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_user_id := NULL; END;
  UPDATE hr.employee_profiles
     SET is_active = FALSE, is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = v_user_id
   WHERE user_id = OLD.user_id;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_employee_profiles_updated_at         ON hr.employee_profiles;
CREATE TRIGGER trg_employee_profiles_updated_at
  BEFORE UPDATE ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_employee_profiles_soft_delete        ON hr.employee_profiles;
CREATE TRIGGER trg_employee_profiles_soft_delete
  BEFORE DELETE ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION hr.soft_delete_employee_profile();

DROP TRIGGER IF EXISTS trg_00_employee_profiles_set_org_id      ON hr.employee_profiles;
CREATE TRIGGER trg_00_employee_profiles_set_org_id
  BEFORE INSERT ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_employee_profiles_set_created_by  ON hr.employee_profiles;
CREATE TRIGGER trg_01_employee_profiles_set_created_by
  BEFORE INSERT ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_02_employee_profiles_set_tenant_id   ON hr.employee_profiles;
CREATE TRIGGER trg_02_employee_profiles_set_tenant_id
  BEFORE INSERT OR UPDATE ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION hr.set_employee_profile_tenant_id();

DROP TRIGGER IF EXISTS trg_employee_profiles_audit              ON hr.employee_profiles;
CREATE TRIGGER trg_employee_profiles_audit
  AFTER UPDATE OR DELETE ON hr.employee_profiles FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_employee_profiles_org
  ON hr.employee_profiles (org_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_tenant
  ON hr.employee_profiles (tenant_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_department
  ON hr.employee_profiles (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_designation
  ON hr.employee_profiles (designation_id) WHERE designation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_employment_type
  ON hr.employee_profiles (employment_type_id) WHERE employment_type_id IS NOT NULL;

-- employee_code unique per tenant, among non-deleted rows that have a code.
CREATE UNIQUE INDEX IF NOT EXISTS uix_employee_profiles_tenant_code
  ON hr.employee_profiles (tenant_id, employee_code)
  WHERE employee_code IS NOT NULL AND NOT is_deleted;

ALTER TABLE hr.employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.employee_profiles;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.employee_profiles;
DROP POLICY IF EXISTS self_read_policy        ON hr.employee_profiles;

CREATE POLICY org_isolation_policy ON hr.employee_profiles AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.employee_profiles AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

-- Self-read: any authenticated app_user may read their own profile row
-- regardless of the org currently in context. PERMISSIVE → OR-combined with
-- org_isolation_policy for SELECT.
CREATE POLICY self_read_policy ON hr.employee_profiles AS PERMISSIVE FOR SELECT TO app_user
  USING (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.employee_profiles TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.employee_profiles TO tenant_admin;
REVOKE DELETE                ON hr.employee_profiles FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.employee_profiles TO root_service;


-- ===================================================================
-- ROLE SEED — hr_admin (rank 75). Canonical seed also lives in
-- 01_init-lookup-data.sql; repeated here idempotently so this migration is
-- self-contained. See Platform_Expansion_Plan.md §2.5 / §6.3.
-- ===================================================================
-- hr_admin is a global (tenant_id NULL) default role; Tier C made the name
-- unique index partial, so the conflict target names the anchor predicate.
INSERT INTO iam.user_roles (name, label, description, rank) VALUES
  ('hr_admin', 'HR Admin', 'Manages HR — employee profiles, leave policies, attendance; no CRM/lead access', 75)
ON CONFLICT (name) WHERE tenant_id IS NULL DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  rank        = EXCLUDED.rank;


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- NOTE: prompt requested '1.3.0', but 1.3.0 and 1.4.0 are already consumed by
-- the Meta CAPI work in 01_init-lookup-data.sql — using the next free version.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.5.0', 'hr/task schemas, hr_svc/task_svc roles, entity.tenant_modules, HR lookups, hr.departments/designations, hr.employee_profiles, hr_admin role')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- CRM Monorepo — Leave Management (Phase 1, DB layer)
-- Adds the complete hr.* leave-management model:
--   holiday_calendars / holidays, leave_policies, hr_settings,
--   leave_ledger (append-only), leave_requests (+ status log),
--   leave_request_approvals, hr.can_approve_leave(), and the
--   dashboard views (vw_leave_balances / vw_leave_requests_enriched /
--   vw_team_leave_calendar).
-- Prerequisite: 01_init-db.sql + 01_init-lookup-data.sql + 10_init-hr-task-schemas.sql
--               (hr schema, hr_svc role, HR lookups, employee_profiles).
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING /
--             guarded DO blocks / DROP+CREATE for triggers & policies).
-- Style, guard patterns, trigger recipe and RLS mirror db_scripts/01 and 10.
-- Operational tables use the marketing.ad_campaigns recipe; append-only logs
-- (leave_ledger, leave_request_status_log) mirror lms.lead_status_log.
-- No existing table, trigger or policy is modified except the note below:
--   hr.leave_ledger.leave_request_id FK depends on hr.leave_requests, so
--   leave_requests DDL is emitted before leave_ledger.
-- ===================================================================


-- ── Extensions ─────────────────────────────────────────────────────
-- btree_gist lets an exclusion constraint mix equality (user_id) with a
-- range overlap (daterange) — used for the no-overlapping-leave guard.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ===================================================================
-- 1. hr.holiday_calendars — org-scoped operational table
--    Standard recipe (marketing.ad_campaigns): UUIDv7 PK, org_id FK,
--    soft-delete + audit, set_updated_at / soft_delete_row / set_org_id /
--    set_created_by / audit_row_changes triggers, org + tenant RLS.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.holiday_calendars (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id      UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL,
  year        INT     NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_holiday_calendars_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_holiday_calendars_updated_at        ON hr.holiday_calendars;
CREATE TRIGGER trg_holiday_calendars_updated_at
  BEFORE UPDATE ON hr.holiday_calendars FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_holiday_calendars_soft_delete       ON hr.holiday_calendars;
CREATE TRIGGER trg_holiday_calendars_soft_delete
  BEFORE DELETE ON hr.holiday_calendars FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_holiday_calendars_set_org_id     ON hr.holiday_calendars;
CREATE TRIGGER trg_00_holiday_calendars_set_org_id
  BEFORE INSERT ON hr.holiday_calendars FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_holiday_calendars_set_created_by ON hr.holiday_calendars;
CREATE TRIGGER trg_01_holiday_calendars_set_created_by
  BEFORE INSERT ON hr.holiday_calendars FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_holiday_calendars_audit             ON hr.holiday_calendars;
CREATE TRIGGER trg_holiday_calendars_audit
  AFTER UPDATE OR DELETE ON hr.holiday_calendars FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_holiday_calendars_org
  ON hr.holiday_calendars (org_id) WHERE NOT is_deleted;
CREATE UNIQUE INDEX IF NOT EXISTS uix_holiday_calendars_org_name_year
  ON hr.holiday_calendars (org_id, name, year) WHERE NOT is_deleted;

ALTER TABLE hr.holiday_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.holiday_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.holiday_calendars;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.holiday_calendars;
CREATE POLICY org_isolation_policy ON hr.holiday_calendars AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.holiday_calendars AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.holiday_calendars TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.holiday_calendars TO tenant_admin;
REVOKE DELETE                ON hr.holiday_calendars FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.holiday_calendars TO root_service;


-- ── hr.holidays ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.holidays (
  id            UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  calendar_id   UUID    NOT NULL REFERENCES hr.holiday_calendars(id) ON DELETE CASCADE,
  org_id        UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  holiday_date  DATE    NOT NULL,
  name          TEXT    NOT NULL,
  is_optional   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_holidays_active_deleted CHECK (NOT (is_active AND is_deleted)),
  CONSTRAINT uq_holidays_calendar_date   UNIQUE (calendar_id, holiday_date)
);

DROP TRIGGER IF EXISTS trg_holidays_updated_at        ON hr.holidays;
CREATE TRIGGER trg_holidays_updated_at
  BEFORE UPDATE ON hr.holidays FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_holidays_soft_delete       ON hr.holidays;
CREATE TRIGGER trg_holidays_soft_delete
  BEFORE DELETE ON hr.holidays FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_holidays_set_org_id     ON hr.holidays;
CREATE TRIGGER trg_00_holidays_set_org_id
  BEFORE INSERT ON hr.holidays FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_holidays_set_created_by ON hr.holidays;
CREATE TRIGGER trg_01_holidays_set_created_by
  BEFORE INSERT ON hr.holidays FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_holidays_audit             ON hr.holidays;
CREATE TRIGGER trg_holidays_audit
  AFTER UPDATE OR DELETE ON hr.holidays FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_holidays_calendar
  ON hr.holidays (calendar_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_holidays_org_date
  ON hr.holidays (org_id, holiday_date) WHERE NOT is_deleted;

ALTER TABLE hr.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.holidays FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.holidays;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.holidays;
CREATE POLICY org_isolation_policy ON hr.holidays AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.holidays AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.holidays TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.holidays TO tenant_admin;
REVOKE DELETE                ON hr.holidays FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.holidays TO root_service;


-- ===================================================================
-- 2. hr.leave_policies — per (tenant, org?, leave_type) rules (§4.2)
--    org_id NULL = tenant-wide default; an org row overrides it. Effective-
--    dated by applicable_from (new row per revision, never mutate history).
--    Writes are restricted to the tenant_admin RLS role; the app layer will
--    ALSO gate policy management to hr_admin / org_admin via serviceDb.
--    NB: no set_org_id trigger — org_id is intentionally nullable here.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.leave_policies (
  id                            UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id                     UUID    NOT NULL REFERENCES entity.tenants(id)       ON DELETE CASCADE,
  org_id                        UUID    REFERENCES entity.organizations(id)          ON DELETE CASCADE,
  leave_type_id                 UUID    NOT NULL REFERENCES hr.leave_types(id)       ON DELETE RESTRICT,
  accrual_frequency             TEXT    NOT NULL DEFAULT 'none'
                                          CHECK (accrual_frequency IN ('monthly','quarterly','yearly','none')),
  accrual_amount                NUMERIC(5,2) NOT NULL DEFAULT 0,
  max_balance                   NUMERIC(5,2),
  carry_forward                 BOOLEAN NOT NULL DEFAULT FALSE,
  max_carry_forward             NUMERIC(5,2),
  max_consecutive_days          SMALLINT,
  min_notice_days               SMALLINT NOT NULL DEFAULT 0,
  allow_half_day                BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document_after_days  SMALLINT,
  -- Approval depth: any value >= 1. The approver chain walks manager_id upward
  -- N levels; a chain shorter than N terminates at the highest available
  -- manager (org_admin / hr_admin fallback). See Platform_Expansion_Plan §4.2.
  approval_levels               SMALLINT NOT NULL DEFAULT 1 CHECK (approval_levels >= 1),
  applicable_from               DATE    NOT NULL,
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted                    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at                    TIMESTAMPTZ,
  deleted_by                    UUID,
  created_by                    UUID,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_leave_policies_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_leave_policies_updated_at        ON hr.leave_policies;
CREATE TRIGGER trg_leave_policies_updated_at
  BEFORE UPDATE ON hr.leave_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_leave_policies_soft_delete       ON hr.leave_policies;
CREATE TRIGGER trg_leave_policies_soft_delete
  BEFORE DELETE ON hr.leave_policies FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_leave_policies_set_created_by  ON hr.leave_policies;
CREATE TRIGGER trg_01_leave_policies_set_created_by
  BEFORE INSERT ON hr.leave_policies FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_leave_policies_audit             ON hr.leave_policies;
CREATE TRIGGER trg_leave_policies_audit
  AFTER UPDATE OR DELETE ON hr.leave_policies FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_leave_policies_tenant
  ON hr.leave_policies (tenant_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_leave_policies_org
  ON hr.leave_policies (org_id) WHERE org_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_leave_policies_leave_type
  ON hr.leave_policies (leave_type_id) WHERE NOT is_deleted;

-- One effective-dated policy row per (tenant, org|tenant-wide, leave_type,
-- applicable_from). COALESCE folds the tenant-wide NULL org into the zero-uuid
-- so a tenant default and an org override never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uix_leave_policies_scope_type_from
  ON hr.leave_policies (
    tenant_id,
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    leave_type_id,
    applicable_from
  ) WHERE NOT is_deleted;

ALTER TABLE hr.leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_policies;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_policies;

-- app_user: SELECT-only. Any user in the tenant may read the tenant's policies
-- (tenant resolved from their current org, mirroring entity.tenant_modules).
CREATE POLICY org_isolation_policy ON hr.leave_policies AS PERMISSIVE FOR SELECT TO app_user
  USING (
    NOT is_deleted
    AND tenant_id = (
      SELECT tenant_id FROM entity.organizations
      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );

-- tenant_admin: full DML within their tenant. hr_admin / org_admin are gated at
-- the app layer via serviceDb (they connect as app_user, which is read-only here).
CREATE POLICY tenant_isolation_policy ON hr.leave_policies AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted);

GRANT SELECT                 ON hr.leave_policies TO app_user;
REVOKE INSERT, UPDATE, DELETE ON hr.leave_policies FROM app_user;
GRANT SELECT, INSERT, UPDATE ON hr.leave_policies TO tenant_admin;
REVOKE DELETE                ON hr.leave_policies FROM tenant_admin;
GRANT ALL PRIVILEGES         ON hr.leave_policies TO root_service;


-- ===================================================================
-- 2b. hr.hr_settings — leave-cycle configuration (§4.2)
--     tenant-wide default (org_id NULL), org row overrides. Read by every
--     app_user in the tenant; written via the service path.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.hr_settings (
  id                       UUID     PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id                UUID     NOT NULL REFERENCES entity.tenants(id)        ON DELETE CASCADE,
  org_id                   UUID     REFERENCES entity.organizations(id)           ON DELETE CASCADE,
  -- 4 = April–March financial year (India FY default)
  leave_cycle_start_month  SMALLINT NOT NULL DEFAULT 4
                                      CHECK (leave_cycle_start_month BETWEEN 1 AND 12),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_hr_settings_updated_at ON hr.hr_settings;
CREATE TRIGGER trg_hr_settings_updated_at
  BEFORE UPDATE ON hr.hr_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uix_hr_settings_scope
  ON hr.hr_settings (
    tenant_id,
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE hr.hr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.hr_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.hr_settings;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.hr_settings;

CREATE POLICY org_isolation_policy ON hr.hr_settings AS PERMISSIVE FOR SELECT TO app_user
  USING (
    tenant_id = (
      SELECT tenant_id FROM entity.organizations
      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );

CREATE POLICY tenant_isolation_policy ON hr.hr_settings AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);

GRANT SELECT                 ON hr.hr_settings TO app_user;
REVOKE INSERT, UPDATE, DELETE ON hr.hr_settings FROM app_user;
GRANT SELECT, INSERT, UPDATE ON hr.hr_settings TO tenant_admin;
REVOKE DELETE                ON hr.hr_settings FROM tenant_admin;
GRANT ALL PRIVILEGES         ON hr.hr_settings TO root_service;

-- Seed one tenant-wide default row (month 4) per existing tenant.
INSERT INTO hr.hr_settings (tenant_id, org_id, leave_cycle_start_month)
SELECT id, NULL, 4 FROM entity.tenants
ON CONFLICT DO NOTHING;


-- ===================================================================
-- 4. hr.leave_requests — emitted BEFORE hr.leave_ledger because the ledger's
--    leave_request_id FK references this table (§3 note). Standard operational
--    recipe + a self policy (users always see & insert their own requests) +
--    an is_open exclusion guard against overlapping active requests.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.leave_requests (
  id            UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id       UUID    NOT NULL REFERENCES iam.users(id)                   ON DELETE RESTRICT,
  org_id        UUID    NOT NULL REFERENCES entity.organizations(id)        ON DELETE RESTRICT,
  leave_type_id UUID    NOT NULL REFERENCES hr.leave_types(id)              ON DELETE RESTRICT,
  start_date    DATE    NOT NULL,
  end_date      DATE    NOT NULL,
  start_half    TEXT    NOT NULL DEFAULT 'full'
                          CHECK (start_half IN ('full','first_half','second_half')),
  end_half      TEXT    NOT NULL DEFAULT 'full'
                          CHECK (end_half IN ('full','first_half','second_half')),
  days_count    NUMERIC(5,2) NOT NULL CHECK (days_count > 0),
  reason        TEXT,
  status_id     UUID    NOT NULL REFERENCES hr.leave_request_statuses(id)   ON DELETE RESTRICT,
  document_url  TEXT,
  -- Maintained by trigger from status_id: TRUE while pending/approved, else
  -- FALSE. Drives the overlap exclusion constraint below.
  is_open       BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_leave_requests_active_deleted CHECK (NOT (is_active AND is_deleted)),
  CONSTRAINT chk_leave_requests_date_order     CHECK (end_date >= start_date),
  -- No two OPEN (pending/approved), non-deleted requests for the same user may
  -- have overlapping inclusive date ranges.
  CONSTRAINT excl_leave_requests_no_overlap
    EXCLUDE USING gist (
      user_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (is_open AND NOT is_deleted)
);

-- Maintain is_open from the resolved status name (pending/approved => TRUE).
CREATE OR REPLACE FUNCTION hr.set_leave_request_is_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT name INTO v_status FROM hr.leave_request_statuses WHERE id = NEW.status_id;
  NEW.is_open := (v_status IN ('pending','approved'));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_00_leave_requests_set_org_id      ON hr.leave_requests;
CREATE TRIGGER trg_00_leave_requests_set_org_id
  BEFORE INSERT ON hr.leave_requests FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_leave_requests_set_created_by  ON hr.leave_requests;
CREATE TRIGGER trg_01_leave_requests_set_created_by
  BEFORE INSERT ON hr.leave_requests FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_02_leave_requests_set_is_open     ON hr.leave_requests;
CREATE TRIGGER trg_02_leave_requests_set_is_open
  BEFORE INSERT OR UPDATE OF status_id ON hr.leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr.set_leave_request_is_open();

DROP TRIGGER IF EXISTS trg_leave_requests_updated_at         ON hr.leave_requests;
CREATE TRIGGER trg_leave_requests_updated_at
  BEFORE UPDATE ON hr.leave_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_leave_requests_soft_delete        ON hr.leave_requests;
CREATE TRIGGER trg_leave_requests_soft_delete
  BEFORE DELETE ON hr.leave_requests FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_leave_requests_audit              ON hr.leave_requests;
CREATE TRIGGER trg_leave_requests_audit
  AFTER UPDATE OR DELETE ON hr.leave_requests FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_leave_requests_user
  ON hr.leave_requests (user_id, start_date DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_leave_requests_org_status
  ON hr.leave_requests (org_id, status_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_leave_requests_leave_type
  ON hr.leave_requests (leave_type_id) WHERE NOT is_deleted;

ALTER TABLE hr.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_requests;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_requests;
DROP POLICY IF EXISTS self_policy             ON hr.leave_requests;

CREATE POLICY org_isolation_policy ON hr.leave_requests AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.leave_requests AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

-- Self policy: a user can always see and insert their own requests, regardless
-- of the org currently in context. PERMISSIVE → OR-combined with org policy.
CREATE POLICY self_policy ON hr.leave_requests AS PERMISSIVE FOR ALL TO app_user
  USING      (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.leave_requests TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.leave_requests TO tenant_admin;
REVOKE DELETE                ON hr.leave_requests FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.leave_requests TO root_service;


-- ── hr.leave_request_status_log — append-only (mirrors lms.lead_status_log) ──
CREATE TABLE IF NOT EXISTS hr.leave_request_status_log (
  id             UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id         UUID    NOT NULL REFERENCES entity.organizations(id)     ON DELETE RESTRICT,
  request_id     UUID    NOT NULL REFERENCES hr.leave_requests(id)        ON DELETE CASCADE,
  changed_by_id  UUID    REFERENCES iam.users(id)                         ON DELETE SET NULL,
  old_status_id  UUID    REFERENCES hr.leave_request_statuses(id)         ON DELETE RESTRICT,
  new_status_id  UUID    NOT NULL REFERENCES hr.leave_request_statuses(id) ON DELETE RESTRICT,
  note           TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

CREATE INDEX IF NOT EXISTS idx_leave_request_status_log_request
  ON hr.leave_request_status_log (org_id, request_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_request_status_log_org_changed
  ON hr.leave_request_status_log (org_id, changed_at DESC);

-- Status-transition log writer. SECURITY DEFINER: app_user has no INSERT on the
-- log. note is read from app.leave_transition_note session GUC set by the API.
CREATE OR REPLACE FUNCTION hr.log_leave_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_changed_by UUID;
  v_note       TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
  BEGIN
    v_note := NULLIF(current_setting('app.leave_transition_note', true), '');
  EXCEPTION WHEN OTHERS THEN v_note := NULL; END;

  INSERT INTO hr.leave_request_status_log (
    org_id, request_id, old_status_id, new_status_id, changed_by_id, note
  ) VALUES (
    NEW.org_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status_id END,
    NEW.status_id,
    v_changed_by,
    v_note
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_leave_request_status_log ON hr.leave_requests;
CREATE TRIGGER trg_leave_request_status_log
  AFTER INSERT OR UPDATE OF status_id ON hr.leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr.log_leave_status_change();

ALTER TABLE hr.leave_request_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_request_status_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_request_status_log;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_request_status_log;
CREATE POLICY org_isolation_policy ON hr.leave_request_status_log AS PERMISSIVE FOR SELECT TO app_user
  USING (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
CREATE POLICY tenant_isolation_policy ON hr.leave_request_status_log AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT                  ON hr.leave_request_status_log TO app_user;
GRANT SELECT                  ON hr.leave_request_status_log TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON hr.leave_request_status_log FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON hr.leave_request_status_log TO root_service;


-- ===================================================================
-- 3. hr.leave_ledger — append-only source of truth for balances (§4.2)
--    SELECT-only for app_user (own rows) + tenant_admin (tenant scope);
--    INSERT only via the service path (root_service / hr-service), exactly as
--    lms.lead_status_log locks down its privileges. leave_request_id FK is
--    valid now that hr.leave_requests exists above.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.leave_ledger (
  id                UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id           UUID    NOT NULL REFERENCES iam.users(id)            ON DELETE RESTRICT,
  org_id            UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  leave_type_id     UUID    NOT NULL REFERENCES hr.leave_types(id)       ON DELETE RESTRICT,
  entry_type        TEXT    NOT NULL
                              CHECK (entry_type IN ('accrual','consumption','adjustment','carry_forward','encashment','lapse')),
  amount            NUMERIC(6,2) NOT NULL CHECK (amount <> 0),
  leave_request_id  UUID    REFERENCES hr.leave_requests(id)             ON DELETE SET NULL,
  period            TEXT,
  effective_date    DATE    NOT NULL,
  note              TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

CREATE INDEX IF NOT EXISTS idx_leave_ledger_user_type_date
  ON hr.leave_ledger (user_id, leave_type_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_org
  ON hr.leave_ledger (org_id);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_request
  ON hr.leave_ledger (leave_request_id) WHERE leave_request_id IS NOT NULL;

ALTER TABLE hr.leave_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_ledger;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_ledger;
DROP POLICY IF EXISTS self_read_policy        ON hr.leave_ledger;

-- app_user: SELECT own rows (org-manager subtree reads come via views); no DML.
CREATE POLICY org_isolation_policy ON hr.leave_ledger AS PERMISSIVE FOR SELECT TO app_user
  USING (
    org_id  = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid
  );
CREATE POLICY tenant_isolation_policy ON hr.leave_ledger AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT                  ON hr.leave_ledger TO app_user;
GRANT SELECT                  ON hr.leave_ledger TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON hr.leave_ledger FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON hr.leave_ledger TO root_service;


-- ===================================================================
-- 5. hr.leave_request_approvals — one row per approval level (§4.2)
--    org/tenant isolation + an approver policy (approver may SELECT/UPDATE
--    rows where approver_id = current user). Created via the service path when
--    a request is submitted; the approver acts on their own row.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.leave_request_approvals (
  id                UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  leave_request_id  UUID    NOT NULL REFERENCES hr.leave_requests(id)     ON DELETE CASCADE,
  org_id            UUID    NOT NULL REFERENCES entity.organizations(id)  ON DELETE RESTRICT,
  level             SMALLINT NOT NULL,
  approver_id       UUID    NOT NULL REFERENCES iam.users(id)             ON DELETE RESTRICT,
  action            TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (action IN ('pending','approved','rejected')),
  acted_at          TIMESTAMPTZ,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT uq_leave_request_approvals_request_level UNIQUE (leave_request_id, level)
);

DROP TRIGGER IF EXISTS trg_00_leave_request_approvals_set_org_id ON hr.leave_request_approvals;
CREATE TRIGGER trg_00_leave_request_approvals_set_org_id
  BEFORE INSERT ON hr.leave_request_approvals FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_leave_request_approvals_audit        ON hr.leave_request_approvals;
CREATE TRIGGER trg_leave_request_approvals_audit
  AFTER UPDATE OR DELETE ON hr.leave_request_approvals FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_leave_request_approvals_request
  ON hr.leave_request_approvals (leave_request_id, level);
CREATE INDEX IF NOT EXISTS idx_leave_request_approvals_approver
  ON hr.leave_request_approvals (approver_id, action);
CREATE INDEX IF NOT EXISTS idx_leave_request_approvals_org
  ON hr.leave_request_approvals (org_id);

ALTER TABLE hr.leave_request_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_request_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.leave_request_approvals;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.leave_request_approvals;
DROP POLICY IF EXISTS approver_policy         ON hr.leave_request_approvals;

CREATE POLICY org_isolation_policy ON hr.leave_request_approvals AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
CREATE POLICY tenant_isolation_policy ON hr.leave_request_approvals AS PERMISSIVE FOR ALL TO tenant_admin
  USING     (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted))
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

-- Approver: may read and act on (approve/reject) rows assigned to them even
-- when the row's org is not the one currently in context.
CREATE POLICY approver_policy ON hr.leave_request_approvals AS PERMISSIVE FOR ALL TO app_user
  USING      (approver_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
  WITH CHECK (approver_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);

GRANT SELECT, INSERT, UPDATE ON hr.leave_request_approvals TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.leave_request_approvals TO tenant_admin;
REVOKE DELETE                ON hr.leave_request_approvals FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.leave_request_approvals TO root_service;


-- ===================================================================
-- 6. hr.can_approve_leave — approval authority (modeled on iam.can_assign_to)
--    TRUE when the approver is in the requester's management chain, OR has
--    rank >= 80 in the org, OR is hr_admin in the org, OR is tenant_admin/
--    super_admin of the owning tenant. SECURITY DEFINER: reads iam.* + entity.*
--    regardless of the calling role. Never lets a user approve their own leave.
-- ===================================================================
CREATE OR REPLACE FUNCTION hr.can_approve_leave(
  p_org_id       UUID,
  p_approver_id  UUID,
  p_requester_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_role     TEXT;
  v_rank     INT;
  v_in_scope BOOLEAN;
  v_tenant   UUID;
BEGIN
  IF p_approver_id = p_requester_id THEN RETURN FALSE; END IF;

  -- 1) Approver is in the requester's management subtree (walks manager_id up).
  SELECT COUNT(*) > 0 INTO v_in_scope
  FROM iam.vw_user_team_members
  WHERE manager_id = p_approver_id
    AND member_id  = p_requester_id
    AND org_id     = p_org_id;
  IF COALESCE(v_in_scope, FALSE) THEN RETURN TRUE; END IF;

  -- 2) Approver's role/rank in this org (org_admin+ => rank 80; hr_admin => 75).
  SELECT ur.name, ur.rank INTO v_role, v_rank
  FROM iam.user_org_mapping uom
  JOIN iam.user_roles ur ON ur.id = uom.role_id
  WHERE uom.user_id = p_approver_id
    AND uom.org_id  = p_org_id
    AND uom.is_active;

  IF COALESCE(v_rank, -1) >= 80 THEN RETURN TRUE; END IF;
  IF v_role = 'hr_admin'        THEN RETURN TRUE; END IF;

  -- 3) tenant_admin / super_admin of the tenant that owns the request's org.
  SELECT tenant_id INTO v_tenant FROM entity.organizations WHERE id = p_org_id;
  IF EXISTS (
    SELECT 1
    FROM iam.user_org_mapping uom
    JOIN iam.user_roles ur        ON ur.id = uom.role_id
    JOIN entity.organizations o   ON o.id  = uom.org_id
    WHERE uom.user_id = p_approver_id
      AND uom.is_active
      AND o.tenant_id = v_tenant
      AND ur.name IN ('tenant_admin','super_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END; $$;

GRANT EXECUTE ON FUNCTION hr.can_approve_leave(UUID,UUID,UUID) TO app_user, tenant_admin;


-- ===================================================================
-- 7. Views (security_invoker — underlying-table RLS applies to the caller)
-- ===================================================================

-- Per (user, org, leave_type) running balance = SUM(ledger.amount).
CREATE OR REPLACE VIEW hr.vw_leave_balances WITH (security_invoker = true) AS
SELECT
  ll.user_id,
  ll.org_id,
  ll.leave_type_id,
  lt.name         AS leave_type_name,
  lt.label        AS leave_type_label,
  SUM(ll.amount)  AS balance
FROM hr.leave_ledger ll
JOIN hr.leave_types  lt ON lt.id = ll.leave_type_id
GROUP BY ll.user_id, ll.org_id, ll.leave_type_id, lt.name, lt.label;

-- Requests joined with requester name, type/status labels, and latest approval.
CREATE OR REPLACE VIEW hr.vw_leave_requests_enriched WITH (security_invoker = true) AS
SELECT
  lr.id,
  lr.user_id,
  u.full_name      AS user_full_name,
  u.email          AS user_email,
  lr.org_id,
  lr.leave_type_id,
  lt.name          AS leave_type_name,
  lt.label         AS leave_type_label,
  lr.start_date,
  lr.end_date,
  lr.start_half,
  lr.end_half,
  lr.days_count,
  lr.reason,
  lr.status_id,
  lrs.name         AS status_name,
  lrs.label        AS status_label,
  lr.document_url,
  lr.is_open,
  la.level         AS latest_approval_level,
  la.approver_id   AS latest_approver_id,
  la.action        AS latest_approval_action,
  la.acted_at      AS latest_approval_acted_at,
  lr.created_at,
  lr.updated_at
FROM hr.leave_requests lr
JOIN iam.users                    u   ON u.id   = lr.user_id
JOIN hr.leave_types               lt  ON lt.id  = lr.leave_type_id
JOIN hr.leave_request_statuses    lrs ON lrs.id = lr.status_id
LEFT JOIN LATERAL (
  SELECT level, approver_id, action, acted_at
  FROM hr.leave_request_approvals a
  WHERE a.leave_request_id = lr.id
  ORDER BY a.level DESC
  LIMIT 1
) la ON TRUE
WHERE NOT lr.is_deleted;

-- Approved leaves with user info, for team-calendar date-range queries.
CREATE OR REPLACE VIEW hr.vw_team_leave_calendar WITH (security_invoker = true) AS
SELECT
  lr.id,
  lr.user_id,
  u.full_name    AS user_full_name,
  lr.org_id,
  lr.leave_type_id,
  lt.name        AS leave_type_name,
  lt.label       AS leave_type_label,
  lr.start_date,
  lr.end_date,
  lr.start_half,
  lr.end_half,
  lr.days_count
FROM hr.leave_requests lr
JOIN iam.users               u   ON u.id   = lr.user_id
JOIN hr.leave_types          lt  ON lt.id  = lr.leave_type_id
JOIN hr.leave_request_statuses lrs ON lrs.id = lr.status_id
WHERE lrs.name = 'approved'
  AND NOT lr.is_deleted;

GRANT SELECT ON hr.vw_leave_balances, hr.vw_leave_requests_enriched, hr.vw_team_leave_calendar
  TO app_user, tenant_admin, root_service;


-- ===================================================================
-- 8. SCHEMA VERSION TRACKING
-- NOTE: prompt requested '1.4.0', but 1.0.0–1.4.0 (Meta CAPI) and 1.5.0
-- (hr/task foundation) are already consumed — using the next free version,
-- matching the precedent set in 10_init-hr-task-schemas.sql.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.6.0', 'Leave management: hr.holiday_calendars/holidays, leave_policies, hr_settings, leave_ledger, leave_requests (+status log), leave_request_approvals, hr.can_approve_leave(), leave views')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- CRM Monorepo — Leave ledger accrual idempotency (Phase 1)
-- Adds the unique partial index that makes the accrual job safe to
-- re-run: at most one accrual/carry_forward row per
-- (user_id, leave_type_id, entry_type, period).
-- Consumption / adjustment / lapse / encashment rows are intentionally
-- NOT constrained (a user may consume the same period many times).
-- Idempotent: safe to re-run.
-- Prerequisite: 11_init-leave-management.sql (hr.leave_ledger).
-- ===================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uix_leave_ledger_accrual_period
  ON hr.leave_ledger (user_id, leave_type_id, entry_type, period)
  WHERE entry_type IN ('accrual', 'carry_forward');

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.6.1', 'Leave ledger accrual idempotency: unique (user, leave_type, entry_type, period) for accrual/carry_forward')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- CRM Monorepo — Attendance (Phase 2, DB layer)
-- Adds the complete hr.* attendance model:
--   entity.organizations geo columns (geofence centre), attendance_rules,
--   shifts, shift_assignments, attendance_events (append-only), attendance_days,
--   attendance_regularizations, hr.can_approve() authority alias, and the
--   dashboard views (vw_attendance_monthly_summary / vw_org_attendance_today).
-- Prerequisite: 01_init-db.sql + 01_init-lookup-data.sql + 10_init-hr-task-schemas.sql
--               (hr schema, hr_svc role, hr.attendance_statuses lookup + seed,
--                employee_profiles) + 11_init-leave-management.sql (leave_requests,
--                hr.can_approve_leave(), btree_gist).
-- Idempotent: safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--             guarded DO blocks / DROP+CREATE for triggers & policies).
-- Style, guard patterns, trigger recipe and RLS mirror db_scripts/10 and 11.
-- Operational tables use the marketing.ad_campaigns recipe; the append-only
-- attendance_events log mirrors hr.leave_ledger's lockdown.
-- ===================================================================


-- btree_gist already installed by 11_init-leave-management.sql; keep for safety
-- (shift_assignments uses an exclusion constraint mixing = and && ).
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- NOTE: entity.organizations.geo_lat / geo_lng (the geofence-centre columns
-- this module needs) now live directly in entity.organizations' CREATE TABLE
-- (msq-hrms's copy of 02_schema.sql) -- originally added here via ALTER
-- TABLE ... ADD COLUMN IF NOT EXISTS.


-- ===================================================================
-- 1. hr.attendance_rules — org-level capture rules (§4.3)
--    One row per org (UNIQUE (org_id) among non-deleted). Standard operational
--    recipe + org/tenant RLS. Readable by every app_user in the org (they need
--    the rules before punching); writes are gated to hr_admin/org_admin at the
--    app layer (same FOR ALL app_user pattern as hr.holidays).
--    Face-verification columns are created now but stay DORMANT (no enforcement
--    logic in this increment).
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.attendance_rules (
  id                       UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id                   UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  geofence_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  geofence_radius_meters   INT     NOT NULL DEFAULT 200 CHECK (geofence_radius_meters > 0),
  require_photo            BOOLEAN NOT NULL DEFAULT TRUE,
  require_geo              BOOLEAN NOT NULL DEFAULT TRUE,
  allow_wfh_checkin        BOOLEAN NOT NULL DEFAULT FALSE,
  -- ── Face-verification rules (DORMANT until the face-verification increment) ──
  require_face_match       BOOLEAN NOT NULL DEFAULT FALSE,
  face_match_threshold     NUMERIC(5,2) NOT NULL DEFAULT 85 CHECK (face_match_threshold BETWEEN 50 AND 100),
  face_match_action        TEXT    NOT NULL DEFAULT 'flag' CHECK (face_match_action IN ('flag','block')),
  -- ── standard soft-delete / audit ──
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_attendance_rules_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_attendance_rules_updated_at        ON hr.attendance_rules;
CREATE TRIGGER trg_attendance_rules_updated_at
  BEFORE UPDATE ON hr.attendance_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_rules_soft_delete       ON hr.attendance_rules;
CREATE TRIGGER trg_attendance_rules_soft_delete
  BEFORE DELETE ON hr.attendance_rules FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_attendance_rules_set_org_id     ON hr.attendance_rules;
CREATE TRIGGER trg_00_attendance_rules_set_org_id
  BEFORE INSERT ON hr.attendance_rules FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_attendance_rules_set_created_by ON hr.attendance_rules;
CREATE TRIGGER trg_01_attendance_rules_set_created_by
  BEFORE INSERT ON hr.attendance_rules FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_attendance_rules_audit             ON hr.attendance_rules;
CREATE TRIGGER trg_attendance_rules_audit
  AFTER UPDATE OR DELETE ON hr.attendance_rules FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

-- One active rules row per org.
CREATE UNIQUE INDEX IF NOT EXISTS uix_attendance_rules_org
  ON hr.attendance_rules (org_id) WHERE NOT is_deleted;

ALTER TABLE hr.attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.attendance_rules;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.attendance_rules;
CREATE POLICY org_isolation_policy ON hr.attendance_rules AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.attendance_rules AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.attendance_rules TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.attendance_rules TO tenant_admin;
REVOKE DELETE                ON hr.attendance_rules FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.attendance_rules TO root_service;


-- ===================================================================
-- 2. hr.shifts — org-scoped shift definitions (§4.3)
--    Standard recipe + org/tenant RLS. Readable by all app_user; writes gated
--    to hr_admin/org_admin at the app layer.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.shifts (
  id                    UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id                UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  name                  TEXT    NOT NULL,
  start_time            TIME    NOT NULL,
  end_time              TIME    NOT NULL,
  grace_minutes         SMALLINT NOT NULL DEFAULT 10,
  min_half_day_minutes  SMALLINT NOT NULL DEFAULT 240,
  min_full_day_minutes  SMALLINT NOT NULL DEFAULT 480,
  is_night_shift        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at            TIMESTAMPTZ,
  deleted_by            UUID,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_shifts_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_shifts_updated_at        ON hr.shifts;
CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON hr.shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_shifts_soft_delete       ON hr.shifts;
CREATE TRIGGER trg_shifts_soft_delete
  BEFORE DELETE ON hr.shifts FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_shifts_set_org_id     ON hr.shifts;
CREATE TRIGGER trg_00_shifts_set_org_id
  BEFORE INSERT ON hr.shifts FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_shifts_set_created_by ON hr.shifts;
CREATE TRIGGER trg_01_shifts_set_created_by
  BEFORE INSERT ON hr.shifts FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_shifts_audit             ON hr.shifts;
CREATE TRIGGER trg_shifts_audit
  AFTER UPDATE OR DELETE ON hr.shifts FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_shifts_org
  ON hr.shifts (org_id) WHERE NOT is_deleted;
CREATE UNIQUE INDEX IF NOT EXISTS uix_shifts_org_name
  ON hr.shifts (org_id, name) WHERE NOT is_deleted;

ALTER TABLE hr.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.shifts;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.shifts;
CREATE POLICY org_isolation_policy ON hr.shifts AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.shifts AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.shifts TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.shifts TO tenant_admin;
REVOKE DELETE                ON hr.shifts FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.shifts TO root_service;


-- ===================================================================
-- 3. hr.shift_assignments — effective-dated user→shift mapping (§4.3)
--    Standard recipe + org/tenant RLS + a self-read policy (a user always sees
--    their own assignment). No overlapping assignments per user among non-deleted
--    rows (gist exclusion on user_id + daterange).
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.shift_assignments (
  id              UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id         UUID    NOT NULL REFERENCES iam.users(id)            ON DELETE RESTRICT,
  org_id          UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  shift_id        UUID    NOT NULL REFERENCES hr.shifts(id)            ON DELETE RESTRICT,
  effective_from  DATE    NOT NULL,
  effective_to    DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_shift_assignments_active_deleted CHECK (NOT (is_active AND is_deleted)),
  CONSTRAINT chk_shift_assignments_date_order     CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- No two non-deleted assignments for the same user may cover overlapping dates.
  CONSTRAINT excl_shift_assignments_no_overlap
    EXCLUDE USING gist (
      user_id WITH =,
      daterange(effective_from, COALESCE(effective_to, 'infinity'), '[]') WITH &&
    ) WHERE (NOT is_deleted)
);

DROP TRIGGER IF EXISTS trg_shift_assignments_updated_at        ON hr.shift_assignments;
CREATE TRIGGER trg_shift_assignments_updated_at
  BEFORE UPDATE ON hr.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_shift_assignments_soft_delete       ON hr.shift_assignments;
CREATE TRIGGER trg_shift_assignments_soft_delete
  BEFORE DELETE ON hr.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_shift_assignments_set_org_id     ON hr.shift_assignments;
CREATE TRIGGER trg_00_shift_assignments_set_org_id
  BEFORE INSERT ON hr.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_shift_assignments_set_created_by ON hr.shift_assignments;
CREATE TRIGGER trg_01_shift_assignments_set_created_by
  BEFORE INSERT ON hr.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_shift_assignments_audit             ON hr.shift_assignments;
CREATE TRIGGER trg_shift_assignments_audit
  AFTER UPDATE OR DELETE ON hr.shift_assignments FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_shift_assignments_user
  ON hr.shift_assignments (user_id, effective_from DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_shift_assignments_org
  ON hr.shift_assignments (org_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift
  ON hr.shift_assignments (shift_id) WHERE NOT is_deleted;

ALTER TABLE hr.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.shift_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.shift_assignments;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.shift_assignments;
DROP POLICY IF EXISTS self_policy             ON hr.shift_assignments;
CREATE POLICY org_isolation_policy ON hr.shift_assignments AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.shift_assignments AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);
-- Self policy: a user may always read their own assignment (needed to compute the
-- shift before punching), regardless of the org currently in context.
CREATE POLICY self_policy ON hr.shift_assignments AS PERMISSIVE FOR SELECT TO app_user
  USING (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.shift_assignments TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.shift_assignments TO tenant_admin;
REVOKE DELETE                ON hr.shift_assignments FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.shift_assignments TO root_service;


-- ===================================================================
-- 4. hr.attendance_events — append-only raw punches (§4.3)
--    Lockdown mirrors hr.leave_ledger: app_user SELECT + INSERT own rows only,
--    tenant_admin SELECT tenant scope, NO UPDATE/DELETE for non-service. Manager
--    / subtree reads happen via the service path (never a broad app_user policy).
--    Corrections go through regularization, never row edits.
--    Face-result columns are created now but stay DORMANT.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.attendance_events (
  id                   UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id              UUID    NOT NULL REFERENCES iam.users(id)            ON DELETE RESTRICT,
  org_id               UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  event_type           TEXT    NOT NULL CHECK (event_type IN ('check_in','check_out')),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  source               TEXT    NOT NULL CHECK (source IN ('web','mobile','biometric','api')),
  geo_lat              NUMERIC(9,6),
  geo_lng              NUMERIC(9,6),
  distance_from_org_m  NUMERIC(10,2),
  is_within_geofence   BOOLEAN,
  is_wfh               BOOLEAN NOT NULL DEFAULT FALSE,
  photo_url            TEXT,
  -- ── Face-verification results (DORMANT until the face-verification increment) ──
  face_match_score     NUMERIC(5,2),
  face_match_passed    BOOLEAN,
  face_review_status   TEXT    CHECK (face_review_status IN ('pending','cleared','rejected')),
  ip                   TEXT,
  device_info          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_user_occurred
  ON hr.attendance_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_attendance_events_org
  ON hr.attendance_events (org_id);

ALTER TABLE hr.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.attendance_events;
DROP POLICY IF EXISTS self_insert_policy      ON hr.attendance_events;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.attendance_events;
-- app_user: SELECT own rows only (org-manager subtree reads come via the service
-- path); INSERT own rows only. No UPDATE/DELETE (revoked below).
CREATE POLICY org_isolation_policy ON hr.attendance_events AS PERMISSIVE FOR SELECT TO app_user
  USING (
    org_id  = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid
  );
CREATE POLICY self_insert_policy ON hr.attendance_events AS PERMISSIVE FOR INSERT TO app_user
  WITH CHECK (
    org_id  = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid
  );
CREATE POLICY tenant_isolation_policy ON hr.attendance_events AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT, INSERT          ON hr.attendance_events TO app_user;
GRANT SELECT                  ON hr.attendance_events TO tenant_admin;
REVOKE UPDATE, DELETE         ON hr.attendance_events FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON hr.attendance_events TO root_service;


-- ===================================================================
-- 5. hr.attendance_days — one resolved row per user per date (§4.3)
--    Upserted by the service path (live punch) and the nightly resolution job.
--    RLS: app_user SELECT own rows; tenant_admin SELECT tenant scope; writes are
--    service-only (org-wide / team reads go through the service path after an
--    authority check, exactly like the leave team queue).
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.attendance_days (
  id                 UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id            UUID    NOT NULL REFERENCES iam.users(id)               ON DELETE RESTRICT,
  org_id             UUID    NOT NULL REFERENCES entity.organizations(id)    ON DELETE RESTRICT,
  work_date          DATE    NOT NULL,
  first_in           TIMESTAMPTZ,
  last_out           TIMESTAMPTZ,
  worked_minutes     INT,
  status_id          UUID    NOT NULL REFERENCES hr.attendance_statuses(id)  ON DELETE RESTRICT,
  is_late            BOOLEAN NOT NULL DEFAULT FALSE,
  is_early_exit      BOOLEAN NOT NULL DEFAULT FALSE,
  leave_request_id   UUID    REFERENCES hr.leave_requests(id)                ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  resolution_source  TEXT    CHECK (resolution_source IN ('events','leave','holiday','weekly_off','regularization','job')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT uq_attendance_days_user_date UNIQUE (user_id, work_date)
);

DROP TRIGGER IF EXISTS trg_attendance_days_updated_at ON hr.attendance_days;
CREATE TRIGGER trg_attendance_days_updated_at
  BEFORE UPDATE ON hr.attendance_days FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_days_audit      ON hr.attendance_days;
CREATE TRIGGER trg_attendance_days_audit
  AFTER UPDATE OR DELETE ON hr.attendance_days FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_attendance_days_org_date
  ON hr.attendance_days (org_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_days_user_date
  ON hr.attendance_days (user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_days_leave_request
  ON hr.attendance_days (leave_request_id) WHERE leave_request_id IS NOT NULL;

ALTER TABLE hr.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.attendance_days;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.attendance_days;
CREATE POLICY org_isolation_policy ON hr.attendance_days AS PERMISSIVE FOR SELECT TO app_user
  USING (
    org_id  = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid
  );
CREATE POLICY tenant_isolation_policy ON hr.attendance_days AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT                  ON hr.attendance_days TO app_user;
GRANT SELECT                  ON hr.attendance_days TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON hr.attendance_days FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON hr.attendance_days TO root_service;


-- ===================================================================
-- 6. hr.attendance_regularizations — correction requests (§4.3)
--    Standard recipe + org/tenant RLS + a self policy (a user always sees and
--    inserts their own). One open regularization per (user, work_date): partial
--    unique index WHERE status='pending' AND NOT is_deleted. Approvers act via
--    the service path (hr.can_approve authority).
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.attendance_regularizations (
  id                  UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  user_id             UUID    NOT NULL REFERENCES iam.users(id)               ON DELETE RESTRICT,
  org_id              UUID    NOT NULL REFERENCES entity.organizations(id)    ON DELETE RESTRICT,
  work_date           DATE    NOT NULL,
  requested_status_id UUID    REFERENCES hr.attendance_statuses(id)           ON DELETE RESTRICT,
  requested_in        TIMESTAMPTZ,
  requested_out       TIMESTAMPTZ,
  reason              TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected')),
  approver_id         UUID    REFERENCES iam.users(id)                        ON DELETE SET NULL,
  acted_at            TIMESTAMPTZ,
  approver_comment    TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_attendance_regularizations_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_attendance_regularizations_updated_at        ON hr.attendance_regularizations;
CREATE TRIGGER trg_attendance_regularizations_updated_at
  BEFORE UPDATE ON hr.attendance_regularizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_regularizations_soft_delete       ON hr.attendance_regularizations;
CREATE TRIGGER trg_attendance_regularizations_soft_delete
  BEFORE DELETE ON hr.attendance_regularizations FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_attendance_regularizations_set_org_id     ON hr.attendance_regularizations;
CREATE TRIGGER trg_00_attendance_regularizations_set_org_id
  BEFORE INSERT ON hr.attendance_regularizations FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_attendance_regularizations_set_created_by ON hr.attendance_regularizations;
CREATE TRIGGER trg_01_attendance_regularizations_set_created_by
  BEFORE INSERT ON hr.attendance_regularizations FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_attendance_regularizations_audit             ON hr.attendance_regularizations;
CREATE TRIGGER trg_attendance_regularizations_audit
  AFTER UPDATE OR DELETE ON hr.attendance_regularizations FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_user
  ON hr.attendance_regularizations (user_id, work_date DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_org_status
  ON hr.attendance_regularizations (org_id, status) WHERE NOT is_deleted;
-- One open (pending) regularization per user per date.
CREATE UNIQUE INDEX IF NOT EXISTS uix_attendance_regularizations_open
  ON hr.attendance_regularizations (user_id, work_date)
  WHERE status = 'pending' AND NOT is_deleted;

ALTER TABLE hr.attendance_regularizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_regularizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.attendance_regularizations;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.attendance_regularizations;
DROP POLICY IF EXISTS self_policy             ON hr.attendance_regularizations;
CREATE POLICY org_isolation_policy ON hr.attendance_regularizations AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON hr.attendance_regularizations AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);
CREATE POLICY self_policy ON hr.attendance_regularizations AS PERMISSIVE FOR ALL TO app_user
  USING      (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON hr.attendance_regularizations TO app_user;
GRANT SELECT, INSERT, UPDATE ON hr.attendance_regularizations TO tenant_admin;
REVOKE DELETE                ON hr.attendance_regularizations FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON hr.attendance_regularizations TO root_service;


-- ===================================================================
-- 7. hr.can_approve — thin authority alias over hr.can_approve_leave (§Service).
--    Rename-agnostic: the underlying function checks the management chain +
--    rank>=80 + hr_admin + tenant_admin/super_admin. Reused for attendance
--    regularization approvals so authority stays defined in exactly one place.
-- ===================================================================
CREATE OR REPLACE FUNCTION hr.can_approve(
  p_org_id       UUID,
  p_approver_id  UUID,
  p_requester_id UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT hr.can_approve_leave(p_org_id, p_approver_id, p_requester_id);
$$;

GRANT EXECUTE ON FUNCTION hr.can_approve(UUID,UUID,UUID) TO app_user, tenant_admin;


-- ===================================================================
-- 8. Views (security_invoker — underlying-table RLS applies to the caller)
-- ===================================================================

-- Per (user, org, month) status counts, late count, avg worked_minutes.
-- Payroll-export source. Month is the org-local YYYY-MM of work_date.
CREATE OR REPLACE VIEW hr.vw_attendance_monthly_summary WITH (security_invoker = true) AS
SELECT
  ad.org_id,
  ad.user_id,
  u.full_name                                            AS user_full_name,
  u.email                                                AS user_email,
  to_char(ad.work_date, 'YYYY-MM')                       AS month,
  COUNT(*) FILTER (WHERE st.name = 'present')            AS present_count,
  COUNT(*) FILTER (WHERE st.name = 'absent')             AS absent_count,
  COUNT(*) FILTER (WHERE st.name = 'half_day')           AS half_day_count,
  COUNT(*) FILTER (WHERE st.name = 'on_leave')           AS on_leave_count,
  COUNT(*) FILTER (WHERE st.name = 'holiday')            AS holiday_count,
  COUNT(*) FILTER (WHERE st.name = 'weekly_off')         AS weekly_off_count,
  COUNT(*) FILTER (WHERE st.name = 'wfh')                AS wfh_count,
  COUNT(*) FILTER (WHERE ad.is_late)                     AS late_count,
  COUNT(*) FILTER (WHERE ad.is_early_exit)               AS early_exit_count,
  AVG(ad.worked_minutes)::numeric(10,2)                  AS avg_worked_minutes
FROM hr.attendance_days ad
JOIN iam.users               u  ON u.id  = ad.user_id
JOIN hr.attendance_statuses  st ON st.id = ad.status_id
GROUP BY ad.org_id, ad.user_id, u.full_name, u.email, to_char(ad.work_date, 'YYYY-MM');

-- Today's org attendance: active employees LEFT JOINed to their attendance_days
-- row for CURRENT_DATE; unmatched employees surface as 'not_marked'. Used by the
-- org dashboard; the /team endpoint queries a parameterized date in the repo for
-- arbitrary days.
CREATE OR REPLACE VIEW hr.vw_org_attendance_today WITH (security_invoker = true) AS
SELECT
  ep.org_id,
  ep.user_id,
  u.full_name                          AS user_full_name,
  u.email                              AS user_email,
  ad.work_date,
  ad.first_in,
  ad.last_out,
  ad.worked_minutes,
  COALESCE(st.name,  'not_marked')     AS status_name,
  COALESCE(st.label, 'Not Marked')     AS status_label,
  COALESCE(ad.is_late, FALSE)          AS is_late,
  COALESCE(ad.is_early_exit, FALSE)    AS is_early_exit
FROM hr.employee_profiles ep
JOIN iam.users u ON u.id = ep.user_id
LEFT JOIN hr.attendance_days ad
       ON ad.user_id = ep.user_id AND ad.work_date = CURRENT_DATE
LEFT JOIN hr.attendance_statuses st ON st.id = ad.status_id
WHERE ep.is_active AND NOT ep.is_deleted;

GRANT SELECT ON hr.vw_attendance_monthly_summary, hr.vw_org_attendance_today
  TO app_user, tenant_admin, root_service;


-- ===================================================================
-- 9. SCHEMA VERSION TRACKING
-- NOTE: the prompt requested '1.5.0', but 1.0.0–1.6.1 are already consumed
-- (Meta CAPI, hr/task foundation, leave management) — using the next free
-- version, matching the precedent in 10_ and 11_.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.7.0', 'Attendance: entity.organizations geo columns, hr.attendance_rules/shifts/shift_assignments, attendance_events (append-only), attendance_days, attendance_regularizations, hr.can_approve(), attendance views')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- 21_init-reporting-lines.sql
--
-- P2.2A — HR reporting hierarchy decoupling. Introduces effective-dated
-- `hr.reporting_lines` as the source of truth for the HR approval chain
-- (leave / attendance approvals), replacing the walk of the single global
-- `iam.users.manager_id` column.
--
-- Why a separate tree: each product owns its own hierarchy (Platform
-- Architecture Decisions §"hierarchy"). HR reporting can be re-orged on its
-- own cadence and must be effective-dated so history is auditable; the
-- LMS/sales assignment tree may legitimately differ and is decoupled in a
-- later phase. `iam.users.manager_id` degrades to an optional org default:
-- it still feeds the LMS/team `vw_user_team_members` tree and is used here
-- only to BACKFILL the initial reporting lines. It is no longer read on the
-- HR approval hot path (see services/hr-service/.../resolve-approvers.ts).
--
-- Prerequisite: 01_init-db.sql (iam.users, roles, entity.*), 10 (hr schema,
--               hr_svc), 11 (btree_gist extension for the exclusion
--               constraint; leave_policies RLS/grant recipe mirrored here).
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE
--             for triggers & policies; the backfill is guarded by NOT EXISTS.
-- Style, trigger recipe and RLS mirror hr.leave_policies in db_scripts/11.
-- ===================================================================

BEGIN;

-- ===================================================================
-- hr.reporting_lines — effective-dated managerial hierarchy (tenant/org scoped)
--   One row = "user_id reports to manager_id, in org_id, for [effective_from,
--   effective_to)". effective_to NULL = the currently-open line. A user has at
--   most one active line per org at any instant (exclusion constraint). A NULL
--   manager_id is not stored — absence of a line means "no reporting line", and
--   the approver resolver falls back to a deterministic org_admin/hr_admin.
-- ===================================================================
CREATE TABLE IF NOT EXISTS hr.reporting_lines (
  id             UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id      UUID    NOT NULL REFERENCES entity.tenants(id)        ON DELETE CASCADE,
  org_id         UUID    NOT NULL REFERENCES entity.organizations(id)  ON DELETE CASCADE,
  user_id        UUID    NOT NULL REFERENCES iam.users(id)             ON DELETE CASCADE,
  manager_id     UUID    NOT NULL REFERENCES iam.users(id)             ON DELETE RESTRICT,
  effective_from DATE    NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_reporting_lines_active_deleted CHECK (NOT (is_active AND is_deleted)),
  CONSTRAINT chk_reporting_lines_not_self       CHECK (user_id <> manager_id),
  CONSTRAINT chk_reporting_lines_range          CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- No two overlapping active lines for the same user in the same org. The
-- half-open daterange [from, to) lets a new line start on the exact day the
-- previous one ends without tripping the constraint. Soft-deleted rows are
-- excluded so a re-org can supersede history. (btree_gist enables mixing the
-- equality columns with the range overlap; extension is created in script 11.)
-- DROP+ADD (not IF NOT EXISTS, which ADD CONSTRAINT doesn't support) keeps the
-- script idempotent. Dropping the constraint also drops its backing gist index.
ALTER TABLE hr.reporting_lines DROP CONSTRAINT IF EXISTS excl_reporting_lines_overlap;
ALTER TABLE hr.reporting_lines ADD CONSTRAINT excl_reporting_lines_overlap
  EXCLUDE USING gist (
    org_id  WITH =,
    user_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (NOT is_deleted);

DROP TRIGGER IF EXISTS trg_reporting_lines_updated_at        ON hr.reporting_lines;
CREATE TRIGGER trg_reporting_lines_updated_at
  BEFORE UPDATE ON hr.reporting_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reporting_lines_soft_delete       ON hr.reporting_lines;
CREATE TRIGGER trg_reporting_lines_soft_delete
  BEFORE DELETE ON hr.reporting_lines FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_reporting_lines_set_org_id     ON hr.reporting_lines;
CREATE TRIGGER trg_00_reporting_lines_set_org_id
  BEFORE INSERT ON hr.reporting_lines FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_reporting_lines_set_created_by ON hr.reporting_lines;
CREATE TRIGGER trg_01_reporting_lines_set_created_by
  BEFORE INSERT ON hr.reporting_lines FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_reporting_lines_audit             ON hr.reporting_lines;
CREATE TRIGGER trg_reporting_lines_audit
  AFTER UPDATE OR DELETE ON hr.reporting_lines FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_reporting_lines_org_user
  ON hr.reporting_lines (org_id, user_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_reporting_lines_org_manager
  ON hr.reporting_lines (org_id, manager_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_reporting_lines_tenant
  ON hr.reporting_lines (tenant_id) WHERE NOT is_deleted;

-- ── RLS (mirror hr.leave_policies) ─────────────────────────────────
-- app_user: SELECT-only, scoped to the caller's current org. Writes are
-- performed by the service (root_service / hr_svc) or a tenant_admin; app-layer
-- authorization gates who may edit a reporting line.
ALTER TABLE hr.reporting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.reporting_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON hr.reporting_lines;
DROP POLICY IF EXISTS tenant_isolation_policy ON hr.reporting_lines;

CREATE POLICY org_isolation_policy ON hr.reporting_lines AS PERMISSIVE FOR SELECT TO app_user
  USING (
    NOT is_deleted
    AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_policy ON hr.reporting_lines AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid AND NOT is_deleted)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid AND NOT is_deleted);

GRANT SELECT                 ON hr.reporting_lines TO app_user;
REVOKE INSERT, UPDATE, DELETE ON hr.reporting_lines FROM app_user;
GRANT SELECT, INSERT, UPDATE ON hr.reporting_lines TO tenant_admin;
REVOKE DELETE                ON hr.reporting_lines FROM tenant_admin;
GRANT ALL PRIVILEGES         ON hr.reporting_lines TO root_service;
-- hr_svc (the HR product login) reads the tree to resolve approvers and writes
-- it when HR admins re-org. It connects under RLS, so isolation still holds.
GRANT SELECT, INSERT, UPDATE ON hr.reporting_lines TO hr_svc;

-- ===================================================================
-- Backfill: seed one open-ended reporting line per user from the current
-- iam.users.manager_id, scoped to the user's org. Idempotent — the NOT EXISTS
-- guard skips any user that already has an active (open) line, so re-running
-- the script (or running it after HR has started managing lines) is a no-op.
-- Only users with a non-null manager get a line; the rest resolve via the
-- approver resolver's org_admin/hr_admin fallback.
-- ===================================================================
INSERT INTO hr.reporting_lines (tenant_id, org_id, user_id, manager_id, effective_from, effective_to)
SELECT o.tenant_id, u.org_id, u.id, u.manager_id, CURRENT_DATE, NULL
FROM iam.users u
JOIN entity.organizations o ON o.id = u.org_id
WHERE u.manager_id IS NOT NULL
  AND NOT u.is_deleted
  AND NOT EXISTS (
    SELECT 1 FROM hr.reporting_lines rl
    WHERE rl.org_id = u.org_id AND rl.user_id = u.id
      AND rl.effective_to IS NULL AND NOT rl.is_deleted
  );

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.15.0', 'P2.2A: effective-dated hr.reporting_lines (tenant/org scoped, RLS, no-overlap exclusion) as the HR approval-chain source of truth; backfilled from iam.users.manager_id, which degrades to an optional default')
ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ===================================================================
-- CRM Monorepo — Tasks / To-Do (Phase 3, DB layer)
-- Adds the complete task.* model:
--   Global lookups task.task_statuses / task.task_priorities (lms.lead_stage
--   shape, no RLS), org-scoped task.task_lists, task.tasks (+ append-only
--   task.task_status_log via trigger + completed_at consistency trigger),
--   append-only task.task_comments, and the dashboard views
--   (task.vw_my_tasks / task.vw_team_tasks).
-- Prerequisite: 01_init-db.sql + 01_init-lookup-data.sql + 10_init-hr-task-schemas.sql
--               (task schema, task_svc login role, schema USAGE + default
--                privileges for app_user/tenant_admin/root_service on the task schema).
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING /
--             guarded DO blocks / DROP+CREATE for triggers & policies).
-- Style, guard patterns, trigger recipe and RLS mirror db_scripts/10, 11 and 13.
-- Operational tables use the marketing.ad_campaigns recipe; the append-only
-- task_status_log / task_comments logs mirror hr.leave_request_status_log's lockdown.
--
-- VISIBILITY NOTE (documented once, enforced in the app layer — see
-- Architecture.md "Tasks"): task_lists carry a `visibility` of private/team/org.
--   * RLS keeps org isolation for every task.* table PLUS a private-list rule on
--     task_lists (a private list is visible ONLY to its owner, even inside the org).
--   * `team` visibility (a team list is visible to the owner's management subtree)
--     is NOT expressible in a single-row RLS predicate, so it is enforced in the
--     tasks-service repository via iam.vw_user_team_members.
--   * task.tasks RLS is plain org/tenant isolation. A task's effective visibility
--     derives from its list's visibility; rather than a correlated join policy on
--     every task read, the tasks-service applies the private/team/own filter in the
--     query (own tasks — created_by/assignee — are always visible). This keeps the
--     hot read path simple; the alternative (a join RLS policy on task.tasks) was
--     rejected for cost/complexity. See Architecture.md for the rationale.
-- ===================================================================


-- ===================================================================
-- 1. GLOBAL LOOKUP TABLES  (UUID PKs, same shape as lms.lead_stage — no RLS)
--    Managed globally (admin-service /lookups slugs); readable by every subject
--    role. task schema USAGE + default SELECT privileges already granted in 10.
-- ===================================================================

-- ── task.task_statuses ─────────────────────────────────────────────
-- is_terminal marks statuses that close a task (done, cancelled). The
-- completed_at consistency trigger keys specifically off the 'done' status.
-- task.task_statuses / task.task_priorities are tenant-scoped (historically
-- added via 22_tenant-scope-lookups.sql ALTER; folded directly into the
-- CREATE TABLE here). No un-scoped seed INSERT: per-tenant default rows are
-- provisioned by entity.seed_tenant_defaults() (05_catalogs.sql) at
-- tenant-creation time, not at DDL time (no tenant exists yet when this
-- script runs).
CREATE TABLE IF NOT EXISTS task.task_statuses (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_task_statuses_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE task.task_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.task_statuses;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.task_statuses;
CREATE POLICY org_isolation_policy ON task.task_statuses AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON task.task_statuses AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS task.task_priorities (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  tenant_id   UUID    NOT NULL REFERENCES entity.tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  description TEXT,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_task_priorities_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE task.task_priorities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.task_priorities;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.task_priorities;
CREATE POLICY org_isolation_policy ON task.task_priorities AS PERMISSIVE FOR SELECT TO app_user
  USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                      WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid));
CREATE POLICY tenant_isolation_policy ON task.task_priorities AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Lookup grants ──────────────────────────────────────────────────
GRANT SELECT         ON task.task_statuses, task.task_priorities TO app_user;
GRANT SELECT         ON task.task_statuses, task.task_priorities TO tenant_admin;
GRANT ALL PRIVILEGES ON task.task_statuses, task.task_priorities TO root_service;


-- ===================================================================
-- 2. task.task_lists — org-scoped named lists (§4.5)
--    Standard operational recipe + org/tenant RLS + an owner-private rule.
--    `visibility`: private (owner only) | team (owner's subtree, app layer) |
--    org (whole org). Writes gated in the service layer.
-- ===================================================================
CREATE TABLE IF NOT EXISTS task.task_lists (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id      UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  name        TEXT    NOT NULL,
  description TEXT,
  owner_id    UUID    NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  visibility  TEXT    NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','team','org')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_task_lists_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_task_lists_updated_at        ON task.task_lists;
CREATE TRIGGER trg_task_lists_updated_at
  BEFORE UPDATE ON task.task_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_task_lists_soft_delete       ON task.task_lists;
CREATE TRIGGER trg_task_lists_soft_delete
  BEFORE DELETE ON task.task_lists FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_task_lists_set_org_id     ON task.task_lists;
CREATE TRIGGER trg_00_task_lists_set_org_id
  BEFORE INSERT ON task.task_lists FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_task_lists_set_created_by ON task.task_lists;
CREATE TRIGGER trg_01_task_lists_set_created_by
  BEFORE INSERT ON task.task_lists FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_task_lists_audit             ON task.task_lists;
CREATE TRIGGER trg_task_lists_audit
  AFTER UPDATE OR DELETE ON task.task_lists FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_task_lists_org
  ON task.task_lists (org_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_task_lists_owner
  ON task.task_lists (owner_id) WHERE NOT is_deleted;

ALTER TABLE task.task_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.task_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.task_lists;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.task_lists;
-- app_user: own org, not deleted, AND (non-private OR owner). The private rule
-- guarantees a peer never even reads another user's private list at the row level;
-- `team` narrowing (owner subtree) is layered on top in the service.
CREATE POLICY org_isolation_policy ON task.task_lists AS PERMISSIVE FOR ALL TO app_user
  USING (
    org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND NOT is_deleted
    AND (visibility <> 'private' OR owner_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid)
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND NOT is_deleted
  );
CREATE POLICY tenant_isolation_policy ON task.task_lists AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON task.task_lists TO app_user;
GRANT SELECT, INSERT, UPDATE ON task.task_lists TO tenant_admin;
REVOKE DELETE                ON task.task_lists FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON task.task_lists TO root_service;


-- ===================================================================
-- 3. task.tasks — the core task entity (§4.5)
--    Standard operational recipe + org/tenant RLS. list_id ON DELETE SET NULL
--    (deleting a list detaches, never cascades, its tasks). parent_task_id is a
--    self-FK for subtasks. related_entity_* is a polymorphic soft link (a task
--    "about" a lead / leave request) with no cross-schema hard FK.
-- ===================================================================
CREATE TABLE IF NOT EXISTS task.tasks (
  id                   UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id               UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  list_id              UUID    REFERENCES task.task_lists(id) ON DELETE SET NULL,
  title                TEXT    NOT NULL,
  description          TEXT,
  assignee_id          UUID    REFERENCES iam.users(id) ON DELETE SET NULL,
  due_at               TIMESTAMPTZ,
  priority_id          UUID    REFERENCES task.task_priorities(id) ON DELETE RESTRICT,
  status_id            UUID    NOT NULL REFERENCES task.task_statuses(id) ON DELETE RESTRICT,
  parent_task_id       UUID    REFERENCES task.tasks(id) ON DELETE SET NULL,
  related_entity_type  TEXT,
  related_entity_id    UUID,
  tags                 TEXT[]  NOT NULL DEFAULT '{}',
  completed_at         TIMESTAMPTZ,
  -- RFC 5545 RRULE column only; recurrence expansion is a later increment.
  recurrence_rule      TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at           TIMESTAMPTZ,
  deleted_by           UUID,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_tasks_active_deleted   CHECK (NOT (is_active AND is_deleted)),
  CONSTRAINT chk_tasks_not_self_parent  CHECK (parent_task_id IS NULL OR parent_task_id <> id),
  -- related_entity_type and _id are set together or not at all.
  CONSTRAINT chk_tasks_related_entity
    CHECK ((related_entity_type IS NULL) = (related_entity_id IS NULL))
);

-- completed_at ↔ status consistency (auto-managed, mirrors the intent of
-- lms.check_follow_up_completion). Sets completed_at when the task enters the
-- terminal 'done' status and clears it on any transition away from 'done'. Runs
-- BEFORE so the value lands on the same row write.
CREATE OR REPLACE FUNCTION task.set_task_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT name INTO v_status FROM task.task_statuses WHERE id = NEW.status_id;
  IF v_status = 'done' THEN
    IF NEW.completed_at IS NULL THEN NEW.completed_at := CLOCK_TIMESTAMP(); END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END; $$;

-- Append-only status-transition log writer. SECURITY DEFINER: app_user has no
-- INSERT on task.task_status_log. Note is read from the app.task_transition_note
-- session GUC set by the API before the update (mirrors hr.log_leave_status_change).
CREATE OR REPLACE FUNCTION task.log_task_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_changed_by UUID;
  v_note       TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
  BEGIN
    v_note := NULLIF(current_setting('app.task_transition_note', true), '');
  EXCEPTION WHEN OTHERS THEN v_note := NULL; END;

  INSERT INTO task.task_status_log (
    org_id, task_id, old_status_id, new_status_id, changed_by_id, note
  ) VALUES (
    NEW.org_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status_id END,
    NEW.status_id,
    v_changed_by,
    v_note
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tasks_updated_at        ON task.tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON task.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_completion         ON task.tasks;
CREATE TRIGGER trg_tasks_completion
  BEFORE INSERT OR UPDATE OF status_id ON task.tasks FOR EACH ROW EXECUTE FUNCTION task.set_task_completion();

DROP TRIGGER IF EXISTS trg_tasks_soft_delete       ON task.tasks;
CREATE TRIGGER trg_tasks_soft_delete
  BEFORE DELETE ON task.tasks FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

DROP TRIGGER IF EXISTS trg_00_tasks_set_org_id     ON task.tasks;
CREATE TRIGGER trg_00_tasks_set_org_id
  BEFORE INSERT ON task.tasks FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

DROP TRIGGER IF EXISTS trg_01_tasks_set_created_by ON task.tasks;
CREATE TRIGGER trg_01_tasks_set_created_by
  BEFORE INSERT ON task.tasks FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_tasks_audit             ON task.tasks;
CREATE TRIGGER trg_tasks_audit
  AFTER UPDATE OR DELETE ON task.tasks FOR EACH ROW EXECUTE FUNCTION audit.audit_row_changes();

CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee_status
  ON task.tasks (org_id, assignee_id, status_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_tasks_org_due
  ON task.tasks (org_id, due_at) WHERE completed_at IS NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_tasks_related_entity
  ON task.tasks (related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_list
  ON task.tasks (list_id) WHERE list_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_tasks_created_by
  ON task.tasks (org_id, created_by) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_tasks_parent
  ON task.tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

ALTER TABLE task.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.tasks;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.tasks;
-- Plain org/tenant isolation (see VISIBILITY NOTE at the top). Private/team
-- narrowing is applied in the tasks-service query, never bypassed.
CREATE POLICY org_isolation_policy ON task.tasks AS PERMISSIVE FOR ALL TO app_user
  USING     (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid AND NOT is_deleted);
CREATE POLICY tenant_isolation_policy ON task.tasks AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted)
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted) AND NOT is_deleted);

GRANT SELECT, INSERT, UPDATE ON task.tasks TO app_user;
GRANT SELECT, INSERT, UPDATE ON task.tasks TO tenant_admin;
REVOKE DELETE                ON task.tasks FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES         ON task.tasks TO root_service;


-- ===================================================================
-- 4. task.task_status_log — append-only (mirrors hr.leave_request_status_log)
--    SELECT-only for app_user (org scope) + tenant_admin (tenant scope);
--    INSERT only via the SECURITY DEFINER trigger above.
-- ===================================================================
CREATE TABLE IF NOT EXISTS task.task_status_log (
  id            UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id        UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  task_id       UUID    NOT NULL REFERENCES task.tasks(id)           ON DELETE CASCADE,
  changed_by_id UUID    REFERENCES iam.users(id)                     ON DELETE SET NULL,
  old_status_id UUID    REFERENCES task.task_statuses(id)            ON DELETE RESTRICT,
  new_status_id UUID    NOT NULL REFERENCES task.task_statuses(id)   ON DELETE RESTRICT,
  note          TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

CREATE INDEX IF NOT EXISTS idx_task_status_log_task
  ON task.task_status_log (org_id, task_id, changed_at DESC);

-- The status-log trigger inserts into this table; declared after the table exists.
DROP TRIGGER IF EXISTS trg_tasks_status_log ON task.tasks;
CREATE TRIGGER trg_tasks_status_log
  AFTER INSERT OR UPDATE OF status_id ON task.tasks
  FOR EACH ROW EXECUTE FUNCTION task.log_task_status_change();

ALTER TABLE task.task_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.task_status_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.task_status_log;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.task_status_log;
CREATE POLICY org_isolation_policy ON task.task_status_log AS PERMISSIVE FOR SELECT TO app_user
  USING (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
CREATE POLICY tenant_isolation_policy ON task.task_status_log AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT                  ON task.task_status_log TO app_user;
GRANT SELECT                  ON task.task_status_log TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON task.task_status_log FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON task.task_status_log TO root_service;


-- ===================================================================
-- 5. task.task_comments — append-only comment thread (§4.5)
--    app_user SELECT + INSERT (own author rows); NO UPDATE/DELETE for non-service
--    (author-delete can come in a later increment). RLS org/tenant isolation.
-- ===================================================================
CREATE TABLE IF NOT EXISTS task.task_comments (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id      UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  task_id     UUID    NOT NULL REFERENCES task.tasks(id)           ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES iam.users(id)            ON DELETE RESTRICT,
  body        TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_00_task_comments_set_org_id ON task.task_comments;
CREATE TRIGGER trg_00_task_comments_set_org_id
  BEFORE INSERT ON task.task_comments FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

CREATE INDEX IF NOT EXISTS idx_task_comments_task
  ON task.task_comments (org_id, task_id, created_at);

ALTER TABLE task.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task.task_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_policy    ON task.task_comments;
DROP POLICY IF EXISTS self_insert_policy      ON task.task_comments;
DROP POLICY IF EXISTS tenant_isolation_policy ON task.task_comments;
CREATE POLICY org_isolation_policy ON task.task_comments AS PERMISSIVE FOR SELECT TO app_user
  USING (org_id = NULLIF(current_setting('app.current_org_id',true),'')::uuid);
-- INSERT own author rows only (org + author must match the session).
CREATE POLICY self_insert_policy ON task.task_comments AS PERMISSIVE FOR INSERT TO app_user
  WITH CHECK (
    org_id  = NULLIF(current_setting('app.current_org_id',true),'')::uuid
    AND user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid
  );
CREATE POLICY tenant_isolation_policy ON task.task_comments AS PERMISSIVE FOR SELECT TO tenant_admin
  USING (org_id IN (SELECT id FROM entity.organizations WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid AND NOT is_deleted));

GRANT SELECT, INSERT          ON task.task_comments TO app_user;
GRANT SELECT                  ON task.task_comments TO tenant_admin;
REVOKE UPDATE, DELETE         ON task.task_comments FROM app_user, tenant_admin;
GRANT ALL PRIVILEGES          ON task.task_comments TO root_service;


-- ===================================================================
-- 6. Views (security_invoker — underlying-table RLS applies to the caller)
--    These resolve lookup labels + user names for the list/detail read paths.
--    Visibility narrowing (own/team/private) still happens in the repository;
--    the views are org-scoped projections, not access-control boundaries.
-- ===================================================================

-- Enriched task projection: lookup labels, list name/visibility, assignee &
-- creator names. Reused by the list/detail endpoints.
CREATE OR REPLACE VIEW task.vw_tasks_enriched WITH (security_invoker = true) AS
SELECT
  t.id,
  t.org_id,
  t.list_id,
  tl.name        AS list_name,
  tl.visibility  AS list_visibility,
  tl.owner_id    AS list_owner_id,
  t.title,
  t.description,
  t.assignee_id,
  ua.full_name   AS assignee_name,
  ua.email       AS assignee_email,
  t.created_by,
  uc.full_name   AS created_by_name,
  t.due_at,
  t.priority_id,
  tp.name        AS priority_name,
  tp.label       AS priority_label,
  tp.sort_order  AS priority_sort_order,
  t.status_id,
  ts.name        AS status_name,
  ts.label       AS status_label,
  ts.is_terminal AS status_is_terminal,
  t.parent_task_id,
  t.related_entity_type,
  t.related_entity_id,
  t.tags,
  t.completed_at,
  t.recurrence_rule,
  t.created_at,
  t.updated_at
FROM task.tasks t
LEFT JOIN task.task_lists      tl ON tl.id = t.list_id
LEFT JOIN task.task_priorities tp ON tp.id = t.priority_id
JOIN      task.task_statuses   ts ON ts.id = t.status_id
LEFT JOIN iam.users            ua ON ua.id = t.assignee_id
LEFT JOIN iam.users            uc ON uc.id = t.created_by
WHERE NOT t.is_deleted;

GRANT SELECT ON task.vw_tasks_enriched TO app_user, tenant_admin, root_service;


-- ===================================================================
-- 7. SCHEMA VERSION TRACKING
-- NOTE: the prompt requested '1.6.0', but 1.0.0–1.7.0 are already consumed
-- (Meta CAPI, hr/task foundation, leave management, attendance) — using the next
-- free version, matching the precedent set in 10_, 11_ and 13_.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.8.0', 'Tasks: task.task_statuses/task_priorities lookups, task.task_lists (owner-private RLS), task.tasks (+ status log + completion trigger), task.task_comments, task.vw_tasks_enriched')
ON CONFLICT (version) DO NOTHING;
