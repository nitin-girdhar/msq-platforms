# Platform Implementation Plan (Consolidated)

> **Status:** Accepted — execution roadmap
> **Companion docs:** `docs/Platform_Architecture_Decisions.md` (the *why*, D1–D8), `docs/Phase0_Scope.md` (Phase 0 detail).
> **Goal:** evolve the current monorepo into a multi-product platform (LMS, HRMS, To-Do, future Gym / Sales) where products are independently developed, deployed, and sold, sharing only a platform core.

---

## 1. Product model

| Product | Repo (future) | Schema | Status today |
|---|---|---|---|
| Platform core | `shared-repo` | `iam`, `entity`, `geo`, `audit` | Exists (identity, gateway, notifications, admin/lookups) |
| LMS (Lead Management System) | `lms-repo` | `lms` (renamed from `crm` — P1.0), `marketing`, `ext` | Exists (leads-service, web `/dashboard`) |
| HRMS | `hrms-repo` | `hr` | Built (hr-service: employees, leave, attendance; web `/leave` `/attendance`) |
| To-Do / Tasks | `todo-repo` | `task` | Built (tasks-service; web `/tasks`) |
| Gym membership | `gym-repo` | `gym` | Future — first product built on the clean template |
| Sales tooling | `sales-repo` | `sales` | Future |

The three products' **features largely exist**; this plan is about **re-architecting the boundaries** so they become independent products, not folding new features in.

> **Naming:** the lead product is **LMS** (Lead Management System), not a full CRM. It is `lms` everywhere (schema, repo, `@lms/*` packages, `lms` entitlement key, `lms_svc` role, `(lms)` route group). Distinct from the platform `@crm/*` → `@platform/*` package rename. See the Architecture doc's "Product naming" section.

---

## 2. Locked decisions (summary — see Architecture doc for rationale)

