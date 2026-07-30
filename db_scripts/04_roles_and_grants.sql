-- ===================================================================
-- 04_roles_and_grants.sql
-- Consolidated DDL: per-product-login DB grants (lms_svc / hr_svc /
-- task_svc / root_service), the resolver EXECUTE grants those logins need on
-- the unified iam ladder, and readonly_user membership for every app-pool login.
--
-- HISTORY — the per-product role ladders are GONE. This file used to create
-- lms/hr/task.roles (per-product role CATALOGS), lms/hr/task.member_roles (the
-- (user, org) role GRANTS), <product>.fn_member_rank / fn_member_role and
-- <product>.vw_member_roles, plus public.set_member_role_tenant_id(). Tier C
-- consolidated ALL role/rank/department resolution onto the single iam ladder
-- (iam.user_roles + iam.fn_user_org_role), so every product service reads one
-- ladder and page guards can no longer disagree with services. The per-product
-- objects had no remaining readers and were dropped — see
-- db_scripts/15_drop_per_product_roles.sql for the teardown that removes them
-- from an existing database.
-- iam.users.platform_role lives directly on iam.users (02_schema.sql).
-- Idempotent: safe to re-run.
-- ===================================================================


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
-- 11_init-leave-management.sql, 13_init-attendance.sql, 14_init-tasks.sql
-- already applied.
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

-- comms is shared, not a product schema: every product sends messages, so all
-- three logins read the template catalog. Read-only — the catalog is seeded and
-- administered, never written on the send path.
GRANT USAGE ON SCHEMA public, iam, entity, geo, comms, lms, marketing, ext TO lms_svc;
GRANT USAGE ON SCHEMA public, iam, entity, geo, comms, hr                  TO hr_svc;
GRANT USAGE ON SCHEMA public, iam, entity, geo, comms, task                TO task_svc;


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
-- every product. This is now the ONLY role-assignment surface: the
-- per-product member_roles tables that P1.3 was going to move it onto were
-- dropped when Tier C unified the ladder.
-- ===================================================================
GRANT SELECT ON ALL TABLES IN SCHEMA geo, entity TO lms_svc, hr_svc, task_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA iam         TO lms_svc, hr_svc, task_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA comms       TO lms_svc, hr_svc, task_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE iam.users, iam.user_org_mapping
  TO lms_svc, hr_svc, task_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA geo    GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA entity GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam    GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA comms  GRANT SELECT ON TABLES TO lms_svc, hr_svc, task_svc;


-- ===================================================================
-- 5. Own-schema DML — mirror exactly what app_user already has on each
-- product's own tables (same tiers as 01_init-db.sql / 10/11/13/14),
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

ALTER DEFAULT PRIVILEGES IN SCHEMA lms       GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketing GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ext       GRANT SELECT, INSERT, UPDATE ON TABLES TO lms_svc;

-- ── hr_svc: hr ──────────────────────────────────────────────────────
GRANT SELECT         ON TABLE hr.employment_types, hr.leave_types, hr.leave_request_statuses, hr.attendance_statuses TO hr_svc;
-- hr.departments moved to iam.departments (Tier C); hr_svc write grant on it is
-- in db_scripts/06_rls.sql alongside the iam.departments RLS.
GRANT SELECT, INSERT, UPDATE ON TABLE hr.designations, hr.employee_profiles TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.holiday_calendars, hr.holidays TO hr_svc;
GRANT SELECT                 ON TABLE hr.leave_policies, hr.hr_settings TO hr_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE hr.leave_requests, hr.leave_request_approvals TO hr_svc;
GRANT SELECT                 ON TABLE hr.leave_request_status_log, hr.leave_ledger TO hr_svc;
-- hr.shift_segments must be named explicitly, exactly like hr.shifts: the
-- ALTER DEFAULT PRIVILEGES below only affects tables created AFTER it runs, and
-- 03_product_schema.sql creates every hr table before this file executes. An
-- existing database can appear to work anyway (the default ACL is already in
-- place from a prior deploy, so a table added later inherits it) while a fresh
-- install ends up with zero hr_svc privilege on the table -- create-shift then
-- fails on the segment INSERT with "permission denied".
GRANT SELECT, INSERT, UPDATE ON TABLE hr.attendance_rules, hr.shifts, hr.shift_segments, hr.shift_assignments, hr.attendance_regularizations TO hr_svc;
GRANT SELECT, INSERT         ON TABLE hr.attendance_events TO hr_svc;
GRANT SELECT                 ON TABLE hr.attendance_days TO hr_svc;
GRANT SELECT ON TABLE
  hr.vw_leave_balances, hr.vw_leave_requests_enriched, hr.vw_team_leave_calendar,
  hr.vw_attendance_monthly_summary, hr.vw_org_attendance_today
  TO hr_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA hr GRANT SELECT, INSERT, UPDATE ON TABLES TO hr_svc;

-- ── task_svc: task ──────────────────────────────────────────────────
GRANT SELECT                 ON TABLE task.task_statuses, task.task_priorities TO task_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE task.task_lists, task.tasks TO task_svc;
GRANT SELECT                 ON TABLE task.task_status_log TO task_svc;
GRANT SELECT, INSERT         ON TABLE task.task_comments TO task_svc;
GRANT SELECT                 ON TABLE task.vw_tasks_enriched TO task_svc;

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
-- RESOLVER EXECUTE GRANTS (historically 20_member-role-resolver-fn.sql)
--
-- The per-product resolvers <product>.fn_member_role(user, org) that this
-- section used to define are GONE — Tier C replaced them with the single
-- iam.fn_user_org_role. What remains is the EXECUTE grants each product login
-- needs on the unified resolvers, declared here because these logins are
-- created above (and in 03), i.e. after 02_schema.sql defines the functions.
-- ===================================================================

BEGIN;

-- Tier C: every product service resolves role/rank/department from the one
-- iam ladder via iam.fn_user_org_role (see 02_schema.sql), so each product login
-- needs EXECUTE on it.
GRANT EXECUTE ON FUNCTION iam.fn_user_org_role(UUID, UUID) TO lms_svc, hr_svc, task_svc, lead_svc;

-- Tier C3: same for the capability matrix, which every service loads at startup.
GRANT EXECUTE ON FUNCTION iam.fn_role_capability_matrix(UUID) TO lms_svc, hr_svc, task_svc, lead_svc;

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
  ('1.14.0', 'P1.3: resolver EXECUTE grants for per-service role resolution (per-product fn_member_role resolvers since removed — superseded by iam.fn_user_org_role)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.15.0', 'P0 #1: readonly_user role (INHERITs app_user) + read-only transaction for read_only actors')
ON CONFLICT (version) DO NOTHING;

COMMIT;
