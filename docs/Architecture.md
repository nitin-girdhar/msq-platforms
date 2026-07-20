# Architecture

## Request flow

```
Browser
  └─→ Per-product Next.js apps (P4.3) — one image each, shared SSO cookie on .app.com:
        auth-web (3000, auth.app.com) · lms-web (3001) · hr-web (3002) · todo-web (3003)
        ├─ Server Components: reads JWT from cookie server-side for SSR
        └─ Client Components: fetch /api/* (rewritten to API Gateway)
              └─→ API Gateway (port 4000)
                    ├─ Public: /auth/login, /auth/logout, /intake/webhook
                    │          /meta/webhook/:integrationId (per-tenant app, HMAC-verified)
                    │          /meta/webhook (shared app across tenants, HMAC-verified)
                    └─ Protected: validates JWT → injects headers → proxies
                          ├─→ identity-service       (4001)  (auth + users + orgs)
                          ├─→ leads-service          (4002)  (leads + assignments + analytics + activities)
                          ├─→ meta-conversion-api    (4003)
                          ├─→ admin-service          (4006)  (super_admin-only CRUD for system lookup tables)
                          ├─→ hr-service             (4007)  (leave + attendance + shifts + face verification)
                          └─→ tasks-service          (4008)

                          hr-service ──(internal network only; NEVER via gateway)──┐
                                                                                   ▼
                          ┌──────────────────────── CompreFace (Exadel) — INTERNAL ────────────────────────┐
                          │ compreface-ui(nginx, admin UI ops-only) → compreface-api ↔ compreface-core (ML) │
                          │ compreface-admin        ── all backed by compreface-postgres-db (its OWN DB,     │
                          │                            NOT the app cluster)                                  │
                          └────────────────────────────────────────────────────────────────────────────────┘

lookup-admin (port 3001) ─→ API Gateway (port 4000) ─→ admin-service (4006)
  (super_admin-only web UI for managing lookup tables)

Meta (Facebook) ─→ API Gateway /meta/webhook/:integrationId ─→ meta-conversion-api  (per-tenant app)
Meta (Facebook) ─→ API Gateway /meta/webhook                ─→ meta-conversion-api  (shared app, multi-tenant)
```

## API endpoints (via Gateway — port 4000)

### Public (no JWT)
| Method | Path | Service |
|---|---|---|
| GET | `/health` | gateway |
| POST | `/auth/login` | identity |
| POST | `/auth/logout` | identity |
| GET | `/auth/me` | identity |
| GET | `/auth/my-orgs` (session cookie verified by identity) | identity |
| POST | `/auth/switch-org` (session cookie verified by identity, login rate limit) | identity |
| POST | `/intake/webhook` (x-internal-secret) | leads |
| GET/POST | `/meta/webhook/:integrationId` | meta-conversion-api |
| GET/POST | `/meta/webhook` (shared app across tenants) | meta-conversion-api |

