-- ===================================================================
-- CRM Monorepo - Lookup / Reference Seed Data
-- Prerequisite: Run 01_init-db.sql first (schema must already exist).
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING / DO UPDATE SET)
-- ===================================================================

-- ===================================================================
-- SCHEMA VERSION TRACKING
-- ===================================================================

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.0.0', 'Merged monorepo + EXISTING_WORKING_CODE: geo tables, soft-delete, business-rule triggers, audit triggers, service logins'),
  ('1.1.0', 'iam.user_org_mapping table, legal_entity_name/brand_name on entity.organizations, fixed multi-org RLS gaps')
ON CONFLICT (version) DO NOTHING;


-- ===================================================================
-- GEOGRAPHIC DATA
-- ===================================================================

-- ── Geographic seed data ────────────────────────────────────────────
INSERT INTO geo.countries (name, iso_code) VALUES
  ('India',                'IN'),
  ('United States',        'US'),
  ('United Kingdom',       'GB'),
  ('United Arab Emirates', 'AE')
ON CONFLICT (name) DO NOTHING;

INSERT INTO geo.states (country_id, name, code)
SELECT c.id, s.name, s.code
FROM geo.countries c
CROSS JOIN (VALUES
  ('Delhi',           'DL'),
  ('Maharashtra',     'MH'),
  ('Karnataka',       'KA'),
  ('Tamil Nadu',      'TN'),
  ('West Bengal',     'WB'),
  ('Telangana',       'TS'),
  ('Rajasthan',       'RJ'),
  ('Gujarat',         'GJ'),
  ('Uttar Pradesh',   'UP'),
  ('Haryana',         'HR'),
  ('Punjab',          'PB'),
  ('Madhya Pradesh',  'MP')
) AS s(name, code)
WHERE c.iso_code = 'IN'
ON CONFLICT (country_id, name) DO NOTHING;

INSERT INTO geo.cities (state_id, name)
SELECT s.id, c.name
FROM geo.states s
CROSS JOIN (VALUES
  ('Delhi',         'New Delhi'),
  ('Delhi',         'Dwarka'),
  ('Delhi',         'Rohini'),
  ('Delhi',         'Lajpat Nagar'),
  ('Delhi',         'Connaught Place'),
  ('Delhi',         'Saket'),
  ('Delhi',         'Janakpuri'),
  ('Uttar Pradesh', 'Lucknow'),
  ('Uttar Pradesh', 'Noida'),
  ('Uttar Pradesh', 'Agra'),
  ('Haryana',       'Gurgaon'),
  ('Haryana',       'Faridabad'),
  ('Punjab',        'Chandigarh'),
  ('Punjab',        'Amritsar')
) AS c(state_name, name)
WHERE s.name = c.state_name
ON CONFLICT (state_id, name) DO NOTHING;


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
-- TIER C3 -- CAPABILITY TREE: CATALOG
-- ===================================================================
-- One row per node. Parent chain is the whole access model:
--   tool -> page -> tab -> operation -> scope
-- Deny a node and its entire subtree is unreachable, whatever its own grant says.
--
-- Inheritance differs by kind, deliberately:
--   tool/page/tab  a grant covers the subtree; an explicit deny prunes it
--   operation      always needs its own grant
--   scope          always needs its own grant; effective scope is the granted
--                  sibling with the highest sort_order
--
-- label       what an admin sees in the grid. 2-4 words.
-- description one sentence, ~12 words. A second clause only for a dependency,
--             an exclusion, or a consequence. Never restates the label, never
--             names a route or a table.

INSERT INTO iam.capabilities (key, kind, parent_key, label, description, sort_order) VALUES

-- ── PLATFORM ────────────────────────────────────────────────────────
('platform',       'tool',      NULL,       'Platform',
 'Cross-product controls that are not tied to one tool.', 0),
('platform.write', 'operation', 'platform', 'Write anything',
 'Without this the account is read-only everywhere, enforced at the database.', 1),

-- ── CRM ─────────────────────────────────────────────────────────────
('lms', 'tool', NULL, 'CRM',
 'The CRM product. Denying it blocks every screen and call below.', 1),

('lms.dashboard', 'page', 'lms', 'Dashboard',
 'The CRM landing screen with pipeline and activity summaries.', 1),
('lms.dashboard.view', 'operation', 'lms.dashboard', 'View dashboard',
 'Read the summary cards and campaign rollups.', 1),

('lms.leads', 'page', 'lms', 'Leads',
 'The Leads list and detail screens.', 2),
('lms.leads.view', 'operation', 'lms.leads', 'View leads',
 'Read the list and lead details. Needs a scope below, or the list is empty.', 1),
('lms.leads.view.own',  'scope', 'lms.leads.view', 'Own only',
 'Leads assigned to them.', 1),
('lms.leads.view.team', 'scope', 'lms.leads.view', 'Their team',
 'Their own, plus everyone reporting to them.', 2),
('lms.leads.view.org',  'scope', 'lms.leads.view', 'Whole branch',
 'Every lead in the branch, including unassigned.', 3),
('lms.leads.unassigned.view', 'operation', 'lms.leads', 'See unassigned leads',
 'Adds the unassigned queue to the list and dashboard.', 2),
('lms.leads.create', 'operation', 'lms.leads', 'Create leads',
 'Add a new lead by hand.', 3),
('lms.leads.edit', 'operation', 'lms.leads', 'Edit leads',
 'Change stage, status, owner and details. Not create, delete or transfer.', 4),
('lms.leads.edit.own',  'scope', 'lms.leads.edit', 'Own only',
 'Only leads assigned to them.', 1),
('lms.leads.edit.team', 'scope', 'lms.leads.edit', 'Their team',
 'Also leads held by people reporting to them.', 2),
