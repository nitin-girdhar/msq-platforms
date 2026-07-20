export * from './pg-schemas.js';

export * from './tables/countries.table.js';
export * from './tables/states.table.js';
export * from './tables/cities.table.js';
export * from './tables/user-roles.table.js';
export * from './tables/lead-stage.table.js';
export * from './tables/lead-stage-outcome.table.js';
export * from './tables/interaction-types.table.js';
export * from './tables/follow-up-statuses.table.js';
export * from './tables/marketing-platforms.table.js';
export * from './tables/campaign-statuses.table.js';
export * from './tables/lead-sources.table.js';
export * from './tables/org-types.table.js';
export * from './tables/tenant-domains.table.js';
export * from './tables/tenant-plan-types.table.js';
export * from './tables/tenants.table.js';
export * from './tables/organizations.table.js';
export * from './tables/users.table.js';
export * from './tables/ad-campaigns.table.js';
export * from './tables/marketing-leads.table.js';
export * from './tables/lead-links.table.js';
export * from './tables/lead-interactions.table.js';
export * from './tables/lead-follow-ups.table.js';
export * from './tables/lead-assignment-log.table.js';
export * from './tables/lead-status-log.table.js';
export * from './tables/activities.table.js';
export * from './tables/marketing-leads-history.table.js';
export * from './tables/audit-log.table.js';
export * from './tables/token-blocklist.table.js';
export * from './tables/schema-versions.table.js';
export * from './tables/user-org-mapping.table.js';
export * from './tables/meta-tenant-config.table.js';
export * from './tables/meta-page-form-org-map.table.js';
export * from './tables/api-clients.table.js';
export * from './tables/api-client-orgs.table.js';
export * from './tables/meta-leads.table.js';
export * from './tables/meta-lead-custom-fields.table.js';
export * from './tables/meta-capi-outbound-logs.table.js';
export * from './tables/meta-lead-addresses.table.js';
export * from './tables/meta-lead-professional.table.js';
export * from './tables/meta-lead-demographics.table.js';
export * from './tables/meta-capi-event-types.table.js';
export * from './tables/lead-stage-capi-event-map.table.js';

// HR + Task platform (Phase 0)
export * from './tables/tenant-modules.table.js';

// Tenant default seeding (Phase 3B — db_scripts/23)
export * from './tables/catalog-defaults.table.js';
export * from './tables/catalog-versions.table.js';
export * from './tables/tenant-catalog-versions.table.js';
export * from './tables/employment-types.table.js';
export * from './tables/leave-types.table.js';
export * from './tables/leave-request-statuses.table.js';
export * from './tables/attendance-statuses.table.js';
export * from './tables/departments.table.js';
export * from './tables/designations.table.js';
export * from './tables/employee-profiles.table.js';

// Leave management (Phase 1)
export * from './tables/holiday-calendars.table.js';
export * from './tables/holidays.table.js';
export * from './tables/leave-policies.table.js';
export * from './tables/hr-settings.table.js';
export * from './tables/leave-requests.table.js';
export * from './tables/leave-request-status-log.table.js';
export * from './tables/leave-ledger.table.js';
export * from './tables/leave-request-approvals.table.js';
export * from './tables/reporting-lines.table.js';

// Attendance (Phase 2)
export * from './tables/attendance-rules.table.js';
export * from './tables/shifts.table.js';
export * from './tables/shift-assignments.table.js';
export * from './tables/attendance-events.table.js';
export * from './tables/attendance-days.table.js';
export * from './tables/attendance-regularizations.table.js';

export * from './views/dashboard-leads.view.js';
export * from './views/lead-followup-timeline.view.js';
export * from './views/lead-assignment-timeline.view.js';
export * from './views/user-team-members.view.js';
export * from './views/user-org-chart.view.js';
export * from './views/user-org-access.view.js';
export * from './views/campaign-lookup.view.js';
export * from './views/rep-performance.view.js';
export * from './views/tenant-campaign-summary.view.js';
export * from './views/meta-leads-complete.view.js';
export * from './views/lead-stage-capi-event-map.view.js';

// Leave management views (Phase 1)
export * from './views/leave-balances.view.js';
export * from './views/leave-requests-enriched.view.js';
export * from './views/team-leave-calendar.view.js';

// Attendance views (Phase 2)
export * from './views/attendance-monthly-summary.view.js';
export * from './views/org-attendance-today.view.js';

// Tasks / To-do (Phase 3)
export * from './tables/task-statuses.table.js';
export * from './tables/task-priorities.table.js';
export * from './tables/task-lists.table.js';
export * from './tables/tasks.table.js';
export * from './tables/task-status-log.table.js';
export * from './tables/task-comments.table.js';

// Per-product roles (P1.1 — per-product role ladders + (user, product, role) grants)
export * from './tables/lms-roles.table.js';
export * from './tables/hr-roles.table.js';
export * from './tables/task-roles.table.js';
export * from './tables/lms-member-roles.table.js';
export * from './tables/hr-member-roles.table.js';
export * from './tables/task-member-roles.table.js';
export * from './views/lms-member-roles.view.js';
export * from './views/hr-member-roles.view.js';
export * from './views/task-member-roles.view.js';
