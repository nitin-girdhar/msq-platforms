# Phase 5 — Repo Extraction Plan (P5.1)

> **Status:** Plan (design output only — do not execute until the "Clean first" flags are cleared).
> **Companion to:** `Platform_Architecture_Decisions.md` (D1, D4, D5, D8) and `Platform_Refactor_Prompts.md` (P5.1 → P5.3).
> **Scope of this doc:** the exact `git filter-repo` keep-sets per target repo, the parent `pnpm-workspace.yaml`, the extraction order, the `db_scripts/` carve, the Drizzle table-type split, and the residual cross-boundary imports that must be cleaned **before** any filter-repo runs.
> **Execution belongs to P5.3.** This is the map, not the move.

---

## 0. Ownership partition (source of truth for every path set)

| Unit | shared-repo | lms-repo | hrms-repo | todo-repo |
|---|---|---|---|---|
| **Services** | `identity-service`, `api-gateway`, `admin-service`², `communication-service` | `leads-service`, `meta-conversion-api`, `notifications-service`¹ | `hr-service` | `tasks-service` |
| **Apps** | `lookup-admin`, `auth-web` | `lms-web` | `hr-web` | `todo-web` |
| **Packages** | `db`, `types`, `platform-authz`, `ui`, `service-auth`, `auth-constants`, `audit-log`, `platform-validation` | `lms-authz`, `lms-web`, `lms-validation` | `hr-authz`, `hr-web`, `hr-validation` | `task-authz`, `task-web`, `task-validation` |
| **DB schemas** | `iam`, `entity`, `geo`, `audit` | `lms`, `marketing`, `ext` | `hr` | `task` |

¹ `notifications-service` is **100% LMS today** (SSE follow-up hub; zero HR/Task refs), so it belongs in **lms-repo**, not shared-repo — this resolves flag N-2 without any decoupling surgery. Extract the generic SSE hub into `@platform/service-kit` only if/when a second product needs realtime (YAGNI until then).

² `admin-service` writes into `lms`/`hr`/`task` lookup schemas (flag N-6). After D8 per-product grants the shared role can't reach those schemas; the aligned fix is P3.3 (tenant-context `lookup-admin` → product lookup APIs), **not** routing through `root_service`/BYPASSRLS (that would defeat both isolation axes). **Status:** N-6 DONE (Half A `db_scripts/25` + Half B `db_scripts/26`) — all 15 product-schema lookup/role tables are tenant-scoped and their admin CRUD moved to the owning product service (writes via `withTenantConfigTx` under tenant RLS, no `root_service`). admin-service now owns only the 4 shared iam/entity lookups (+ tenants/organizations), so it no longer writes `lms`/`hr`/`task` and is cleanly extractable on this axis. New-tenant catalog seeding for the 7 LMS lookups is a tracked follow-up (see §7 N-6). See §7 N-6.

**Package name residue (flag, non-blocking):** platform packages `db`, `types`, `service-auth`, `auth-constants`, `audit-log`, `validation` still ship as `@crm/*` (only `ui`→`@platform/ui-kit` and `permissions`→`@platform/authz` were renamed). D5's Stage-2 git-tag deps assume `@platform/*`. Rename these in shared-repo as part of extraction (or immediately after) so product `package.json` deps point at `@platform/*`.

---

## 1. Extraction order

**shared-repo first, then the three products in any order** (they only depend on `@platform/*`, never on each other):

1. **shared-repo** — the platform core. Everything else depends on `@platform/*`, so it must exist first (git-tag/workspace target).
2. **lms-repo** — largest product; also the origin of most residual coupling, so extracting it validates the seam cuts earliest.
3. **hrms-repo**
4. **todo-repo**

Rationale: matches `Platform_Architecture_Decisions.md` "Migration sequence" step 4 (shared-repo first, then lms/hrms/todo). Products FK into `iam`/`entity`/`geo` and import `@platform/*` — nothing flows the other way, so product order is free.

---

## 2. `git filter-repo` keep-sets

**Mechanics.** For each target repo: fresh clone of the monorepo → run `git filter-repo` with the `--path` keep-list below → the repo now contains **only** those paths, with full history for each. `filter-repo` operates on **whole files/dirs** — it cannot split a file's *contents* by schema. The schema-mixed `db_scripts` (§3) are therefore kept **whole in every repo that shares them**, then trimmed in-place by a **follow-up commit per repo** (so each side keeps the file's history). Root scaffolding (`package.json`, `tsconfig.base.json`, `turbo.json`, `Makefile`, docker-compose, `.env.example`, etc.) is likewise kept everywhere and then pruned per repo.

> Run each block from a fresh clone. `--path` with a trailing `/` keeps a directory; without it, an exact file. Order of `--path` flags is irrelevant.

### 2a. shared-repo