('lms.leads.edit.any',  'scope', 'lms.leads.edit', 'Anyone''s',
 'Any lead in the branch, whoever holds it.', 3),
('lms.leads.delete', 'operation', 'lms.leads', 'Delete leads',
 'Permanently remove a lead. Reason required, and audited.', 5),
('lms.leads.transfer', 'operation', 'lms.leads', 'Transfer leads',
 'Move a lead to another branch. It leaves this branch''s list.', 6),
('lms.leads.assign', 'operation', 'lms.leads', 'Assign leads',
 'Hand a lead to someone else. The scope below sets who is in the picker.', 7),
('lms.leads.assign.reports', 'scope', 'lms.leads.assign', 'People below them',
 'Only people ranked below them.', 1),
('lms.leads.assign.peers',   'scope', 'lms.leads.assign', 'Peers and below',
 'Adds same-rank colleagues and themselves.', 2),
('lms.leads.assign.any',     'scope', 'lms.leads.assign', 'Anyone in the branch',
 'No rank limit, including seniors.', 3),
('lms.leads.interaction.log', 'operation', 'lms.leads', 'Log interactions',
 'Record a call, visit or note against a lead.', 8),
('lms.leads.timeline.view', 'operation', 'lms.leads', 'View lead timeline',
 'Read a lead''s full activity and ownership history.', 9),

('lms.followups', 'page', 'lms', 'Follow-ups',
 'The follow-up queue across leads.', 3),
('lms.followups.view',   'operation', 'lms.followups', 'View follow-ups',
 'Read scheduled follow-ups.', 1),
('lms.followups.create', 'operation', 'lms.followups', 'Create follow-ups',
 'Schedule a follow-up on a lead.', 2),
('lms.followups.edit',   'operation', 'lms.followups', 'Edit follow-ups',
 'Reschedule or close a follow-up.', 3),
('lms.followups.delete', 'operation', 'lms.followups', 'Delete follow-ups',
 'Remove a scheduled follow-up.', 4),

('lms.history', 'page', 'lms', 'Leads history',
 'The audit view of lead activity over time.', 4),
('lms.history.view', 'operation', 'lms.history', 'View history',
 'Read past lead activity. Needs a scope below, or nothing is returned.', 1),
('lms.history.view.own',    'scope', 'lms.history.view', 'Own only',
 'Activity on their own leads.', 1),
('lms.history.view.team',   'scope', 'lms.history.view', 'Their team',
 'Also activity by people reporting to them.', 2),
('lms.history.view.org',    'scope', 'lms.history.view', 'Whole branch',
 'All activity in the branch.', 3),
('lms.history.view.tenant', 'scope', 'lms.history.view', 'Every branch',
 'All activity across every branch in the tenant.', 4),
('lms.history.view.all',    'scope', 'lms.history.view', 'Every tenant',
 'All activity platform-wide. Crosses the tenant boundary.', 5),

('lms.assignments', 'page', 'lms', 'Assignments',
 'The lead assignment queue and its history.', 5),
('lms.assignments.view',   'operation', 'lms.assignments', 'View assignments',
 'Read assignment records and who holds what.', 1),
('lms.assignments.edit',   'operation', 'lms.assignments', 'Edit assignments',
 'Change an existing assignment record.', 2),
('lms.assignments.delete', 'operation', 'lms.assignments', 'Delete assignments',
 'Remove an assignment record.', 3),

('lms.analytics', 'page', 'lms', 'Analytics',
 'Pipeline, performance and campaign reporting.', 6),
('lms.analytics.view',     'operation', 'lms.analytics', 'View analytics',
 'Read pipeline, performance and campaign reports for the branch.', 1),
('lms.analytics.org.view', 'operation', 'lms.analytics', 'View branch comparison',
 'Compare performance across branches in the tenant.', 2),

('lms.campaigns', 'page', 'lms', 'Campaigns',
 'Lead source campaigns and their configuration.', 7),
('lms.campaigns.view',   'operation', 'lms.campaigns', 'View campaigns',
 'Read campaigns and their results.', 1),
('lms.campaigns.manage', 'operation', 'lms.campaigns', 'Manage campaigns',
 'Create, edit and retire campaigns.', 2),

('lms.users', 'page', 'lms', 'Users',
 'The CRM people directory and org chart.', 8),
('lms.users.view', 'operation', 'lms.users', 'View users',
 'Read the directory and reporting lines. Needs a scope below.', 1),
('lms.users.view.team', 'scope', 'lms.users.view', 'Their team',
 'Only people reporting to them.', 1),
('lms.users.view.org',  'scope', 'lms.users.view', 'Whole branch',
 'Everyone in the branch.', 2),
('lms.users.manage', 'operation', 'lms.users', 'Manage users',
 'Add people, change roles, deactivate accounts.', 2),

('lms.apiclients', 'page', 'lms', 'API clients',
 'Machine credentials for the public lead intake API.', 9),
('lms.apiclients.view',   'operation', 'lms.apiclients', 'View API clients',
 'Read the client list. Secrets are never shown.', 1),
('lms.apiclients.manage', 'operation', 'lms.apiclients', 'Manage API clients',
 'Create clients and rotate their secrets.', 2),

-- ── ATTENDANCE ──────────────────────────────────────────────────────
('hr.attendance', 'tool', NULL, 'Attendance',
 'The attendance product. Sold separately from Leave.', 2),
('hr.attendance.view', 'operation', 'hr.attendance', 'View attendance',
 'Read attendance records. Needs a scope below, or nothing is shown.', 1),
('hr.attendance.view.own',  'scope', 'hr.attendance.view', 'Own only',
 'Their own attendance.', 1),
('hr.attendance.view.team', 'scope', 'hr.attendance.view', 'Their team',
 'Also their reports. Shows the Team tab.', 2),
('hr.attendance.view.org',  'scope', 'hr.attendance.view', 'Whole branch',
 'Everyone in the branch.', 3),
