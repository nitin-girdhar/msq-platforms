-- ===================================================================
-- reference_data/03_roles_and_grants.sql — Roles and platform-default grants
--
-- super_admin is the only role that stays global at runtime: it acts
-- across tenants, so no single tenant could own it.
-- 
-- Every other role here is a TEMPLATE (tenant_id IS NULL). It is never
-- used directly — entity.seed_tenant_rbac() copies it, with its grants,
-- into each tenant. Tenant-scoped RLS hides the templates from ordinary
-- users, so a tenant only ever sees its own copies.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- IAM -- USER ROLES
-- ===================================================================

-- Tier C: these are GLOBAL anchor/default roles (tenant_id NULL), shared by every
-- tenant. The four true anchors (read_only / org_admin / tenant_admin / super_admin)
-- carry the fixed ranks defined in @platform/rbac — 0 / 980 / 990 / 1000 — leaving
-- the 1..979 band for tenant-specific, department-driven roles. The remaining rows
-- are global defaults a tenant can later fork into its own department roles.
-- The name unique index is now partial (WHERE tenant_id IS NULL), so the conflict
-- target names that predicate.
INSERT INTO iam.user_roles (name, label, description, rank) VALUES
  ('read_only',               'Read Only',              'Read-only viewer — dashboards and reports only',                                    0),
  ('sales_representative',    'Sales Representative',   'Front-line sales — manages own assigned leads and follow-ups',                     20),
  ('senior_sales_executive',  'Senior Sales Executive', 'Senior Sales Executive — manages a team of sales reps; reports to org_manager',    40),
  ('org_manager',             'Manager',                'Manages a team of Senior Sales Executives and reps within an org',                 60),
  ('org_sr_manager',          'Senior Manager',         'Manages a team of managers and reps within an org',                               70),
  ('hr_admin',                'HR Admin',               'Manages HR — employee profiles, leave policies, attendance; no CRM/lead access',   75),
  ('org_admin',               'Admin',                  'Org-level admin — full control within one org',                                  980),
  ('tenant_admin',            'Tenant Admin',           'Tenant-level admin — manages all orgs under the tenant',                         990),
  ('super_admin',             'Super Admin',            'Platform-level superuser — SaaS admin only',                                    1000)
ON CONFLICT (name) WHERE tenant_id IS NULL DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  rank        = EXCLUDED.rank;


-- ===================================================================
-- TIER C3 -- PLATFORM DEFAULT GRANTS
-- ===================================================================
-- tenant_id NULL = the shipped default, shared by every tenant. A tenant
-- reshapes access by inserting its own row for the same (role, capability),
-- which wins; is_granted = FALSE is how it revokes a default.
--
-- These lists are EXPLICIT on purpose. Every other seed in this file derives
-- from a rank threshold, which is safe within one product but not across the
-- unified ladder: a rank chosen for HR seniority silently clears a sales floor,
-- which is precisely how hr_admin acquired lead-edit rights. Omission from a
-- list has no threshold to clear.
--
-- Remember tool/page/tab grants CASCADE. Granting 'lms' covers every page under
-- it, so a page a role must not see needs an explicit deny in the second block.

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT NULL, r.id, c.id, TRUE
FROM (VALUES

-- ── read_only (0) ───────────────────────────────────────────────────
-- An audit account: sees the branch, changes nothing. No platform.write, so the
-- database itself refuses writes even if an app check is ever missed.
('read_only', ARRAY[
  'platform',
  'lms','lms.dashboard.view','lms.leads.view','lms.leads.view.org',
  'lms.leads.timeline.view','lms.followups.view',
  'lms.history.view','lms.history.view.org',
  'lms.assignments.view',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own',
  'hr.leave','hr.leave.view','hr.leave.view.own',
  'tasks','tasks.view','tasks.view.own','tasks.lists','tasks.lists.view'
]),

-- ── sales_representative (20) ───────────────────────────────────────
('sales_representative', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit',
  'lms.history.view','lms.history.view.own',
  'lms.assignments.view',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.leave','hr.leave.view','hr.leave.view.own',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.employees','hr.employees.view',
  'tasks','tasks.view','tasks.view.own','tasks.create',
  'tasks.edit','tasks.edit.own','tasks.comment','tasks.history.view',
  'tasks.lists.view'
]),