```bash
git filter-repo \
  --path services/identity-service/ \
  --path services/api-gateway/ \
  --path services/admin-service/ \
  --path services/communication-service/ \
  --path apps/lookup-admin/ \
  --path apps/auth-web/ \
  --path packages/db/ \
  --path packages/types/ \
  --path packages/platform-authz/ \
  --path packages/ui/ \
  --path packages/service-auth/ \
  --path packages/auth-constants/ \
  --path packages/audit-log/ \
  --path packages/platform-validation/ \
  --path db_scripts/ \
  --path infra/ --path scripts/ --path skills/ --path docs/ --path .claude/ \
  --path api-testing/ \
  --path package.json --path pnpm-workspace.yaml --path pnpm-lock.yaml \
  --path tsconfig.base.json --path turbo.json --path .dependency-cruiser.cjs \
  --path Makefile --path .gitignore --path .dockerignore \
  --path .env.example --path docker-compose.yml --path docker-compose-linux.yml
```
Then (follow-up commits): trim `db_scripts/` to the shared carve (§3); rewrite `pnpm-workspace.yaml`/`package.json`/`turbo.json`/`docker-compose*`/`.env.example` to the shared subset; rename `@crm/*` platform packages → `@platform/*`; drop `db_scripts/{03,04,06*,11,12,13,14}` (pure product).

### 2b. lms-repo

```bash
git filter-repo \
  --path services/leads-service/ \
  --path services/meta-conversion-api/ \
  --path services/notifications-service/ \
  --path apps/lms-web/ \
  --path packages/lms-authz/ \
  --path packages/lms-validation/ \
  --path packages/lms-web/ \
  --path meta-sync-scripts/ \
  --path db_scripts/ \
  --path api-testing/ \
  --path package.json --path pnpm-workspace.yaml --path pnpm-lock.yaml \
  --path tsconfig.base.json --path turbo.json \
  --path Makefile --path .gitignore --path .dockerignore \
  --path .env.example --path docker-compose.yml --path docker-compose-linux.yml
```
Then: keep only the LMS carve of `db_scripts` (`01`+`01-lookup`+`03`+`04`+`06*` LMS parts, LMS slices of `16..23`); add a new `packages/db-schema` (or `@lms/db`) holding the `lms`/`marketing`/`ext` Drizzle tables moved out of `@platform/db` (§4); repoint every `from '@platform/db'` product-table import to the local schema package; add `@platform/*` as workspace deps; prune root config to the LMS subset; slim `api-testing/` to LMS collections.

### 2c. hrms-repo

```bash
git filter-repo \
  --path services/hr-service/ \
  --path apps/hr-web/ \
  --path packages/hr-authz/ \
  --path packages/hr-validation/ \
  --path packages/hr-web/ \
  --path db_scripts/ \
  --path api-testing/ \
  --path package.json --path pnpm-workspace.yaml --path pnpm-lock.yaml \
  --path tsconfig.base.json --path turbo.json \
  --path Makefile --path .gitignore --path .dockerignore \
  --path .env.example --path docker-compose.yml --path docker-compose-linux.yml
```
Then: keep only the HR carve (`10` hr parts, `11`, `12`, `13`, hr slices of `17..23`); add local `hr` Drizzle schema package; repoint imports; prune config/tests.

### 2d. todo-repo

```bash
git filter-repo \
  --path services/tasks-service/ \
  --path apps/todo-web/ \
  --path packages/task-authz/ \
  --path packages/task-validation/ \
  --path packages/task-web/ \
  --path db_scripts/ \
  --path api-testing/ \
  --path package.json --path pnpm-workspace.yaml --path pnpm-lock.yaml \
  --path tsconfig.base.json --path turbo.json \
  --path Makefile --path .gitignore --path .dockerignore \
  --path .env.example --path docker-compose.yml --path docker-compose-linux.yml
```
Then: keep only the Task carve (`10` task parts, `14`, task slices of `17..23`); add local `task` Drizzle schema package; repoint imports; prune config/tests.

---

## 3. `db_scripts/` carve plan

DDL is idempotent `*.sql` (the source of truth — D4), so the carve is **per-schema ownership**, with the **shared-first run order** preserved: a product repo's scripts assume `iam`/`entity`/`geo`/`audit` already exist (state this in each product README — a product repo **cannot bootstrap a DB alone**). Numbering restarts at `01_` locally in each repo; cross-repo order is by dependency, not a global number.

Two kinds of script:
- **Single-schema** → moves whole to one repo.
- **Schema-mixed** → kept in each sharing repo by filter-repo, then **trimmed in-place** to that repo's schema(s).