('hr.attendance.punch', 'operation', 'hr.attendance', 'Check in and out',
 'Record their own arrival and departure.', 2),
('hr.attendance.photo.view', 'operation', 'hr.attendance', 'View check-in photos',
 'Open the photo captured at check-in.', 3),
('hr.attendance.regularization.request', 'operation', 'hr.attendance', 'Request a correction',
 'Ask for a missed or wrong punch to be fixed.', 4),
('hr.attendance.regularization.approve', 'operation', 'hr.attendance', 'Approve corrections',
 'Accept a correction request.', 5),
('hr.attendance.regularization.reject',  'operation', 'hr.attendance', 'Reject corrections',
 'Decline a correction request.', 6),

('hr.attendance.admin', 'page', 'hr.attendance', 'Attendance admin',
 'Configuration for the whole branch''s attendance.', 7),
('hr.attendance.admin.rules', 'tab', 'hr.attendance.admin', 'Rules',
 'Working hours, grace period, geofence radius, timezone.', 1),
('hr.attendance.admin.rules.view',   'operation', 'hr.attendance.admin.rules', 'View rules',
 'Read the branch''s attendance configuration.', 1),
('hr.attendance.admin.rules.update', 'operation', 'hr.attendance.admin.rules', 'Change rules',
 'Edit the configuration. Applies to everyone in the branch.', 2),
('hr.attendance.admin.shifts', 'tab', 'hr.attendance.admin', 'Shifts',
 'Named shift patterns and their timings.', 2),
('hr.attendance.admin.shifts.view',   'operation', 'hr.attendance.admin.shifts', 'View shifts',
 'Read the shift patterns.', 1),
('hr.attendance.admin.shifts.manage', 'operation', 'hr.attendance.admin.shifts', 'Manage shifts',
 'Create and edit shift patterns.', 2),
('hr.attendance.admin.assignments', 'tab', 'hr.attendance.admin', 'Shift assignments',
 'Which person works which shift.', 3),
('hr.attendance.admin.assignments.view',   'operation', 'hr.attendance.admin.assignments', 'View assignments',
 'Read who is on which shift.', 1),
('hr.attendance.admin.assignments.manage', 'operation', 'hr.attendance.admin.assignments', 'Manage assignments',
 'Put people on shifts and move them.', 2),
('hr.attendance.admin.reports', 'tab', 'hr.attendance.admin', 'Reports',
 'Attendance summaries across the branch.', 4),
('hr.attendance.admin.reports.view', 'operation', 'hr.attendance.admin.reports', 'View reports',
 'Read branch-wide attendance summaries.', 1),

-- ── LEAVE ───────────────────────────────────────────────────────────
('hr.leave', 'tool', NULL, 'Leave',
 'The leave product. Sold separately from Attendance.', 3),
('hr.leave.view', 'operation', 'hr.leave', 'View leave',
 'Read balances, ledger and requests. Needs a scope below.', 1),
('hr.leave.view.own',    'scope', 'hr.leave.view', 'Own only',
 'Their own balance and requests.', 1),
('hr.leave.view.team',   'scope', 'hr.leave.view', 'Their team',
 'Also their reports. Shows the Approvals tab.', 2),
('hr.leave.view.org',    'scope', 'hr.leave.view', 'Whole branch',
 'Everyone in the branch.', 3),
('hr.leave.view.tenant', 'scope', 'hr.leave.view', 'Every branch',
 'Everyone across every branch in the tenant.', 4),
('hr.leave.request.create', 'operation', 'hr.leave', 'Apply for leave',
 'Submit a leave request for themselves.', 2),
('hr.leave.request.cancel', 'operation', 'hr.leave', 'Cancel own leave',
 'Withdraw a request they submitted.', 3),
('hr.leave.approve', 'operation', 'hr.leave', 'Approve leave',
 'Accept a request. Who they can act for follows the scope above.', 4),
('hr.leave.reject',  'operation', 'hr.leave', 'Reject leave',
 'Decline a request.', 5),

('hr.leave.admin', 'page', 'hr.leave', 'Leave admin',
 'Leave configuration for the whole branch.', 6),
('hr.leave.admin.policies', 'tab', 'hr.leave.admin', 'Policies',
 'Leave types, entitlements and accrual rules.', 1),
('hr.leave.admin.policies.view',   'operation', 'hr.leave.admin.policies', 'View policies',
 'Read the leave policies.', 1),
('hr.leave.admin.policies.manage', 'operation', 'hr.leave.admin.policies', 'Manage policies',
 'Create and edit policies. Changes affect future accrual.', 2),
('hr.leave.admin.holidays', 'tab', 'hr.leave.admin', 'Holidays',
 'Holiday calendars and their dates.', 2),
('hr.leave.admin.holidays.view',   'operation', 'hr.leave.admin.holidays', 'View holidays',
 'Read the holiday calendars.', 1),
('hr.leave.admin.holidays.manage', 'operation', 'hr.leave.admin.holidays', 'Manage holidays',
 'Create calendars and set their dates.', 2),
('hr.leave.admin.cycle', 'tab', 'hr.leave.admin', 'Leave year',
 'When the leave year starts and how balances carry over.', 3),
('hr.leave.admin.cycle.manage', 'operation', 'hr.leave.admin.cycle', 'Manage leave year',
 'Set the cycle and carry-forward rules.', 1),
('hr.leave.admin.adjustment', 'tab', 'hr.leave.admin', 'Adjustments',
 'Manual corrections to someone''s balance.', 4),
('hr.leave.admin.adjustment.create', 'operation', 'hr.leave.admin.adjustment', 'Adjust balances',
 'Add or remove days from a balance. Audited.', 1),

-- ── EMPLOYEES ───────────────────────────────────────────────────────
('hr.employees', 'tool', NULL, 'Employees',
 'Employee records, shared by both HR products.', 4),