-- ── senior_sales_executive (40) ─────────────────────────────────────
-- First tier that sees a team, works the unassigned queue, and may hand work down.
('senior_sales_executive', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own','lms.leads.edit.team',
  'lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team',
  'lms.assignments.view','lms.assignments.edit',
  'lms.users.view','lms.users.view.team',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.leave','hr.leave.view','hr.leave.view.own',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.employees','hr.employees.view',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.create',
  'tasks.edit','tasks.edit.own','tasks.edit.team','tasks.assign',
  'tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage'
]),

-- ── org_manager (60) ────────────────────────────────────────────────
-- Branch-wide visibility and the first tier that approves leave and deletes leads.
('org_manager', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own','lms.leads.edit.team',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.users.view','lms.users.view.team','lms.users.view.org',
  'lms.campaigns.view',
  'lms.analytics','lms.analytics.view',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own','hr.attendance.view.team',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.leave','hr.leave.view','hr.leave.view.own','hr.leave.view.team',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.leave.approve','hr.leave.reject',
  'hr.employees','hr.employees.view',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.create',
  'tasks.edit','tasks.edit.own','tasks.edit.team','tasks.delete','tasks.assign',
  'tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage'
]),

-- ── org_sr_manager (70) ─────────────────────────────────────────────
-- As org_manager, plus branch-wide edit and peer-level assignment reach.
('org_sr_manager', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.users.view','lms.users.view.team','lms.users.view.org',
  'lms.campaigns.view',
  'lms.analytics','lms.analytics.view',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own','hr.attendance.view.team',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.leave','hr.leave.view','hr.leave.view.own','hr.leave.view.team',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.leave.approve','hr.leave.reject',
  'hr.employees','hr.employees.view',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.create',
  'tasks.edit','tasks.edit.own','tasks.edit.team','tasks.delete','tasks.assign',
  'tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage'
]),

-- ── hr_admin (75) ───────────────────────────────────────────────────
-- Full HR authority and NO CRM tool at all. Before Tier C this was implicit —
-- hr_admin had no row in lms.member_roles. Unifying the ladder made rank 75
-- clear every LMS floor, so the exclusion is now stated rather than assumed.
--
-- Deliberately NO self-service punch/leave-apply: an HR admin views and
-- decides on other people's attendance and leave, they don't clock themselves
-- in or file their own requests through this role. (Also drops
-- hr.attendance.punch's downstream face-enroll routes — consistent, since
-- there is nothing to enroll a face for.) hr_admin is a per-tenant role since
-- _migrations/19, so this list alone won't reach existing tenants' copies —
-- see the backfill block below.
('hr_admin', ARRAY[
  'platform','platform.write',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org',
  'hr.leave.approve','hr.leave.reject',
  'hr.leave.admin.policies.view','hr.leave.admin.policies.manage',
  'hr.leave.admin.holidays.view','hr.leave.admin.holidays.manage',
  'hr.leave.admin.cycle.manage','hr.leave.admin.adjustment.create',
  'hr.employees','hr.employees.view','hr.employees.manage','hr.employees.taxonomy.manage',
  'tasks','tasks.view','tasks.view.own','tasks.create',
  'tasks.edit','tasks.edit.own','tasks.comment','tasks.history.view',
  'tasks.lists.view'
]),

-- ── org_admin (980) ─────────────────────────────────────────────────
-- Everything within one branch. Not lookup data, which is platform-wide.
-- No self-service punch/leave-apply, same reasoning as hr_admin above: an
-- org_admin views and decides on their branch's attendance and leave, they
-- don't clock themselves in or file their own requests through this role.
('org_admin', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.users.view','lms.users.view.team','lms.users.view.org','lms.users.manage',
  'platform.api_tokens.view','platform.api_tokens.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org',
  'hr.leave.approve','hr.leave.reject',
  'hr.leave.admin.policies.view','hr.leave.admin.policies.manage',
  'hr.leave.admin.holidays.view','hr.leave.admin.holidays.manage',
  'hr.leave.admin.cycle.manage','hr.leave.admin.adjustment.create',
  'hr.employees','hr.employees.view','hr.employees.manage','hr.employees.taxonomy.manage',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.view.org',
  'tasks.create','tasks.edit','tasks.edit.own','tasks.edit.team','tasks.edit.any',
  'tasks.delete','tasks.assign','tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage','tasks.lists.delete'
  -- No `admin` tool: the only pages left under it are lookup-admin's, which
  -- org_admin is explicitly denied below, so the grant reached nothing.
]),