| Script | Touches | Carve |
|---|---|---|
| `01_init-db.sql` | lms 319, iam 218, ext 179, entity 122, audit 59, marketing 55, geo 25 | **SPLIT.** Extensions + `geo`/`iam`/`entity` schema creation + `audit` schema + `audit.audit_log` only + `root_service` role + shared functions → **shared** `01`. `lms`/`marketing`/`ext` schema+tables **and** `audit.activities`/`audit.marketing_leads_history` (relocated to `lms.*`, D-1) + their trigger fn/RLS/grants → **lms** `01`. |
| `01_init-lookup-data.sql` | iam 18, lms 17, ext 16, entity 12, geo 5, marketing 2 | **SPLIT** by schema: iam/entity/geo lookups → **shared**; lms/marketing/ext lookups → **lms**. |
| `02-seed-tenants-orgs-users.sql` | iam 24, entity 9, marketing 7, geo 3, lms 1 | **Mostly shared** (tenants/orgs/users seed). Move the handful of `lms`/`marketing` seed rows → **lms** seed. |
| `03-seed-leads-bulk.sql` | lms 8, geo 3, marketing 2, entity 2, iam 1 | **lms** (demo lead seed; geo/entity/iam refs are FKs only). |
| `04-seed-interactions-followups.sql` | lms 17, audit 2, iam 1, entity 1 | **lms**. |
| `05-cleanup-seed-helpers.sql` | (helpers) | **shared** if it drops shared helper fns; else duplicate the relevant DROPs per repo. Inspect before assigning. |
| `06a/06b/06c-cleanup-demo-data*` | lms-dominant, some entity/iam/ext | **SPLIT.** Demo-data cleanup is per-schema; lms/marketing/ext deletes → **lms**, iam/entity deletes → **shared**. (These are demo-only — consider dropping from all repos.) |
| `10_init-hr-task-schemas.sql` | hr 113, entity 32, iam 4, audit 3 | **SPLIT 3 ways:** `entity.tenant_modules` + entity bits → **shared**; `hr` schema+tables → **hrms**; `task` schema creation → **todo**. |
| `11_init-leave-management.sql` | hr 213 (+entity/iam/audit FKs) | **hrms**. |
| `12_leave_ledger_idempotency.sql` | hr 2 | **hrms**. |
| `13_init-attendance.sql` | hr 163 | **hrms**. |
| `14_init-tasks.sql` | task 133 | **todo**. |
| `15_tenant-modules-lms-rename.sql` | entity 18, ext 1 | **shared** (`entity.tenant_modules`). |
| `16_rename_crm_schema_and_service_role.sql` | lms 23, iam 8 | **SPLIT.** `ALTER ROLE crm_service→root_service` → **shared**; `ALTER SCHEMA crm→lms` + trigger-fn bodies → **lms**. (One-time migration — see note below.) |
| `17_init-per-product-roles.sql` | task 33, lms 33, hr 33, iam 17, entity 10 | **SPLIT 3 ways + shared:** each product's `*.member_roles`/`*_roles` → its repo; the `iam`/`entity` grant scaffolding → **shared**. |
| `18_backfill-per-product-roles.sql` | iam 14, entity 7, task 5, lms 4, hr 4 | **SPLIT** by target schema; the iam read-side → **shared**. Backfill is one-time. |
| `19_init-per-product-db-grants.sql` | hr 29, lms 21, task 11, iam 8 | **SPLIT:** `lms_svc`/`hr_svc`/`task_svc` GRANTs → each product repo; shared read grants on `iam`/`entity`/`geo`/`audit` → **shared**. |
| `20_member-role-resolver-fn.sql` | task 6, lms 6, hr 6, iam 3 | **SPLIT.** The resolver is per-product — one function per repo (each reads its own `member_roles`). |
| `21_init-reporting-lines.sql` | hr 35 | **hrms**. |
| `22_tenant-scope-lookups.sql` | hr 95, task 66, entity 32, lms 21 | **SPLIT by schema:** hr→hrms, task→todo, lms→lms; entity infra → **shared**. |
| `23_tenant-default-catalogs.sql` | entity 86, hr 52, task 36, lms 13 | **SPLIT:** `entity.catalog_*`/`tenant_catalog_versions` infra → **shared**; per-product default catalog rows → each product repo (as `seeds/` fixtures per D7/P3.2). |
| `test.sql` | ext 4, lms 1 | **lms** (or drop). |
| `db_deploy.ps1` | orchestrator | **Clone into every repo** as its local `db_deploy.ps1` (each runs its own carve). Parent workspace adds a top-level orchestrator that runs shared → products. |

**One-time-migration note:** scripts `15–20`, `16`, `18` are *migrations* that rewrote the schema during Phases 0–1. In extracted repos the DDL source of truth should express the **end state** (fresh installs create `lms`/per-product roles directly). Two acceptable options — pick one before P5.3: (a) keep the migration scripts as history and rely on them being idempotent/guarded; or (b) fold them into the `01`/`10`/`11..14` fresh-install scripts and archive `15–20` under `db_scripts/_migrations/`. Recommendation: **(b)** for the schema/role creation (cleaner fresh installs), keeping only genuinely idempotent guards.

---

## 4. Drizzle table-type split

`@platform/db` (shared-repo) keeps **only** shared-schema table defs. Each product repo gets a local schema package (`@lms/db-schema`, `@hr/db-schema`, `@task/db-schema` — or fold into the existing product package) holding its own tables, **hand-synced with that repo's SQL**. Cross-schema FKs stay as Drizzle cross-package imports of the shared table def (`.references(() => usersTable.id)` → `REFERENCES iam.users(id)`), which is a legitimate same-database reference (D4).

### 4a. Stays in `@platform/db` (shared)

| Schema | Tables |
|---|---|
| `geo` | `countries`, `states`, `cities` |
| `iam` | `users`, `user-roles`, `user-org-mapping`, `token-blocklist`, **`api-clients`, `api-client-orgs`** (relocated `ext`→`iam`, N-4) |
| `entity` | `tenants`, `organizations`, `org-types`, `tenant-domains`, `tenant-plan-types`, `tenant-modules`, `catalog-defaults`, `catalog-versions`, `tenant-catalog-versions` |
| `audit` | `audit-log` only (generic platform audit trail, FK → `iam.users`). `activities` + `marketing-leads-history` **move to lms-repo** — see flag D-1. |
| (unscoped) | `schema-versions` |