('hr.employees.view', 'operation', 'hr.employees', 'View employees',
 'Read employee profiles, departments and designations.', 1),
('hr.employees.manage', 'operation', 'hr.employees', 'Manage employees',
 'Create and edit employee profiles.', 2),
('hr.employees.taxonomy.manage', 'operation', 'hr.employees', 'Manage departments',
 'Create and edit departments and designations.', 3),

-- ── TASKS ───────────────────────────────────────────────────────────
('tasks', 'tool', NULL, 'Tasks',
 'The task product. Denying it blocks every task screen and call.', 5),
('tasks.view', 'operation', 'tasks', 'View tasks',
 'Read tasks. Needs a scope below, or the board is empty.', 1),
('tasks.view.own',  'scope', 'tasks.view', 'Own only',
 'Tasks they created or were assigned.', 1),
('tasks.view.team', 'scope', 'tasks.view', 'Their team',
 'Also their reports'' tasks. Shows the Team tab.', 2),
('tasks.view.org',  'scope', 'tasks.view', 'Whole branch',
 'Every task in the branch.', 3),
('tasks.create', 'operation', 'tasks', 'Create tasks',
 'Add a task for themselves or, with Assign, for others.', 2),
('tasks.edit', 'operation', 'tasks', 'Edit tasks',
 'Change a task''s title, status, due date and notes.', 3),
('tasks.edit.own',  'scope', 'tasks.edit', 'Own only',
 'Tasks they created or were assigned.', 1),
('tasks.edit.team', 'scope', 'tasks.edit', 'Their team',
 'Also their reports'' tasks.', 2),
('tasks.edit.any',  'scope', 'tasks.edit', 'Anyone''s',
 'Any task in the branch, whoever owns it.', 3),
('tasks.delete', 'operation', 'tasks', 'Delete tasks',
 'Remove a task. Follows the Edit scope for whose tasks.', 4),
('tasks.assign', 'operation', 'tasks', 'Assign tasks',
 'Give a task to someone else.', 5),
('tasks.comment', 'operation', 'tasks', 'Comment on tasks',
 'Read and post comments on a task.', 6),
('tasks.history.view', 'operation', 'tasks', 'View task history',
 'Read a task''s status change history.', 7),

('tasks.lists', 'page', 'tasks', 'Task lists',
 'Named lists that group tasks.', 8),
('tasks.lists.view',   'operation', 'tasks.lists', 'View lists',
 'Read task lists and their contents.', 1),
('tasks.lists.manage', 'operation', 'tasks.lists', 'Manage lists',
 'Create and rename lists.', 2),
('tasks.lists.delete', 'operation', 'tasks.lists', 'Delete lists',
 'Remove a list. Its tasks are not deleted.', 3),

-- ── ADMINISTRATION ──────────────────────────────────────────────────
('admin', 'tool', NULL, 'Administration',
 'Tenant and platform configuration.', 6),

('admin.orgs', 'page', 'admin', 'Branches',
 'The tenant''s branches and their settings.', 1),
('admin.orgs.view',   'operation', 'admin.orgs', 'View branches',
 'Read the branch list and settings.', 1),
('admin.orgs.manage', 'operation', 'admin.orgs', 'Manage branches',
 'Create branches and change their configuration.', 2),

('admin.users', 'page', 'admin', 'User administration',
 'Accounts across the tenant, independent of any product.', 2),
('admin.users.manage', 'operation', 'admin.users', 'Manage accounts',
 'Create, edit and deactivate accounts.', 1),
('admin.users.mappings.manage', 'operation', 'admin.users', 'Manage branch access',
 'Give or remove a person''s access to a branch.', 2),
('admin.users.password.reset', 'operation', 'admin.users', 'Reset passwords',
 'Force a password reset on another account.', 3),

('admin.lookups', 'page', 'admin', 'Lookup data',
 'Platform-wide reference tables. Changes affect every tenant.', 3),
('admin.lookups.view',   'operation', 'admin.lookups', 'View lookup data',
 'Read the reference tables.', 1),
('admin.lookups.manage', 'operation', 'admin.lookups', 'Manage lookup data',
 'Edit reference tables. Affects every tenant on the platform.', 2),

('admin.roles.manage', 'operation', 'admin', 'Manage roles',
 'Define roles, ranks, departments and these capability grants.', 4),
('admin.config.lms.manage', 'operation', 'admin', 'Manage CRM configuration',
 'Edit lead stages, sources and interaction types.', 5),
('admin.meta.manage', 'operation', 'admin', 'Manage lead integrations',
 'Connect and configure external lead sources.', 6),
('admin.comms.send', 'operation', 'admin', 'Send messages',
 'Send email and WhatsApp through the platform.', 7)

ON CONFLICT (key) DO UPDATE SET
  kind        = EXCLUDED.kind,
  parent_key  = EXCLUDED.parent_key,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order,
  is_active   = TRUE;


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
  'tasks','tasks.view','tasks.view.own','tasks.lists.view'
]),

