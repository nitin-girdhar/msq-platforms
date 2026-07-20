/** @type {import('dependency-cruiser').IConfiguration} */

// --- Boundary path groups (PR-B / Phase5 F-0) -----------------------------
// Product ownership is by *repo* (see docs/Phase5_Extraction_Plan.md §0), not by
// package folder alone. `notifications-service` is LMS-owned (decision N-2), so it
// counts as LMS code here, not shared.
//
// SHARED = platform packages + shared services + shared apps. It must never import
// a product package. Each product's code must never import a *sibling* product's
// package. These rules are the wall that keeps the seams closed after the repo
// split: a violation here is a cross-boundary edge that git-filter-repo would
// otherwise cut into a broken build.
//
// NOTE: dependency-cruiser sees the *import graph* only. Raw-SQL cross-schema
// access (identity → lms.marketing_leads [N-5]; admin-service → hr/task lookups
// [N-6]) is invisible to it and is guarded separately — do not assume green
// depcruise means zero cross-boundary coupling.

const SHARED =
  '^(packages/(platform-authz|ui|db|types|service-auth|auth-constants|audit-log|validation)|services/(identity-service|api-gateway|admin-service|communication-service)|apps/(auth-web|lookup-admin))/';

const LMS =
  '^(services/(leads-service|meta-conversion-api|notifications-service)|apps/lms-web|packages/lms-(authz|web))/';
const HR = '^(services/hr-service|apps/hr-web|packages/hr-(authz|web))/';
const TASK = '^(services/tasks-service|apps/todo-web|packages/task-(authz|web))/';

// A product's importable packages (the `to` side of a forbidden edge).
const LMS_PKG = '^packages/lms-(authz|web)/';
const HR_PKG = '^packages/hr-(authz|web)/';
const TASK_PKG = '^packages/task-(authz|web)/';
const ANY_PRODUCT_PKG = '^packages/(lms|hr|task)-(authz|web)/';

module.exports = {
  forbidden: [
    {
      name: 'platform-no-product',
      comment:
        'Shared/platform code (platform packages, shared services, shared apps) must never depend on a product package — that would make shared-repo depend on a product repo. See Phase5_Extraction_Plan §5 N-1.',
      severity: 'error',
      from: { path: SHARED },
      to: { path: ANY_PRODUCT_PKG },
    },
    {
      name: 'lms-no-sibling',
      comment:
        'LMS code (leads/meta/notifications services, lms-web app, @lms/* packages) may depend on @platform/* only — never on @hr/* or @task/*. See Phase5_Extraction_Plan §5 N-3 / §5b P-4.',
      severity: 'error',
      from: { path: LMS },
      to: { path: `${HR_PKG}|${TASK_PKG}` },
    },
    {
      name: 'hr-no-sibling',
      comment:
        'HR code (hr-service, hr-web app, @hr/* packages) may depend on @platform/* only — never on @lms/* or @task/*.',
      severity: 'error',
      from: { path: HR },
      to: { path: `${LMS_PKG}|${TASK_PKG}` },
    },
    {
      name: 'task-no-sibling',
      comment:
        'Task code (tasks-service, todo-web app, @task/* packages) may depend on @platform/* only — never on @lms/* or @hr/*.',
      severity: 'error',
      from: { path: TASK },
      to: { path: `${LMS_PKG}|${HR_PKG}` },
    },
  ],
  options: {
    doNotFollow: {
      // dist is doNotFollow (not exclude) so a built package (e.g. @lms/authz →
      // packages/lms-authz/dist, whose package.json main points at dist) is still a
      // reportable `to` node for the boundary rules, without cruising its internals.
      path: '(^|/)(node_modules|dist)/',
    },
    exclude: {
      path: '(^|/)(\\.turbo|node_modules)/',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