-- ── tenant_admin (990) ──────────────────────────────────────────────
-- Everything org_admin has, across every branch, plus role administration.
-- No self-service punch/leave-apply, same reasoning as org_admin above.
('tenant_admin', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team',
  'lms.history.view.org','lms.history.view.tenant',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view','lms.analytics.org.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.users.view','lms.users.view.team','lms.users.view.org','lms.users.manage',
  'platform.api_tokens.view','platform.api_tokens.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org','hr.leave.view.tenant',
  'hr.leave.approve','hr.leave.reject',
  'hr.leave.admin.policies.view','hr.leave.admin.policies.manage',
  'hr.leave.admin.holidays.view','hr.leave.admin.holidays.manage',
  'hr.leave.admin.cycle.manage','hr.leave.admin.adjustment.create',
  'hr.employees','hr.employees.view','hr.employees.manage','hr.employees.taxonomy.manage',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.view.org',
  'tasks.create','tasks.edit','tasks.edit.own','tasks.edit.team','tasks.edit.any',
  'tasks.delete','tasks.assign','tasks.comment','tasks.history.view',
  -- No `admin` subtree. Platform administration (the lookup-admin console) is
  -- super_admin-only by decision, and admin-service's putGrants now REFUSES to
  -- write any admin.* grant to a role below that rank — so seeding one here
  -- would be the seed doing what the API forbids. super_admin receives those
  -- keys through the `*` wildcard below, not through rows like these.
  'tasks.lists.view','tasks.lists.manage','tasks.lists.delete'
]),

-- ── super_admin (1000) ──────────────────────────────────────────────
-- Everything, including platform-wide lookup data and cross-tenant history.
('super_admin', ARRAY['*'])

) AS a(role_name, cap_keys)
JOIN iam.user_roles   r ON r.name = a.role_name AND r.tenant_id IS NULL
JOIN iam.capabilities c ON (c.key = ANY(a.cap_keys) OR a.cap_keys = ARRAY['*'])
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;


-- ── Seed self-check: grants that resolve to nothing ─────────────────
-- A row granting a node whose ANCESTOR is not granted is silently ineffective —
-- the tree prunes it, and the capability simply never appears. That is easy to
-- write and impossible to see in the grant lists above, so it is asserted here.
--
-- This is not hypothetical: the first version of this seed granted
-- 'platform.write' to eight roles but never granted the 'platform' tool, which
-- left every role running with transaction_read_only = on and every write
-- failing at the database.
DO $seedcheck$
DECLARE
  bad_count INT;
  sample    TEXT;
BEGIN
  SELECT count(*), string_agg(DISTINCT m.role_name || ' -> ' || m.capability_key, ', ')
    INTO bad_count, sample
  FROM iam.role_capabilities rc
  JOIN iam.user_roles   r ON r.id = rc.role_id
  JOIN iam.capabilities c ON c.id = rc.capability_id
  JOIN iam.fn_role_capability_matrix(NULL) m
    ON m.role_name = r.name AND m.capability_key = c.key
  WHERE rc.tenant_id IS NULL AND rc.is_granted AND NOT m.granted;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Capability seed: % grant(s) are pruned by an ungranted ancestor: %',
      bad_count, left(sample, 400);
  END IF;
END $seedcheck$;