-- ── sales_representative (20) ───────────────────────────────────────
('sales_representative', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own',
  'lms.leads.create','lms.leads.edit','lms.leads.edit.own',
  'lms.leads.interaction.log','lms.leads.timeline.view',
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
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers',
  'lms.leads.interaction.log','lms.leads.timeline.view',
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
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers',
  'lms.leads.interaction.log','lms.leads.timeline.view',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.users.view','lms.users.view.team','lms.users.view.org',
  'lms.campaigns.view',
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
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers',
  'lms.leads.interaction.log','lms.leads.timeline.view',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.users.view','lms.users.view.team','lms.users.view.org',
  'lms.campaigns.view',
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
('hr_admin', ARRAY[
  'platform','platform.write',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org',
  'hr.leave.request.create','hr.leave.request.cancel',
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
('org_admin', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  'lms.leads.interaction.log','lms.leads.timeline.view',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team','lms.history.view.org',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.users.view','lms.users.view.team','lms.users.view.org','lms.users.manage',
  'lms.apiclients.view','lms.apiclients.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.leave.approve','hr.leave.reject',
  'hr.leave.admin.policies.view','hr.leave.admin.policies.manage',
  'hr.leave.admin.holidays.view','hr.leave.admin.holidays.manage',
  'hr.leave.admin.cycle.manage','hr.leave.admin.adjustment.create',
  'hr.employees','hr.employees.view','hr.employees.manage','hr.employees.taxonomy.manage',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.view.org',
  'tasks.create','tasks.edit','tasks.edit.own','tasks.edit.team','tasks.edit.any',
  'tasks.delete','tasks.assign','tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage','tasks.lists.delete',
  'admin','admin.orgs.view','admin.users.manage','admin.config.lms.manage',
  'admin.comms.send'
]),

-- ── tenant_admin (990) ──────────────────────────────────────────────
-- Everything org_admin has, across every branch, plus role administration.
('tenant_admin', ARRAY[
  'platform','platform.write',
  'lms','lms.dashboard.view',
  'lms.leads.view','lms.leads.view.own','lms.leads.view.team','lms.leads.view.org',
  'lms.leads.unassigned.view',
  'lms.leads.create','lms.leads.edit',
  'lms.leads.edit.own','lms.leads.edit.team','lms.leads.edit.any',
  'lms.leads.delete','lms.leads.transfer',
  'lms.leads.assign','lms.leads.assign.reports','lms.leads.assign.peers','lms.leads.assign.any',
  'lms.leads.interaction.log','lms.leads.timeline.view',
  'lms.followups.view','lms.followups.create','lms.followups.edit','lms.followups.delete',
  'lms.history.view','lms.history.view.own','lms.history.view.team',
  'lms.history.view.org','lms.history.view.tenant',
  'lms.assignments.view','lms.assignments.edit','lms.assignments.delete',
  'lms.analytics.view','lms.analytics.org.view',
  'lms.campaigns.view','lms.campaigns.manage',
  'lms.users.view','lms.users.view.team','lms.users.view.org','lms.users.manage',
  'lms.apiclients.view','lms.apiclients.manage',
  'hr.attendance','hr.attendance.view',
  'hr.attendance.view.own','hr.attendance.view.team','hr.attendance.view.org',
  'hr.attendance.punch','hr.attendance.photo.view',
  'hr.attendance.regularization.request',
  'hr.attendance.regularization.approve','hr.attendance.regularization.reject',
  'hr.attendance.admin.rules.view','hr.attendance.admin.rules.update',
  'hr.attendance.admin.shifts.view','hr.attendance.admin.shifts.manage',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.assignments.manage',
  'hr.attendance.admin.reports.view',
  'hr.leave','hr.leave.view',
  'hr.leave.view.own','hr.leave.view.team','hr.leave.view.org','hr.leave.view.tenant',
  'hr.leave.request.create','hr.leave.request.cancel',
  'hr.leave.approve','hr.leave.reject',
  'hr.leave.admin.policies.view','hr.leave.admin.policies.manage',
  'hr.leave.admin.holidays.view','hr.leave.admin.holidays.manage',
  'hr.leave.admin.cycle.manage','hr.leave.admin.adjustment.create',
  'hr.employees','hr.employees.view','hr.employees.manage','hr.employees.taxonomy.manage',
  'tasks','tasks.view','tasks.view.own','tasks.view.team','tasks.view.org',
  'tasks.create','tasks.edit','tasks.edit.own','tasks.edit.team','tasks.edit.any',
  'tasks.delete','tasks.assign','tasks.comment','tasks.history.view',
  'tasks.lists.view','tasks.lists.manage','tasks.lists.delete',
  'admin','admin.orgs.view','admin.orgs.manage',
  'admin.users.manage','admin.users.mappings.manage','admin.users.password.reset',
  'admin.roles.manage','admin.config.lms.manage','admin.meta.manage','admin.comms.send'
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
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT NULL, r.id, c.id, FALSE
FROM (VALUES
  ('read_only',              ARRAY['lms.analytics','lms.campaigns','lms.users','lms.apiclients','hr.attendance.admin','hr.leave.admin','tasks.lists']),
  ('sales_representative',   ARRAY['lms.analytics','lms.campaigns','lms.users','lms.apiclients','hr.attendance.admin','hr.leave.admin']),
  ('senior_sales_executive', ARRAY['lms.analytics','lms.campaigns','lms.apiclients','hr.attendance.admin','hr.leave.admin']),
  ('org_manager',            ARRAY['lms.analytics','lms.apiclients','hr.attendance.admin','hr.leave.admin']),
  ('org_sr_manager',         ARRAY['lms.analytics','lms.apiclients','hr.attendance.admin','hr.leave.admin']),
  ('org_admin',              ARRAY['admin.lookups'])
) AS d(role_name, cap_keys)
JOIN iam.user_roles   r ON r.name = d.role_name AND r.tenant_id IS NULL
JOIN iam.capabilities c ON c.key = ANY(d.cap_keys)
ON CONFLICT (role_id, capability_id) WHERE tenant_id IS NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;


-- ===================================================================
-- CRM -- LEAD STAGES, OUTCOMES, INTERACTION TYPES, FOLLOW-UP STATUSES, SOURCES
-- ===================================================================

INSERT INTO lms.lead_stage (name, label, description, sort_order, followup_required, is_rejected, is_terminated) VALUES
  ('new',            'New',            'Lead just received — not yet contacted',                       1, FALSE, FALSE, FALSE),
  ('contacting',     'Contacting',     'Active outreach in progress — calls, WhatsApp, or email',      2, TRUE,  FALSE, FALSE),
  ('on_hold',        'On Hold',        'Follow-up temporarily paused — lead asked to be contacted later or is unreachable', 3, TRUE,  FALSE, FALSE),
  ('qualified',      'Qualified',      'Lead confirmed as a genuine prospect with intent and budget',  4, TRUE,  FALSE, FALSE),
  ('converted',      'Converted',      'Lead became a paying customer',                                5, FALSE, FALSE, TRUE),
  ('unqualified',    'Unqualified',    'Lead did not qualify — outcome and note must be recorded',     6, FALSE, TRUE,  TRUE),
  ('transferred_out','Transferred Out','Lead transferred to another org or partner',                   7, FALSE, FALSE, TRUE)
ON CONFLICT (name) DO UPDATE SET
  label             = EXCLUDED.label,
  description       = EXCLUDED.description,
  sort_order        = EXCLUDED.sort_order,
  followup_required = EXCLUDED.followup_required,
  is_rejected       = EXCLUDED.is_rejected,
  is_terminated     = EXCLUDED.is_terminated;

-- Seed all outcomes using name subqueries (never hardcoded IDs)
DO $$
DECLARE
  v_contacting  UUID;
  v_on_hold     UUID;
  v_qualified   UUID;
  v_converted   UUID;
  v_unqualified UUID;
  v_transferred UUID;
BEGIN
  SELECT id INTO v_contacting  FROM lms.lead_stage WHERE name = 'contacting';
  SELECT id INTO v_on_hold     FROM lms.lead_stage WHERE name = 'on_hold';
  SELECT id INTO v_qualified   FROM lms.lead_stage WHERE name = 'qualified';
  SELECT id INTO v_converted   FROM lms.lead_stage WHERE name = 'converted';
  SELECT id INTO v_unqualified FROM lms.lead_stage WHERE name = 'unqualified';
  SELECT id INTO v_transferred FROM lms.lead_stage WHERE name = 'transferred_out';

  -- contacting outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_contacting, 'not_connected',   'Not Connected',   FALSE, 1),
    (v_contacting, 'switch_off',      'Switch Off',      FALSE, 2),
    (v_contacting, 'not_answered',    'Not Answered',    FALSE, 3),
    (v_contacting, 'call_back_later', 'Call Back Later', FALSE, 4),
    (v_contacting, 'other',           'Other',           TRUE,  5)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- on_hold outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, sort_order) VALUES
    (v_on_hold, 'on_hold', 'On Hold', 1)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- qualified outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_qualified, 'visit_scheduled', 'Visit Scheduled', FALSE, 1),
    (v_qualified, 'visited',         'Visited',         FALSE, 2),
    (v_qualified, 'other',           'Other',           TRUE,  3)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- converted outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_converted, 'membership_sold', 'Membership Sold', FALSE, 1),
    (v_converted, 'other',           'Other',           TRUE,  2)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- unqualified outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_unqualified, 'no_response_after_multiple_attempts', 'No Response After Multiple Attempts', FALSE, 1),
    (v_unqualified, 'wrong_number',                        'Wrong Number',                        FALSE, 2),
    (v_unqualified, 'job_applicant',                       'Job Applicant',                       FALSE, 3),
    (v_unqualified, 'budget_issue',                        'Budget Issue',                        FALSE, 4),
    (v_unqualified, 'not_interested',                      'Not Interested',                      FALSE, 5),
    (v_unqualified, 'location_issue',                      'Location Issue',                      FALSE, 6),
    (v_unqualified, 'duplicate_lead',                      'Duplicate Lead',                      FALSE, 7),
    (v_unqualified, 'other',                               'Other',                               TRUE,  8)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- transferred_out outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_transferred, 'transferred_to_other_branch', 'Transferred to Other Branch', FALSE, 1),
    (v_transferred, 'other',                       'Other',                       TRUE,  2)
  ON CONFLICT (stage_id, name) DO NOTHING;
