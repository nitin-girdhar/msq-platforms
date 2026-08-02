-- ===================================================================
-- reference_data/07_catalog_registry.sql — Tenant catalog registry
--
-- The versioned default rows behind entity.seed_tenant_defaults(): task
-- statuses and priorities, HR leave/employment/attendance types, and the
-- per-product role catalogs.
-- 
-- Never edit a shipped (catalog_key, version) row set — add rows at
-- version N+1 and bump entity.catalog_versions.current_version, so
-- existing tenants keep what they have.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 9. Seed the version-1 default catalogs.
--    Values mirror the original global lookup seeds (14_init-tasks.sql,
--    10_init-hr-task-schemas.sql, 17_init-per-product-roles.sql) — the set
--    every tenant received via 22_tenant-scope-lookups.sql. Append-only:
--    to change a default for future tenants, INSERT version 2 rows and bump
--    current_version below; do NOT edit these rows.
-- ═══════════════════════════════════════════════════════════════════

-- task.task_statuses (module: tasks)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, is_terminal, sort_order) VALUES
  ('task.task_statuses', 'tasks', 1, 'todo',        'To Do',       FALSE, 1),
  ('task.task_statuses', 'tasks', 1, 'in_progress', 'In Progress', FALSE, 2),
  ('task.task_statuses', 'tasks', 1, 'blocked',     'Blocked',     FALSE, 3),
  ('task.task_statuses', 'tasks', 1, 'done',        'Done',        TRUE,  4),
  ('task.task_statuses', 'tasks', 1, 'cancelled',   'Cancelled',   TRUE,  5)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- task.task_priorities (module: tasks)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, sort_order) VALUES
  ('task.task_priorities', 'tasks', 1, 'low',    'Low',    1),
  ('task.task_priorities', 'tasks', 1, 'medium', 'Medium', 2),
  ('task.task_priorities', 'tasks', 1, 'high',   'High',   3),
  ('task.task_priorities', 'tasks', 1, 'urgent', 'Urgent', 4)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- hr.leave_types (module: leave)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, is_paid, sort_order) VALUES
  ('hr.leave_types', 'leave', 1, 'casual',      'Casual Leave',      TRUE,  1),
  ('hr.leave_types', 'leave', 1, 'sick',        'Sick Leave',        TRUE,  2),
  ('hr.leave_types', 'leave', 1, 'earned',      'Earned Leave',      TRUE,  3),
  ('hr.leave_types', 'leave', 1, 'maternity',   'Maternity Leave',   TRUE,  4),
  ('hr.leave_types', 'leave', 1, 'paternity',   'Paternity Leave',   TRUE,  5),
  ('hr.leave_types', 'leave', 1, 'bereavement', 'Bereavement Leave', TRUE,  6),
  ('hr.leave_types', 'leave', 1, 'comp_off',    'Compensatory Off',  TRUE,  7),
  ('hr.leave_types', 'leave', 1, 'loss_of_pay', 'Loss of Pay',       FALSE, 8)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- hr.employment_types (modules: leave OR attendance — HR-wide)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, sort_order) VALUES
  ('hr.employment_types', 'leave', 1, 'full_time', 'Full Time', 1),
  ('hr.employment_types', 'leave', 1, 'part_time', 'Part Time', 2),
  ('hr.employment_types', 'leave', 1, 'contract',  'Contract',  3),
  ('hr.employment_types', 'leave', 1, 'intern',    'Intern',    4)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- hr.leave_request_statuses (module: leave)
