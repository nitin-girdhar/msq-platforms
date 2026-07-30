# Reporting — copy-paste prompts, one per phase

Each block below is a **self-contained prompt for a fresh session**. Copy one, paste
it into a new window, run it. They assume no prior context beyond this repo.

- Status doc (read/update every session): `docs/REPORTING_STATUS.md`
- Approved plan: `C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md`
- **Phases 0 and 1 are done.** Start at Phase 2.

Run phases **in order** — each builds on the last. The only pair that can safely go in
parallel is 5 and 6 (two independent dataset registries), and only after 4 has landed.

---

## Standing traps (already paid for once — every prompt repeats them)

1. **`@platform/reporting` is consumed as `dist`.** Run
   `pnpm --filter @platform/reporting build` before testing anything downstream, or
   you will validate stale code. This cost a wrong "all clear" in Phase 1.
2. **Use PowerShell, not Git Bash, for `docker exec … -f /tmp/x.sql`.** Bash rewrites
   `/tmp/x.sql` to a Windows path, psql reports "No such file", and the run looks clean.
3. **Unit tests on generated SQL are necessary and NOT sufficient.** Phase 1's worst
   bug (every time-series report broken) passed 279 unit tests and was caught only by
   `PREPARE`-ing against a real database. Do that for every new dataset.
4. **`pnpm dev`'s `predev` runs `taskkill /F /IM node.exe`** — it kills every node
   process on the machine. Prefer `pnpm --filter <pkg> dev`.
5. **`capabilities.ts` says "generated" but there is no generator.** New keys must be
   hand-synced with `db_scripts/07_seed_lookup_data.sql`, and `@platform/rbac` must be
   rebuilt before consumers see them.
6. **Two pre-existing failures are not yours**: `@crm/hr-service`
   gateway-route-coverage (two missing attendance-regularization gateway routes) and
   `@task/web-app` lint (`next lint`, no ESLint config, prompts interactively).
   Verify against a clean tree before touching either.

---

## Phase 2 — ui-kit chart primitives

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then the "ui kit components" section of the
approved plan at C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md.

Implement Phase 2: Recharts chart primitives in @platform/ui-kit
(msq-core/packages/ui). No report builder UI, no data fetching, no LMS knowledge.

BEFORE writing any chart code or picking any colour, load the `dataviz` skill and
follow it. Take its validated palette from references/palette.md as the starting
values, run its contrast validator, and only then nudge hues toward the platform's
existing accent hexes — re-validating after each change. Do NOT invent a palette and
do NOT sample colours out of existing Tailwind class strings.

Build under msq-core/packages/ui/src/components/Chart/:
  ReportChart.tsx  ChartFrame.tsx  ChartTooltip.tsx  ChartLegend.tsx
  Sparkline.tsx  KpiTile.tsx  KpiRow.tsx  DataTable.tsx
  palette.ts  format.ts  index.ts

ReportChart({ spec, result, loading, error, height, palette, onPointClick,
emptyMessage }) switches on spec.chart.type and must render every ChartType in
@platform/reporting: table, kpi, line, area, bar, bar_stacked, bar_horizontal, pie,
donut, scatter. It consumes ReportResult exactly as returned — rows are already
pivoted wide, keyed by cellKey(measureId, seriesKey); series[] gives render order.

Constraints:
- Recharts goes in @platform/ui-kit's `dependencies`, NOT peerDependencies. ui-kit is
  consumed as TS source via transpilePackages, so pnpm resolves it from
  packages/ui/node_modules. Consuming apps must NOT also list recharts — that is the
  only way to get two Reacts. Verify the React 19 peer on install and report if it warns.
- Every chart component is 'use client' (refs + ResizeObserver).
- DataTable.tsx is a plain semantic table, NOT AG Grid. Do not add AG Grid to ui-kit.
- palette.ts exports plain hex strings (Recharts needs fill/stroke values; this repo
  has no CSS custom properties): CHART_PALETTE { categorical, sequential, diverging },
  CHART_TOKENS { axis, grid, text, textMuted, surface, positive, negative, neutral },
  seriesColor(i, override?).