-- ── Explicit denies ─────────────────────────────────────────────────
-- Nav grants cascade, so a page a role must not reach needs a deny. Without
-- these, granting the 'lms' tool would light up Analytics and API clients for
-- everyone, and the operations under them would still be denied — leaving a
-- visible screen that returns nothing, which is the exact bug class Tier C
-- exists to remove.
--
-- READ THIS BEFORE TRYING TO HIDE A PAGE. A page or tab with NO ROW AT ALL is
-- not "off" — it is ON, inherited from its parent (fn_role_capability_matrix:
-- `COALESCE(g.is_granted, w.nav_inherited)`). DELETING a grant row therefore
-- REVEALS a page rather than hiding it. This VALUES list is the one place a
-- page is taken away; adding the role and the page/tab key here is the whole
-- mechanism. Note what goes with it: denying `lms.users` also prunes
-- lms.users.view, lms.users.manage and their scopes, so the service gates on
-- those start refusing too. That is the intent, but it is not visible from the
-- key alone.
--
-- Only tools and operations/scopes behave the way most people expect — those
-- need their own row and default to denied. It is exactly the nav nodes
-- (page/tab), the ones an operator actually wants to hide, that inherit.
--
-- This block writes PLATFORM DEFAULTS (tenant_id NULL), i.e. every tenant. To
-- take a page away from one customer only, write a tenant-scoped row instead —
-- see _migrations/21_role_nav_denies.sql, or just untick it in the Capability
-- Matrix screen, which writes the same thing and can put it back.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT NULL, r.id, c.id, FALSE
FROM (VALUES
  ('read_only',              ARRAY['lms.analytics','lms.campaigns','lms.users','platform.api_tokens','hr.attendance.admin','hr.leave.admin','tasks.lists']),
  ('sales_representative',   ARRAY['lms.analytics','lms.campaigns','lms.users','platform.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('senior_sales_executive', ARRAY['lms.analytics','lms.campaigns','platform.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_manager',            ARRAY['platform.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_sr_manager',         ARRAY['platform.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_admin',              ARRAY['admin.lookups'])
) AS d(role_name, cap_keys)
JOIN iam.user_roles   r ON r.name = d.role_name AND r.tenant_id IS NULL
JOIN iam.capabilities c ON c.key = ANY(d.cap_keys)
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;


-- ── Back-fill capabilities added after _migrations/19 ───────────────
-- Every grant block above joins `iam.user_roles ... AND r.tenant_id IS NULL`,
-- but _migrations/19_tenant_scope_ladder_roles.sql moved the working ladder
-- roles (sales_representative, senior_sales_executive, org_manager,
-- org_sr_manager, hr_admin) to one copy PER TENANT, taking a one-time snapshot
-- of their grants. Only the four anchors (super_admin, tenant_admin, org_admin,
-- read_only) are still global.
--
-- Net effect: a capability introduced AFTER that migration ran lands on the
-- anchors only, and the per-tenant ladder copies never receive it — so the
-- reps a feature is built for silently cannot use it.
--
-- Rather than re-listing every role name (which drifts, and differs per tenant
-- once a tenant renames a role), each new capability is pinned to an existing
-- one with the same audience. Granting WhatsApp wherever interaction logging is
-- already granted keeps the two in step for every tenant-scoped copy.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.interaction.log'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.whatsapp.send'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = TRUE;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.interaction.log'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.whatsapp.send'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;

-- ── Back-fill: geofence exceptions (schema 1.30.0) ──────────────────
-- Same trap as the WhatsApp back-fill above. hr_admin is one copy PER TENANT
-- since _migrations/19, and every grant block in this file joins
-- `r.tenant_id IS NULL` — so the two capabilities added for this feature would
-- reach the anchors only, and the HR admins it was built for would never see the
-- tab in their own tenant.
--
-- Pinned to the shift-assignment pair, which has exactly the same audience:
-- whoever already decides which person works which shift is who decides which
-- person is not held to the office radius.
WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.view',   'hr.attendance.admin.geo_exceptions.view'),
         ('hr.attendance.admin.assignments.manage', 'hr.attendance.admin.geo_exceptions.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM pin
JOIN iam.capabilities src ON src.key = pin.src_key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.role_capabilities rc ON rc.capability_id = src.id AND rc.is_granted
WHERE rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = TRUE;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.view',   'hr.attendance.admin.geo_exceptions.view'),
         ('hr.attendance.admin.assignments.manage', 'hr.attendance.admin.geo_exceptions.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM pin
JOIN iam.capabilities src ON src.key = pin.src_key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.role_capabilities rc ON rc.capability_id = src.id AND rc.is_granted
WHERE rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;

-- ── Back-fill: revoke hr_admin self-punch/leave-apply for existing tenants ──
-- hr_admin is a per-tenant role since _migrations/19 (see the WhatsApp
-- back-fill above for the mechanism). Removing punch/apply-leave from the
-- global template list above (Tier C3 hr_admin block) only touches rows with
-- tenant_id IS NULL, so every tenant's existing hr_admin copy still holds the
-- old grants unless explicitly revoked here.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT r.tenant_id, r.id, c.id, FALSE
FROM iam.user_roles r
JOIN iam.capabilities c ON c.key IN (
  'hr.attendance.punch', 'hr.attendance.regularization.request',
  'hr.leave.request.create', 'hr.leave.request.cancel'
)
WHERE r.name = 'hr_admin' AND r.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = FALSE;

-- ── Back-fill: lms.analytics for org_manager / org_sr_manager ───────
-- Same trap again: the deny block above only flips the tenant_id IS NULL
-- template. org_manager/org_sr_manager are per-tenant copies since
-- _migrations/19, so removing them from the deny list here left every
-- existing tenant's copy still holding the old explicit deny row.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT r.tenant_id, r.id, c.id, TRUE
FROM iam.user_roles r
JOIN iam.capabilities c ON c.key IN ('lms.analytics','lms.analytics.view')
WHERE r.name IN ('org_manager','org_sr_manager') AND r.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;


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

COMMIT;