Also drop `pg-schemas.ts` down to `geo/entity/iam/audit` here; each product repo re-declares its own `pgSchema('lms'|'hr'|'task'|'marketing'|'ext')`.

### 4b. Moves to lms-repo

- **`lms`:** `lead-stage`, `lead-stage-outcome`, `interaction-types`, `follow-up-statuses`, `lead-sources`, `lead-links`, `lead-interactions`, `lead-follow-ups`, `lead-assignment-log`, `lead-status-log`, `marketing-leads`, `lms-roles`, `lms-member-roles`
- **`marketing`:** `marketing-platforms`, `ad-campaigns`, `campaign-statuses`
- **`ext`:** `meta-tenant-config`, `meta-page-form-org-map`, `meta-leads`, `meta-lead-addresses`, `meta-lead-demographics`, `meta-lead-professional`, `meta-lead-custom-fields`, `meta-capi-event-types`, `meta-capi-outbound-logs`, `lead-stage-capi-event-map`
- **relocated `audit`→`lms` (D-1):** `activities` (→ `lms.activities`), `marketing-leads-history` (→ `lms.marketing_leads_history`). Change `auditSchema`→`lmsSchema` in both `.table.ts` files.

### 4c. Moves to hrms-repo (`hr`)

`departments`, `designations`, `employee-profiles`, `employment-types`, `hr-roles`, `hr-member-roles`, `hr-settings`, `holiday-calendars`, `holidays`, `leave-types`, `leave-policies`, `leave-requests`, `leave-request-statuses`, `leave-request-approvals`, `leave-request-status-log`, `leave-ledger`, `attendance-days`, `attendance-events`, `attendance-rules`, `attendance-regularizations`, `attendance-statuses`, `shifts`, `shift-assignments`, `reporting-lines`

### 4d. Moves to todo-repo (`task`)

`tasks`, `task-lists`, `task-comments`, `task-statuses`, `task-priorities`, `task-status-log`, `task-roles`, `task-member-roles`

### 4e. Barrel change

`packages/db/src/schema/index.ts` currently `export *`s **all 80 table files**. Post-split it must export only §4a. Each product repo builds its own barrel. Every `from '@platform/db'` / `from '@platform/db/schema'` product-table import in a product service (41 + 8 sites) repoints to the local schema package; shared-table imports keep pointing at `@platform/db`.