### Protected (JWT required)
| Method | Path | Service |
|---|---|---|
| POST | `/auth/change-password` | identity |
| GET/POST | `/leads` | leads |
| GET/PATCH/DELETE | `/leads/:id` | leads |
| POST | `/leads/:id/transfer` | leads |
| GET | `/leads/:id/timeline` | leads |
| GET | `/leads/:id/form-data` | leads |
| GET/POST | `/leads/:id/interactions` | leads |
| GET | `/leads/:id/assignment-history` | leads |
| GET | `/leads/:id/assignments` | leads |
| GET/POST | `/leads/:id/follow-ups` | leads |
| PATCH/DELETE | `/leads/:id/follow-ups/:followUpId` | leads |
| GET | `/follow-ups` | leads |
| GET/POST | `/campaigns` | leads |
| GET/PATCH/DELETE | `/campaigns/:id` | leads |
| GET | `/campaigns/platforms`, `/campaigns/statuses` | leads |
| GET | `/lookups`, `/lookups/cities`, `/lookups/lead-stages`, `/lookups/lead-stage-outcomes` | leads |
| GET | `/locations` | leads |
| GET/POST | `/users` | identity |
| GET/PATCH/DELETE | `/users/:id` | identity |
| GET | `/users/assignable`, `/users/team`, `/users/org-chart` | identity |
| POST | `/users/:id/reset-password` | identity |
| GET | `/users/:id/org-mappings` | identity |
| POST | `/users/:id/org-mappings` | identity |
| DELETE | `/users/:id/org-mappings/:orgId` | identity |
| GET | `/orgs`, `/orgs/all`, `/lead-sources` | identity |
| GET/POST | `/assignments` | leads |
| GET | `/assignments/mine` | leads |
| GET/PATCH/DELETE | `/assignments/:id` | leads |
| GET | `/analytics/dashboard`, `/analytics/dashboard/campaigns` | leads |
| GET | `/analytics/performance`, `/analytics/pipeline` | leads |
| GET | `/activities` | leads |
| POST | `/meta/crm-event` | meta-conversion-api |
| POST | `/meta/capi/auto-trigger` | meta-conversion-api |
| GET/POST/PATCH | `/meta/integration` | meta-conversion-api |
| GET/POST | `/lookups/:slug` (super_admin only) | admin-service (shared iam/entity: org-types, tenant-domains, tenant-plan-types, user-roles) |
| PATCH | `/lookups/:slug/:id` (super_admin only) | admin-service |
| GET/POST/PATCH | `/lookups/{lms-roles,lead-stage,lead-stage-outcome,interaction-types,follow-up-statuses,lead-sources,marketing-platforms,campaign-statuses}` (super_admin, `?tenant_id=`) | leads-service (N-6) |
| GET/POST/PATCH | `/lookups/{leave-types,employment-types,attendance-statuses,hr-roles}` (super_admin, `?tenant_id=`) | hr-service (N-6) |
| GET/POST/PATCH | `/lookups/{task-statuses,task-priorities,task-roles}` (super_admin, `?tenant_id=`) | tasks-service (N-6) |
| GET/POST | `/lookups/tenants` (super_admin only) | admin-service |
| PATCH | `/lookups/tenants/:id` (super_admin only) | admin-service |
| GET/POST | `/lookups/organizations` (super_admin only, tenant-scoped) | admin-service |
| PATCH | `/lookups/organizations/:id` (super_admin only, tenant-scoped) | admin-service |
| POST | `/hr/attendance/check-in`, `/hr/attendance/check-out` | hr |
| GET/PUT | `/hr/attendance/rules`, `/hr/attendance/rules/admin` (incl. `require_face_match` / `face_match_threshold` / `face_match_action`) | hr |
| POST | `/hr/attendance/face/enroll` (hr_admin/org_admin; `consent` must be true) | hr |
| DELETE | `/hr/attendance/face/enroll/:userId` (hr_admin/org_admin) | hr |
| GET | `/hr/attendance/face/status/:userId`, `/hr/attendance/face/reference/:userId` | hr |
| GET | `/hr/attendance/face-reviews?status=pending` (approver scope) | hr |
| POST | `/hr/attendance/face-reviews/:eventId/clear`, `/hr/attendance/face-reviews/:eventId/reject` | hr |

### Legacy aliases
| Path | Redirects to |
|---|---|
| `/dashboard` | `/analytics/dashboard` |
| `/dashboard/campaigns` | `/analytics/dashboard/campaigns` |
| `/org/performance` | `/analytics/performance` |

## JWT & auth