END;
$$;

-- ===================================================================
-- EXT -- META CAPI EVENT TYPES + LEAD STAGE -> CAPI EVENT MAPPING
-- ===================================================================

INSERT INTO ext.meta_capi_event_types (code, label, sort_order) VALUES
  ('Other',         'Other',           1),
  ('ConvertedLead', 'Converted Lead',  2),
  ('QualifiedLead', 'Qualified Lead',  3)
ON CONFLICT (code) DO UPDATE SET
  label      = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order;

-- Wire each lead_stage to its Meta CAPI event by id (never by name-string
-- comparison at request time — this join is one-time seed wiring only).
-- Stages not listed here ('new', 'unqualified') get no row, so no CAPI
-- event fires when a lead transitions into them.
INSERT INTO ext.lead_stage_capi_event_map (stage_id, capi_event_type_id)
SELECT ls.id, et.id
FROM (VALUES
  ('contacting',      'Other'),
  ('on_hold',         'Other'),
  ('qualified',       'QualifiedLead'),
  ('converted',       'ConvertedLead'),
  ('transferred_out', 'Other')
) AS m(stage_name, event_code)
JOIN lms.lead_stage ls            ON ls.name = m.stage_name
JOIN ext.meta_capi_event_types et ON et.code = m.event_code
ON CONFLICT (stage_id) DO UPDATE SET
  capi_event_type_id = EXCLUDED.capi_event_type_id;

INSERT INTO lms.interaction_types (name, label, description) VALUES
  ('call',          'Call',          'Outbound or inbound phone call'),
  ('whatsapp',      'WhatsApp',      'WhatsApp message (text, audio, or media)'),
  ('email',         'Email',         'Email sent or received'),
  ('sms',           'SMS',           'SMS or text message'),
  ('in_person',     'In Person',     'Face-to-face meeting at store, office, or event'),
  ('video_call',    'Video Call',    'Video call via Zoom, Google Meet, WhatsApp Video, etc.'),
  ('chat',          'Chat',          'Live chat on website or social media platform'),
  ('internal_note', 'Internal Note', 'Internal note or annotation added by a team member')