**Flag D-1 — RESOLVED: move `activities` + `marketing-leads-history` to lms-repo (relocate `audit`→`lms`).** Both are LMS-domain (`marketing-leads-history` FKs `lms.marketing_leads` and its RLS EXISTS-subqueries it; `activities` is written by leads-service's `activities` module). Because a product repo may migrate only its **own** schema (D4), ownership by lms-repo requires relocating them **out of the shared `audit` schema into `lms`** — otherwise lms-repo would be mutating a shared schema. Migration steps (lms-repo, one-time):
1. `ALTER TABLE audit.activities SET SCHEMA lms;` and `ALTER TABLE audit.marketing_leads_history SET SCHEMA lms;` (guarded by existence checks; fresh installs create them in `lms` directly).
2. Update the SECURITY DEFINER trigger fn body (INSERT target `audit.marketing_leads_history` → `lms.marketing_leads_history`) and the two RLS policies (`history_org_isolation` / `history_tenant_isolation`) to the new schema — they already reference `lms.marketing_leads`, so they become same-schema.
3. Move the GRANT/REVOKE lines (`01_init-db.sql:2114`, `2134`) into the lms carve.
4. Drizzle: `auditSchema`→`lmsSchema` in `activities.table.ts` + `marketing-leads-history.table.ts`, move both files to the lms schema package.

Net effect: the shared `audit` schema is left with only the generic `audit_log`, and the one cross-schema ownership straddle in the carve disappears.

---

## 5. Cross-boundary imports to clean **before** extraction

These are hard shared→product or product→sibling edges. filter-repo will happily cut them and leave broken builds. **Fix in the monorepo first** (10× cheaper — ADR), then extract. None of them is currently caught by `.dependency-cruiser.cjs` (see F-0).

### F-0 — dependency-cruiser blind spots (fix first so the rest get caught)
Current rules only forbid `packages/*-authz` → sibling `*-authz`. They do **not** cover:
- shared **services/apps** → product packages, nor
- product **service/app** → sibling-product package.

Extend `.dependency-cruiser.cjs` with rules scoped to `services/` and `apps/`:
- `services/(identity-service|api-gateway|admin-service|notifications-service|communication-service)` ✗→ `packages/(lms|hr|task)-*`
- `services/leads-service|meta-conversion-api|apps/lms-web` ✗→ `@hr/*` / `@task/*` (and symmetrically for hr/task).

Run it; it will surface N-1, N-2, N-3 below as errors. Fix them, keep the rules — they're the wall that keeps the seams closed post-extraction.

### N-1 — `identity-service` (shared) imports `@lms/authz`
- `services/identity-service/src/api/v1/users/users.controller.ts:7` — `import { LMS_RANKS } from '@lms/authz'`
- `services/identity-service/src/api/v1/users/users.service.ts:8` — `import { canSeeOrgFilter, checkMoveUserBranchAccess } from '@lms/authz'`

Identity is platform-shared and must not know LMS ranks/hierarchy. **DECISION:** identity's user-list returns identity + platform-role-scoped fields only (drop `assigned_leads_count` and LMS-rank org scoping); leads-service owns the "sales users + lead counts" view via its own grant. The move-authorization splits per N-5 — platform role gates the org move, leads-service gates the lead handoff. Net: no `@lms/authz` import remains in identity.

### N-2 — `notifications-service` (shared) is hard-wired to LMS  ⚠ **biggest cut**
- `src/connections/manager.ts:2` — `import { getRulesForTenant, canViewUnassignedLeads } from '@lms/authz'`
- `src/routes/stream.ts:17` — `resolveMemberRole('lms', …)`
- `src/services/followup-checker.ts:46-51` — direct `FROM lms.marketing_leads` JOIN `lms.lead_stage` query + `followup:due`/`followup:missed` emission

**RESOLVED — reclassify, don't decouple.** The sweep confirmed notifications-service has **zero HR/Task references**; it is entirely an LMS follow-up hub today. So the fix is not surgery — it's ownership: **put notifications-service in lms-repo** (see §0/§2b). There it legitimately uses `@lms/authz` + `lms.*`, and no boundary is crossed. Runtime impact of the *current* coupling is low (background `setInterval`, off the request path), but that's irrelevant to the *build/ownership* problem the reclassification removes. If HR/Task later need realtime, extract the generic SSE hub (`connections`, `transport/pg-notify`, `stream` shell) into `@platform/service-kit` at that point — not before.

### N-3 — `apps/lms-web` MyDayWidget imports sibling products
- `apps/lms-web/components/dashboard/MyDayWidget.tsx:6` — `import { tasks as tasksApi, endOfTodayISO } from '@task/web'`
- `apps/lms-web/components/dashboard/MyDayWidget.tsx:7` — `import { leave as leaveApi, canViewLeaveApprovals } from '@hr/web'`

LMS web pulls HR and Task **feature packages** directly — a product→sibling-product edge (violates D1 "never imports another product repo"). **Fix:** the "My Day" cross-product aggregation must go through the gateway API (HTTP to hr-service/tasks-service), gated by `licensed_products`, not a compile-time package import. This is exactly the cross-product read D8 says must go via API/contract-view, never a direct link.

### N-4 — `identity-service` (shared) owns `ext.api_clients` CRUD
- `services/identity-service/src/api/v1/api-clients/api-clients.repository.ts` — full CRUD on `ext.api_clients` / `ext.api_client_orgs` (20+ statements)

`ext` is lms-repo territory (Meta/external-integration schema). A shared service can't own product-schema tables — and after D8 grants, `identity-service`'s role won't be able to read `ext.*`. These rows are **per-tenant hashed API keys** (`key_hash`/`key_prefix`/scopes, `tenant_id → entity.tenants`) for the Public/Partner API (PUBLIC-API-SPEC: 4 capabilities, gateway-translated into an internal session) — a platform/gateway **auth primitive**, in `ext` only for historical reasons. **RESOLVED — option (a):** move the `api_clients`/`api_client_orgs` *tables* out of `ext` into a shared schema (`iam`, next to `token-blocklist`); keep CRUD in identity/gateway. Then identity(shared) → shared schema is clean. Choose (b) — move CRUD to lms-repo — only if the keys will *only ever* feed LMS lead intake.

### N-5 — `identity-service` (shared) reads **and writes** `lms.marketing_leads`  ⚠
- `services/identity-service/src/api/v1/users/users.repository.ts:53` — `LEFT JOIN lms.marketing_leads` (per-user lead counts)
- `services/identity-service/src/api/v1/users/users.repository.ts:365` — `UPDATE lms.marketing_leads` (lead reassignment on user change)

The worst class: a shared service **mutating** product data and joining a product table (violates D8 rules 1 & 2). After extraction `identity-service`'s role loses `lms.*` access entirely. Two operational paths leak today, both in `users.service.ts`: **branch move** (`moveUserBranch`, line 193 — reassigns old-branch leads) and **deactivation** (`reassignUserLeadsInOrg`, line 212), plus the `assigned_leads_count` JOIN in the user list (N-1).

**DECISION:**
- **Identity owns the identity change** — `iam.users.org_id` / `user_org_mapping` / role + token revocation (`reason: branch_changed | user_deactivated`). Its own data.
- **Leads-service owns the lead change** — reassigning the departing user's leads (it holds `lms_svc`; identity's role can't touch `lms.*` post-D8). Identity **invokes** leads-service — no direct `UPDATE lms.marketing_leads`.
- **Org-scoping rule (LMS domain):** leads are `org_id`-scoped and **do not follow** a moved user — they stay in the old branch and are reassigned to an old-branch recipient (today's `reassign_leads_to`). This rule lives in leads-service.
- **Consistency:** the current single-transaction atomicity is lost across services → use a **reassign-then-move synchronous saga** (leads-service reassigns → confirms → identity commits the org move), so no lead is ever assigned to a user no longer in that org.
- **Authorization (with N-1):** *moving a user between orgs* is a **platform/tenant-admin** action (gate by platform role); *who may receive the handed-off leads* is **LMS** authority (enforced by leads-service). So `checkMoveUserBranchAccess` splits across both sides.

### N-6 — `admin-service` (shared) does cross-product lookup/role CRUD
Touches `task.task_statuses`, `task.task_priorities`, `lms.roles`, `hr.roles`, `task.roles`, `hr.leave_types`, `hr.employment_types`, `hr.attendance_statuses`.

`admin-service` is the "shared lookups" service, but D7 already moved these lookups into per-product tenant-scoped tables, and D8 grants mean the shared role can't reach `lms/hr/task.*`. **Fix (aligns with D7/P3.3):** lookup/role management moves to each product service's API; `lookup-admin` acts within a tenant context calling those product APIs, not a shared service editing product schemas. Until then `admin-service` cannot be extracted to shared-repo as-is.

**Note — do *not* "solve" this with `root_service`.** super_admin-only is an *authorization* gate (already enforced: admin-service throws `Forbidden` on `rank < SUPER_ADMIN`), and writes already go through the super_admin branch of `withRoleTx` with `tenant_id` as routing context — i.e. tenant-scoped under RLS, the D7-correct path. Routing these writes through `root_service` (BYPASSRLS) to punch across schemas would re-globalize the lookups and defeat **both** isolation axes (product grant + tenant RLS) — a regression from today's behavior. super_admin authority never requires BYPASSRLS.

### ✅ Clean at the DB level — no cross-product FK (positive finding)
Every FK in `db_scripts` is either **product → shared** (`iam`/`entity`/`geo`/`audit` — allowed, D8 rule 3) or **intra-product** (`lms`↔`marketing`↔`ext` all land in lms-repo; `task`→`task`; `hr`→`hr`; each `*.member_roles`→its own `*.roles`). **No hard FK crosses a product-repo boundary**, so D8 rule 1 holds physically — the schemas are cleanly separable at extraction. The residual coupling is entirely in the **service/app code layer** (N-1…N-6), not the data model.

### ✅ Partially clean at the package level
`@platform/*` packages import no product *package* (`@platform/ui-kit` injects the LMS notification bell via a **slot**, not an `@lms/web` import; `@platform/db` **inlines** rank logic rather than importing `@lms/authz`), and shared apps `auth-web`/`lookup-admin` import no product package. **But** the shared packages still *contain* product SQL/logic and one product web package imports a sibling — see §5b.

## 5b. Package / asset-layer couplings (decided)

The service sweep (N-1…N-6) covered `services/`+`apps/`; this covers the shared **packages** and stray top-level assets. All decided:

| # | Where | Coupling | DECISION |
|---|---|---|---|
| **P-1** | `@platform/db` (shared) | `assignment.ts` (LMS auto-assign), `recipients.ts` (joins `lms.marketing_leads`), `api-clients.ts` (`ext.api_clients`), `member-role.ts` (dispatches `{lms,hr,task}.fn_member_role`) | `assignment.ts` → **lms-repo**; `recipients.ts` → **lms-repo** (its only consumers are the LMS follow-up/notification path, now in lms-repo — verify no shared consumer at move time); `api-clients.ts` → **stays shared**, repoint `ext.api_clients`→`iam.api_clients` (follows N-4); `member-role.ts` → **stays shared** as a thin dispatcher — the schema-function names are data, a soft coupling, and it's the shared "resolve product role" contract used by every service. Document the soft coupling; don't fan it out. |
| **P-2** | `@crm/validation` (shared) | Mixes product validators (`leads`, `leave`, `attendance`, `task`, `assignments`, `hr`) with shared (`auth`, `users`, `api-clients`) | **Split:** product validators → their product repos; shared → `@platform/validation`. Also **add `@platform/validation` to the ADR shared-package list** (D1) — it's currently an undocumented shared package silently mixing product concerns. |
| **P-3** | `@platform/types` (shared) | `database.ts` has ~4 product type refs; otherwise shared (`SessionUser`/JWT/tenancy) | **Keep shared** as `@platform/types`; trim/move the handful of product-specific types to product repos. Low effort. |
| **P-4** | `packages/lms-web` (feature pkg) | `LeadEditModal.tsx` imports `TaskLeadSection` from `@task/web` ("create task from lead") — product→sibling | Same fix family as N-3: **slot** injected by the host app, or gateway-driven — no sibling import. |
| **P-5** | `meta-sync-scripts/` (top-level) | Python Meta sync (campaigns/forms/leads) — pure LMS, unassigned | → **lms-repo** (added to §2b keep-set). |

Positive: `communication-service` has **zero** product-schema refs (stays shared cleanly, modulo the `recipients.ts` helper handled in P-1); `infra/` (Caddyfile) and `scripts/` are generic shared/parent assets.

### Not-a-blocker (expected, repoint at P5.3)
- Product services importing **their own** tables from `@platform/db` (41+8 sites) — expected; repoint to the local schema package after the §4 move.
- `api-gateway` route registry referencing product route prefixes — allowed; it's a proxy/entitlement gate, not a code import.
- `@crm/*` → `@platform/*` package renames — do in shared-repo (see §0).

---

## 6. Parent `pnpm-workspace.yaml`

The parent folder is a thin orchestration wrapper (D5 Stage 1): all four repos cloned side-by-side, one root workspace globbing every repo's package dirs so pnpm symlinks `@platform/*` into each product exactly as in the monorepo.

```
<parent>/
  pnpm-workspace.yaml     # this file
  shared-repo/
  lms-repo/
  hrms-repo/
  todo-repo/
  gym-repo/               # future (P6)
```

```yaml
# <parent>/pnpm-workspace.yaml
packages:
  # shared platform core
  - 'shared-repo/packages/*'
  - 'shared-repo/services/*'
  - 'shared-repo/apps/*'
  # LMS
  - 'lms-repo/packages/*'
  - 'lms-repo/services/*'
  - 'lms-repo/apps/*'
  # HRMS
  - 'hrms-repo/packages/*'
  - 'hrms-repo/services/*'
  - 'hrms-repo/apps/*'
  # To-Do / Tasks
  - 'todo-repo/packages/*'
  - 'todo-repo/services/*'
  - 'todo-repo/apps/*'
  # future products, added on extraction
  # - 'gym-repo/packages/*'
  # - 'gym-repo/services/*'
  # - 'gym-repo/apps/*'
```

Each repo **also keeps its own** `pnpm-workspace.yaml` (globbing only its own `packages/*`, `services/*`, `apps/*`) so it builds standalone with git-tag/registry `@platform/*` deps (D5 Stage 2/3). The parent workspace overrides those with local symlinks for live dev (Stage 1). DB orchestration: parent adds a top-level script that runs `shared-repo/db_scripts` first, then each product's (shared-first, §3).

---

## 7. Pre-flight gate + implementation order (everything decided)

All items are decided; none is left open pending a call. Execute in this order — the detector first, then the code decouplings (cheap while it's one repo), then the mechanical carves, then extract.

**Stage A — detector (do first)**
- [x] **F-0 DONE** — `.dependency-cruiser.cjs` extended to `services/`+`apps/`+`packages/` (shared ✗→ product; product ✗→ sibling; `notifications-service` treated as LMS per N-2). Verified: flags exactly N-1 (×2), N-3 (×2), P-4 (×1) = 5 errors, no spurious hits. Also fixed a latent PR-B hole — authz packages resolve to `dist/`, which the old config *excluded*, so the original rules never fired; `dist` moved to `doNotFollow`. Rules stay `error` (red until Stage B lands) — they are the post-extraction wall.

**Stage B — code decouplings (surfaced by F-0)**
- [x] **N-1 DONE** — identity's `/users` list dropped `assigned_leads_count` (dead field, no consumers) and the `lms.marketing_leads` JOIN; `canSeeOrgFilter`/`checkMoveUserBranchAccess` (pure platform_role checks misplaced in `@lms/authz`) moved to `@platform/authz`; the LMS-rank gate on list/create/update is now an inlined `USER_MGMT_MIN_RANK` constant (same pattern already used for `RANK_READ_ONLY`/`RANK_ADMIN` in this file). No `@lms/authz` import remains in identity-service; removed from its `package.json`. Verified: depcruise 0 violations, identity-service + leads-service + `@lms/web` typecheck green.
- [x] **N-2** RESOLVED — notifications-service → lms-repo (100% LMS; no surgery).
- [x] **N-3 + P-4 DONE** — cross-product web reads now go via the gateway, no sibling imports. `MyDayWidget` uses a local `myDayApi` (reads `/tasks` + `/hr/leave/requests/team`); `LeadEditModal` renders a local `LeadTasksSection` (reads `/tasks`) instead of `@task/web`'s `TaskLeadSection`. Verified: depcruise 5→2, `@lms/web` + `@lms/web-app` typecheck green. React skill updated (sibling exception removed).
- [x] **N-4 DONE** — `iam.api_clients`/`iam.api_client_orgs` (moved from `ext` in `01_init-db.sql`; guarded migration `24_move-api-clients-to-iam.sql` for already-deployed DBs); Drizzle tables repointed to `iamSchema`; identity-service repository/`@platform/db` queries repointed; `lms_svc`'s now-redundant write grant on these tables dropped (its blanket `SELECT ON ALL TABLES IN SCHEMA iam` already covers reads). Identity keeps the CRUD.
- [x] **N-5 DONE** — identity no longer touches `lms.marketing_leads`. New internal endpoint `POST /internal/leads/reassign-org` on leads-service (internal-secret gated); identity's `moveUserBranch`/`reassignUserLeadsInOrg` call it via a synchronous reassign-then-move saga (validate target org → reassign via leads-service → commit the org-move tx). Atomicity is accepted as lost across the two services per the saga design.
- [x] **N-6 DONE (Half A + Half B).** Cross-product lookup/role CRUD → product APIs (D7/P3.3 tenant-context path); **not** `root_service`. All 15 product-schema lookup/role tables' super_admin admin CRUD now lives in the owning product service; admin-service (shared) keeps only the 4 shared iam/entity lookups (+ tenants/organizations) and no longer writes `lms`/`hr`/`task`.
  - **Half A DONE** — the **8 already-tenant-scoped** tables (`lms.roles`; `hr.leave_types/employment_types/attendance_statuses/roles`; `task.task_statuses/task_priorities/roles`). Admin modules moved admin-service → owning product service (leads/hr/tasks); writes via `@platform/db withTenantConfigTx` as the product-scoped login (member of `app_user`) with `app.current_tenant_id` pinned to the super_admin-selected tenant. Tenant-scoped admin write RLS + product-role write GRANTs in `db_scripts/25` make cross-tenant writes physically impossible — **no `root_service`/BYPASSRLS**.
  - **Half B DONE** — tenant-scoped the **7 formerly-global LMS marketing lookups** (`lead_stage`, `lead_stage_outcome`, `interaction_types`, `follow_up_statuses`, `lead_sources`, `marketing_platforms`, `campaign_statuses`). `db_scripts/26_tenant-scope-lms-lookups.sql`: added `tenant_id NOT NULL` + RLS + admin write policy, per-tenant copies, repointed every dependent FK (`marketing_leads`, `lead_follow_ups`, `lead_status_log`, `lead_interactions`, `ad_campaigns`, `ext.lead_stage_capi_event_map`, self-ref `lead_stage_outcome.stage_id`) via explicit old→new maps, and rewrote the follow-up-status default/sync triggers to be tenant-scoped. Moved+converted the 7 admin modules to leads-service; fixed the two BYPASSRLS runtime reads (intake, transferLead) to resolve stages/sources by the lead's tenant (the `withRoleTx` reads auto-scope via RLS). Gateway `/lookups/<slug>` reroutes all 15 to the product service (ungated — super_admin isn't a licensee; product service enforces `authenticateSuperAdmin`). Verified: typecheck + depcruise green.
  - **Follow-up (tracked, not blocking extraction):** new-tenant **seeding** for the 7 LMS lookups isn't wired into the versioned catalog-defaults (`db_scripts/23`/`seedTenantDefaults`) yet — a tenant created after `26` runs gets zero rows until seeded, and `marketing_leads.stage_id` is `NOT NULL`, so brand-new-tenant lead intake needs this. Same two-step precedent as P3.1→P3.2 for the first 8 tables; documented in `26`'s KNOWN FOLLOW-UP. **Not run against a live DB** — `25`/`26` must be applied + smoke-tested (esp. `26`'s FK repoints on core lead data) before production use.
- [x] **P-1 DONE** — `assignment.ts` moved to `services/leads-service/src/lib/assignment.ts` (its only 2 callers are already in leads-service). `recipients.ts` **split**, not moved wholesale — verification at move time found a **shared consumer** (`api-gateway`'s public-comms guard) contradicting the original "lms-repo only" assumption: the `iam.users` check stays in `@platform/db` (`findKnownUserContacts`); the `lms.marketing_leads` check moved to a new leads-service endpoint (`POST /internal/leads/known-contacts`); `api-gateway` now calls both and merges. `api-clients.ts` repointed `ext`→`iam` (see N-4). `member-role.ts` left as-is (already-documented soft coupling, unchanged).
- [x] **P-2 DONE** — split into `@platform/validation` (auth, users, api-clients), `@lms/validation` (leads, assignments), `@hr/validation` (hr, leave, attendance), `@task/validation` (task); old `@crm/validation` deleted, all consumers (identity/leads/hr/tasks-service, `admin-service`'s stale unused dep) repointed. Added to the ADR shared-package list (`Platform_Implementation_Plan.md` package taxonomy).
- [x] **P-3 DONE** — `Assignment`/`Activity` interfaces deleted from `database.ts` (dead exports, zero consumers anywhere); `LeadView`/`LeadFormData`/`LeadFormDataField` moved to `packages/lms-web/src/types/leads.ts` (their only consumers — `lms-web`/`apps/lms-web` — leads-service has its own separate local `LeadView` in `serializers/leads.ts`, untouched). `database.ts` now holds only the shared `DatabaseUser`.

**Stage C — mechanical carves & housekeeping**
- [x] **D-1** RESOLVED — `activities`/`marketing-leads-history` → lms-repo, relocated `audit`→`lms`.
- [x] **P-5** RESOLVED — `meta-sync-scripts/` → lms-repo (in §2b keep-set).
- [ ] Rename `@crm/*` platform packages → `@platform/*` (db, types→split, service-auth, auth-constants, audit-log, validation→split). **Recommendation:** do this last in the monorepo (or as shared-repo's first commit) so product `package.json` deps land on `@platform/*` for D5 Stage-2 git-tag deps.
- [ ] **DB migrations 15–20:** **Recommendation (b)** — fold schema/role/table creation into the fresh-install `01`/`10`/`11–14` scripts; archive the one-time migrations under `db_scripts/_migrations/`. Cleaner fresh installs per repo.
- [ ] Carve `db_scripts/` (§3), `api-testing/` Bruno, `docker-compose*`, `tsconfig`/`turbo`, `.env.example` per repo; each product README states "requires shared-repo DB schemas first — cannot bootstrap alone."
- [ ] Install `git filter-repo`; tag the monorepo `pre-extraction` for rollback.

**Stage D — extract**
- [ ] Run the §2 keep-sets in the §1 order (shared → lms → hrms → todo). This is **P5.3**.

Only when Stages A–C are green does Stage D run.
