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

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.30.0', 'Per-employee geofence exemptions: hr.attendance_geo_exceptions (effective-dated, gist no-overlap scoped by type) names the people allowed to punch outside the fence — exception_type ''remote_role'' for rotating/field roles, ''wfh'' for an approved work-from-home stretch — replacing the all-or-nothing, self-declared attendance_rules.allow_wfh_checkin as the way to handle the few. hr.attendance_events.geo_exception_type records which kind let a punch through, so field work is never counted as working from home; a ''wfh'' exemption also sets is_wfh server-side, with no checkbox for the employee to forget or misuse.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.31.0', 'ext.meta_page_form_org_map.form_id made nullable for page-level Meta lead routing: a row with form_id NULL subscribes to every leadgen form on that Page, routing them all to the row''s org; an explicit form_id row still wins over the page-level fallback for pages shared across multiple orgs. New partial unique index uq_meta_page_form_org_map_page_level enforces at most one active page-level row per page.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.32.0', 'Public daily lead report page: lms.lead_report_snapshot (one row per branch+assignee per day, RLS-guarded, written by the existing send-lead-report cron job) so day-over-day comparison has history to read; branch/tenant rollups are derived via GROUPING SETS at read time rather than stored. New auth-constants scope lead-report:read on the existing iam.api_clients credential system — no new token table or issuance endpoint.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.33.0', 'Meta lead platform now sourced per-lead from Meta''s Graph API response (webhook + backfill scripts) instead of only the static ext.meta_page_form_org_map.platform config value, which had been defaulting nearly every Page/Form mapping to fb regardless of true placement. platform CHECK widened fb/ig -> fb/ig/wa on ext.meta_page_form_org_map and ext.meta_leads to support WhatsApp-sourced Lead Ads leads; lms.lead_sources.whatsapp (already seeded) is now reachable from ingestion.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.34.0', 'lms.lead_report_snapshot gains source_id/source_label so the public lead report''s per-source grids can compare against a prior day, not just live data. Unique key widened to (tenant_id, org_id, assigned_user_id, source_id, report_date); existing rows backfilled to source_id NULL / source_label ''Unknown''. send-lead-report.ts now writes one row per (branch, assignee, source) plus zero-fill placeholders per (branch, source), sourced from the same getTenantSourceReport() query the live page uses.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.35.0', 'New capability lms.history.detail.view — the Lead History dialog opened from a Leads History row now carries its own permission under the lms.history page instead of borrowing lms.leads.view / lms.leads.timeline.view from the Leads page. Denying the Leads page to org_admin/tenant_admin (2026-08-07) pruned those two operations and broke the dialog on a page both roles still hold. leads-service gains requireAnyCapability and accepts either key on GET /leads/:id, /leads/:id/timeline and /leads/:id/form-data; row scoping is untouched and still comes from lms.history.view''s scope ladder plus RLS. Back-filled for every role already holding lms.history.view, platform-default and per-tenant copies alike.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.36.0', 'Dedup-superseded leads (marketing_leads.superseded_by IS NOT NULL — an old lead replaced by a newer submission with the same org_id+phone/email) were only excluded from the daily lead-report views, leaking into every other operational surface: the main leads list, follow-up queue, org/tenant dashboards, rep leaderboard, and lead assignment endpoints. lms.vw_org_performance_snapshot, lms.vw_tenant_full_dashboard and lms.vw_rep_performance now additionally filter superseded_by IS NULL, matching the pattern vw_lead_report_branch/user already used; lms.vw_dashboard_leads is left unfiltered by design since its callers (leads-service listLeads/listFollowUps/assignments queries) now apply the same filter themselves so a direct-ID lookup (getLeadById) can still resolve a superseded lead.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.37.0', 'Lead assignment authority is now the capability ladder everywhere. iam.can_assign_to stopped resolving WHOM you may assign to from iam.reporting_lines (iam.fn_is_in_subtree) and now reads the seeded lms.leads.assign.reports/.peers/.any scopes against the target''s rank, matching @lms/authz''s canAssignToUser so the two write paths into a lead''s assignee — POST /assignments, and PATCH /leads/:id plus follow-up assignment — can no longer disagree. Under the old subtree rule, granting a role lms.leads.assign.peers had NO effect on the PATCH path, because a peer is by definition not in your reporting subtree; the seeded scope description ("Only people ranked below them") had always described rank, not reporting line. The three assign scopes are read in a single iam.fn_role_capability_matrix scan, so SQL and application code resolve tenant-override precedence and ancestor pruning identically; measured on production a matrix build is ~35ms warm, so one scan replaces what would have been ~100ms of per-key probing on every assignment write. Self-assignment stays unconditional on both paths. iam.reporting_lines remains the authority for hr.can_approve_leave and Tasks team scope — only lead assignment stopped reading it. No new capabilities, tables or RLS; lms.leads.assign.peers'' description text updated (self no longer depends on that rung).')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.38.0', 'Lead follow-up scheduling is now enforced where the data lives, and an assignment note finally persists. lms.log_lead_assignment() reads the app.lead_transition_note GUC and writes lms.lead_assignment_log.note — a column that existed since the table was created and that nothing had ever populated: the Edit Lead dialog demanded a note for an assignment-only change and then dropped it, because lms.log_lead_stage_change() returns early when neither stage_id nor outcome_id moved and no other trigger recorded it. The assignment_change branch of lms.vw_lead_followup_timeline appends that note to its generated sentence so Lead History shows it. Notes are no longer mandatory client-side for a bare re-assignment; they remain mandatory for stage, outcome and follow-up changes, which are the edits the audit log actually keeps. Separately, leads-service now rejects any PATCH /leads/:id that would leave a lead in a stage with lead_stage.followup_required and marketing_leads.scheduled_at NULL — previously that rule lived only in the Edit Lead dialog, so a script, an integration, or the dialog itself when its stage-catalog fetch failed could park a lead in contacting/on_hold/qualified with no due time, making it invisible to the notifications-service poller (which requires scheduled_at IS NOT NULL) and to every overdue count. The follow-up is now created inside the same transaction as the stage move via the new follow_up_scheduled_at field, completing a follow-up on a lead still in such a stage requires the next due time, deleting a follow-up re-derives the pointer from the surviving pending row instead of leaving it dangling, and moving a lead out of a follow-up stage clears the stale timestamp. New partial index idx_marketing_leads_scheduled_at backs the poller and the overdue filters, which had been scanning unindexed.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.39.0', 'Lookup Admin coverage: hr.leave_request_statuses onboarded (hr-service /lookups/leave-request-statuses, reserved-name guard on its machine vocabulary); iam.departments becomes writable (was list-only, and was the required parent of iam.user_roles — a tenant with no seeded department could not have a role created for it); hr.designations onboarded as the console''s first org-scoped (rather than tenant-scoped) table, requiring a new admin_tenant_config_policy on hr.designations since hr_svc holds only app_user membership (07_grants.sql) and the table had no write path for a super_admin acting within a selected tenant+org — org_isolation_policy needs app.current_org_id (never set by the admin write helper) and tenant_isolation_policy needs the tenant_admin PG role hr_svc does not hold.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.40.0', 'Tier C cleanup: dropped the P1.1 per-product role ladders — lms/hr/task.roles + .member_roles, fn_member_rank, fn_member_role, vw_member_roles, public.set_member_role_tenant_id() and their catalog_defaults/catalog_versions seed rows (lms.roles/hr.roles/task.roles) — and their lookup-admin CRUD screens/routers. member_roles was never written by any code path (verified against a prod-restored copy: its populated rows trace to a since-removed backfill from iam.user_org_mapping); role/rank resolution has run on the single iam ladder via iam.fn_user_org_role since Tier C. api-gateway''s communicationSendGuard, the last reader, now calls resolveGlobalRole instead of the removed resolveMemberRole. See db_scripts/one_time for the one-off drop script for servers already carrying these objects.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.41.0', 'Lookup Admin coverage continued: hr.holiday_calendars/holidays/shifts onboarded as org-scoped lookups, each needing the same admin_tenant_config_policy added for hr.designations in 1.39.0 and for the same reason (hr_svc has no path to write an org-scoped table as app_user without app.current_org_id, nor as tenant_admin without the PG role). ext.meta_capi_event_types (global) and ext.lead_stage_capi_event_map (tenant-scoped, already RLS-covered by its existing admin_tenant_config_policy from 1.25.0) also gain admin surfaces; entity.tenant_modules becomes editable per tenant (previously SQL-only); entity.catalog_versions/tenant_catalog_versions gain a read-only drift report.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.42.0', 'Daily lead report now counts the whole lead catalog, not just the handful of metrics a screen happened to show. lms.vw_lead_report_branch and lms.vw_lead_report_user carry 29 metrics in one fixed grouped order — 6 core, one per lms.lead_stage (adding contacting/on_hold/qualified/transferred_out), and one per non-"other" lms.lead_stage_outcome (16, oc_ prefixed so the on_hold STAGE and on_hold OUTCOME do not collide on a column name), reached through a new LEFT JOIN lms.lead_stage_outcome on marketing_leads.outcome_id. Both views changed from CREATE OR REPLACE to DROP + CREATE: replace can only append columns and never reposition them, which is how new_leads_this_month had ended up stranded after snapshot_at, and appending 20 more would have compounded it. lms.lead_report_snapshot is dropped and recreated with the same 29 columns in the same order — its rows are day-over-day comparison history only, are not backfillable in any case (stage/outcome have moved since capture), and the page already degrades to "No snapshot recorded" for a missing date. The point of capturing every stage/outcome now rather than one at a time: a live counter can be added whenever and is instantly correct for all history because it is computed from marketing_leads on read, but the snapshot is the half that can never be recovered — a metric not captured today has no comparison tomorrow. Counters are CURRENT STATE (stage_id/outcome_id as the lead reads right now; outcome_id is overwritten when the lead moves on, so a lead that visited then converted leaves oc_visited_count and joins converted_count). Consumed by leads-service, which generates its SUM/INSERT/ON CONFLICT column lists from a single METRIC_KEYS list so the four declarations cannot silently drift; adding a KPI card or a grid column is now a UI-only change.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.43.0', 'Creating a user is now authorized by the lms.users.manage CAPABILITY evaluated per TARGET BRANCH, not by a rank-980 floor pinned to the session org. New iam.fn_user_can_manage_users(user, org) — modelled on iam.can_assign_to, resolving the role through iam.fn_user_org_role and the grant through iam.fn_role_capability_matrix, so SQL and @platform/db''s capability cache answer the question identically (tenant override > platform default > deny, and an ancestor resolving FALSE prunes its subtree). It returns TRUE unconditionally for org_admin/tenant_admin/super_admin, so no permission that existed before was removed. Five write policies moved off `iam.fn_user_org_rank(...) >= 980` onto it: org_admin_read/insert/update_policy on iam.user_org_mapping, users_org_write on iam.users, and org_admin_manage_policy on iam.reporting_lines (a create that supplies manager_id writes there too, so it had to move in the same step). Before this, granting lms.users.manage to a tenant-defined role was inert — the button appeared, identity-service''s rank>=40 gate passed, and the INSERT was refused by RLS as "new row violates row-level security policy", surfacing to the operator as a 403 they could only fix by handing out org_admin. The second half of the change is reach: each policy now tests `org_id = ANY(iam.fn_user_active_orgs(actor))` against THE ROW''S org_id rather than app.current_org_id, because iam.user_org_mapping is many-to-many — an actor mapped into several branches administers users in all of them without switching branch first. The tenant boundary is unchanged: every org in that array is one the actor holds a mapping row for, and tenant_isolation_policy still fences the tenant_admin pool. identity-service''s users.controller.create swapped its rank>=40 throw for the same capability check and resolveAssignments now validates each target branch against membership+capability instead of checkMoveUserBranchAccess''s platform_role test; the rank CEILING checks (canGrantRole, canManageUser) are untouched, since "who outranks whom" stayed a rank question. users_org_update on iam.users deliberately keeps the narrower org_id = current_org_id rule — editing an existing user across branches is a separate change. Existing databases: db_scripts/one_time/apply_user_create_capability_authz.sql.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.44.0', 'lead_assignment_weight moves off iam.user_org_mapping into lms.lead_assignment_weights, and iam.user_org_mapping gains a surrogate id for extension tables to key off. The column was pure LMS on the platform''s most shared table: only leads-service''s resolveAutoAssignedUser and its Python port in meta-sync-scripts ever read it, no SQL function/trigger/view touched it, and iam.vw_user_org_access did not even expose it — while iam.user_org_mapping is what iam.fn_user_active_orgs, the reporting-line membership check and most RLS policies are built on. Leaving it there meant every product wanting a per-branch, per-user setting would add its own column to that one table. The new shape is a reusable pattern rather than a one-off: iam.user_org_mapping.id (UUID, DEFAULT public.gen_uuidv7(), UNIQUE — NOT the primary key, which stays (user_id, org_id) so that every ON CONFLICT upsert in identity-service is unchanged and "one membership per user per branch" is still a PK guarantee), and product extension tables live in the OWNING product''s schema keyed by user_org_mapping_id ON DELETE CASCADE. lms.lead_assignment_weights is the first: no row means weight 0, which the picker already treats as out-of-rotation, so absence and an explicit zero are the same thing and only non-zero weights were backfilled. Because the extension table has no org_id of its own, RLS resolves it through a new SECURITY DEFINER helper iam.fn_mapping_org(mapping_id) — an inline subquery into iam.user_org_mapping would be re-filtered by that table''s own FORCE''d policies and return NULL, turning every extension policy silently FALSE instead of raising. Its four policies are org_admin_read/insert/update_policy and tenant_isolation_policy from iam.user_org_mapping with the row''s org_id replaced by that call, so the weight row is reachable exactly when its membership row is. lms.vw_lead_assignment_weights restores the flat (user_id, org_id, weight) shape the one_time/ and tools/ operator scripts query by branch. identity-service still owns every write (the user create/edit payload carries weights alongside branch/role, so the API contract and the UserForm are unchanged, field name included); leads-service only reads, via an INNER JOIN that subsumes the old weight > 0 filter. Also fixes moveUserBranch, which never handled weight at all — it left the source branch''s weight orphaned on the deactivated mapping and started the destination at 0. Existing databases: db_scripts/one_time/move_lead_assignment_weight_to_lms.sql.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.45.0', 'Capability namespace split, so the tenant admin console can gate its screens by permission instead of rank. `admin` was the PLATFORM OPERATOR namespace (lookup-admin: lookups, roles.manage) and unassignable to any tenant role — admin-service''s putGrants refuses it below super_admin, since admin.roles.manage DEFINES grants and would let a holder grant themselves anything. Meanwhile admin-web, the TENANT console, had no namespace at all: it borrowed platform.write for Team behind a rank-980 layout floor, so a role granted the directory capability still could not reach the screen. The operator keys move to a new `superadmin` root (iam.capabilities + @platform/rbac isSuperAdminCapability, renamed from isPlatformAdminCapability; the Capability Matrix now HIDES that subtree rather than rendering it locked, while putGrants keeps refusing it — the hide is an affordance, not the boundary). `admin` is re-created as the tenant console tool and takes two pages: admin.team (was lms.users — the directory manages fitness/HR/every user and is mounted outside the CRM) and admin.api_tokens (was platform.api_tokens — a console screen, so it sits with the console''s others; platform.* keeps only platform.write, which is behaviour everywhere rather than a screen). Renames, not aliases, per the platform.api_tokens precedent: exactly one name per capability. CRITICAL COUPLING: iam.fn_user_can_manage_users resolves ''admin.team.manage'' (was ''lms.users.manage'') and the ~9 write policies in 08_rls.sql call it, so the function and the grants must move in one transaction — anchor roles short-circuit to TRUE before the lookup, so only tenant-defined roles are exposed and only they prove the migration. Grants carry is_granted through unchanged so explicit denies survive, and every role holding an admin.* child is also granted the `admin` tool, without which the child resolves to nothing.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.46.0', 'New capability admin.team.notify (operation under admin.team), plus its default grant on org_admin and tenant_admin and a per-tenant back-fill pinned to admin.team.manage in reference_data/03_roles_and_grants.sql. It gates the "Notify user by email" checkbox on the Team create / reset-password / branch-change forms: identity-service''s users.controller checks it (hasCapability, alongside the existing rank>=ORG_ADMIN short-circuit) before users.service fires a fire-and-forget email through communication-service /api/v1/communications/public-send for user_created, password_reset_by_admin and branch/home-branch changes. Pure authorization for an outbound notification — NOT an RLS boundary, so unlike admin.team.manage it has no iam.fn_user_can_manage_users / 08_rls.sql coupling and stands alone. No table, column, policy, function or view change; this row exists only so a fresh db_deploy reports the same version as a server seeded incrementally. Existing databases: db_scripts/one_time/apply_admin_team_notify_capability.sql (idempotent INSERT ... ON CONFLICT of the node + grants).')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.47.0', 'New notify schema and notify.push_subscriptions: Web Push subscriptions, one row per installed PWA + browser + device that has granted the Notification permission. Platform-wide on purpose, NOT under lms -- notifications-service is only the first consumer (follow-up due); hr-service (leave approved/rejected) and tasks-service (task assigned) are expected to follow, and a shared-tier schema is what keeps the second and third consumer from being a schema change. Same reasoning that put comms there. endpoint (the push service URL issued by the browser vendor) is the NATURAL KEY and is UNIQUE: the client re-registers on every launch -- deleting the Home Screen icon destroys the subscription and a fresh install issues a new endpoint -- so the subscribe path must be INSERT ... ON CONFLICT (endpoint) DO UPDATE or it accumulates one row per launch. p256dh/auth are the client public key and auth secret needed to encrypt a payload for that endpoint; user_agent is a debugging aid; last_used_at is stamped on each successful send so a pruning job can find registrations that went quiet without waiting for a 410. Rows are HARD-deleted (unsubscribe, and 404/410 Gone pruning) -- a dead device registration has nothing to audit, so the is_deleted/soft_delete_row recipe used by the domain tables is deliberately not applied. One index, (user_id, org_id): the sender lookup on every notification. RLS is ENABLE + FORCE with a DELIBERATE DEPARTURE from the org-only pattern every other table in 08_rls.sql follows -- the app_user policy constrains user_id AS WELL AS org_id. A push subscription is PERSONAL, not org-shared: with org isolation alone any colleague in the branch could SELECT the endpoint/p256dh/auth triple, which is everything needed to push a notification to that person''s locked phone, or DELETE the row and silently stop their alerts. tenant_isolation_policy stays tenant-scoped (same subquery shape as lms.lead_links) so an admin can prune dead registrations across branches. notifications-service reaches the table through root_service (DATABASE_URL_SERVICE / withServiceTx), which bypasses RLS because a send fans out to every device of the target user with no app session to scope it; the policies therefore guard incidental access from authenticated app sessions, the same reasoning already written above lms.lead_report_snapshot. Mirrored in @platform/db as notifySchema + pushSubscriptionsTable. Existing databases: db_scripts/one_time/apply_notify_push_subscriptions.sql (idempotent CREATE SCHEMA/TABLE IF NOT EXISTS + index, grants, RLS). This row originally shipped WITHOUT that script, and the omission is why every server seeded before 1.47.0 -- UAT and production alike -- had no table at all: db_scripts/00-10 are applied by Postgres'' init hook, which runs only on a database''s FIRST boot, so a later CREATE TABLE reaches a fresh db_deploy and nothing else. The symptom is total, not partial: POST /notifications/push/subscribe answers 500 with PostgresError 42P01 relation "notify.push_subscriptions" does not exist, no device can register, and no follow-up notification is ever delivered. It reads as device-specific because usePushSubscription''s mount reconciler swallows the identical failure on a browser that already granted permission, so only the handset where someone actually pressed Turn on reports an error.')
  ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.48.0', 'iam.users.email now has exactly ONE canonical spelling -- trimmed and lowercase -- on the way in, at every write path and in the login comparison. The column is a plain TEXT NOT NULL UNIQUE, and that UNIQUE is case-SENSITIVE, which produced two defects on the platform''s primary login credential: a user created as John.Doe@x.com could NOT sign in as john.doe@x.com (identity-service''s getUserByEmail is an equality test, u.email = $1, so a different casing matched no row and returned the generic invalid-credentials failure), and John.Doe@x.com plus john.doe@x.com could BOTH be created as separate accounts -- the UNIQUE did not collide, so asDuplicateUserConflict never fired and one person ended up with two identities, two sets of branch mappings and two audit trails. This is the same problem mobile solved when it became a login credential, and it is fixed the same way: new normalizeEmail() + emailInputSchema in @platform/validation (packages/platform-validation/src/email.ts) is the single normalizer, called by createUserSchema and updateUserSchema on the write path and by resolveLoginUser on the login path -- exactly where normalizeMobile() sits. One zod transform covers every writer because there IS only one: api-gateway proxies all /users writes to identity-service, /api/v1/public/users is GET-only, both consoles post to that same route, no other service writes the column, and there is no self-service signup, invite-accept, forgot-password or email-verification flow (admin reset is keyed by user id). New CONSTRAINT chk_users_email_lowercase CHECK (email = lower(email)) is the database half. A CHECK rather than citext (not enabled in this database, and an extension is a heavier answer than a constraint for one column) and rather than a UNIQUE INDEX on lower(email) (redundant once every stored value is already lowercase, and it would break the ON CONFLICT (email) upserts in dummy_data/): the CHECK makes an un-normalized writer -- an operator script, a psql session -- fail loudly at the point of the mistake instead of silently forking an identity. No index DDL changed; idx_users_org_email stays a plain-value index and becomes MORE useful, since an equality lookup on a guaranteed-lowercase column can now use it. normalizeEmail is deliberately case + whitespace ONLY -- no dot-stripping, no plus-tag removal, because those are provider-specific (Gmail) and would silently merge addresses that are distinct subscribers everywhere else. The audit target logged by auth.service on a failed login deliberately keeps the RAW identifier: it is the forensic record of what was actually typed, and audit.fn_detect_password_spray groups on it -- grouping is marginally looser across case variants, which is preferable to rewriting history. NOT fixed here, and still open: lms.marketing_leads.email and ext.meta_leads.email carry the identical case-sensitive dedup bug (uix_marketing_leads_org_email, and the AND email = $1 dedup in leads-service intake). Lead intake has its own dedup semantics and feeds the Meta CAPI hash, so it is a separate change. Existing databases: db_scripts/one_time/apply_email_lowercase.sql, which ABORTS with the offending rows listed if two live accounts (or a live and a soft-deleted one) differ only by case -- which row survives is an operational decision, not the script''s.')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
