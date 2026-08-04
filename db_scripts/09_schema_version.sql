-- ===================================================================
-- 09_schema_version.sql
--
-- Records the schema increments this consolidated set represents.
-- Kept as one file so the version history is not scattered across
-- the object-type scripts.
--
-- This file must record EVERY version whose end state 00-08 and 10 build,
-- so that a fresh db_deploy.ps1 install reports the same version history as
-- a server that got there incrementally. Add a row here whenever you change
-- the schema; the description is the only record of WHY a change was made,
-- since the scripts themselves only show the current shape.
-- ===================================================================

BEGIN;

-- ===================================================================
-- SCHEMA VERSION TRACKING — Meta Conversion API and the pre-monorepo base.
-- Recorded here because 00-08 already build their end state; they predate
-- this file and were previously only mentioned in the NOTE comments below.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.0.0', 'Merged monorepo + EXISTING_WORKING_CODE: geo tables, soft-delete, business-rule triggers, audit triggers, service logins')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.1.0', 'iam.user_org_mapping table, legal_entity_name/brand_name on entity.organizations, fixed multi-org RLS gaps')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.2.0', 'Meta Conversion API: ext.meta_org_config, ext.meta_leads, ext.meta_lead_custom_fields, ext.meta_capi_outbound_logs')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.3.0', 'Meta Conversion API: ext.meta_lead_addresses, ext.meta_lead_professional, ext.meta_lead_demographics, ext.meta_org_config.field_mappings, extended ext.view_meta_leads_complete')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.4.0', 'Meta Conversion API: tenant-level app config (ext.meta_tenant_config replaces per-org ext.meta_org_config) + ext.meta_page_form_org_map for Page/Form -> org attribution, ext.meta_leads.page_id')
ON CONFLICT (version) DO NOTHING;

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- NOTE: prompt requested '1.3.0', but 1.3.0 and 1.4.0 are already consumed by
-- the Meta CAPI work in 01_init-lookup-data.sql — using the next free version.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.5.0', 'hr/task schemas, hr_svc/task_svc roles, entity.tenant_modules, HR lookups, hr.departments/designations, hr.employee_profiles, hr_admin role')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- 8. SCHEMA VERSION TRACKING
-- NOTE: prompt requested '1.4.0', but 1.0.0–1.4.0 (Meta CAPI) and 1.5.0
-- (hr/task foundation) are already consumed — using the next free version,
-- matching the precedent set in 10_init-hr-task-schemas.sql.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.6.0', 'Leave management: hr.holiday_calendars/holidays, leave_policies, hr_settings, leave_ledger, leave_requests (+status log), leave_request_approvals, hr.can_approve_leave(), leave views')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.6.1', 'Leave ledger accrual idempotency: unique (user, leave_type, entry_type, period) for accrual/carry_forward')
ON CONFLICT (version) DO NOTHING;


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
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.15.0', 'P2.2A: effective-dated hr.reporting_lines (tenant/org scoped, RLS, no-overlap exclusion) as the HR approval-chain source of truth; backfilled from iam.users.manager_id, which degrades to an optional default')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- 7. SCHEMA VERSION TRACKING
-- NOTE: the prompt requested '1.6.0', but 1.0.0–1.7.0 are already consumed
-- (Meta CAPI, hr/task foundation, leave management, attendance) — using the next
-- free version, matching the precedent set in 10_, 11_ and 13_.
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.8.0', 'Tasks: task.task_statuses/task_priorities lookups, task.task_lists (owner-private RLS), task.tasks (+ status log + completion trigger), task.task_comments, task.vw_tasks_enriched')
ON CONFLICT (version) DO NOTHING;


-- NOTE: iam.users.platform_role now lives directly in iam.users' CREATE
-- TABLE (02_schema.sql) -- originally added here via ALTER TABLE ... ADD
-- COLUMN IF NOT EXISTS.


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.11.0', 'P1.1 Phase A (expand): per-product role catalogs (lms/hr/task.roles) + grants (member_roles) with RLS + fn_member_rank + vw_member_roles + iam.users.platform_role (nullable); global iam.user_roles ladder untouched')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.12.0', 'P1.1 Phase B (backfill): iam.users.platform_role + lms/hr/task.member_roles populated from iam.user_org_mapping ladder; idempotent, old ladder untouched')
ON CONFLICT (version) DO NOTHING;


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

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.14.0', 'P1.3: <product>.fn_member_role(user,org) -> (role,rank) resolver for per-service product-role resolution')
ON CONFLICT (version) DO NOTHING;