- **Cookie**: `fc_session` (httpOnly, sameSite=lax, secure in production). When `COOKIE_DOMAIN` is set (`.app.com`), identity-service scopes the cookie to the parent domain so every product subdomain (`lms.`/`hr.`/`todo.`/`auth.`) shares one SSO session — one login at `auth.app.com` authenticates all. Unset in single-host dev → host-only cookie (on `localhost` the cookie is still shared across ports because cookies ignore the port).
- **Algorithm**: HS256 with `JWT_SECRET` by default; RS256 when `JWT_PRIVATE_KEY`/`JWT_KID` are configured (public key served via JWKS). Verifiers — gateway, identity-service, and every web app's Edge middleware + server session helpers (`@platform/ui-kit`) — select the key by the token's `alg` header, so both coexist during migration. In the split topology (P4.3) product apps carry **only** `JWT_PUBLIC_KEY` (verify); identity-service alone holds the signing key. Issuer `fitclass-crm`, audience `fitclass-crm:web`.
- **SSO across product apps (P4.3)**: each product app's `middleware.ts` is `createProductMiddleware()` from `@platform/ui-kit/middleware` — it verifies the shared cookie and, when absent/invalid, redirects to `NEXT_PUBLIC_AUTH_URL/login?callbackUrl=<full-url>`. Because the cookie is already present on `.app.com`, a user switching products via the in-navbar `ProductSwitcher` (cross-origin links to sibling product origins) lands authenticated with no re-login. `auth-web` validates the post-login `callbackUrl` against an origin allowlist (`allowedRedirectOrigins()`) before redirecting — an off-allowlist or attacker-supplied origin falls back to the LMS dashboard (open-redirect guard).
- **Password watermark**: `pwd_iat = floor(password_changed_at / 1000)`. `/auth/me` rejects any session where `payload.pwd_iat < db.passwordChangedAt`.
- **Session revocation**: the `iam.token_blocklist` (via `@platform/db`) backs both single-session logout (per-`jti` row) and bulk revocation (jti-less row scoped to `user_id`). Password change/self, admin reset, deactivation, role change, and soft-delete all insert a jti-less **user-scoped** row so every prior token for that user is rejected at the gateway and `/auth/me` — not only at `/auth/me` via the watermark. Self-change scopes the revocation to the freshly issued token's `iat` so the new session survives. Note: a user-scoped bulk row must set **only** `user_id` (never `org_id`/`tenant_id`), otherwise it would match the org-/tenant-level bulk branches and log out the whole org/tenant.
- **Shrunk token (P1.3)**: the JWT carries identity (`sub`, `email`), the coarse `platform_role` (`super_admin` | `tenant_admin` | `org_admin` | `member`), `org_id`/`tenant_id`, `licensed_products`, and `pwd_iat`/`jti` — but **no** global product role/rank. Product authority is resolved per request from each product's own `<product>.member_roles` table, so a stolen or stale token can never assert a product rank it wasn't granted. `platform_role` drives which Postgres role `withRoleTx` selects (RLS) and platform-level gates; `licensed_products` is a UX convenience (the gateway's DB-backed entitlement gate remains authoritative).
- **Gateway**: validates JWT with `jose` (Edge-compatible). Injects `X-User-Id`, `X-Platform-Role`, `X-Org-Id`, `X-Tenant-Id` headers onto every proxied request (no rank/product-role header). Also injects `X-Internal-Secret` so downstream services can verify the request came through the gateway. A pre-P1.3 token lacking `platform_role` is rejected (401) — a hard cutover forcing one re-login.
- **Services**: never re-verify the JWT — they trust the injected headers from the gateway (reject requests missing `X-Internal-Secret`), and resolve the acting user's rank/role from the DB, never a header: product services (`leads`/`hr`/`tasks`) via `resolveMemberRole('<product>', …)` against `<product>.member_roles`; identity-service via `resolveGlobalRank(…)` on the `iam.user_roles` ladder (user management stays on the global ladder); admin/meta from the coarse `platformRank(platform_role)`. LMS/Tasks membership is required (no grant → 403); HR does not require a grant (every employee has self-service — a missing grant just means no elevated HR authority). notifications resolves LMS rank for lead-event visibility; communication-service is a stateless relay that does no rank authz (its send-block is enforced at the gateway).
- **Branch switching**: a session is always scoped to exactly one org (the JWT's `org_id` drives `app.current_org_id` / RLS). Users mapped to multiple branches via `iam.user_org_mapping` list them with `GET /auth/my-orgs` and re-mint the session for another branch with `POST /auth/switch-org { org_id }` — no re-authentication. The target org is validated server-side against the caller's active mapping rows (403 otherwise), the new JWT is re-minted for that branch (`org_id` + the branch's `platform_role`; product role/rank is resolved per-service from `<product>.member_roles` for the active org), and the previous token's `jti` is revoked so only one active branch exists per session. `/auth/me` resolves role/org the same org-scoped way, so the web app's role-gated nav follows the active branch. The web app surfaces this as a post-login `/select-branch` page (when >1 mapping) and a navbar `BranchSwitcher` dropdown; both do a full navigation after switching so the server-rendered layout rebuilds from the new cookie. Tenant admins (rank ≥ 90) bypass all of this — their `tenant_admin` RLS policies already span every branch in the tenant.

## Database pools

Three postgres.js pools exist, all with `transform: { column: { from: postgres.toCamel } }`:

| Pool | Connection | RLS | Used for |
|---|---|---|---|
| `appDb()` | `DATABASE_URL` (app_user) | Enabled | Org-scoped reads/writes |
| `tenantDb()` | `DATABASE_URL_TENANT` (tenant_admin) | Enabled (tenant scope) | Cross-org reads within a tenant |
| `serviceDb()` | `DATABASE_URL_SERVICE` (root_service) | BYPASSRLS | System operations |

### Transaction helpers

- **`withRoleTx(ctx, fn)`** — Dispatches based on `ctx.role`: `super_admin` uses serviceDb, `tenant_admin` uses tenantDb, others use appDb with `SET LOCAL ROLE app_user` + GUCs.
- **`withServiceTx(fn)`** — No role switch, BYPASSRLS. Used for auth lookups, seed scripts, activity logging, and webhook ingestion.

## Row Level Security

RLS is enabled on `lms.marketing_leads`, `lms.lead_links`, `iam.users`, `marketing.ad_campaigns`, `lms.lead_interactions`, `lms.lead_follow_ups`, `lms.lead_assignment_log`, `lms.lead_status_log`, `audit.activities`, `ext.meta_org_config`, `ext.meta_leads`, `ext.meta_lead_custom_fields`, `ext.meta_capi_outbound_logs`, `ext.meta_lead_addresses`, `ext.meta_lead_professional`, and `ext.meta_lead_demographics`. Each table has:

- `org_isolation_policy` (TO app_user): restricts rows to `org_id = current_setting('app.current_org_id')::uuid`

Some tables also have:
- `tenant_isolation_policy` (TO tenant_admin): restricts rows to orgs belonging to `current_setting('app.current_tenant_id')::uuid`

`root_service` has `BYPASSRLS` and is unaffected by these policies.

## Assignment model

Assignments are **not** a separate table. The assignment is stored as `lms.marketing_leads.assigned_user_id`. The assignments module (in leads-service) queries and updates `lms.marketing_leads` directly. Assignment ID in API responses = Lead ID.

### Weighted auto-assignment

When a new lead is created without an explicit `assigned_user_id` (Meta sync, manual lead creation), `resolveAutoAssignedUser(tx, orgId)` in `@platform/db` (`packages/db/src/assignment.ts`) picks who receives it. Applies uniformly across every lead-creation path — both `services/meta-conversion-api/.../lead-sync.service.ts` and `services/leads-service/.../leads.repository.ts createLead()` call it.

**Eligibility:** active `iam.user_org_mapping` row for the org, `lead_assignment_weight > 0`, and role rank strictly between `READ_ONLY` and `ADMIN` (org admins and read-only users are never auto-assigned leads).

**Algorithm — deficit-based weighted round-robin:**
1. Count each eligible user's current *open* workload: leads assigned to them in this org where the lead's stage has `is_terminated = false` (no hardcoded stage names — picks up `new`/`contacting`/`on_hold`/`qualified`, and any future non-terminal stage, automatically)
2. `deficit = (weight / 100 * total_open_including_new_lead) - current_open_count`
3. Assign to whichever eligible user has the highest deficit; ties broken randomly

This deterministically converges to each user's target %, self-corrects as leads resolve (convert/reject/transfer), and is not retroactive — changing weights only affects future unassigned leads. If no users in the org have a weight set, `resolveAutoAssignedUser` returns `null` and the lead stays unassigned (today's default behavior, unchanged).

**Managing weights:** `GET/PUT /users/assignment-weights` (identity-service, org-admin rank required for PUT). The PUT endpoint validates every `user_id` is actually eligible and that weights sum to exactly 100 (or all 0, disabling auto-assignment for the org) — both checked at the application layer inside the same transaction as the write, not via a DB constraint.

## Face verification (attendance)

Optional per-org verification of attendance punch selfies against an enrolled
reference photo, using a **self-hosted CompreFace (Exadel)** instance. Governed by
three `hr.attendance_rules` columns: `require_face_match` (off by default),
`face_match_threshold` (default 85), and `face_match_action` (`flag` | `block`).

**Deployment — internal-only.** CompreFace (compreface-ui/api/core/admin) runs on
the compose network with its **own** postgres (`compreface-postgres-db` + a
dedicated volume) — never the app cluster. Nothing is published to the host except,
optionally, the admin UI (ops-only, for the one-time API-key setup). It is a private
dependency of **hr-service only**: hr-service calls `http://compreface-api:8080`
directly; **the api-gateway never proxies to CompreFace** and no other service
touches it. hr-service talks to it through a vendor-neutral `FaceVerificationDriver`
(`services/hr-service/src/lib/face/`) selected by `FACE_DRIVER`, so a cloud driver
can replace CompreFace without changing any call site. CompreFace's 0–1 similarity
is normalized to 0–100 at the driver boundary.

**Enrollment.** `POST /hr/attendance/face/enroll` (hr_admin/org_admin only for now;
self-enrollment is deferred) requires an explicit `consent: true` (DPDP —
`face_consent_at` is stamped; a false/absent consent is a 422). The CompreFace
subject id is the user's UUID; re-enrollment replaces the subject's faces
(delete-then-add). Unenroll (`DELETE …/face/enroll/:userId`) drops the subject and
clears the profile columns. There is no automatic hook from identity-service user
deactivation (that would couple the services) — unenroll-on-exit is an ops task,
documented in `docs/FACE_VERIFICATION.md`.

**Punch integration (check-in AND check-out, after geo/photo validation).** When
`require_face_match` is on and a photo is present, the CompreFace call happens
**outside the DB transaction** — the event is written afterward with the result:

| Situation | `flag` action | `block` action |
|---|---|---|
| Not enrolled | record, `face_match_passed=NULL`, review `pending` | **422 `FACE_NOT_ENROLLED`** |
| score ≥ threshold | record, `passed=true` | record, `passed=true` |
| score < threshold | record, `passed=false`, review `pending`, **notify manager** | **422 `FACE_MISMATCH`** (payload carries score + threshold) |
| CompreFace unavailable | record, `passed=NULL`, review `pending` | record, `passed=NULL`, review `pending` |

**Fail-open rule (non-negotiable):** a verification-dependency outage — timeout, 5xx,
or any driver error — **never rejects a punch**, not even in `block` mode. The event
is always recorded with `face_match_passed=NULL` and a `pending` review, and the
error is logged. An attendance event must never be lost to CompreFace being down.

**Review queue.** `GET /hr/attendance/face-reviews?status=pending` lists flagged
punches for the approver's scope (same `hr.can_approve` authority as
regularizations: manager subtree, hr_admin, org_admin). `…/clear` marks the punch
`cleared` (it stands); `…/reject` marks it `rejected` and **invalidates it for
attendance** — the user's `attendance_days` for that date is recomputed excluding
rejected events (shared `computeDayResolution` in `lib/attendance/day-resolution.ts`,
also used by the nightly job, which likewise excludes `face_review_status='rejected'`).

## Activity logging

Fire-and-forget: every service calls `@platform/audit-log`'s `logActivity()` in-process (writes are `void`'d or errors are swallowed internally). This ensures activity logging never blocks or fails a user-facing request. Reads (`GET /activities`, admin-only) are served by leads-service and scoped by RLS via `withRoleTx` — never bypassed for the read path.

