-- ===================================================================
-- 06_rls.sql
-- Consolidated DDL: lookup-admin write RLS policies (super_admin/
-- tenant-scoped catalog editing surface).
-- Idempotent: safe to re-run.
-- ===================================================================

-- ===================================================================
-- 25_lookup-admin-write-rls.sql
--
-- N-6 (Phase5_Extraction_Plan §5) — Half A. Lets the OWNING product
-- service (leads/hr/tasks) perform super_admin lookup/role management
-- writes into its OWN schema, tenant-scoped, WITHOUT root_service/BYPASSRLS.
--
-- Model: a super_admin managing a tenant's config first SELECTS a target
-- tenant; the product service then runs the write as its product-scoped
-- login (lms_svc/hr_svc/task_svc — each a MEMBER of app_user, script 19)
-- with app.current_tenant_id pinned to that tenant (see @crm/db
-- withTenantConfigTx). The permissive FOR ALL policy below keys on
-- app.current_tenant_id, so a write can only ever touch the selected
-- tenant's rows — cross-tenant contamination is physically impossible.
--
-- Why this is safe for normal runtime traffic: the product runtime
-- (app_user branch of withRoleTx) sets app.current_org_id, never
-- app.current_tenant_id, so this policy's predicate is NULL (no match) on
-- that path — it grants NOTHING extra at runtime. Only the explicit admin
-- tx sets current_tenant_id. Table-level INSERT/UPDATE is granted ONLY to
-- the specific product role (not app_user broadly), so other app_user
-- members (e.g. identity-service) still cannot write these tables even
-- though the policy is TO app_user.
--
-- These 8 tables are already tenant-scoped (tenant_id NOT NULL, script
-- 22/17). The 7 still-global LMS lookups (lead_stage etc.) are Half B.
--
-- Idempotent: DROP POLICY IF EXISTS + GRANT are safe to re-run.
-- ===================================================================

BEGIN;

-- Shared predicate: the row's tenant must equal the admin-selected tenant.
-- (Written inline per table below — Postgres has no policy macros.)

-- ── lms.roles  (lms_svc) ────────────────────────────────────────────
DROP POLICY IF EXISTS admin_tenant_config_policy ON lms.roles;
CREATE POLICY admin_tenant_config_policy ON lms.roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE lms.roles TO lms_svc;

-- ── hr.leave_types / employment_types / attendance_statuses / roles  (hr_svc) ──
DROP POLICY IF EXISTS admin_tenant_config_policy ON hr.leave_types;
CREATE POLICY admin_tenant_config_policy ON hr.leave_types
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE hr.leave_types TO hr_svc;

DROP POLICY IF EXISTS admin_tenant_config_policy ON hr.employment_types;
CREATE POLICY admin_tenant_config_policy ON hr.employment_types
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE hr.employment_types TO hr_svc;

DROP POLICY IF EXISTS admin_tenant_config_policy ON hr.attendance_statuses;
CREATE POLICY admin_tenant_config_policy ON hr.attendance_statuses
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE hr.attendance_statuses TO hr_svc;

DROP POLICY IF EXISTS admin_tenant_config_policy ON hr.roles;
CREATE POLICY admin_tenant_config_policy ON hr.roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE hr.roles TO hr_svc;

-- ── task.task_statuses / task_priorities / roles  (task_svc) ─────────
DROP POLICY IF EXISTS admin_tenant_config_policy ON task.task_statuses;
CREATE POLICY admin_tenant_config_policy ON task.task_statuses
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE task.task_statuses TO task_svc;

DROP POLICY IF EXISTS admin_tenant_config_policy ON task.task_priorities;
CREATE POLICY admin_tenant_config_policy ON task.task_priorities
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE task.task_priorities TO task_svc;

DROP POLICY IF EXISTS admin_tenant_config_policy ON task.roles;
CREATE POLICY admin_tenant_config_policy ON task.roles
  AS PERMISSIVE FOR ALL TO app_user
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT INSERT, UPDATE ON TABLE task.roles TO task_svc;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.18.0', 'N-6 Half A: tenant-scoped admin write RLS + product-role write GRANTs on the 8 tenant-scoped lookup/role tables (lms.roles; hr.leave_types/employment_types/attendance_statuses/roles; task.task_statuses/task_priorities/roles) so product services own super_admin lookup writes without BYPASSRLS')
  ON CONFLICT (version) DO NOTHING;

COMMIT;


-- ── RLS + product-role write GRANTs for the 7 tenant-scoped LMS lookups above
--    (historically 26_tenant-scope-lms-lookups.sql; GRANT ... TO lms_svc
--    moved to 04_roles_and_grants.sql, after lms_svc's CREATE ROLE) ──
DO $rls$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'lms.lead_stage','lms.lead_stage_outcome','lms.interaction_types',
    'lms.follow_up_statuses','lms.lead_sources',
    'marketing.marketing_platforms','marketing.campaign_statuses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_policy ON %s', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %s', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_tenant_config_policy ON %s', t);
    EXECUTE format($p$CREATE POLICY org_isolation_policy ON %s AS PERMISSIVE FOR SELECT TO app_user
      USING (tenant_id = (SELECT tenant_id FROM entity.organizations
                          WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::uuid))$p$, t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %s AS PERMISSIVE FOR SELECT TO tenant_admin
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
    -- N-6 admin write (super_admin acting within a selected tenant via withTenantConfigTx)
    EXECUTE format($p$CREATE POLICY admin_tenant_config_policy ON %s AS PERMISSIVE FOR ALL TO app_user
      USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $rls$;
-- Widen every RLS policy to also name the roles that are MEMBERS of the roles
-- it already targets.
--
-- 04_roles_and_grants.sql assumes a "TO app_user" policy matches any member of
-- app_user regardless of INHERIT. That is not how Postgres works: policy
-- applicability uses the INHERIT-respecting check (pg_has_role(..,'USAGE')),
-- not 'MEMBER'. Every service login is NOINHERIT, so no app_user policy applied
-- to any of them and every policy-protected table read back ZERO rows -- with no
-- error, which is why it surfaced as empty module/tool lists rather than a failure.
--
-- Naming the member roles explicitly restores policy enforcement while KEEPING
-- them NOINHERIT, so the per-product GRANT isolation is untouched: a role still
-- holds only the table privileges granted to it directly.
--
-- Idempotent: the target role set is recomputed from current membership on every
-- run, so re-running after adding a role or policy converges.

DO $$
DECLARE
  p         RECORD;
  new_roles TEXT;
BEGIN
  FOR p IN
    SELECT pol.polname,
           n.nspname,
           c.relname,
           ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (pol.polroles)) AS roles
    FROM pg_policy pol
    JOIN pg_class     c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- polroles = {0} means TO PUBLIC, which already covers everyone.
    WHERE pol.polroles <> '{0}'::oid[]
  LOOP
    SELECT string_agg(DISTINCT quote_ident(role_name), ', ')
      INTO new_roles
      FROM (
        SELECT unnest(p.roles) AS role_name
        UNION
        SELECT r.rolname
        FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.member
        JOIN pg_roles g ON g.oid = m.roleid
        WHERE g.rolname = ANY (p.roles)
      ) s;

    EXECUTE format('ALTER POLICY %I ON %I.%I TO %s',
                   p.polname, p.nspname, p.relname, new_roles);
  END LOOP;
END $$;