ON CONFLICT (name) DO NOTHING;

INSERT INTO lms.follow_up_statuses (name, label, description) VALUES
  ('pending',     'Pending',     'Follow-up scheduled and not yet actioned'),
  ('completed',   'Completed',   'Follow-up actioned within the scheduled window'),
  ('missed',      'Missed',      'Follow-up was not actioned before the scheduled time'),
  ('rescheduled', 'Rescheduled', 'Follow-up postponed to a new scheduled_at datetime')
ON CONFLICT (name) DO NOTHING;


-- ===================================================================
-- MARKETING -- PLATFORMS & CAMPAIGN STATUSES
-- ===================================================================

INSERT INTO marketing.marketing_platforms (name, label, description) VALUES
  ('facebook',     'Facebook',     'Facebook / Instagram Lead Ads and Campaigns'),
  ('google',       'Google',       'Google Ads (Search, Display, Shopping, Performance Max)'),
  ('instagram',    'Instagram',    'Instagram organic and paid posts'),
  ('youtube',      'YouTube',      'YouTube video ads'),
  ('whatsapp',     'WhatsApp',     'WhatsApp click-to-chat ads via Facebook Ads Manager'),
  ('linkedin',     'LinkedIn',     'LinkedIn Lead Gen Forms and sponsored content'),
  ('tiktok',       'TikTok',       'TikTok for Business lead generation'),
  ('organic',      'Organic',      'Walk-in, direct website, or offline enquiry with no paid source'),
  ('referral',     'Referral',     'Referred by an existing customer or partner'),
  ('whatsapp_ads', 'WhatsApp Ads', 'WhatsApp click-to-chat ads via Facebook Ads Manager (legacy alias)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO marketing.campaign_statuses (name, label, description) VALUES
  ('draft',     'Draft',     'Campaign created but not yet submitted for review or activation'),
  ('active',    'Active',    'Campaign is live and currently running'),
  ('paused',    'Paused',    'Campaign temporarily paused; can be resumed'),
  ('completed', 'Completed', 'Campaign ran its full duration and ended normally'),
  ('archived',  'Archived',  'Campaign permanently closed and moved to archive')
ON CONFLICT (name) DO NOTHING;


-- ===================================================================
-- ENTITY -- ORG TYPES, TENANT DOMAINS, TENANT PLAN TYPES
-- ===================================================================

INSERT INTO entity.org_types (name, label, description) VALUES
  ('gym_location', 'Gym Location', 'Physical gym or fitness centre location'),
  ('boutique',     'Boutique',     'Boutique or small retail outlet'),
  ('branch',       'Branch',       'Standard branch office of a business'),
  ('headquarters', 'Headquarters', 'Corporate headquarters or registered office'),
  ('franchise',    'Franchise',    'Franchise outlet operating under a licensor brand'),
  ('clinic',       'Clinic',       'Medical or wellness clinic unit'),
  ('warehouse',    'Warehouse',    'Storage or fulfilment centre'),
  ('showroom',     'Showroom',     'Product display and sales showroom'),
  ('head_office',  'Head Office',  'Corporate headquarters or registered office (alias)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO entity.tenant_domains (name, label, description) VALUES
  ('fitness',     'Fitness',     'Gyms, fitness centres, yoga studios, personal training'),
  ('retail',      'Retail',      'Fashion boutiques, apparel, accessories, lifestyle stores'),
  ('healthcare',  'Healthcare',  'Clinics, hospitals, diagnostic centres, healthcare providers'),
  ('education',   'Education',   'Schools, coaching centres, e-learning platforms'),
  ('hospitality', 'Hospitality', 'Hotels, resorts, restaurants, event venues'),
  ('medical',     'Medical',     'Medical practices and healthcare providers (alias for healthcare)'),
  ('real_estate', 'Real Estate', 'Property sales, rentals, property management'),
  ('automotive',  'Automotive',  'Car dealerships, service centres, vehicle rentals'),
  ('logistics',   'Logistics',   'Warehousing, freight, courier, supply chain')
ON CONFLICT (name) DO NOTHING;

INSERT INTO entity.tenant_plan_types (name, label, description) VALUES
  ('free_trial', 'Free Trial', 'Up to 3 iam.users, 1 org, 100 leads — 30-day trial'),
  ('starter',    'Starter',    'Up to 10 iam.users, 2 orgs, 1 000 leads/month'),
  ('growth',     'Growth',     'Up to 50 iam.users, 10 orgs, 10 000 leads/month, AI scoring'),
  ('enterprise', 'Enterprise', 'Unlimited iam.users and orgs, dedicated support, custom SLA')
ON CONFLICT (name) DO NOTHING;

INSERT INTO lms.lead_sources (name, label) VALUES
  ('facebook',     'Facebook'),
  ('google',       'Google'),
  ('instagram',    'Instagram'),
  ('whatsapp',     'WhatsApp'),
  ('website_form', 'Website Form'),
  ('referral',     'Referral'),
  ('walk_in',      'Walk In'),
  ('cold_call',    'Cold Call'),
  ('other',        'Other')
ON CONFLICT (name) DO NOTHING;


-- ===================================================================
-- SCHEMA VERSION TRACKING (Meta CAPI additions)
-- ===================================================================

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.2.0', 'Meta Conversion API: ext.meta_org_config, ext.meta_leads, ext.meta_lead_custom_fields, ext.meta_capi_outbound_logs')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.3.0', 'Meta Conversion API: ext.meta_lead_addresses, ext.meta_lead_professional, ext.meta_lead_demographics, ext.meta_org_config.field_mappings, extended ext.view_meta_leads_complete')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_versions (version, description) VALUES
  ('1.4.0', 'Meta Conversion API: tenant-level app config (ext.meta_tenant_config replaces per-org ext.meta_org_config) + ext.meta_page_form_org_map for Page/Form -> org attribution, ext.meta_leads.page_id')
ON CONFLICT (version) DO NOTHING;


-- Run against a DB that already has 01_init-db.sql + 01_init-lookup-data.sql applied.
-- Paste directly into DBeaver's SQL editor (no psql \copy / meta-commands used).
--
-- NOTE: users.csv / user_org_mapping.csv had a blank org_id for the Root
-- (super_admin) user, but iam.users.org_id and iam.user_org_mapping.org_id
-- are both NOT NULL. Per instruction, the Root user is attached to the
-- Gurgaon org (e05601c1-bf3e-4b92-b157-8e038bdffab1) below.
--
-- NOTE: entity.tenant_domains / entity.tenant_plan_types / entity.org_types /
-- iam.user_roles all default their id to gen_uuidv7() at insert time, so the
-- literal UUIDs from the CSVs (generated in a different DB) don't exist here.
-- All four lookups are resolved by name below instead.
/*
BEGIN;

INSERT INTO entity.tenants
  (id, name, domain_id, plan_type_id, is_active, is_deleted, deleted_at, deleted_by, metadata, created_at, updated_at)
VALUES
  ('0b39b589-ea7d-446a-b660-350e1d84ebd9', 'Fitclass',
   (SELECT id FROM entity.tenant_domains WHERE name = 'fitness'),
   (SELECT id FROM entity.tenant_plan_types WHERE name = 'growth'),
   TRUE, FALSE, NULL, NULL, '{}'::jsonb, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00');

INSERT INTO entity.organizations
  (id, tenant_id, name, legal_entity_name, brand_name, org_type_id, address_line1, address_line2, landmark, pincode,
   city_id, state_id, country_id, timezone, is_active, is_deleted, deleted_at, deleted_by, metadata, created_at, updated_at)
VALUES
  ('e05601c1-bf3e-4b92-b157-8e038bdffab1', '0b39b589-ea7d-446a-b660-350e1d84ebd9', 'Fitclass - Gurgaon - Sec 69', NULL, 'Fitclass',
   (SELECT id FROM entity.org_types WHERE name = 'gym_location'), NULL, 'Sector 69', NULL, NULL,
   NULL, NULL, NULL, 'Asia/Kolkata', TRUE, FALSE, NULL, NULL, '{}'::jsonb, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00');

INSERT INTO iam.users
  (id, org_id, first_name, middle_name, last_name, email, mobile, password_hash, role_id, manager_id,
   is_active, is_deleted, deleted_at, deleted_by, created_by, force_password_change, password_changed_at, last_login_at, created_at, updated_at)
VALUES
  ('870d4958-4a11-4c78-99e0-f240c9f17412', 'e05601c1-bf3e-4b92-b157-8e038bdffab1', 'Root', NULL, 'User',
   'root@root.com', NULL, '$2b$12$JKkWDgN8P1xNEe.p4LvxU.Pmya5i8ywVg6GRkn7ePBqa6SJczmF7m',
   (SELECT id FROM iam.user_roles WHERE name = 'super_admin'), NULL,
   TRUE, FALSE, NULL, NULL, NULL, FALSE, '2026-07-09 08:35:14+00', NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00'),

  ('b9aaf975-05ab-4112-b2b8-1f2bc538e1e0', 'e05601c1-bf3e-4b92-b157-8e038bdffab1', 'Tenant', NULL, 'Admin',
   'admin@fitclass.in', NULL, '$2b$12$JKkWDgN8P1xNEe.p4LvxU.Pmya5i8ywVg6GRkn7ePBqa6SJczmF7m',
   (SELECT id FROM iam.user_roles WHERE name = 'tenant_admin'), NULL,
   TRUE, FALSE, NULL, NULL, NULL, FALSE, '2026-07-09 08:35:14+00', NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00'),

  ('b7d7bc32-0e25-422c-b587-8abe0911f7a5', 'e05601c1-bf3e-4b92-b157-8e038bdffab1', 'Branch', NULL, 'Admin',
   'admin-ggn-69@fitclass.in', NULL, '$2b$12$JKkWDgN8P1xNEe.p4LvxU.Pmya5i8ywVg6GRkn7ePBqa6SJczmF7m',
   (SELECT id FROM iam.user_roles WHERE name = 'org_admin'), NULL,
   TRUE, FALSE, NULL, NULL, NULL, FALSE, '2026-07-09 08:35:14+00', NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00');

-- role_id resolved by name from iam.user_roles since user_org_mapping.csv carries role names, not UUIDs.
INSERT INTO iam.user_org_mapping
  (user_id, org_id, role_id, is_active, lead_assignment_weight, granted_by, granted_at, updated_at)
VALUES
  ('870d4958-4a11-4c78-99e0-f240c9f17412', 'e05601c1-bf3e-4b92-b157-8e038bdffab1',
   (SELECT id FROM iam.user_roles WHERE name = 'super_admin'), TRUE, 0, NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00'),

  ('b9aaf975-05ab-4112-b2b8-1f2bc538e1e0', 'e05601c1-bf3e-4b92-b157-8e038bdffab1',
   (SELECT id FROM iam.user_roles WHERE name = 'tenant_admin'), TRUE, 0, NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00'),

  ('b7d7bc32-0e25-422c-b587-8abe0911f7a5', 'e05601c1-bf3e-4b92-b157-8e038bdffab1',
   (SELECT id FROM iam.user_roles WHERE name = 'org_admin'), TRUE, 0, NULL, '2026-07-09 08:35:14+00', '2026-07-09 08:35:14+00');

COMMIT;
*/