- @platform/ui-kit may import ONLY @platform/reporting's "." entry, never "./sql".
  There is a boundary test in the reporting package asserting "." pulls no drizzle;
  keep that true.
- Never add domain knowledge to ui-kit: no dataset keys, no capability keys, no
  endpoint paths. The barrel src/index.ts documents this rule — honour it.
- Handle meta.truncated visibly. A truncated chart that looks complete is worse than
  no chart.
- A null cell must render as a gap, not as zero, and not as a connected line.

Export from msq-core/packages/ui/src/index.ts.

Verify:
  pnpm --filter @platform/ui-kit typecheck
  pnpm --filter @platform/ui-kit test
  pnpm --filter @platform/reporting test    # boundary tests must stay green
  pnpm depcruise
Then prove it visually: build a throwaway page in lms-web that renders a HARDCODED
ReportResult through every chart type, screenshot it, and confirm light and dark both
read correctly. Delete the throwaway page afterwards.

Finish by updating docs/REPORTING_STATUS.md: mark Phase 2, record what you built,
any deviation from the plan and why, and anything the next phase must know.
```

---

## Phase 3 — LMS report builder page (the end-to-end proof)

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then the approved plan at
C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md.

Implement Phase 3: the pivot-style report builder UI, wired to the Phase 1 endpoints.
This is THE end-to-end proof of the whole feature. No persistence yet.

Build under msq-core/packages/ui/src/components/ReportBuilder/:
  ReportBuilder.tsx  FieldPalette.tsx  DropZone.tsx  FieldChip.tsx  MeasureChip.tsx
  FilterEditor.tsx  ChartTypePicker.tsx  PivotTable.tsx  SavedReportList.tsx
  useReportSpec.ts  index.ts

ReportBuilder is FULLY CONTROLLED:
({ datasets, spec, onSpecChange, result, loading, error, onRun, onSave?,
   savedReports?, onLoadSaved?, onDeleteSaved?, onExport?, autoRun? })
Omitting onSave hides the save UI entirely — that is how ui-kit stays ignorant of
capabilities. Phase 3 passes no onSave; Phase 4 adds it.

UX: drag a field from the palette onto Rows / Columns / Values. Values get an
aggregation picker restricted to that measure's declared `aggs`. A temporal dimension
gets a bucket picker restricted to its declared `buckets`. ChartTypePicker disables a
type and SAYS WHY using chartShapeError() from @platform/reporting — do not duplicate
that rule, import it.

The invariant that keeps this honest: everything the palette offers comes from
DatasetMeta, which the server already filtered by capability. If the UI can construct
it, the server accepts it. Use LIMITS + canAcceptOnShelf() to disable a full shelf
BEFORE the user drops, rather than showing a 400 afterwards.

Also required:
- A dataset with requiresDateRange must open with the date filter pre-filled
  (defaultDateFilter / specForDataset already do this) and must not let the user
  submit without one.
- Refuse to chart a cardinality:'high' dimension without a topN; offer to add one.
- Wire onExport to the existing export/export.ts + DownloadButton in ui-kit.

Product wiring:
- msq-lms/packages/lms-web/src/components/reports/ReportsClient.tsx — SWR against
  GET /api/analytics/reports/datasets and POST /api/analytics/reports/query, using the
  existing lms-web api client. Debounce autoRun.
- msq-lms/apps/lms-web/app/dashboard/(lms)/reports/page.tsx — server component
  mirroring the existing analytics/page.tsx (requireSession, capability gate, render
  client). Gate on CAPABILITY.LMS_REPORTS_VIEW, which is already seeded.
- Add the nav entry. Nav visibility uses holdsUsableNode() in
  msq-core/packages/ui/src/shell/nav.ts — check how sibling pages do it.

Verify:
  pnpm --filter @platform/ui-kit typecheck
  pnpm typecheck
  pnpm depcruise
Then RUN IT: make dev-infra, then start api-gateway + leads-service + lms-web
(pnpm --filter <pkg> dev; do NOT use root `pnpm dev`, its predev kills all node).
Log in, open /dashboard/reports, and actually build "leads created per month, stacked
by stage" end to end. Screenshot it. Confirm the numbers match the leads list for the
same filter. Report anything that felt wrong in the interaction, not just whether it
rendered.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 4 — persistence (saved reports)

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then the "Database" section of the approved plan
at C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md.

Implement Phase 4: persist report definitions.

DDL goes in the BASE db_scripts files, not _migrations/ — db_scripts/_migrations/README.md
says purely-additive DDL belongs in place because db_deploy.ps1 re-runs them idempotently.
Read that README before writing any SQL.
  01_extensions_and_roles.sql  CREATE SCHEMA IF NOT EXISTS report;
  02_schema.sql                report.report_definitions + indexes + triggers + vw_; bump schema_version
  04_roles_and_grants.sql      USAGE + SELECT/INSERT/UPDATE (NO DELETE — soft delete only)
  06_rls.sql                   policies below

A NEW `report` schema, not a product schema (all three services write it and lms_svc
has no USAGE on hr) and not iam/entity (product logins are deliberately read-only there).

report.report_definitions: gen_uuidv7() PK, org_id + tenant_id FKs, product,
dataset_key, name, description, spec JSONB, spec_version, visibility, is_pinned,
sort_order, last_run_at, plus the standard is_active/is_deleted/deleted_at/deleted_by/
created_by/created_at/updated_at. CHECKs: active-xor-deleted, product IN
('lms','hr','task'), visibility IN ('private','org','tenant'), jsonb_typeof(spec)='object',
name length 1..120, pg_column_size(spec) < 32768. Reuse the existing trigger helpers in
02_schema.sql: set_updated_at, soft_delete_row, set_org_id, set_created_by. Add a small
report.set_report_tenant_id() BEFORE INSERT trigger resolving tenant_id from
entity.organizations when NULL.

RLS: permissive org_isolation_policy TO app_user (own org AND (visibility <> 'private'
OR own row); WITH CHECK pins created_by to the caller); permissive
tenant_isolation_policy TO tenant_admin; plus RESTRICTIVE product_scope_lms/hr/task
policies TO each product login (USING product = '<p>') so a product service can never
see another product's saved reports.
VERIFY THE RESTRICTIVE-ON-NOINHERIT-LOGIN BEHAVIOUR EMPIRICALLY IN PSQL before relying
on it — withRoleTx's comments note membership checks ignore INHERIT, and this policy is
the crux of cross-product isolation on a shared table.

Code:
- @platform/reporting/store (new "./store" subpath export) — CRUD taking the injected
  SqlExecutor, exactly like ./sql does. Do NOT add @platform/db as a dependency.
- CRITICAL: re-validate spec JSONB through parseReportSpec() ON READ, not only on
  write. A row written before a registry change, or edited out of band, is untrusted
  input exactly like a request body. There is already a test asserting this contract
  for the compiler; add the equivalent for the store.
- GET definitions returns per-row `valid: boolean` + `issues: string[]` so a report
  referencing a since-removed field shows "needs attention" instead of exploding.
- Routes in leads-service (list/create/get/patch/delete + POST :id/query), gated
  LMS_REPORTS_VIEW for reads and LMS_REPORTS_MANAGE for writes. Both keys are already
  seeded. Gateway proxyTo registrations for each; the drift test will tell you if you
  miss one.
- Wire SavedReportList and pass onSave into ReportBuilder.

NOTE a decision already made and encoded in the seed: read_only holds reports.view but
NOT reports.manage, because it has no platform.write, so withRoleTx runs it read-only
and the DB would refuse the INSERT. Do not "fix" that by granting manage — a Save
button that always errors is worse. Make sure the UI hides save when onSave is absent.

Verify: pnpm --filter @platform/reporting test, leads-service test, pnpm typecheck,
pnpm depcruise, then apply the DDL (db_scripts/db_deploy.ps1 or targeted psql) against
the running msq-db-server container and prove RLS by hand: as three different actors,
confirm a private report is invisible to another user in the same org, and that a
product login cannot see another product's rows.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 5 — LMS dataset breadth (the real test of the abstraction)

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, especially Phase 1's "Finding 4" and the
DB-validation harness at the end of that section.

Implement Phase 5: add two more LMS datasets.
  lms.rep_performance  over lms.vw_rep_performance
  lms.campaigns        over marketing.vw_tenant_campaign_summary

THIS PHASE IS THE TEST OF THE CONFIG-DRIVEN CLAIM. It should be a change to
msq-lms/services/leads-service/src/api/v1/reports/datasets/ and NOTHING ELSE.
If you find yourself editing @platform/reporting, the engine leaked an assumption:
STOP, report exactly what forced the change, and fix the abstraction rather than
special-casing the dataset. Say so explicitly in your final summary either way —
"registry-only, no engine changes" is the result worth reporting.

Known prerequisite: marketing.vw_tenant_campaign_summary is NOT granted to lms_svc.
The grants in db_scripts/04_roles_and_grants.sql are enumerated per login, never
wildcarded, so add an explicit GRANT SELECT. Today that view is only reached via the
tenant_admin pool in analytics.repository.ts.

Follow the authoring rules at the top of @platform/reporting/src/sql/dataset.ts.
In particular: declare per-measure `aggs` honestly (no SUM over a surrogate key or a
status id), set requiresDateRange on anything that grows without bound, and prefer a
denormalised label column already in the view over adding a join.

MANDATORY verification, per dataset — a mistyped column in a `sql` fragment is valid
TypeScript and passes every unit test:
1. pnpm --filter @platform/reporting build      # dist is what the service consumes
2. Write a throwaway emit-sql.ts in the leads-service root (outside src/, so tsc
   ignores it) that loops EVERY dimension and measure, calls buildReportQuery, and
   prints `PREPARE p<i> AS <sql>; DEALLOCATE p<i>;`
3. npx tsx emit-sql.ts > prepared.sql
4. From PowerShell (NOT Git Bash — it mangles /tmp paths and the run looks clean):
   docker cp prepared.sql msq-db-server:/tmp/
   docker exec msq-db-server psql -U postgres -d platforms -f /tmp/prepared.sql
5. Every statement must PREPARE with zero errors. Delete the throwaway script.

Also consider the parked follow-up: lms.vw_dashboard_leads exposes ls.name/ls.label
but not ls.sort_order, so stages sort alphabetically instead of in pipeline order.
Fixing it means appending `ls.sort_order AS stage_sort` to that view and adding
sortExpr to the stage dimension. Appending a column to a shared view affects any
SELECT * consumer — check for those first and say what you found before doing it.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 6 — HRMS onboards

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then Phase 1's implementation in
msq-lms/services/leads-service/src/api/v1/reports/ — you are mirroring it for HR.

Implement Phase 6: reporting for HRMS. This is the second product on the engine, so it
is also the honest test of whether Phase 0's abstraction holds. Any change required
inside @platform/reporting here is a design bug from Phase 0 — fix the engine, do not
special-case HR, and report it.

Datasets over the existing HR views:
  hr.attendance_monthly  over hr.vw_attendance_monthly_summary   (attendance by type over months)
  hr.attendance_today    over hr.vw_org_attendance_today
  hr.leave_balances      over hr.vw_leave_balances               (leave by type x status)
The user's original ask named exactly these: attendance by attendance type, and leave
by leave type and status. Make sure those two reports are buildable end to end.

KNOWN PREREQUISITE — hr_svc lacks GRANT SELECT ON iam.vw_user_team_members. lms_svc has
it (db_scripts/04_roles_and_grants.sql:597). Without it, any HR dataset serving a
'team'-scoped actor fails at the database. Add the grant. Then check the same for every
relation your datasets name.

Capabilities: seed hr.reports + hr.reports.view/.manage in
db_scripts/07_seed_lookup_data.sql, hand-sync msq-core/packages/rbac/src/capabilities.ts
(update the section count comments), and rebuild @platform/rbac so consumers see the
keys. Mirror the Phase 1 decisions: grant view where the equivalent HR reporting
audience already sits, and add hr.reports to the deny lists wherever hr.attendance.admin
is denied — nav grants cascade, so a new page lights up for everyone otherwise. There is
a seed self-check that fails the deploy if you grant a node whose ancestor is not granted.

Scope operations: reuse the existing HR ladders (hr.attendance.view / hr.leave.view with
their .own/.team/.org scopes) as each dataset's scopeOperation, so a report shows exactly
the rows that person sees in the HR screens.

Service + gateway: mirror leads-service's reports/ 5-file resource in
msq-hrms/services/hr-service, mount under /reports/* so the gateway path is /hr/reports/*
(already covered by product-map.ts and NOT in HR_UNGATED_PREFIXES — verify). hr-service
already has vitest; extend its existing gateway-route-coverage test rather than adding a
second one.

Verify: hr-service tests, pnpm typecheck, pnpm depcruise, and the PREPARE-against-live-DB
harness described in Phase 5 for every HR dataset (build @platform/reporting first;
PowerShell not Git Bash). Then build both target reports in hr-web and screenshot them.

Note: hr-service's gateway-route-coverage test has TWO PRE-EXISTING failures (missing
PATCH /hr/attendance/regularizations/:id and POST .../:id/cancel gateway routes) that
are not caused by this work. Confirm against a clean tree, and do not fix them silently.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 7 — subscription schema + scheduler (no UI)

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then the "Subscriptions & scheduled email
delivery" section of the approved plan at
C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md. Read it fully
before writing code — the topology matters more than the code here.

Implement Phase 7: scheduled email delivery of saved reports. NO UI this phase.
Ship it dark behind REPORTS_SCHEDULER_ENABLED=false.

Context you must know: there is NO scheduler anywhere in this repo — no cron library,
no queue, no Redis, no pg_cron, no GitHub Actions. communication-service is a stateless
nodemailer/SMTP relay with NO attachment support and NO send-audit table. Nothing here
can be assumed to exist.

Tables in the `report` schema (base db_scripts files, same placement rules as Phase 4):
- report.report_schedules — definition_id FK ON DELETE CASCADE, frequency
  ('daily'|'weekly'|'monthly'), day_of_week (0-6), day_of_month (1-28, capped at 28 so
  "the 31st" cannot silently skip months), hour, minute, timezone, is_active,
  last_run_at, next_run_at, consecutive_failures + standard audit/soft-delete columns.
  CHECK that the day column matching `frequency` is non-NULL and the others NULL.
  Index on (next_run_at) WHERE is_active AND NOT is_deleted — the claim query's only index.
- report.report_schedule_recipients — schedule_id, user_id FK to iam.users, added_by.
  UNIQUE (schedule_id, user_id). The FK to iam.users IS the "no free-text addresses"
  rule, enforced in the schema where it cannot be bypassed; it mirrors the recipient
  allowlist api-gateway/src/lib/public-comms.ts already enforces fail-closed.
- report.report_deliveries — schedule_id, recipient_user_id, run_at, status
  ('pending'|'sent'|'failed'|'skipped_empty'), row_count, attempt, elapsed_ms, error.
  This is the send-audit trail the platform currently lacks entirely: today a delivered
  email leaves no DB row anywhere. Prune >90 days in the same loop.

Cadence is DISCRETE COLUMNS, not a cron string: no cron-parser dependency, it maps 1:1
onto the UI controls, and it cannot express something the UI can't render.
computeNextRun() goes in @platform/reporting/src/schedule/next-run.ts — pure, no date
library, Intl + the org timezone.

Dispatcher lives in msq-core/services/admin-service as a boot-time loop behind
REPORTS_SCHEDULER_ENABLED (default false). It already has @platform/db and withServiceTx,
is platform-scoped, and needs no new container/port/healthcheck. communication-service is
deliberately stateless with NO @platform/db dependency — do not put a DB poller there.
Claim due rows with FOR UPDATE SKIP LOCKED, and take pg_try_advisory_lock so one replica
wins; both, not either.

*** THE SHARPEST RISK IN THE WHOLE PLAN — RENDER PER RECIPIENT, NOT PER SCHEDULE. ***
Two subscribers to one report can resolve to different capability scopes (own vs team vs
org). A single render emails the wider result to the narrower-scoped recipient — outside
the app, unauditable, irretrievable. The dispatcher loops recipients and calls the owning
product service, which runs withRoleTx as THAT recipient. Memoisation within a run is
allowed ONLY on the full (role, org_id, resolved scope) tuple. There is already a test in
leads-service asserting the three scopes produce different SQL; add the delivery-level
equivalent asserting different recipients get different row counts.

Flow: admin-service claims → internal HTTP with X-Internal-Secret to
POST /api/v1/internal/reports/run-scheduled on leads-service (requireInternalSecret,
NOT gateway-exposed — teach the drift test to exempt /internal/*) → that service runs the
query and renders → POST to communication-service /api/v1/communications/public-send →
log report_deliveries → next_run_at = computeNextRun().

Email body: inline-styled HTML table (email clients ignore <style>), capped at 100 rows,
with a deep link to the live report. EVERY CELL HTML-ESCAPED — dimension values are user
data from the underlying tables. Lives in @platform/reporting/src/email/render.ts as a
pure ReportResult -> { subject, html }. Do NOT use comms.message_templates: its email side
is schema-only with no interpolation engine.

Empty result => status 'skipped_empty', logged, NOT sent.
Failures: retry with backoff on the delivery row, max 3 per run; at 5 consecutive
schedule failures auto-deactivate and notify the owner once — an SMTP credential rotation
must not retry forever. Consider a per-org daily send cap.

computeNextRun tests, in detail: all three frequencies; every weekday; day_of_month 1..28;
the hour that does not exist on a DST spring-forward AND the hour that happens twice on
fall-back; month boundaries; and a schedule whose next_run_at is already in the past —
it must fire ONCE on resume, not once per missed period (max(next_run_at, now()) before
advancing). Claim/complete: two concurrent transactions on the same due row must yield
exactly one claim.

Manual delivery proof: point SMTP at a local catcher (SMTP_HOST=localhost, MailHog or
Mailpit on 1025 — nodemailer needs no code change), insert a schedule with
next_run_at = now(), start admin-service with the flag on, and confirm the email arrives,
one report_deliveries row per recipient, next_run_at advanced exactly one period, and
TWO RECIPIENTS WITH DIFFERENT SCOPES RECEIVED DIFFERENT ROW COUNTS. That last check is
the security assertion for this half of the feature.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 8 — subscription UI + self-service

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then Phase 7's implementation.

Implement Phase 8: let users subscribe themselves, and let report owners add other
in-org recipients.

Routes in leads-service (+ gateway proxyTo for each; the drift test will catch a miss):
  GET    /analytics/reports/definitions/:id/schedules      LMS_REPORTS_VIEW
  POST   /analytics/reports/definitions/:id/schedules      LMS_REPORTS_VIEW   (self-subscribe)
  PATCH  /analytics/reports/schedules/:id                  owner or self
  DELETE /analytics/reports/schedules/:id                  owner or self
  POST   /analytics/reports/schedules/:id/recipients       LMS_REPORTS_MANAGE
  DELETE /analytics/reports/schedules/:id/recipients/:uid  LMS_REPORTS_MANAGE
  POST   /analytics/reports/schedules/:id/test-send        owner
  GET    /analytics/reports/schedules/:id/deliveries       owner or self

UI: a SubscribeDialog in ui-kit's ReportBuilder/ (frequency, day, time, recipient picker
via the existing UserPicker from @platform/ui-kit) plus a Subscriptions tab listing
schedules with last/next run and recent delivery status.

test-send is NOT optional — nobody trusts a schedule they cannot fire once by hand. It
must go through the exact same render-and-send path as the scheduler, or it proves nothing.

Recipients are always resolved to iam.users rows; never accept a free-text address. The
schema FK enforces it, but the picker should make it impossible to try.

Show delivery history honestly: a 'skipped_empty' run is not a failure and should not
look like one, and a 'failed' run must show the reason.

Rollout: enable REPORTS_SCHEDULER_ENABLED in staging first and watch report_deliveries
for a week before production. This is the platform's first outbound email that fires with
no human in the loop, over a single SMTP transport with no bounce handling or suppression
list — say so in your summary.

Verify: leads-service tests, pnpm typecheck, pnpm depcruise, then subscribe yourself to a
real report, fire test-send, confirm the email and the delivery row, and let one scheduled
run fire naturally.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 9 — HRMS subscriptions

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then Phases 6, 7 and 8.

Implement Phase 9: subscriptions for HR reports.

This should be small: add POST /api/v1/internal/reports/run-scheduled to
msq-hrms/services/hr-service (requireInternalSecret, not gateway-exposed) and the
/hr/reports/schedules/* routes mirroring LMS. The admin-service dispatcher needs NO
change — it already routes by report_schedules.product.

If the dispatcher does need changing, that is a Phase 7 design bug: report it and fix the
dispatcher's product routing rather than adding an HR branch.

Re-assert the per-recipient rendering guarantee for HR datasets specifically: an
attendance report emailed to a manager and to an employee must contain different rows.
Add that test.

Verify: hr-service tests, pnpm typecheck, pnpm depcruise, plus a real scheduled HR report
delivered to two recipients with different scopes.

Finish by updating docs/REPORTING_STATUS.md.
```

