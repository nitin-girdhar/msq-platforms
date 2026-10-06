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
  -- Appearance is personal and changes nothing shared, so even the audit
  -- account may pick its own colours.
  'platform','platform.appearance',
  'lms','lms.dashboard.view','lms.leads.view','lms.leads.view.org',
  'lms.leads.timeline.view','lms.followups.view',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.org',
  'lms.assignments.view',
  'hr.attendance','hr.attendance.view','hr.attendance.view.own',
  'hr.leave','hr.leave.view','hr.leave.view.own',
  'tasks','tasks.view','tasks.view.own','tasks.lists','tasks.lists.view'
]),

-- ── sales_representative (20) ───────────────────────────────────────
('sales_representative', ARRAY[
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit',
  'lms.history.detail.view',
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
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own','lms.leads.edit.team',
  'lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.own','lms.history.view.team',
  'lms.assignments.view','lms.assignments.edit',
  'admin','admin.team.view','admin.team.view.team',
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
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own','lms.leads.edit.team',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'admin','admin.team.view','admin.team.view.team','admin.team.view.org',
  'lms.campaigns.view',
  'lms.campaign_types.view',
  -- Sees hiring leads as well as sales ones. This is the branch-management
  -- tier: below it, lms.leads.view.all_types is deliberately absent, which is
  -- what keeps a hiring lead off a sales rep's list.
  'lms.leads.view.all_types',
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
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'admin','admin.team.view','admin.team.view.team','admin.team.view.org',
  'lms.campaigns.view',
  'lms.campaign_types.view',
  -- Sees hiring leads as well as sales ones. This is the branch-management
  -- tier: below it, lms.leads.view.all_types is deliberately absent, which is
  -- what keeps a hiring lead off a sales rep's list.
  'lms.leads.view.all_types',
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
  'platform','platform.write','platform.appearance',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.reports','hr.reports.attendance.view',
  'hr.reports.attendance.view.org','hr.reports.attendance.view.tenant',
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
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  -- assign.any is the RANK ceiling (assign to anyone); assign.bulk is the Bulk
  -- Assign PAGE gate. They are independent rungs, so holding the wider one did
  -- not open the page — org_admin and tenant_admin were locked out of a screen
  -- every role beneath them (senior_sales_executive upward) could already use.
  'lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.campaign_types.view','lms.campaign_types.manage',
  'lms.leads.view.all_types',
  'admin','admin.team.view','admin.team.view.team','admin.team.view.org','admin.team.manage','admin.team.notify',
  'admin.api_tokens.view','admin.api_tokens.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.reports','hr.reports.attendance.view','hr.reports.attendance.view.org',
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
  'platform','platform.write','platform.appearance',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  -- The only role with cross-BRANCH lead reach: this is what puts every branch
  -- in the Bulk Assign / dashboard branch picker (identity-service resolves the
  -- picker off this exact ladder) and what lets leads-service run the read under
  -- the tenant Postgres role. tenant_admin already holds lms.history.view.tenant;
  -- leads was the outlier, which left the branch picker frozen for everyone.
  'lms.leads.view.tenant',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  -- assign.any is the RANK ceiling (assign to anyone); assign.bulk is the Bulk
  -- Assign PAGE gate. They are independent rungs, so holding the wider one did
  -- not open the page — org_admin and tenant_admin were locked out of a screen
  -- every role beneath them (senior_sales_executive upward) could already use.
  'lms.leads.assign.bulk',
  'lms.leads.interaction.log','lms.leads.timeline.view','lms.leads.whatsapp.send',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.detail.view',
  'lms.history.view','lms.history.view.own','lms.history.view.team',
  'lms.history.view.org','lms.history.view.tenant',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view','lms.analytics.org.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.campaign_types.view','lms.campaign_types.manage',
  'lms.leads.view.all_types',
  'admin','admin.team.view','admin.team.view.team','admin.team.view.org','admin.team.manage','admin.team.notify',
  'admin.api_tokens.view','admin.api_tokens.manage',
  -- Branding (1.57.0): tenant admins own the colours / terms / menu half;
  -- Super Admin owns logos, names and the login link.
  'admin.branding','admin.branding.view','admin.branding.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.photo.view',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.geo_exceptions.view','hr.attendance.admin.geo_exceptions.manage',
  'hr.reports','hr.reports.attendance.view',
  'hr.reports.attendance.view.org','hr.reports.attendance.view.tenant',
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
-- mechanism. Note what goes with it: denying `admin.team` also prunes
-- admin.team.view, admin.team.manage and their scopes, so the service gates on
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
  -- lms.campaign_types travels with lms.campaigns everywhere in this list: it is
  -- the same audience, and leaving it out would REVEAL the page to these roles
  -- rather than hide it -- a page with no row inherits its parent's grant, and
  -- `lms` is granted to all three. See the paragraph above.
  ('read_only',              ARRAY['lms.analytics','lms.campaigns','lms.campaign_types','admin.team','admin.api_tokens','hr.attendance.admin','hr.leave.admin','tasks.lists']),
  ('sales_representative',   ARRAY['lms.analytics','lms.campaigns','lms.campaign_types','admin.team','admin.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('senior_sales_executive', ARRAY['lms.analytics','lms.campaigns','lms.campaign_types','admin.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_manager',            ARRAY['admin.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_sr_manager',         ARRAY['admin.api_tokens','hr.attendance.admin','hr.leave.admin']),
  ('org_admin',              ARRAY['superadmin.lookups'])
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


-- ── Back-fill: lms.history.detail.view (Lead History dialog) ────────
-- Same trap as the WhatsApp back-fill above, and the same remedy: pin the new
-- capability to one that already has exactly the right audience. Whoever may
-- read the history list may open a row from it, so this follows
-- lms.history.view — for the per-tenant ladder copies AND for the anchors,
-- including tenant-scoped copies of org_admin/tenant_admin that a tenant
-- provisioned before those two became global.
--
-- This is what makes the dialog independent of the Leads page: a role denied
-- 'lms.leads' loses lms.leads.view and lms.leads.timeline.view with it, and
-- before this capability existed that silently broke the dialog on the history
-- page the role still holds.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.history.view'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.history.detail.view'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = TRUE;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.history.view'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.history.detail.view'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;


-- ── Back-fill: cross-branch lead reach + the Bulk Assign page gate ──
-- Same trap as the WhatsApp back-fill above, and the reason the Bulk Assign
-- branch picker shipped frozen. iam.fn_role_capability_matrix resolves ONE role
-- row per name and the per-tenant copy WINS, so a grant written onto the global
-- tenant_admin/org_admin template never reaches a tenant that already has its
-- own copy of that role. Both capabilities are therefore pinned to an existing
-- one with an identical audience, which reaches every copy in every tenant.
--
--   lms.leads.view.tenant  ← lms.history.view.tenant  (tenant_admin + super_admin)
--   lms.leads.assign.bulk  ← lms.leads.assign.any     (org_admin, tenant_admin, super_admin)
--
-- DO NOTHING, not DO UPDATE, unlike the back-fills above: both capabilities
-- predate this change, so a tenant may already have deliberately revoked one
-- (Fitclass had turned assign.bulk off for tenant_admin). `is_granted = FALSE`
-- is a tenant's opt-out and must survive a re-seed — only ABSENT rows are added.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.history.view.tenant'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.view.tenant'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.history.view.tenant'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.view.tenant'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.assign.any'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.assign.bulk'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.assign.any'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.assign.bulk'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: bulk update + bulk reschedule (schema 1.58.0) ───────
-- Same trap as the back-fills above: a grant on a global role template never
-- reaches a tenant that already holds its own copy of that role, so both new
-- capabilities are pinned to an existing one with the audience we want.
--
--   lms.leads.bulk.update          ← lms.leads.assign.bulk
--   lms.followups.bulk.reschedule  ← lms.leads.assign.bulk
--
-- Whoever may already move many leads between people (senior_sales_executive
-- upward, org_admin, tenant_admin, super_admin) may also bulk-update and
-- bulk-reschedule them; sales reps and read_only do not. DO NOTHING, not
-- DO UPDATE: a tenant that unticks one in the Capability Matrix writes
-- is_granted = FALSE, and a re-seed must not flip it back.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.assign.bulk'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key IN ('lms.leads.bulk.update', 'lms.followups.bulk.reschedule')
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.assign.bulk'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key IN ('lms.leads.bulk.update', 'lms.followups.bulk.reschedule')
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: tasks.bulk + tasks.export (schema 1.68.0) ───────────
-- Same trap as above (a global-template grant never reaches a tenant's own role
-- copy), so each is pinned to an existing key with the audience we want:
--   tasks.bulk    ← tasks.assign     whoever may already hand tasks to others
--   tasks.export  ← tasks.view.team  managers and up (the Team tab audience)
-- DO NOTHING: a tenant's is_granted = FALSE opt-out must survive a re-seed.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN iam.capabilities tgt ON (src.key, tgt.key) IN (('tasks.assign','tasks.bulk'), ('tasks.view.team','tasks.export'))
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN iam.capabilities tgt ON (src.key, tgt.key) IN (('tasks.assign','tasks.bulk'), ('tasks.view.team','tasks.export'))
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: admin.team.notify (schema 1.46.0) ───────────────────
-- Same trap as the WhatsApp back-fill above: a grant on the global
-- org_admin/tenant_admin template never reaches a tenant that already holds its
-- own per-tenant copy of that role. Pinned to admin.team.manage — whoever can
-- manage the team can also send account/password/branch emails — so it reaches
-- every copy in every tenant.
--
-- DO NOTHING, not DO UPDATE: a tenant that later unticks "Notify user by email"
-- in the Capability Matrix writes is_granted = FALSE, and a re-seed must not
-- flip that back on.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'admin.team.manage'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'admin.team.notify'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'admin.team.manage'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'admin.team.notify'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


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


-- ── Back-fill: campaign types + all-types lead visibility (1.49.0) ──
-- The same trap the WhatsApp and history.detail back-fills above document: the
-- grant blocks at the top of this file join `r.tenant_id IS NULL`, but the
-- ladder roles have been PER-TENANT copies since _migrations/19, so a capability
-- added now lands on the four anchors and never reaches org_manager or
-- org_sr_manager in any existing tenant. The remedy is the same: pin each new
-- capability to an existing one with exactly the right audience, for every copy.
--
-- lms.leads.view.all_types is pinned to lms.leads.delete, and that pin is chosen
-- rather than the more obvious lms.leads.view.org because the audiences differ
-- by one role that matters: read_only holds view.org. An audit account that can
-- see the branch should not thereby start seeing HR's hiring pipeline. The
-- holders of lms.leads.delete are exactly org_manager, org_sr_manager, org_admin
-- and tenant_admin -- the four roles this capability is meant for, and no others.
--
-- VERIFY WITH iam.fn_role_capability_matrix, never by reading
-- iam.role_capabilities: that table shows grant rows, including ones a denied
-- ancestor makes inert, so it will happily report a grant that does not apply.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.delete'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.view.all_types'
  AND rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = TRUE;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'lms.leads.delete'
CROSS JOIN iam.capabilities tgt
WHERE tgt.key = 'lms.leads.view.all_types'
  AND rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;

-- The campaign-types operations follow their campaigns twins one-for-one:
-- whoever may read campaigns may read types, whoever may manage campaigns may
-- manage them. Both directions, so a tenant that has already denied campaigns to
-- a role does not acquire a types page it never asked for.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, rc.is_granted
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN iam.capabilities tgt ON tgt.key = replace(src.key, 'lms.campaigns', 'lms.campaign_types')
WHERE src.key IN ('lms.campaigns', 'lms.campaigns.view', 'lms.campaigns.manage')
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, rc.is_granted
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN iam.capabilities tgt ON tgt.key = replace(src.key, 'lms.campaigns', 'lms.campaign_types')
WHERE src.key IN ('lms.campaigns', 'lms.campaigns.view', 'lms.campaigns.manage')
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;


-- ── Back-fill: hr.reports replaces hr.attendance.admin.reports (1.56.0) ──
-- Reports left the Attendance admin page for their own HRMS left-nav entry and
-- their own tool. Same per-tenant-copy trap as every back-fill above, so the new
-- keys are pinned to the RETIRED one — hr.attendance.admin.reports.view — whose
-- holders are exactly the audience, in every tenant, including a tenant's own
-- custom roles — but only where that grant is EFFECTIVE, so a role a tenant
-- had cut off from attendance (a denied ancestor) does not gain the new page.
-- The retired node is deactivated (not deleted) by
-- one_time/apply_hr_reports_capability.sql; once it is, the matrix no longer
-- lists it and this block is a no-op. On a fresh install the lists above cover it.
--
-- Branch reach: every holder gets .org (what the old tab did). Only
-- tenant_admin, hr_admin and super_admin get .tenant — the roles that already
-- work across branches (hr_admin is often homed in a head-office branch with
-- nobody in it).
--
-- DO NOTHING: a tenant that later unticks a report scope in the Capability
-- Matrix writes is_granted = FALSE, and a re-seed must not flip it back on.
WITH tgt(key, tenant_roles_only) AS (
  VALUES ('hr.reports', FALSE), ('hr.reports.attendance.view', FALSE),
         ('hr.reports.attendance.view.org', FALSE), ('hr.reports.attendance.view.tenant', TRUE)
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, c.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'hr.attendance.admin.reports.view'
JOIN iam.user_roles r ON r.id = rc.role_id
-- EFFECTIVE holders only: a grant row a denied ancestor prunes (e.g. a tenant
-- that took hr.attendance away from org_admin) must not become a live Reports
-- page. The matrix resolves the per-tenant copy of the role first, as login does.
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = 'hr.attendance.admin.reports.view' AND m.granted
  LIMIT 1
) eff ON TRUE
CROSS JOIN tgt
JOIN iam.capabilities c ON c.key = tgt.key
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
  AND (NOT tgt.tenant_roles_only OR r.name IN ('tenant_admin', 'hr_admin', 'super_admin'))
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH tgt(key, tenant_roles_only) AS (
  VALUES ('hr.reports', FALSE), ('hr.reports.attendance.view', FALSE),
         ('hr.reports.attendance.view.org', FALSE), ('hr.reports.attendance.view.tenant', TRUE)
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, c.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id AND src.key = 'hr.attendance.admin.reports.view'
JOIN iam.user_roles r ON r.id = rc.role_id
-- EFFECTIVE holders only: a grant row a denied ancestor prunes (e.g. a tenant
-- that took hr.attendance away from org_admin) must not become a live Reports
-- page. The matrix resolves the per-tenant copy of the role first, as login does.
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = 'hr.attendance.admin.reports.view' AND m.granted
  LIMIT 1
) eff ON TRUE
CROSS JOIN tgt
JOIN iam.capabilities c ON c.key = tgt.key
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
  AND (NOT tgt.tenant_roles_only OR r.name IN ('tenant_admin', 'hr_admin', 'super_admin'))
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: comp-off capabilities (schema 1.59.0) ─────────────────
--   hr.leave.comp_off.request  <- hr.leave.request.create  (whoever may apply may claim)
--   hr.leave.comp_off.approve  <- hr.leave.approve         (whoever may approve leave may decide)
-- Effective holders only (a denied ancestor prunes the source), DO NOTHING so a
-- tenant's explicit opt-out survives. Two statements per scope because
-- iam.role_capabilities has two PARTIAL unique indexes.
WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.leave.request.create', 'hr.leave.comp_off.request'),
         ('hr.leave.approve',        'hr.leave.comp_off.approve')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.leave.request.create', 'hr.leave.comp_off.request'),
         ('hr.leave.approve',        'hr.leave.comp_off.approve')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: Employee 360 capabilities (schema 1.60.0) ──────────────
--   hr.employees.profile.edit      <- hr.employees.view    (anyone who can see the directory keeps their own profile)
--   hr.employees.profile360.view   <- hr.employees.manage  (whoever manages employees may open the full profile)
--   hr.employees.notes.manage      <- hr.employees.manage
-- Effective holders only; DO NOTHING so a tenant opt-out survives.
WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.profile.edit'),
         ('hr.employees.manage', 'hr.employees.profile360.view'),
         ('hr.employees.manage', 'hr.employees.notes.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.profile.edit'),
         ('hr.employees.manage', 'hr.employees.profile360.view'),
         ('hr.employees.manage', 'hr.employees.notes.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: roster + shift-swap capabilities (schema 1.61.0) ───────
--   hr.attendance.roster.view  <- hr.attendance.view                    (whoever sees attendance sees the roster)
--   hr.attendance.swap.request <- hr.attendance.punch                   (whoever punches may swap)
--   hr.attendance.swap.approve <- hr.attendance.regularization.approve  (whoever approves corrections decides swaps)
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.view',                      'hr.attendance.roster.view'),
         ('hr.attendance.punch',                     'hr.attendance.swap.request'),
         ('hr.attendance.regularization.approve',    'hr.attendance.swap.approve')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.view',                      'hr.attendance.roster.view'),
         ('hr.attendance.punch',                     'hr.attendance.swap.request'),
         ('hr.attendance.regularization.approve',    'hr.attendance.swap.approve')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: payroll viewer capabilities (schema 1.62.0) ─────────────
--   hr.employees.payslip.view   <- hr.employees.view    (whoever is in the directory reads their own payslips)
--   hr.reports.payroll.manage   <- hr.employees.manage  (whoever manages employees prepares payslips)
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.payslip.view'),
         ('hr.employees.manage', 'hr.reports.payroll.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.payslip.view'),
         ('hr.employees.manage', 'hr.reports.payroll.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: announcements + assets capabilities (schema 1.63.0) ─────
--   *.announcements.view / *.assets.view     <- hr.employees.view
--   *.announcements.manage / *.assets.manage <- hr.employees.manage
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.announcements.view'),
         ('hr.employees.manage', 'hr.employees.announcements.manage'),
         ('hr.employees.view',   'hr.employees.assets.view'),
         ('hr.employees.manage', 'hr.employees.assets.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.announcements.view'),
         ('hr.employees.manage', 'hr.employees.announcements.manage'),
         ('hr.employees.view',   'hr.employees.assets.view'),
         ('hr.employees.manage', 'hr.employees.assets.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;


-- ── Back-fill: attendance override, encashment, statutory (schema 1.64.0) ─
--   hr.attendance.admin.override  <- hr.attendance.admin.assignments.manage
--   hr.leave.encashment.request   <- hr.leave.request.create
--   hr.leave.encashment.approve   <- hr.leave.approve
--   hr.employees.statutory.manage <- hr.employees.manage
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.manage', 'hr.attendance.admin.override'),
         ('hr.leave.request.create',                 'hr.leave.encashment.request'),
         ('hr.leave.approve',                        'hr.leave.encashment.approve'),
         ('hr.employees.manage',                     'hr.employees.statutory.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.manage', 'hr.attendance.admin.override'),
         ('hr.leave.request.create',                 'hr.leave.encashment.request'),
         ('hr.leave.approve',                        'hr.leave.encashment.approve'),
         ('hr.employees.manage',                     'hr.employees.statutory.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;

-- ── Back-fill: documents capabilities (schema 1.65.0) ───────────────────
--   *.documents.view   <- hr.employees.view
--   *.documents.manage <- hr.employees.manage
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.documents.view'),
         ('hr.employees.manage', 'hr.employees.documents.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.employees.view',   'hr.employees.documents.view'),
         ('hr.employees.manage', 'hr.employees.documents.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;

-- ── Back-fill: roster planner capability (schema 1.66.0) ───────────────
--   hr.attendance.roster.manage <- hr.attendance.admin.assignments.manage
-- Effective holders only; DO NOTHING so a tenant opt-out survives.

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.manage', 'hr.attendance.roster.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NULL
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO NOTHING;

WITH pin(src_key, tgt_key) AS (
  VALUES ('hr.attendance.admin.assignments.manage', 'hr.attendance.roster.manage')
)
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT rc.tenant_id, rc.role_id, tgt.id, TRUE
FROM iam.role_capabilities rc
JOIN iam.capabilities src ON src.id = rc.capability_id
JOIN pin ON pin.src_key = src.key
JOIN iam.capabilities tgt ON tgt.key = pin.tgt_key
JOIN iam.user_roles r ON r.id = rc.role_id
JOIN LATERAL (
  SELECT 1 FROM iam.fn_role_capability_matrix(rc.tenant_id) m
  WHERE m.role_name = r.name AND m.capability_key = pin.src_key AND m.granted
  LIMIT 1
) eff ON TRUE
WHERE rc.is_granted
  AND rc.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO NOTHING;

COMMIT;
