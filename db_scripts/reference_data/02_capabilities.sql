-- ===================================================================
-- reference_data/02_capabilities.sql — Capability tree
--
-- The permission catalog every role grant points at. Global by
-- definition — a capability key means the same thing in every tenant.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

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

-- Was lms.apiclients* — API credentials aren't LMS-specific (comms/tasks routes
-- use the same clients), so this moved out from under the CRM tool. Renamed,
-- not just reparented: the old key stays gone rather than kept as an alias, so
-- there is exactly one name for this capability going forward. See
-- tools/rename_apiclients_capability.sql for the one-time UPDATE that migrates
-- existing grants on an already-provisioned database — this INSERT alone only
-- covers a fresh deploy.
('platform.api_tokens',        'page',      'platform',           'API tokens',
 'Machine credentials for the public integration API.', 2),
('platform.api_tokens.view',   'operation', 'platform.api_tokens', 'View API tokens',
 'Read the client list. Secrets are never shown.', 1),
('platform.api_tokens.manage', 'operation', 'platform.api_tokens', 'Manage API tokens',
 'Create clients and rotate their secrets.', 2),

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
('lms.leads.whatsapp.send', 'operation', 'lms.leads', 'Send WhatsApp',
 'Message a lead on WhatsApp using an approved template. Separate from logging an interaction, because it contacts the customer directly.', 10),
('lms.leads.assign.bulk', 'operation', 'lms.leads', 'Bulk assign leads',
 'Assign many leads to one person in a single action.', 11),

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
('hr.attendance.admin.geo_exceptions', 'tab', 'hr.attendance.admin', 'Geofence exceptions',
 'People allowed to check in from outside the office radius.', 5),
('hr.attendance.admin.geo_exceptions.view',   'operation', 'hr.attendance.admin.geo_exceptions', 'View exceptions',
 'Read who may check in remotely, and until when.', 1),
('hr.attendance.admin.geo_exceptions.manage', 'operation', 'hr.attendance.admin.geo_exceptions', 'Manage exceptions',
 'Let a named person check in from anywhere — a rotating field role, or an approved work-from-home stretch.', 2),
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
-- Scope: the lookup-admin console, which is super_admin-only (its layout gates
-- on admin.lookups.manage, and every admin-service route behind it additionally
-- requires RANKS.SUPER_ADMIN). Nothing here describes the HR or Tasks admin
-- tabs — those are the `hr.*.admin.*` tab nodes and `tasks.lists`.
--
-- KEEP THIS SUBTREE TO WHAT IS ACTUALLY GATED. It previously also carried
-- admin.orgs{,.view,.manage}, admin.users{,.manage,.mappings.manage,
-- .password.reset}, admin.lookups.view, admin.config.lms.manage,
-- admin.meta.manage and admin.comms.send — eleven keys with no reader in any
-- app or service. They rendered as tickable boxes on the Capability Matrix
-- screen that changed nothing, because the surfaces they named live in
-- admin-service / identity-service, which gate on rank alone. Removed in
-- _migrations/22_prune_unused_admin_capabilities.sql. If one of those surfaces
-- ever grows a real requireCapability gate, re-add the key WITH the gate, in
-- the same change.
('admin', 'tool', NULL, 'Administration',
 'Tenant and platform configuration.', 6),

('admin.lookups', 'page', 'admin', 'Lookup data',
 'Platform-wide reference tables. Changes affect every tenant.', 3),
-- No sibling `.view`: lookup-admin is manage-or-nothing. A view-only grant
-- would light up the sidebar (filterNav wants any granted descendant) and then
-- hit the layout's "Access restricted" screen — the render-then-403 shape the
-- capability tree exists to prevent.
('admin.lookups.manage', 'operation', 'admin.lookups', 'Manage lookup data',
 'Edit reference tables. Affects every tenant on the platform.', 2),

('admin.roles.manage', 'operation', 'admin', 'Manage roles',
 'Define roles, ranks, departments and these capability grants.', 4)

ON CONFLICT (key) DO UPDATE SET
  kind        = EXCLUDED.kind,
  parent_key  = EXCLUDED.parent_key,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order,
  is_active   = TRUE;

COMMIT;