---

## Phase 10 — later (dashboards, attachments, chart images, tasks)

```
Repo: c:\Girdhar\MSquare\repos\msq-platforms

Read docs/REPORTING_STATUS.md first, then the approved plan.

Implement Phase 10 items. These are independent — pick one and say which:

(a) Dashboards. report.report_dashboards + report.report_dashboard_tiles
    (dashboard_id, definition_id, grid x/y/w/h, per-tile filter overrides), same trigger
    and RLS set as report_definitions. Phase 4 deliberately shipped only is_pinned +
    sort_order so this needs no rewrite of the definition table.

(b) XLSX / CSV attachments on scheduled email. Requires NEW attachment support in
    communication-service (src/lib/providers/email.provider.ts + the zod
    sendEmailSchema — SendEmailInput is to/subject/body/html/cc/bcc only today) AND a way
    to get bytes to that stateless relay. @platform/blob-storage's s3 driver THROWS
    ("Unsupported BLOB_STORAGE_DRIVER") — only the local driver is implemented. Decide
    blob-key-passing vs multipart and say why. exceljs is already used in hr-service for
    a synchronous download, so generation is solved; delivery is not.

(c) Chart images in email. Recharts is client-only, so this needs either a headless
    browser (no puppeteer installed) or a separate SVG-to-PNG path. There is no PDF
    library in the repo either. Scope this honestly before starting — it is the most
    expensive item on the list and the inline HTML table already covers the use case.

(d) Tasks datasets over task.vw_tasks_enriched, mirroring Phase 6. Registry-only if the
    abstraction held.

Verify per the standing pattern: unit tests, pnpm typecheck, pnpm depcruise, the
PREPARE-against-live-DB harness for any new dataset, and a real end-to-end run.

Finish by updating docs/REPORTING_STATUS.md.
```