-- These `name` values are a MACHINE vocabulary — hr.check_leave_request_completion()
-- and the approval flow key on them. A tenant may relabel; renaming breaks leave.
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, sort_order) VALUES
  ('hr.leave_request_statuses', 'leave', 1, 'draft',     'Draft',     1),
  ('hr.leave_request_statuses', 'leave', 1, 'pending',   'Pending',   2),
  ('hr.leave_request_statuses', 'leave', 1, 'approved',  'Approved',  3),
  ('hr.leave_request_statuses', 'leave', 1, 'rejected',  'Rejected',  4),
  ('hr.leave_request_statuses', 'leave', 1, 'cancelled', 'Cancelled', 5),
  ('hr.leave_request_statuses', 'leave', 1, 'withdrawn', 'Withdrawn', 6)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- hr.attendance_statuses (module: attendance)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, sort_order) VALUES
  ('hr.attendance_statuses', 'attendance', 1, 'present',    'Present',         1),
  ('hr.attendance_statuses', 'attendance', 1, 'absent',     'Absent',          2),
  ('hr.attendance_statuses', 'attendance', 1, 'half_day',   'Half Day',        3),
  ('hr.attendance_statuses', 'attendance', 1, 'on_leave',   'On Leave',        4),
  ('hr.attendance_statuses', 'attendance', 1, 'holiday',    'Holiday',         5),
  ('hr.attendance_statuses', 'attendance', 1, 'weekly_off', 'Weekly Off',      6),
  ('hr.attendance_statuses', 'attendance', 1, 'wfh',        'Work From Home',  7)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- lms.roles (module: lms)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, description, rank, sort_order) VALUES
  ('lms.roles', 'lms', 1, 'read_only',              'Read Only',              'Read-only viewer — dashboards and reports only',                    0,  1),
  ('lms.roles', 'lms', 1, 'sales_representative',   'Sales Representative',   'Front-line sales — manages own assigned leads and follow-ups',     20, 2),
  ('lms.roles', 'lms', 1, 'senior_sales_executive', 'Senior Sales Executive', 'Manages a team of sales reps',                                     40, 3),
  ('lms.roles', 'lms', 1, 'org_manager',            'Manager',                'Manages a team of Senior Sales Executives and reps within an org', 60, 4),
  ('lms.roles', 'lms', 1, 'org_sr_manager',         'Senior Manager',         'Manages a team of managers and reps within an org',                70, 5),
  ('lms.roles', 'lms', 1, 'lms_admin',              'LMS Admin',              'Full control of the LMS product within an org',                    80, 6)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- hr.roles (modules: leave OR attendance — HR-wide)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, description, rank, sort_order) VALUES
  ('hr.roles', 'leave', 1, 'hr_viewer',  'HR Viewer',  'Read-only access to HR data',                                  0,  1),
  ('hr.roles', 'leave', 1, 'hr_staff',   'HR Staff',   'Day-to-day HR operations — leave/attendance entry',           40, 2),
  ('hr.roles', 'leave', 1, 'hr_manager', 'HR Manager', 'Approves leave, manages team attendance',                     70, 3),
  ('hr.roles', 'leave', 1, 'hr_admin',   'HR Admin',   'Full control of the HR product — profiles, policies, config', 80, 4)
ON CONFLICT (catalog_key, version, name) DO NOTHING;

-- task.roles (module: tasks)
INSERT INTO entity.catalog_defaults (catalog_key, product, version, name, label, description, rank, sort_order) VALUES
  ('task.roles', 'tasks', 1, 'task_member', 'Task Member', 'Creates and works own tasks',                     20, 1),
  ('task.roles', 'tasks', 1, 'task_lead',   'Task Lead',   'Manages a team''s tasks and lists',               40, 2),
  ('task.roles', 'tasks', 1, 'task_admin',  'Task Admin',  'Full control of the Tasks product within an org', 80, 3)
ON CONFLICT (catalog_key, version, name) DO NOTHING;


-- Register the current version + module gating per catalog.
INSERT INTO entity.catalog_versions (catalog_key, product, modules, current_version) VALUES
  ('task.task_statuses',     'tasks',      ARRAY['tasks'],               1),
  ('task.task_priorities',   'tasks',      ARRAY['tasks'],               1),
  ('task.roles',             'tasks',      ARRAY['tasks'],               1),
  ('hr.leave_types',         'leave',      ARRAY['leave'],               1),
  ('hr.attendance_statuses', 'attendance', ARRAY['attendance'],          1),
  ('hr.leave_request_statuses','leave',     ARRAY['leave'],               1),
  ('hr.employment_types',    'leave',      ARRAY['leave','attendance'],  1),
  ('hr.roles',               'leave',      ARRAY['leave','attendance'],  1),
  ('lms.roles',              'lms',        ARRAY['lms'],                 1)
ON CONFLICT (catalog_key) DO NOTHING;

COMMIT;