-- NOTE: an insert claiming '1.15.0' for 'P0 #1: readonly_user role' used to sit
-- here. 1.15.0 was already taken by P2.2A (hr.reporting_lines, above), so
-- ON CONFLICT silently dropped it on every install and the deployed databases
-- all carry the P2.2A description. Removed rather than renumbered: minting a
-- free version would give fresh installs a row no existing server has, which is
-- the same divergence this file exists to prevent. The readonly_user role is
-- asserted declaratively in 00_extensions_schemas_roles.sql.


-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.17.0', 'Tenant default seeding: entity.catalog_defaults/catalog_versions (versioned per-product default catalogs) + entity.tenant_catalog_versions (per-tenant provisioning record, RLS) + entity.seed_tenant_defaults()/reset_tenant_catalog() functions; seeds v1 defaults for the 8 tenant-scoped lookups and backfills existing tenants')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.18.0', 'N-6 Half A: tenant-scoped admin write RLS + product-role write GRANTs on the 8 tenant-scoped lookup/role tables (lms.roles; hr.leave_types/employment_types/attendance_statuses/roles; task.task_statuses/task_priorities/roles) so product services own super_admin lookup writes without BYPASSRLS')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.20.0', 'Ladder roles hr_admin/org_sr_manager/org_manager/senior_sales_executive/sales_representative cloned per tenant (with capability grants) and repointed; only the four anchors super_admin/tenant_admin/org_admin/read_only remain global')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.23.0', 'Anchor roles tenant_admin/org_admin/read_only cloned per tenant (with capability grants) and repointed; super_admin is now the only global role')
  ON CONFLICT (version) DO NOTHING;

-- 1.24.0-1.26.0 were applied to the existing servers as one-off transforms
-- (geo PKs retyped to UUID, two tables given a tenant_id) before those scripts
-- were retired. 02/03 declare their end state, so a fresh install is already at
-- this level the moment it is built and must say so.
INSERT INTO public.schema_versions (version, description) VALUES
  ('1.24.0', 'geo.countries/states/cities become a tenant-scoped catalog: UUID v7 PKs (was SMALLINT/INTEGER identity), tenant_id (NULL = platform template, cloned by entity.seed_tenant_geo()), is_active soft delete, RLS + tenant_admin writes, composite (tenant_id, x_id) FKs from entity.organizations; lms.marketing_leads geo FKs retyped to UUID and fenced by lms.check_lead_fk_org_scope(). Pre-migration tables archived in schema geo_archive.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.25.0', 'ext.lead_stage_capi_event_map tenant-scoped: tenant_id backfilled from lms.lead_stage (NULL = platform template), composite (tenant_id, stage_id) FK, RLS + write policy. Closes a cross-tenant read/write hole - app_user held SELECT/INSERT/UPDATE on a table with no tenant column and no RLS, so any tenant could read and repoint another tenant''s Meta conversion-event wiring. ext.vw_lead_stage_capi_event_map also gains security_invoker, without which it would leak past the new RLS.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.26.0', 'Three lookups tenants could not see. marketing.marketing_platforms/campaign_statuses: global UNIQUE (name) on an already tenant-scoped table made cloning impossible, so they were never provisioned and every tenant saw an empty dropdown - unique is now (tenant_id, name), templates cloned per tenant, and entity.seed_tenant_lms_catalogs() covers them going forward. hr.leave_request_statuses: the only one of four HR lookups left global - now tenant-scoped with RLS and provisioned from the catalog registry like its siblings.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.27.0', 'P4: single platform reporting hierarchy — hr.reporting_lines becomes iam.reporting_lines, read by LMS/HR/Tasks alike via iam.fn_is_in_subtree/fn_subtree_members/fn_manager_chain (effective-dated, as-of queryable); cross-org managers require an iam.user_org_mapping row; iam.users.manager_id demoted to a display mirror')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.28.0', 'Attendance regularizations escalate up the same iam.reporting_lines chain as leave: hr.attendance_regularization_approvals (one row per level) + hr.attendance_rules.regularization_approval_levels; hr_admin/org_admin/tenant_admin remain the any-level exception via hr.can_approve')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.29.0', 'hr.attendance_rules becomes tenant-scoped with an org override (tenant_id + nullable org_id, hr_settings-style precedence) and gains regularization_max_backdate_days — the admin-set window, in days, for how far back an attendance regularization may be filed; future-dated requests are always rejected')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