## Meta Conversion API

Bidirectional integration with Meta (Facebook) Lead Ads:

### Inbound flow (Meta → CRM)
1. Meta sends a webhook POST to `/meta/webhook/:integrationId` (per-tenant app) or `/meta/webhook` (shared app, no integrationId) through the gateway
2. Gateway forwards raw bytes (not re-serialized JSON) via `proxyToRaw()` for HMAC integrity
3. Meta-conversion-api resolves Meta app credentials from `ext.meta_tenant_config`: by `integrationId` when present (a specific tenant's app), or the single row with `tenant_id IS NULL` when absent (a shared app covering multiple tenants)
4. HMAC-SHA256 verification using the resolved row's `app_secret`
5. Fetches full lead data from Meta Graph API using the resolved row's `access_token`
6. Always inserts a new `lms.marketing_leads` row (source=facebook, stage=new). If an active lead with the same `(org_id, phone)` already exists, the old row is marked `is_active=false, superseded_by=<new_id>` and a `lms.lead_links` record (`link_type='merge'`) is written for audit. A linked `ext.meta_leads` row is created referencing the new marketing lead.
7. Org (and, for the shared-app path, tenant) is resolved from `ext.meta_page_form_org_map` via `page_id`/`form_id` — `form_id` is authoritative (globally unique across all tenants), `page_id` is a fallback. Unmapped leads are skipped.
8. Field extraction uses the resolved tenant's `field_mappings` (from `ext.meta_tenant_config.field_mappings`, JSONB) merged over the hardcoded `DEFAULT_FIELD_MAPPINGS` — lets a tenant remap Meta form field keys without a redeploy
9. Address/job/demographic fields are written to `ext.meta_lead_addresses`, `ext.meta_lead_professional`, `ext.meta_lead_demographics` (1:1, only when at least one field is present)
10. Any remaining unmapped form fields stored in `ext.meta_lead_custom_fields`

### Outbound flow (CRM → Meta CAPI)
- **Auto-trigger**: When a lead's stage changes, leads-service fires a fire-and-forget HTTP call to meta-conversion-api. The service checks if the new stage is in `ext.meta_tenant_config.capi_trigger_stages` and sends a CAPI event if so. Credentials are resolved by the lead's tenant_id, falling back to the shared-app row if the tenant has no dedicated app.
- **Manual trigger**: `POST /meta/crm-event` (protected, JWT-authenticated) allows users to manually send conversion events.
- PII is SHA256-hashed before transmission. Deterministic `event_id` ensures Meta deduplication.
- Partial unique index on `ext.meta_capi_outbound_logs(marketing_lead_id, event_name) WHERE delivery_status = 'SUCCESS'` prevents duplicate events.

## Permissions

Since P1.3 there is no single global rank. Each product owns its own rank scale
(comparable only within that product), and `@platform/authz` keeps only the coarse
platform tiers. Rank is resolved **from the DB per request** (see JWT & auth above), never a header.

**Platform tiers** (`@platform/authz` `RANKS`; from `platform_role`): `member` 0 · `org_admin` 80 · `tenant_admin` 90 · `super_admin` 100.

**LMS** (`@lms/authz` `LMS_RANKS`, from `lms.member_roles`): read_only 0 · sales_representative 20 · senior_sales_executive 40 · org_manager 60 · org_sr_manager 70 · lms_admin 80.

**HR** (`@hr/authz` `HR_RANKS`, from `hr.member_roles`): hr_viewer 0 · hr_staff 40 · hr_manager 70 · hr_admin 80.

**Tasks** (`@task/authz` `TASK_RANKS`, from `task.member_roles`): task_member 20 · task_lead 40 · task_admin 80.

Cross-org / tenant-wide capabilities (e.g. Leads History "tenant"/"all" scope, moving a user's branch, tenant leave-admin) are **platform** concerns keyed on `platform_role` (`tenant_admin`/`super_admin`), not a product rank — a product rank tops out per-org at its admin tier (80) and cannot express "sees every org in the tenant".

`can_assign_to(org_id, acting_user_id, target_user_id)` is a PostgreSQL function (3-param, SECURITY DEFINER). Managers and senior roles may assign within their subtree via `vw_user_team_members`; admins and tenant_admins may assign within/across their org/tenant.

## Hierarchy decoupling (P2.1/P2.2)

The LMS assignment tree and the HR approval tree are two independent hierarchies, each with its own source of truth:

| Hierarchy | Source of truth | Drives | Never reads |
|---|---|---|---|
| LMS assignment | `iam.users.manager_id` / `iam.vw_user_team_members` | Lead auto-assignment, `can_assign_to`, the "Assigned To" subtree picker | `hr.reporting_lines` |
| HR approval | `hr.reporting_lines` (effective-dated, tenant/org-scoped, RLS) | Leave/attendance approver chains (`resolveApprovers`/`buildApproverChain` in `services/hr-service/.../resolve-approvers.ts`) | `iam.users.manager_id`, `iam.vw_user_team_members` |

`hr.reporting_lines` was seeded once from `iam.users.manager_id` (backfill in `db_scripts/21_init-reporting-lines.sql`); after that, re-orging one tree has no effect on the other. A rep's LMS lead/manager and their HR approval chain can legitimately diverge. `resolveApprovers` falls back to a deterministic `org_admin`/`hr_admin` when a requester has no HR reporting line, rather than inferring anything from the LMS tree. See `services/hr-service/src/lib/leave/__tests__/resolve-approvers.integration.test.ts` for tests proving the independence, and `docs/DB_model.md#hrreporting_lines` for the table shape.

## Product entitlements (D6)

`entity.tenant_modules` licenses which products a tenant can use. Enforcement is centralized at the **api-gateway** — the single choke point: after JWT verify, `productGuard` maps the registered route prefix to a product and returns `403 PRODUCT_NOT_ENABLED` if the tenant lacks it. The table stores fine-grained modules; the gateway maps them to products:

| Product | Route prefixes (gateway) | Requires active module(s) |
|---|---|---|
| `lms` | `/leads*`, `/assignments*`, `/campaigns*`, `/follow-ups*`, `/analytics*`, `/activities*`, `/locations*`, `/dashboard*`, `/org/performance*` | `lms` |
| `hr` | `/hr/*` **except** `/hr/employees*` and `/hr/modules` (ungated) | `leave` OR `attendance` |
| `task` | `/tasks*`, `/task-lists*` | `tasks` |

Everything else (users, orgs, api-clients, lookups, meta, communications, auth, notifications) is ungated. Per-service `require-module` middleware in **leads-service** (`lms`), **hr-service** (`leave`/`attendance`), and **tasks-service** (`tasks`) stays as **defense-in-depth** — a call that bypasses the gateway is still rejected. `@platform/authz.hasProduct()`/`assertProduct()` (async) resolve entitlement via a 60s per-tenant cached read; the DB source is injected at gateway startup (`configureProductSource`) so the package stays free of `@platform/db` and safe to import from the Next.js apps. The lead product's key is `lms` (renamed from legacy `crm`; the `crm`→`lms` schema rename landed in P1.0). Every tenant is backfilled with an active `lms` row, so the rollout is non-breaking.

## Tenant provisioning & default catalogs (P3B)

A brand-new tenant is provisioned with a **private copy** of each licensed product's lookup catalog via `seedTenantDefaults(tenantId)` (`@platform/db`, backed by `entity.seed_tenant_defaults()` in `23_tenant-default-catalogs.sql`). Call it **after** the tenant's `entity.tenant_modules` rows are inserted — only catalogs whose gating module the tenant licenses are seeded. It runs under `withServiceTx` (BYPASSRLS system op; `tenantId` is server-derived at provisioning, never client input) and is idempotent — a catalog already recorded in `entity.tenant_catalog_versions` is never re-seeded, so re-running provisioning never clobbers a tenant's later edits.

Defaults are **versioned and immutable**: `entity.catalog_defaults` holds the rows per `version`, `entity.catalog_versions` points at the `current_version` a new tenant gets. Because seeding copies rows into the tenant's own tables, editing a default (shipped as a new version + `current_version` bump) only affects **future** tenants — existing tenants are never touched retroactively. An explicit opt-in `resetTenantCatalog(tenantId, catalogKey, version?)` restores one catalog to a default version (re-adds deleted defaults, restores default label/flags/sort_order, preserves row ids so FKs stay valid, leaves tenant-custom rows alone). See DB_model.md → "Tenant default catalogs". Wiring these into a self-serve provisioning API and the `lookup-admin` reset UI is Phase 3C.

## Shared packages

All packages live in `packages/` and are consumed via workspace references (`@crm/*`). They compile to ESM via `tsc` (`"module": "NodeNext"`). Services import from them; they never import from each other (no circular deps).

| Package | Purpose |
|---|---|
| `@platform/db` | Connection pools, Drizzle schema, transaction helpers, blocklist |
| `@platform/types` | Shared TypeScript interfaces |
| `@crm/validation` | Zod schemas for request validation |
| `@platform/authz` | Identity/tenancy checks (`hasRole`, `hasMinimumRole`, `hasAnyRole`), org-scope resolution, user-management rank gates, product-grant primitive (`hasProduct`/`assertProduct`), and the coarse platform-tier `RANKS` + `platformRank()` (the shared cross-product ladder was dissolved in P1.3) |
| `@lms/authz` | Sales roles + LMS business rules (`leads`, `assignments`, tenant business rules) + the `LMS_RANKS` scale |
| `@hr/authz` | HR authority helpers (leave/attendance/employee management) |
| `@task/authz` | Task scope gates |
| `@crm/permissions` | **Deprecated compat barrel** — re-exports the four `*/authz` packages so existing imports keep working; being migrated away and then removed |
| `@platform/auth-constants` | AUTH_COOKIE_NAME and other auth constants |
| `@crm/internal-client` | HTTP client for inter-service calls |

## Lookup table administration

`services/admin-service` (port 4006) exposes super_admin-only REST CRUD (GET list, POST create, PATCH update — no hard delete) at `/lookups/{slug}` through the gateway for the 4 remaining **shared** system-wide lookup tables: `entity.org_types`, `entity.tenant_domains`, `entity.tenant_plan_types`, `iam.user_roles`. (Post N-6, every product-schema lookup — including the 7 formerly-here `lms`/`marketing` marketing lookups `lead_stage`, `lead_stage_outcome`, `interaction_types`, `follow_up_statuses`, `lead_sources`, `marketing_platforms`, `campaign_statuses` — moved to its owning product service and became tenant-scoped; see "Tenant-scoped lookup tables" below.)

`services/admin-service` also exposes super_admin-only REST CRUD (GET list, POST create, PATCH update — no hard delete) for `entity.tenants` at `/lookups/tenants[/:id]` and for `entity.organizations` at `/lookups/organizations[/:id]` (tenant-scoped; includes geo address fields — country/state/city).

### Tenant-scoped lookup tables (P3.1 + P3.3 + N-6)

`db_scripts/22_tenant-scope-lookups.sql` (P3.1) converted 8 lookup tables to per-tenant catalogs (`task.task_statuses`, `task.task_priorities`, `hr.leave_types`, `hr.employment_types`, `hr.attendance_statuses`, `lms.roles`, `hr.roles`, `task.roles`), and `db_scripts/26_tenant-scope-lms-lookups.sql` (N-6 Half B) did the same for the 7 remaining `lms`/`marketing` marketing lookups (`lms.lead_stage`, `lms.lead_stage_outcome`, `lms.interaction_types`, `lms.follow_up_statuses`, `lms.lead_sources`, `marketing.marketing_platforms`, `marketing.campaign_statuses`) — repointing every dependent FK (`marketing_leads`, `lead_follow_ups`, `lead_status_log`, `lead_interactions`, `ad_campaigns`, `lead_stage_capi_event_map`) to per-tenant copies. All 15 now carry `tenant_id NOT NULL`, are unique per `(tenant_id, name)`, and have RLS. Runtime RLS is **SELECT-only** for ordinary `app_user`/`tenant_admin` (tenant users never edit their own catalog); super_admin **management** writes go through a separate tenant-pinned admin RLS policy — see below.

**N-6 — who owns the admin CRUD (complete).** Every product-schema lookup/role table's super_admin management CRUD (`/lookups/{slug}`) lives in the **owning product service**, not admin-service — the 8 above plus the 7 LMS marketing lookups all route to **leads/hr/tasks-service** (`task-*` → tasks-service; `leave-types`/`employment-types`/`attendance-statuses`/`hr-roles` → hr-service; `lms-roles` + the 7 marketing lookups → leads-service). A shared service cannot write `lms`/`hr`/`task` after the D8 per-product grants, and routing through `root_service`/BYPASSRLS would defeat both isolation axes — so instead the product service (whose login `lms_svc`/`hr_svc`/`task_svc` is a member of `app_user`) performs the write via `@platform/db withTenantConfigTx`, which pins `app.current_tenant_id` to the super_admin-**selected** tenant (the required `?tenant_id=` query param). `db_scripts/25` (the 8) and `db_scripts/26` (the 7) add a permissive `FOR ALL TO app_user` admin policy on each table keyed on `app.current_tenant_id` plus `INSERT, UPDATE` GRANTs scoped to that product role — so a write is **physically confined to the selected tenant's rows** (cross-tenant contamination is impossible), and normal runtime traffic (which sets `app.current_org_id`, never `app.current_tenant_id`) gets nothing extra. The gateway proxies `/lookups/{slug}` to the product service (ungated at the entitlement layer — super_admin is platform staff, not a product licensee); the product service enforces the super_admin gate via `authenticateSuperAdmin` (platform-role gate, not product membership). The repositories keep an explicit `WHERE tenant_id` as defense-in-depth.

> **Runtime reads** of the now-tenant-scoped LMS lookups are scoped by RLS: reads under `withRoleTx` (the leads UI dropdowns, lead create/transfer) auto-filter to the caller's tenant. The two BYPASSRLS (`withServiceTx`) paths that resolved a stage/source by name — gateway-less **intake** (`'new'` stage, named source) and cross-org **transfer** (`'new'`/`'transferred_out'`) — were made explicitly tenant-scoped via the lead's `org_id → tenant`.
>
> **New-tenant seeding (follow-up):** a tenant created after `26` runs gets zero rows in these 7 tables until seeded, and `marketing_leads.stage_id` is `NOT NULL` — so lead intake for a brand-new tenant needs these 7 wired into the versioned catalog-defaults (`db_scripts/23` / `seedTenantDefaults`), the same two-step pattern P3.1→P3.2 used for the first 8. Tracked in `26`'s KNOWN FOLLOW-UP.

`apps/lookup-admin` (port 3001) is a separate Next.js app providing the super_admin-only web UI for managing these lookup tables, tenants, and organizations (all 15 tenant-scoped tables now via their owning product service; the 4 shared iam/entity lookups + tenants/organizations via admin-service), plus a Users management UI (`app/dashboard/users/`) that calls the pre-existing identity-service Users CRUD, reset-password, and org-mappings endpoints. For the 15 tenant-scoped tables, the table page renders a `TenantSelector` (a `<select>` driven by the URL's `tenant_id` search param) above the grid; no tenant selected means an empty/prompt state instead of a fetch, and "New"/edit actions (and parent-lookup option fetches, e.g. lead-stage for a stage-outcome) pass the selected `tenant_id` through. This selector is advisory only — the real enforcement is the backend's required `tenant_id` query param, the `authenticateSuperAdmin` gate, and the tenant-pinned admin RLS.

## Key database objects

### Views
- `lms.vw_dashboard_leads` — paginated lead listing with all display fields
- `lms.vw_lead_followup_timeline` — follow-up events for lead detail
- `iam.vw_user_team_members` / `iam.vw_user_org_chart` — hierarchy views
- `lms.vw_org_performance_snapshot` — per-org metrics
- `lms.vw_tenant_full_dashboard` — cross-org tenant metrics
- `lms.vw_rep_performance` — per-sales-rep lead counts by stage
- `ext.view_meta_leads_complete` — meta_leads joined to marketing_leads, addresses, professional, and demographics

### Functions
- `iam.can_assign_to(org_id, acting_user_id, target_user_id)` — authority check (3-param, SECURITY DEFINER)
- `public.gen_uuidv7()` — RFC 9562 time-ordered UUID generator
- `iam.fn_user_active_orgs(user_id)` / `iam.fn_org_active_users(org_id)` — membership lookups

### Meta-specific tables (`ext` schema)
- `ext.meta_org_config` — per-org Meta credentials, pixel ID, CAPI trigger stages, `field_mappings` (JSONB, runtime-reloadable form field key overrides)
- `ext.meta_leads` — raw Meta lead data (BIGINT meta_lead_id) linked to lms.marketing_leads via FK
- `ext.meta_lead_custom_fields` — unmapped form fields (1:many)
- `ext.meta_lead_addresses` — address fields from Meta lead forms (1:1)
- `ext.meta_lead_professional` — job/company fields from Meta lead forms (1:1)
- `ext.meta_lead_demographics` — demographic fields from Meta lead forms (1:1)
- `ext.meta_capi_outbound_logs` — CAPI event audit trail with idempotency index