- **D1 Multi-repo** — `shared-repo` + per-product repos, cloned side-by-side under a parent pnpm workspace.
- **D2 Separate UI image per product**, single SSO cookie on a shared parent domain.
- **D3 Per-product roles + per-product hierarchy** — `iam.users` identity-only; JWT = identity + platform role + tenant/org + licensed products.
- **D4 One Postgres cluster, one database, schema-per-product** — NOT a DB per product.
- **D5 Local pnpm workspace** for dev + laptop image builds (`pnpm deploy`); git-tags when builds leave the laptop; registry later.
- **D6 Entitlements at the gateway** (`entity.tenant_products` / today's `tenant_modules`) — the subscription on/off lever.
- **D7 Tenant-scoped config & lookups** — no global rows; per-tenant defaults seeded at provisioning.
- **D8 Product-owned schemas + per-product DB grants** — no cross-product FKs/joins; storage product+tenant scoped.

---

## 3. Target architecture

```
Browser
  ├── lms.app.com   (lms-web image)   ─┐
  ├── hr.app.com    (hr-web image)     ├─→ API Gateway (shared)  ── JWT verify + entitlement gate (D6)
  ├── tasks.app.com (todo-web image)  ─┘        │
  └── auth.app.com  (identity/login, sets .app.com cookie — SSO)
                                               ├─→ identity-service   (shared)  iam/entity
                                               ├─→ leads-service                lms.* (+ marketing/ext)
                                               ├─→ hr-service                   hr.*
                                               ├─→ tasks-service                task.*
                                               └─→ notifications/admin (shared)

Postgres (one cluster, one DB): iam | entity | geo | audit  (shared, shared-repo owns)
                                lms | marketing | ext        (lms-repo owns)
                                hr                            (hrms-repo owns)
                                task                          (todo-repo owns)
Isolation: RLS on app.current_tenant_id (tenant) + per-product DB role GRANTs (product)
```

**Package taxonomy (after Phase 0):**
```
@platform/{authz, db, types, validation, service-auth, service-kit, ui-kit, audit-log}
@lms/{authz, types, validation}      @hr/{authz, types, validation}      @task/{authz, types, validation}
```
Product packages depend on `@platform/*`, never on each other (enforced by dependency-cruiser).

---

## 4. Phased roadmap

Each phase is non-breaking and independently shippable. Order matters where noted.

### Phase 0 — Boundary cleanup (in-monorepo) — *detailed in Phase0_Scope.md*
- **PR-A** split `@crm/permissions` → `@platform/authz` + `@lms/authz` + `@hr/authz` + `@task/authz` (compatibility shim keeps ~81 import sites green).
- **PR-B** dependency-cruiser wall (platform ✗→ product; product ✗→ sibling product).
- **PR-C** entitlements: tenant RLS on `entity.tenant_modules`, centralize enforcement at the gateway (closes the ungated LMS/leads gap), backfill tenants, wire `hasProduct()`.
- **Acceptance:** typecheck/tests green; no cross-product imports; unlicensed product → 403 at gateway.

### Phase 1 — Authorization decoupling *(the linchpin — do before Gym)*
- **1.0 — crm-naming cleanup pass (P1.0).** Two renames done together (same `db_scripts`/env surface): **(a)** schema `crm` → `lms` — `ALTER SCHEMA crm RENAME TO lms` + rewrite ~8 trigger-function bodies + update idempotent init scripts + Drizzle (`crmSchema`→`lmsSchema`) + ~57 raw-SQL refs + Bruno/docs; **(b)** platform BYPASSRLS role `crm_service` → `root_service` — `ALTER ROLE` + `DATABASE_URL_SERVICE` + `APP_ROLE_TO_PG_ROLE` + `db_scripts` literals (~110 refs). `marketing`/`ext` schemas keep their names. Do this **first in Phase 1** so the new product tables below land in the correctly-named schema and the DB-literal files are touched once.
- **1A** Per-product role tables: `lms.member_roles`, `hr.member_roles`, `task.member_roles` (tenant-scoped, D7). Platform keeps only `super_admin`/`tenant_admin`/`org_admin`.
- **1B** `(user, product, role)` grants; migrate existing `hr_admin` + sales roles from the global `iam.user_roles` ladder into their product tables. Backfill.
- **1C** Shrink the JWT: `identity + platform_role + tenant/org + licensed_products`. Remove the single global `role`/`rank`. Each product service resolves its own role from its own table; gateway header injection updated.
- **1D** Per-product DB role GRANTs (D8): `lms_svc`/`hr_svc`/`task_svc` can read/write only their schema + read shared `iam`/`entity`/`geo`. Revoke cross-schema access.
- **Acceptance:** a user can hold different roles per product; `hr_svc` physically cannot read `lms.*`; auth flows unchanged from the user's perspective.
- **Depends on:** Phase 0.

### Phase 2 — Hierarchy decoupling
- **2A** ✅ `hr.reporting_lines` (effective-dated: `user_id, manager_id, effective_from/to`, tenant/org scoped, RLS + no-overlap exclusion). Backfilled from `iam.users.manager_id`. `db_scripts/21_init-reporting-lines.sql`.
- **2B** ✅ Repoint HR approver resolution (`resolve-approvers.ts`) to walk `hr.reporting_lines` (as of the apply date) instead of `iam.users.manager_id`. Pure `buildApproverChain` + unit tests unchanged.
- **2C** _(pending)_ Degrade `iam.users.manager_id` to an optional org default (or retire once no product depends on it); LMS keeps its own assignment hierarchy. Deferred: `manager_id` still feeds the LMS/team `vw_user_team_members` tree, so retirement waits on the LMS assignment-hierarchy carve-out.
- **2.2** ✅ Tests + docs for the hierarchy split: unit/integration tests proving `resolveApprovers` reads only `hr.reporting_lines` and never `iam.vw_user_team_members`/`manager_id` (`resolve-approvers.integration.test.ts`); Architecture.md/DB_model.md + HR-Leave Bruno docs updated.
- **Acceptance:** HR leave/attendance approval chain is independent of LMS sales hierarchy; changing an HR reporting line does not affect lead assignment.
- **Depends on:** Phase 1 (product roles), can parallel Phase 3.

### Phase 3 — Tenant-scoped configuration & seeding (D7)
- **3A** Add `tenant_id NOT NULL` + `tenant_isolation_policy` to every lookup currently global (`task-statuses`, `task-priorities`, HR `leave_types`/`employment_types`/`attendance_statuses`, plus the new per-tenant role tables).
- **3B** ✅ `seedTenantDefaults(tenantId)` provisioning step + versioned default catalogs per product. `db_scripts/23_tenant-default-catalogs.sql`: `entity.catalog_defaults` (immutable versioned rows) + `entity.catalog_versions` (current version + module gating) + `entity.tenant_catalog_versions` (per-tenant seeded/reset record, RLS) + `entity.seed_tenant_defaults()`/`reset_tenant_catalog()` functions. TS wrappers `seedTenantDefaults()`/`resetTenantCatalog()`/`getTenantCatalogVersions()` in `@crm/db`. Seeds a private copy of each licensed product's catalog; editing a default (new version) never touches existing tenants; explicit opt-in reset restores defaults FK-safely. Backfilled existing tenants. Wiring into a provisioning API + `lookup-admin` reset UI is 3C.
- **3C** Make `lookup-admin` tenant-context-aware (act *within* a tenant, never edit global rows).
- **Acceptance:** editing a tenant's lookup never affects another tenant; a new tenant provisions with a full default catalog per licensed product.
- **Depends on:** Phase 0; parallel to Phase 2.

### Phase 4 — Web product split (D2)
- **4A** ✅ Extract `@platform/ui-kit` (design system, session + API-client hooks) from `apps/web`.
- **4B** ✅ Move each product's screens into a product feature package + route group: `(lms)`, `(hr)`, `(todo)`; product switcher shows only licensed products.
- **4C** ✅ **Split into separate Next apps/images** (P4.3). `apps/web` was retired and replaced by four thin Next apps: `apps/auth-web` (`auth.app.com`, port 3000 — login/change-password/select-branch), `apps/lms-web` (`lms.app.com`, 3001), `apps/hr-web` (`hr.app.com`, 3002), `apps/todo-web` (`todo.app.com`, 3003). Shared chrome (navbar, sidebars, product switcher, user/branch menus) moved into `@platform/ui-kit/shell` (product-agnostic — nav items, product origins, and the LMS-only notification bell come in as props/slots). **SSO:** identity-service sets the `fc_session` cookie on `COOKIE_DOMAIN` (`.app.com`) so all subdomains share one session; product apps verify it via `JWT_PUBLIC_KEY` (RS256) only — a reusable `createProductMiddleware()` bounces unauthenticated users to `auth.app.com/login` with the full return URL. auth-web validates its post-login `callbackUrl` against an origin allowlist (open-redirect guard). Local dev: on `localhost` the cookie is shared across ports 3000–3003 (port is ignored), so SSO works with no proxy; an optional Caddy profile (`--profile sso-proxy`, `infra/Caddyfile`) fronts `*.app.localhost` to simulate the real cross-subdomain topology.
- **Acceptance:** ✅ each product UI deploys/shuts down independently (own image); switching products needs no re-login (shared cookie); unlicensed product hidden by the switcher + blocked at the gateway.
- **Depends on:** Phase 0 (feature-package boundaries); best after Phase 1 (licensed_products in JWT).

### Phase 5 — Repo extraction + local Docker delivery (D1, D5)
- **5A** Stand up parent workspace folder; root `pnpm-workspace.yaml` globbing sibling repos.
- **5B** `git filter-repo` per target repo (`shared-repo` first, then `lms-repo`, `hrms-repo`, `todo-repo`); each consumes `@platform/*` via the workspace.
- **5B-db** Split `db_scripts/` by schema ownership and **carve the schema-mixed scripts** (`01`, `10`, lookup/seed) along schema lines; each repo gets its own deploy script; enforce **shared-first run order**. See "Cross-repo database handling" under D4 in the Architecture doc for the ownership table + carve list + ordering rule. Drizzle table types split the same way (shared → `@platform/db`, product → product repo).
- **5C** Per-service/app Dockerfiles using `pnpm --filter <pkg> deploy` for self-contained images; ship via `docker save | gzip` → server → `docker load`.
- **Acceptance:** each repo builds its images on the laptop; server runs them; nothing couples repos at the source level.
- **Depends on:** Phases 0–4 (clean boundaries first — do NOT split repos before this).

### Phase 6 — New product on the template (Gym) — the proof
- Build `gym-repo` end-to-end using the clean template: `gym.*` schema, `gym.member_roles`, own reporting model if needed, own web image, entitlement row — **with zero edits to LMS/HR/Task code**.
- **Acceptance:** a new product ships without touching any existing product = the seams hold.

---

## 5. Dependency graph (what blocks what)

```
Phase 0 ──┬──> Phase 1 ──┬──> Phase 2
          │              └──> Phase 4 (web split)
          └──> Phase 3 (tenant config)   [parallel to 1/2]
Phases 0–4 ──> Phase 5 (repo split) ──> Phase 6 (gym)
```

- **Never** start Phase 5 (repo split) before boundaries are clean (Phases 0–4).
- Phase 1 is the highest-value, highest-risk phase — schedule it first after Phase 0 and before any new product.

---

## 6. Cross-cutting rules (apply in every phase)

- Every new operational table: UUIDv7 PK, `tenant_id` + tenant RLS, standard audit + soft-delete triggers, per-product DB role grant. (D7/D8)
- No hard FK across product schemas; cross-product refs are soft links resolved via API/view. (D8)
- No cross-product joins in operational code; cross-product only in a read-only reporting role. (D8)
- After any API change, update Bruno tests in `/api-testing/`; after any code change, update the relevant `.md` docs. (CLAUDE.md)
- Read the relevant `skills/*/SKILL.md` before writing code in that layer. (CLAUDE.md)

---

## 7. Definition of done (platform-level)

- A user can be, e.g., a junior sales rep in LMS and a department head in HRMS simultaneously, with independent approval chains.
- A tenant can subscribe to any subset of products; turning one off is a single entitlement flip.
- A new product ships as a new repo + schema + image without editing existing products.
- Editing one tenant's configuration never affects another tenant.
- `hr_svc` cannot read `lms.*`, and vice versa, at the database grant level.
