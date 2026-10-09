# Architecture

## Request flow

```
Browser
  └─→ Per-product Next.js apps (P4.3) — one image each, ONE ORIGIN, one path prefix each,
      sharing a host-only SSO cookie (path=/). Each app sets a matching Next `basePath`:
        /  auth-web (3000) · /lms lms-web (3001) · /hrms hr-web (3002) · /todo todo-web (3003)
        /admin admin-web (3004) · /sa lookup-admin (3005)
        ├─ Server Components: reads JWT from cookie server-side for SSR
        └─ Client Components: fetch <basePath>/api/* (rewritten to API Gateway)
              └─→ API Gateway (port 4000)
                    ├─ Public: /auth/login, /auth/logout, /intake/webhook
                    │          /meta/webhook/:integrationId (per-tenant app, HMAC-verified)
                    │          /meta/webhook (shared app across tenants, HMAC-verified)
                    └─ Protected: validates JWT → injects headers → proxies
                          ├─→ identity-service       (4001)  (auth + users + orgs)
                          ├─→ leads-service          (4002)  (leads + assignments + analytics + activities)
                          ├─→ meta-conversion-api    (4003)
                          ├─→ notifications-service  (4004)  (LMS lead-event visibility notifications over SSE; Web Push device registration + follow-up push)
                          ├─→ communication-service  (4005)  (stateless send relay; no rank authz — enforced at gateway; also called service-to-service by identity-service for Team notification emails)
                          ├─→ admin-service          (4006)  (super_admin-only CRUD for system lookup tables)
                          ├─→ hr-service             (4007)  (leave + attendance + shifts + face verification)
                          └─→ tasks-service          (4008)

                          hr-service ──(internal network only; NEVER via gateway)──┐
                                                                                   ▼
                          ┌──────────────────────── CompreFace (Exadel) — INTERNAL ────────────────────────┐
                          │ compreface-ui(nginx, admin UI ops-only) → compreface-api ↔ compreface-core (ML) │
                          │ compreface-admin        ── all backed by compreface-postgres-db (its OWN DB,     │
                          │                            NOT the app cluster)                                  │
                          │ Defined in msq-hrms/docker-compose.yml (nested repo), pulled into the root      │
                          │ compose project by its `include:` block — see "One compose project" below       │
                          └────────────────────────────────────────────────────────────────────────────────┘

admin-web    (port 3004) ─→ API Gateway (port 4000) ─→ identity-service / hr-service / etc.
  (org/tenant-admin console — Team, API tokens, HR leave/attendance admin; capability-gated per screen,
   not a single "admin" capability. Distinct from lookup-admin: this is for tenant/org admins, not super_admin.)

lookup-admin (port 3005) ─→ API Gateway (port 4000) ─→ admin-service (4006) / leads-service / hr-service / tasks-service
  (super_admin-only web UI for managing lookup tables, tenants, organizations, users, capabilities)

Meta (Facebook) ─→ API Gateway /meta/webhook/:integrationId ─→ meta-conversion-api  (per-tenant app)
Meta (Facebook) ─→ API Gateway /meta/webhook                ─→ meta-conversion-api  (shared app, multi-tenant)

caddy (ports 80/443, profile "sso-proxy", root docker-compose.yml, infra/Caddyfile) — fronts ALL
  six web apps on ONE host, dispatching by path prefix (`@lms path /lms /lms/*` + `handle @lms` ->
  lms-web, ... and a final bare `handle` -> auth-web for the root). Uses `handle`, never
  `handle_path`: each app is compiled with a matching `basePath` and expects to receive its own
  prefix. Each prefix is matched via a NAMED matcher listing both the bare path and the wildcard —
  `/lms/*` alone does not match a bare `/lms`, which fell through to auth-web and 404'd, and
  `handle` accepts only one matcher token so the two paths cannot be written inline. The site
  address comes from
  CADDY_SITE_ADDRESS (`http://app.localhost` locally — the explicit scheme suppresses ACME;
  `apps.fitclass.in` in production, where Caddy issues the certificate). A single origin is what
  makes the platform installable as one PWA holding one push subscription.
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
| POST | `/auth/forgot-password` (email only; always 200; 5 per 15 min per IP + 3 per 15 min per user) | identity |
| POST | `/auth/reset-password` (single-use 15-min token, SHA-256 stored; revokes every session; login rate limit) | identity |
| GET | `/public/branding/:publicKey` (login-link display branding; unknown/rotated key → platform default, 60/min per IP) | identity |
| GET | `/public/branding/:publicKey/assets/:slot` (logo/icon bytes, immutable + CSP sandbox, 240/min per IP) | identity |
| POST | `/intake/webhook` (x-internal-secret) | leads |
| GET/POST | `/meta/webhook/:integrationId` | meta-conversion-api |
| GET/POST | `/meta/webhook` (shared app across tenants) | meta-conversion-api |

### Partner API (API key, `/public/v1/*`)

Authenticated by an `iam.api_clients` key (`Authorization: Bearer crmk_…` or `X-Api-Key`), never a JWT. Keys are issued on the admin **API Tokens** screen, where each key gets an explicit set of **scopes**. The checkboxes are rendered from `API_SCOPES` in `@platform/auth-constants`, so adding a scope there is all that is needed for it to appear. Each route requires exactly one scope (`publicApiKeyAuth(scope)` in the gateway).

**Tenant is never a request parameter.** It comes from the verified key (`X-Tenant-Id`), so a key can only ever read its own tenant.

**Branch reach comes from the key:**
- A key bound to one branch sees that branch only.
- A key bound to several branches sees only those.
- A tenant-wide key (`scope_all_orgs`) sees every branch.
- `branch_id` narrows within that reach. A branch outside it is a 400.
- On the list/find/users/branches endpoints, a multi-branch key is fenced to its branches even when no `branch_id` is sent. Before 1.53.0, `/users` and `/branches` returned the whole tenant in that case.

Downstream handlers run under `withServiceTx`, because there is no user context for RLS. They use a mandatory explicit `tenant_id` filter and a whitelisted column list.

| Method | Path | Scope | Service | Filters |
|---|---|---|---|---|
| POST | `/public/v1/leads` | `leads:write` | leads | create a lead |
| GET | `/public/v1/leads` | `leads:list` | leads | `branch_id`, `assigned_to`, `source`, `stage`, `outcome` (csv; source/stage/outcome take a uuid or the catalog `name`), `start_date`, `end_date` (see below), `include_inactive`, `limit` (≤500, default 100), `offset` |
| POST | `/public/v1/leads/find` | `leads:find` | leads | body `{ phones?: [], emails?: [], branch_id?: [], include_inactive? }`, ≤100 values combined |
| GET | `/public/v1/leads/:id` | `leads:read` | leads | — |
| GET | `/public/v1/users` | `users:read` | identity | `branch_id`, `department_id`, `manager_id` (csv uuids) |
| GET | `/public/v1/branches` | `branches:read` | identity | `branch_id`, `country_id`, `state_id`, `city_id` (csv uuids) |
| GET | `/public/v1/locations/{countries,states,cities}` | `locations:read` | identity | geo drill-down |
| POST | `/public/v1/communications/send` | `comms:send` | communication | — |
| GET | `/public/v1/lead-report` | `lead-report:read` | leads | browser page, `?key=` |

- **Date filters:** `start_date` and `end_date` take `YYYY-MM-DD` or an ISO timestamp with offset. A bare date is a calendar day in the lead's branch timezone, and `end_date` includes that whole day.
- **Lead rows** (list/find) return:
  - contact fields and address
  - branch id and name
  - source, stage and outcome (`name` + `label`)
  - assignee (id and name)
  - `next_followup_at`, `is_active`, `created_at`, `updated_at`

  They never include `raw_webhook_data`, `metadata`, `tags`, `outcome_comment` or campaign internals.
- **Superseded leads:** both list and find return only active leads unless `include_inactive` is set.
- **Find matching:**
  - Phones match on the **last 10 digits**, so `+91 98…`, `098…` and `98…` all meet.
  - Emails match on trimmed lowercase.
  - Each row carries `matched_on` (`phone`/`email`).
  - The response also lists the inputs with no match under `not_found`.
- **User rows:** one row per (user, branch membership). `branch_id` is the membership branch and `org_id` the home branch. `department_*` is the department of the role held in that branch (`iam.user_roles.department_id`).
- **Scope split:** `leads:read`, `leads:list` and `leads:find` are deliberately separate. A key issued for one-at-a-time lookups never gains bulk access to the lead book.

### Protected (JWT required)
| Method | Path | Service |
|---|---|---|
| POST | `/auth/change-password` | identity |
| GET | `/me/branding` (session tenant names/terms/menu/assets + theme layers) | identity |
| PUT/DELETE | `/me/preferences/theme` (own appearance; `platform.appearance`; includes the 4-step `font_size`, which survives the theme lock) | identity |
| GET/PUT | `/tenant/branding` (session tenant; `admin.branding.view` / `.manage`; theme fields refused while locked) | identity |
| GET/PUT | `/sa/tenants/:id/branding` (super admin) | identity |
| POST/DELETE | `/sa/tenants/:id/branding/assets/:slot` (super admin; sniffed + SVG-sanitised) | identity |
| POST | `/sa/tenants/:id/branding/rotate-key` (super admin) | identity |
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
| GET | `/follow-ups` (`org_ids`, `campaign_type_ids` — same scope rule as `/leads`) | leads |
| GET/POST | `/campaigns` | leads |
| GET/PATCH/DELETE | `/campaigns/:id` | leads |
| GET | `/campaigns/platforms`, `/campaigns/statuses` | leads |
| GET | `/lookups`, `/lookups/cities`, `/lookups/lead-stages`, `/lookups/lead-stage-outcomes` | leads |
| GET | `/locations` | leads |
| GET/POST | `/users` | identity |
| GET/PATCH/DELETE | `/users/:id` (GET: yourself, or `admin.team.view`) | identity |
| GET | `/users/assignable`, `/users/org-chart` (needs `admin.team.view`) | identity |
| POST | `/users/:id/reset-password` | identity |
| GET | `/users/:id/org-mappings` | identity |
| — | every `/users*` route above takes an optional `?tenant_id=` — honoured for super_admin only (lookup-admin's selected tenant); by-id routes 404 a user outside it | identity |
| POST | `/users/:id/org-mappings` | identity |
| DELETE | `/users/:id/org-mappings/:orgId` | identity |
| GET | `/orgs`, `/orgs/all`, `/lead-sources` | identity |
| GET/POST | `/assignments` | leads |
| GET | `/assignments/mine` | leads |
| POST | `/assignments/bulk` | leads |
| GET/PATCH/DELETE | `/assignments/:id` | leads |
| GET | `/analytics/dashboard`, `/analytics/dashboard/campaigns` | leads |
| GET | `/analytics/performance`, `/analytics/pipeline` | leads |
| GET | `/activities` | leads |
| POST | `/meta/capi/auto-trigger` | meta-conversion-api (internal secret; not routed by the gateway — queues into the outbox) |
| GET/POST/PATCH | `/meta/integration` (super-admin only) | meta-conversion-api |
| GET/POST | `/meta/page-org-map` (super_admin, `?tenant_id=`) | meta-conversion-api |
| PATCH/DELETE | `/meta/page-org-map/:mappingId` (super_admin, `?tenant_id=`) | meta-conversion-api |
| GET | `/meta/pages` (super_admin, `?tenant_id=`) | meta-conversion-api — Graph `/me/accounts`, returns `{page_id, name}` only |
| GET | `/meta/campaigns` (super_admin, `?tenant_id=`, optional `?mapping_status=`) | meta-conversion-api — the three mapping grids, with a per-campaign lead count |
| POST | `/meta/campaigns/sync` (super_admin, `?tenant_id=`) | meta-conversion-api — the "Fetch campaigns" button; walks the tenant's ad accounts |
| PATCH | `/meta/campaigns/:metaCampaignId` (super_admin, `?tenant_id=`, `?dry_run=`) | meta-conversion-api — confirm/correct a type, then fan out the reclassification |
| GET | `/meta/lead-pull/campaigns` (super_admin, `?tenant_id=`, optional `?page_ids=`) | meta-conversion-api — the campaign multiselect; the response says the filter is **post-fetch** |
| POST | `/meta/lead-pull/runs` (super_admin, `?tenant_id=`) | meta-conversion-api — enqueues a pull, **202 + `run_id`**; 409 while one is live |
| GET | `/meta/lead-pull/runs/:runId` (super_admin, `?tenant_id=`) | meta-conversion-api — status, progress, delta summary (polled by the UI) |
| GET | `/meta/lead-pull/runs/:runId/leads` (super_admin, `?tenant_id=`, optional `?verdict=`) | meta-conversion-api — the staged rows behind each summary number |
| POST | `/meta/lead-pull/runs/:runId/apply` (super_admin, `?tenant_id=`) | meta-conversion-api — applies the importable rows through the canonical write path |
| GET/POST | `/lookups/:slug` (super_admin only) | admin-service (shared iam/entity: org-types, tenant-domains, tenant-plan-types, user-roles) |
| PATCH | `/lookups/:slug/:id` (super_admin only) | admin-service |
| GET/POST/PATCH | `/lookups/{lms-roles,lead-stage,lead-stage-outcome,interaction-types,follow-up-statuses,lead-sources,marketing-platforms,campaign-statuses}` (super_admin, `?tenant_id=`) | leads-service (N-6) |
| GET/POST/PATCH | `/lookups/{leave-types,employment-types,attendance-statuses,hr-roles}` (super_admin, `?tenant_id=`) | hr-service (N-6) |
| GET/POST/PATCH | `/lookups/{task-statuses,task-priorities,task-roles}` (super_admin, `?tenant_id=`) | tasks-service (N-6) |
| GET/POST | `/lookups/tenants` (super_admin only) | admin-service |
| PATCH | `/lookups/tenants/:id` (super_admin only) | admin-service |
| GET/POST | `/lookups/organizations` (super_admin only) — GET lists orgs **across all tenants** (each row carries `tenant_id` and `is_active`, **snake_case** like every other response on the platform; callers filter client-side). This is lookup-admin's org source for the navbar Org scope and the departments `org_id` FK; identity-service's `/orgs/all` is NOT usable there, as it omits `tenant_id` and is pinned to the caller's own tenant | admin-service |
| PATCH | `/lookups/organizations/:id` (super_admin only, tenant-scoped) | admin-service |
| GET | `/capabilities` (super_admin only) — the global `iam.capabilities` tree (tool→page→tab→operation→scope) | admin-service |
| GET | `/roles/:id/capabilities?tenant_id=` (super_admin only) — platform defaults + this tenant's overrides for one role | admin-service |
| PUT | `/roles/:id/capabilities` (super_admin only) `{ tenant_id, grants: [{capability_id, is_granted}] }` — upserts tenant override rows in `iam.role_capabilities` | admin-service |
| GET | `/departments?tenant_id=` (super_admin only) — read-only; `iam.departments` is written by hr-service | admin-service |
| POST | `/hr/attendance/check-in`, `/hr/attendance/check-out` | hr |
| GET/PUT | `/hr/attendance/rules` (GET, needs `hr.attendance.view`), `/hr/attendance/rules/admin` (GET needs `hr.attendance.admin.rules.view`, PUT `.update`) (incl. `require_face_match` / `face_match_threshold` / `face_match_action` / `photo_change_cooldown_days` / `image_retention_days`) | hr |
| GET | `/hr/attendance/reports/summary?month=&format=json\|csv\|xlsx` — monthly per-employee counts (incl. `missed_punch_count`); `hr.reports.attendance.view` + a `.org`/`.tenant` scope (since 1.56.0; was `hr.attendance.admin.reports.view` + `hr.attendance.admin`). Current branch only | hr |
| GET | `/hr/attendance/regularizations/:id`, `/hr/leave/requests/:id` — detail views (proxied since 1.52.0; before that they 404'd at the gateway) | hr |
| GET | `/hr/attendance/reports/detail?month=&format=xlsx\|csv` — detailed download: Summary / Daily Detail (employee × day) / Punches (per session) sheets; csv = Daily Detail. Same gate; current branch only (see ATTENDANCE_DAY_CLASSIFICATION.md §7) | hr |
| GET | `/hr/attendance/reports/muster?month=&branch=current\|all&org_id=&format=json\|xlsx` — combined attendance (muster) sheet: one row per employee (profile, department, DOJ, branch), one P/HD/HD-L/A/L/LOP/WO/H cell per day, paid-day totals, blank Final Paid Days. Same gate; `branch=all` needs `hr.reports.attendance.view.tenant`, the branch list is derived server-side from the verified tenant, an `org_id` outside it is 403 (see ATTENDANCE_DAY_CLASSIFICATION.md §8) | hr |
| POST | `/users/me/photo` (self), `/users/:id/photo` (admin) — avatar upload; `consent` must be true | identity |
| GET | `/users/:id/photo` — avatar bytes, ETag + `Cache-Control: private` | identity |
| POST | `/hr/attendance/face/enroll` (self or hr_admin/org_admin; `consent` must be true; sources the avatar) | hr |
| GET | `/hr/attendance/face/me` — self enrollment context (check-in gate + upload modal) | hr |
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

- **Cookie**: name from `authCookieName()` (`@platform/auth-constants`) — `AUTH_COOKIE_NAME` env var, default `fc_session`. A browser cookie is keyed by `(name, domain)`, and **the per-environment name is the isolation mechanism**: `apps.fitclass.in` and `apps-uat.fitclass.in` both sit under `fitclass.in`, so a *same-named* cookie set by one is delivered to the other's host, where the api-gateway verifies the foreign-signed token against its own `JWT_SECRET`, rejects it as `Invalid token`, and 401s every client-side API call while SSR (which forwards the request's own cookie) still succeeds. Distinct names — `fc_session` (prod), `fc_session_uat`, `fc_session_dev` — mean each environment simply never reads the others' cookie. Every container in an environment must carry that environment's name: identity-service, api-gateway, and all six web apps. Attributes: httpOnly, sameSite=lax, `path=/`, secure in production. **`COOKIE_DOMAIN`** is each environment's existing scope: prod is `.fitclass.in` (unchanged — a re-login overwrites the cookie in place, so no session is dropped), UAT `apps-uat.fitclass.in`, dev `app.localhost`. Note a bare host as `COOKIE_DOMAIN` is still a *domain* cookie (browsers store `apps.fitclass.in` as `.apps.fitclass.in` and offer it to sub-hosts); only an unset value is truly host-only. Tightening prod to host-only is a future change that needs a maintenance-window logout, out of scope here. Changing an environment's cookie *name* logs that environment's users out once, by design.
- **Algorithm**: HS256 with `JWT_SECRET` by default; RS256 when `JWT_PRIVATE_KEY`/`JWT_KID` are configured (public key served via JWKS). Verifiers — gateway, identity-service, and every web app's Edge middleware + server session helpers (`@platform/ui-kit`) — select the key by the token's `alg` header, so both coexist during migration. In the split topology (P4.3) product apps carry **only** `JWT_PUBLIC_KEY` (verify); identity-service alone holds the signing key. Issuer `fitclass-crm`, audience `fitclass-crm:web`.
- **SSO across product apps (P4.3)**: each product app's `middleware.ts` is `createProductMiddleware()` from `@platform/ui-kit/middleware` — it verifies the shared cookie and, when absent/invalid, redirects to `<AUTH_URL>/login?callbackUrl=<full-url>`. The `sso.ts` helpers (`authOrigin()`, `productOrigins()`, `adminOrigin()`, `adminWebOrigin()`) resolve **base URLs**, not bare origins: a value may carry a path prefix (`https://apps.app.com/lms`) so all six apps can sit behind one host — one PWA scope, one push subscription. Every URL is therefore built by CONCATENATION (`${base}/login`); `new URL('/login', base)` would discard the prefix. Because the cookie is already present on the auth host, a user switching products via the in-navbar `ProductSwitcher` lands authenticated with no re-login. `auth-web` validates the post-login `callbackUrl` against `allowedRedirectOrigins()`, each entry normalized to its origin, before redirecting; an attacker-supplied host is rejected and the user falls back to the session-derived landing (`sessionDestination()`, or `/no-access`) rather than a hardcoded product. Under one host that check accepts any path on that host — deliberate and correct, since every internal path is then our own app; see the comment on `resolveCallback`.
- **`basePath` and what Next does *not* prefix**: each product app compiles a `basePath` (`/lms`, `/hrms`, `/todo`, `/admin`, `/sa`) into its image — changing a prefix is a rebuild and redeploy, never an env flip. Next applies it automatically to `<Link>`/router navigation, `next/image`, `/_next/*` assets, `rewrites()` **sources**, and middleware **matchers**; it deliberately leaves absolute rewrite destinations alone, which is why `/hrms/api/leave` reaches the gateway as `/leave`. Two consequences are easy to get wrong: (1) `config.matcher` and `protectedPrefixes` are **app-relative** — Next prepends the prefix at build time and `request.nextUrl.pathname` arrives with it already stripped, so spelling it out yourself yields `/hrms/hrms/...`, which matches nothing and silently leaves routes unauthenticated; (2) `fetch()` gets **no** prefixing, so a bare `fetch('/api/…')` under one origin would hit auth-web at the root instead of the calling app. `createApiClient()` resolves its mount through `withBasePath()` (`packages/ui/src/api/base-path.ts`), which reads the value Next compiles in — so all call sites keep passing `'/api'`, and a shared package built into two apps gets the right prefix in each.
- **Password watermark**: `pwd_iat = floor(password_changed_at / 1000)`. `/auth/me` rejects any session where `payload.pwd_iat < db.passwordChangedAt`.
- **Session revocation**: the `iam.token_blocklist` (via `@platform/db`) backs both single-session logout (per-`jti` row) and bulk revocation (jti-less row scoped to `user_id`). Password change/self, admin reset, deactivation, role change, and soft-delete all insert a jti-less **user-scoped** row so every prior token for that user is rejected at the gateway and `/auth/me` — not only at `/auth/me` via the watermark. Self-change scopes the revocation to the freshly issued token's `iat` so the new session survives. Note: a user-scoped bulk row must set **only** `user_id` (never `org_id`/`tenant_id`), otherwise it would match the org-/tenant-level bulk branches and log out the whole org/tenant.
- **Shrunk token (P1.3)**: the JWT carries identity (`sub`, `email`), the coarse `platform_role` (`super_admin` | `tenant_admin` | `org_admin` | `member`), `org_id`/`tenant_id`, `licensed_products`, and `pwd_iat`/`jti` — but **no** global product role/rank. Product authority is resolved per request from each product's own `<product>.member_roles` table, so a stolen or stale token can never assert a product rank it wasn't granted. `platform_role` drives which Postgres role `withRoleTx` selects (RLS) and platform-level gates; `licensed_products` is a UX convenience (the gateway's DB-backed entitlement gate remains authoritative).
- **Gateway**: validates JWT with `jose` (Edge-compatible). Injects `X-User-Id`, `X-Platform-Role`, `X-Org-Id`, `X-Tenant-Id` headers onto every proxied request (no rank/product-role header). Also injects `X-Internal-Secret` so downstream services can verify the request came through the gateway. A pre-P1.3 token lacking `platform_role` is rejected (401) — a hard cutover forcing one re-login.
- **Services**: never re-verify the JWT — they trust the injected headers from the gateway (reject requests missing `X-Internal-Secret`), and resolve the acting user's rank/role from the DB, never a header: product services (`leads`/`hr`/`tasks`) via `resolveMemberRole('<product>', …)` against `<product>.member_roles`; identity-service via `resolveGlobalRank(…)` on the `iam.user_roles` ladder (user management stays on the global ladder); admin/meta from the coarse `platformRank(platform_role)`. LMS/Tasks membership is required (no grant → 403); HR does not require a grant (every employee has self-service — a missing grant just means no elevated HR authority). notifications resolves LMS rank for lead-event visibility; communication-service is a stateless relay that does no rank authz (its send-block is enforced at the gateway).
- **Upstream path guard**: the secret travels on *every* proxied request, so the path the gateway sends upstream must be exactly the path the route handler built. find-my-way decodes `%2F` / `%3F` / `%23` inside a path param, so `..%2Finternal%2F…` used to reach a handler as `../internal/…`, be interpolated into the upstream path and collapsed by `new URL()` onto a secret-only route. Two fences in the gateway: a global `preValidation` hook rejects any path param containing `/`, `\`, `?`, `#`, a control character or equal to `.` / `..` (400 `Invalid path parameter`), and `proxyTo` / `proxySSE` / `proxyToRaw` build the URL through `lib/upstream-url.ts#buildUpstreamUrl`, which returns null (→ 400 `Invalid request path`, nothing sent upstream) unless the path resolves to itself on the upstream origin. New routes need no per-route `encodeURIComponent` for safety. Tests: `api-gateway/src/lib/__tests__/upstream-url.test.ts`; e2e `suites/security/gateway-path-traversal.mjs`.
- **Internal routes (`/internal/*`, `/capi/auto-trigger`)** take tenant / org / actor from the body, so the secret alone is not enough for them: they also refuse any request carrying `X-User-Id`. The gateway sets that header on every request it proxies for a user; a service-to-service caller (identity-service's hr / leads clients, the gateway's own known-contacts lookup, meta-conversion-api ↔ leads-service) never does. hr-service: `internal.auth.ts#authenticateInternal`; leads-service: `internal.auth.ts#authenticateServiceToService` (its `authenticateInternal` stays secret-only for the gateway-fronted `/public/leads*` routes, which do carry a user context). A new service-to-service client must not forward user headers.
- **Branch switching**: a session is always scoped to exactly one org (the JWT's `org_id` drives `app.current_org_id` / RLS). Users mapped to multiple branches via `iam.user_org_mapping` list them with `GET /auth/my-orgs` and re-mint the session for another branch with `POST /auth/switch-org { org_id }` — no re-authentication. The target org is validated server-side against the caller's active mapping rows (403 otherwise), the new JWT is re-minted for that branch (`org_id` + the branch's `platform_role`; product role/rank is resolved per-service from `<product>.member_roles` for the active org), and the previous token's `jti` is revoked so only one active branch exists per session. `/auth/me` resolves role/org the same org-scoped way, so the web app's role-gated nav follows the active branch. The web app surfaces this as a post-login `/select-branch` page (when >1 mapping) and a navbar `BranchSwitcher` dropdown; both do a full navigation after switching so the server-rendered layout rebuilds from the new cookie. Tenant admins (rank ≥ 90) bypass all of this — their `tenant_admin` RLS policies already span every branch in the tenant.
- **Super admin: switch tenant from any app (1.55.0).** A platform super_admin's `BranchSwitcher` (every app's navbar — LMS, HRMS, Tasks, Admin and the SA console) opens with a **Tenant** picker; the branch list and the "All branches" row follow the picked tenant, and the chip reads `Tenant · Branch`. `GET /auth/my-orgs` returns, for super_admin only, every active branch of every active tenant with `tenant_id`/`tenant_name` (`UserOrgOption`) **plus a `tenants` list (`TenantOption[]`) read straight from `entity.tenants`** — the Tenant picker is built from that list, not from branches, so a freshly onboarded tenant with no branch yet is still selectable (it shows "has no branches yet" and no "All branches" row, since a session needs a real org to anchor on; add its first branch from the tenant setup). `POST /auth/switch-org { org_id }` accepts a branch of any active tenant for a user whose **DB row** has `platform_role = 'super_admin'` (`findUser`, never the token claim — `/auth/me` and `/auth/my-orgs` share the query, so a switched session stays valid); `{ all_branches: true, tenant_id }` re-mints "All branches of <tenant>" anchored on a real branch of it (the home branch when it is in that tenant) — `tenant_id` is a 403 for anyone else. `tenant_name` now names the **target** tenant. Every switch audits `org_switch` under the new branch; a cross-tenant switch is also filed under the source branch as `org_switch_out`, so both tenants' trails show it. Each row names only ids of the tenant whose feed it lands in (`{ cross_tenant: true }` across tenants, `{ from_org_id }` within one) — `GET /activities` is read by that tenant's admins, so the other tenant's branch/tenant ids never appear there. The new token carries the target tenant's `licensed_products`, so product nav and gating follow it. **Data is fenced to the switched tenant on every screen** by `withRoleTx` (super_admin → `tenant_admin` pinned to the session tenant, above) — the switcher only chooses which tenant. `task.task_comments` gained `tenant_admin` INSERT + `tenant_self_insert_policy` in the same change (tenant admins, and so a switched super admin, could not comment on tasks). Post-login `/select-branch` groups a super admin's branches by tenant.
- **"All branches" session scope.** Users whose `GET /auth/my-orgs` lists every branch of the tenant (the same `isTenantWideRole` rule; the response now carries `can_view_all`) also get an **All branches** row at the top of the navbar `BranchSwitcher`, and it is their **login default**. `POST /auth/switch-org { all_branches: true }` re-mints the token on the user's *home* org with the claim `branch_scope: 'all'` (403 for anyone without `can_view_all`); `/auth/me` surfaces it as `SessionUser.all_branches`. Picking a single branch (`{ org_id }`) drops the claim. The token always keeps a real `org_id` because RLS and writes need one — the claim is a **read-filter hint, never a grant**: branch-scoped LMS screens (Leads, Follow-ups) read it via `sessionBranchFilter(actor)` (`msq-lms/packages/lms-web/src/lib/leads/branch-scope.ts`) and send no `org_ids` for "All" and `[session org]` for a picked branch, while the services still decide reach from the `lms.leads.view` scope (non-tenant/all scopes are pinned to the session org whatever is sent). Before this, a tenant-wide user's Leads grids ignored the switcher entirely: `/leads` sent no `org_ids` and returned the whole tenant, while `/follow-ups` was hard-pinned to the session org — the two views on one page disagreed.

## Database pools

Three postgres.js pools exist, all with `transform: { column: { from: postgres.toCamel } }`:

| Pool | Connection | RLS | Used for |
|---|---|---|---|
| `appDb()` | `DATABASE_URL` (app_user) | Enabled | Org-scoped reads/writes |
| `tenantDb()` | `DATABASE_URL_TENANT` (tenant_admin) | Enabled (tenant scope) | Cross-org reads within a tenant |
| `serviceDb()` | `DATABASE_URL_SERVICE` (root_service) | BYPASSRLS | System operations |

### Transaction helpers

- **`withRoleTx(ctx, fn)`** — Dispatches based on `ctx.role`: `tenant_admin` uses tenantDb, others use appDb with `SET LOCAL ROLE app_user` + GUCs. **`super_admin` runs as `tenant_admin` pinned to its session tenant (1.55.0)** — `app.current_tenant_id` = `ctx.tenant_id`, or the tenant of `ctx.org_id` when the session carries none; no tenant is an error. It used to run on serviceDb (root_service, BYPASSRLS), so every read that relied on RLS alone returned **every tenant's rows** whichever tenant the super admin had switched into. Deliberately cross-tenant super-admin work (the lookup-admin consoles, existence/membership checks) never goes through `withRoleTx`: it uses `withTenantConfigTx` or a commented `withServiceTx`.
  - **`ctx.tenantWide`** — opt-in flag that selects the `tenant_admin` Postgres role for an actor whose *capability* reaches every branch in the tenant, even when `platform_role` is not literally `tenant_admin`. Cross-branch reach in this platform is a capability (`lms.leads.view.tenant`), but `platform_role` is a four-value denormalisation that collapses any tenant-defined role — a regional manager, say — to `member`. Without the flag such an actor passes every app-layer gate and then reads **zero** rows, because RLS is still pinned to `app.current_org_id`. This is not an RLS bypass: `tenant_isolation_policy` still fences every row to `app.current_tenant_id`, taken from the verified session, so it widens *branch* reach inside one tenant and can never cross tenants. Like `readOnly`, it is a caller assertion — whoever sets it must already have resolved the capability. Set today by `leads.repository.listLeads`, `orgs.repository.getOrgs`, `users.service.getAssignableUsers` and the assignment writes. On the assignment paths (single assign/reassign/unassign and bulk) the flag is gated by **coverage**, not by the capability ladder: `writeCtxForOrg(ctx, leadOrgId)` in `assignments.service` asserts the lead's branch is one of `getCoveredOrgIds(ctx)` and otherwise throws 403. Gating on the ladder instead (`lms.leads.view` = tenant/all) is what broke Bulk Assign for multi-branch `org`-scope roles: they resolve to `org`, so picking any branch other than the one they were switched into read back zero leads and failed as "One or more leads were not found". The **lead edit and delete** paths (`PATCH`/`DELETE /leads/:id`) now use the same coverage gate, shared as `leadWriteCtx(ctx, leadOrgId)` in `leads-service/src/lib/lead-write-scope.ts` (which also owns `resolveLeadOrgId` and the single `getCoveredOrgIds`, re-exported by `assignments.repository`). Before that, both writes were pinned to `ctx.org_id` while `listLeads` showed the whole tenant, so editing or reassigning a lead in any other branch matched zero rows and surfaced as **"Lead not found"** — and the delete silently changed nothing while answering 204. The write now runs in the lead's own branch (`{ ...ctx, org_id: leadOrgId }`, so audit triggers stamp the right org), every statement keeps an explicit `org_id = leadOrgId` predicate rather than leaning on the widened RLS fence, and a branch the actor neither administers nor is mapped to is a 403 instead of a misleading 404. Cross-branch reach here is deliberately **not** taken from the `lms.leads.edit` ladder: its widest rung is `.any`, which `resolveScope` reports as `all` but which means org-wide, so a branch admin holding it must not become tenant-wide.
  - **`ctx.readOnly`** — adds `SET LOCAL transaction_read_only = on` (and `SET LOCAL ROLE readonly_user` on the app path) so a read path is physically incapable of writing. Applied on every `tenantWide` read.
- **`withServiceTx(fn)`** — No role switch, BYPASSRLS. Used for auth lookups, seed scripts, activity logging, and webhook ingestion.

## Row Level Security

RLS is enabled on `lms.marketing_leads`, `lms.lead_links`, `iam.users`, `marketing.ad_campaigns`, `lms.lead_interactions`, `lms.lead_follow_ups`, `lms.lead_assignment_log`, `lms.lead_status_log`, `audit.activities`, `ext.meta_org_config`, `ext.meta_leads`, `ext.meta_lead_custom_fields`, `ext.meta_capi_outbound_logs`, `ext.meta_lead_addresses`, `ext.meta_lead_professional`, and `ext.meta_lead_demographics`. Each table has:

- `org_isolation_policy` (TO app_user): restricts rows to `org_id = current_setting('app.current_org_id')::uuid`

Some tables also have:
- `tenant_isolation_policy` (TO tenant_admin): restricts rows to orgs belonging to `current_setting('app.current_tenant_id')::uuid`

`root_service` has `BYPASSRLS` and is unaffected by these policies.

### Soft-deleted branches are RLS's job — except under `withServiceTx`

Both policies on `entity.organizations` carry `NOT is_deleted`, so on the `withRoleTx` path a
`security_invoker` view that joins organizations drops a soft-deleted branch's rows without any
query saying so. `withServiceTx` (`root_service`, `BYPASSRLS`) gets no such help, and **every
reporting path that runs without a user context is service-tx**: the public report page, the daily
`send-lead-report` cron, and the `lms.lead_report_snapshot` rows it persists. Those queries must
spell out `AND NOT o.is_deleted` themselves — including inside a CTE whose rows a rollup later sums.
The source report's ALL BRANCHES total was wrong for exactly this reason: the per-branch join
filtered, the `counters` CTE behind the rollup did not, so a deleted branch's leads vanished from
every branch row and still landed in the tenant total.

The `iam` write policies are the exception to the `org_id = app.current_org_id` shape: since `1.43.0` the user-management policies on `iam.users`, `iam.user_org_mapping` and `iam.reporting_lines` scope to the actor's **membership** (`iam.fn_user_active_orgs`) and ask `iam.fn_user_can_manage_users` per row. See *User management is a capability, per branch* under Permissions.

## Assignment model

Assignments are **not** a separate table. The assignment is stored as `lms.marketing_leads.assigned_user_id`. The assignments module (in leads-service) queries and updates `lms.marketing_leads` directly. Assignment ID in API responses = Lead ID.

### Weighted auto-assignment

When a new lead is created without an explicit `assigned_user_id` (Meta sync, manual lead creation), `resolveAutoAssignedUser(tx, orgId, campaignTypeId)` in leads-service (`services/leads-service/src/lib/assignment.ts` — moved out of `@platform/db` in P-1, it is LMS business logic) picks who receives it. Applies uniformly across every lead-creation path, all inside leads-service: intake `createWebhookLead` (which the Meta webhook and lead-pull Apply reach through `meta-conversion-api/.../lead-sync.service.ts` → `POST /intake/webhook` — lead-sync never calls it directly), `leads.repository.ts` `createLead()` and the branch transfer, and the campaign reclassify fan-out. Every one of them logs `lead.autoassign_skipped` when the pick finds nobody.

**Weights follow the role's department (1.50.2).** A weight only routes when the member's role department equals the campaign type's department — the same rule `lms.fn_user_sees_campaign_type` uses for visibility — so a Sales rep weighted for Hiring is never handed hiring leads they cannot see. New weights breaking the rule are refused (identity-service 400, DB trigger); pre-existing ones are kept, skipped by the picker with reason `no_department_match`, and reported by `one_time/report_weight_department_mismatch_dryrun.sql`. Once the role or weights are fixed, the super-admin **Re-run Auto-Assignment** screen (lookup-admin → leads-service `POST /lead-assignment/rerun`, dry run first, 500 leads per call) assigns leads that arrived unassigned — only leads with no owner and no logged interaction.

**The pool is `(branch x campaign type)`, not just the branch, as of `1.49.0`.** A hiring lead routes to that branch's HR rotation and a sales lead to its sales rotation, because `lms.lead_assignment_weights` is keyed on `(user_org_mapping_id, campaign_type_id)` — one person holds one row per pool they belong to. See *Campaign-type routing* below.

**Eligibility:** active `iam.user_org_mapping` row for the org, an **active, non-deleted `iam.users` row**, an `lms.lead_assignment_weights` row **for that campaign type** with `weight > 0`, a role rank strictly between `READ_ONLY` and `ADMIN` (org admins and read-only users are never auto-assigned leads), and a role holding the `LMS` capability. The `LMS` gate still applies to every type — hiring leads are LMS leads too, living in `lms.marketing_leads` and worked on the same screens. What a pool's members see of the *other* types is a separate question, answered by `lms.fn_user_sees_campaign_type()` inside the row policy, not by the picker.

Since `1.44.0` the weight lives in `lms.lead_assignment_weights`, keyed by the membership's surrogate `iam.user_org_mapping.id`, rather than in a `lead_assignment_weight` column on the mapping itself — the mapping is shared by every product and only LMS ever read that column. **No row means weight 0**, so the picker's join to the weights table does the `> 0` filtering that the column's `NOT NULL DEFAULT 0` used to require an explicit predicate for. See *Per-product settings on a membership* in `docs/DB_model.md` for the pattern other products should follow instead of adding a column here.

The user-row condition mirrors `iam.fn_actor_can_act_in_org`, which `lms.check_lead_fk_org_scope()` re-runs on insert. **The two predicates must stay identical.** When they drifted, a user deactivated via edit-user (which sets `iam.users.is_active = false` but leaves the mapping untouched — unlike `softDeleteUser`, which cascades) stayed selectable: the picker chose them, the trigger rejected them, and the insert RAISEd. Because a user who can never receive a lead keeps an open-lead count of 0, their deficit stays maximal and they win *every* pick — so the branch fails 100% of the time, not intermittently. Via the Meta webhook that surfaced as a 404 from intake and every inbound lead for that branch was silently dropped (Gurugram - Sector 104, Aug 13-24 2026).

Deactivating a user now zeroes the weight on every one of their memberships in the same transaction as the `is_active` write (identity-service `updateUser`). The mappings stay active so reactivation restores membership; weights are not restored, since the share has to be redistributed while the user is away. `moveUserBranch` does the same for the branch being left — before `1.44.0` it handled the weight not at all, orphaning it on the deactivated mapping.

**Who owns the leads a departing user leaves behind.** Both flows that remove a user from a branch — deactivation and a branch move — carry an optional `reassign_leads_to` on `PATCH /users/:id`, and the field is deliberately **three-valued**: a uuid hands the open leads to that user, `null` **unassigns** them (`lms.marketing_leads.assigned_user_id = NULL`), and `undefined` means the caller said nothing, so no reassignment runs at all. Identity-service forwards all three to leads-service's `POST /internal/leads/reassign-org`, which accepts a null `to_user_id` and stamps the run as a bulk unassign.

Both server paths therefore gate on `!== undefined`, never on truthiness — `reassignUserLeadsInOrg` (deactivation) always did; `moveUserBranch` did not until this change, so a null branch move was indistinguishable from an omitted one and silently skipped the reassign, leaving the pipeline pointed at a user no longer in that org. That is precisely what the reassign-then-move saga exists to prevent, so the two paths now draw the same line.

**Lead UI is shown only for roles that work leads.** `GET /users/role-catalog` returns `works_leads` per role, resolved against `lms.leads` (the same predicate as `/users/assignable?purpose=filter`, not the `lms` product root, which admins hold too). The shared `OrgAssignmentsField` hides the lead-assignment weight for a role with `works_leads === false`, and `EditUserModal` skips the "Reassign their leads to" panel for a user whose current home-branch role lacks it. That user's deactivation or branch move still sends `reassign_leads_to: null`, so stray leads are unassigned, not stranded. The flag is display-only. Weight rows a non-lead role already holds are left untouched, and an absent flag (older identity-service) keeps the previous always-shown behaviour.

The UI never omits the key while the reassign panel is open: it requires a successor whenever the branch still has anyone eligible (`/users/assignable`, which gates on real branch membership and the LMS capability, not the rank ladder), and sends `null` only when it does not. Leads are never left owned by a login that can no longer act on them. The reassign only fires when the user actually **leaves** the branch — `homeMoved && !stillHoldsOldOrg` — so moving home between branches they keep strands nothing and is correctly a no-op.

**Algorithm — deficit-based weighted round-robin:**
1. Count each eligible user's current *open* workload **in this same pool**: leads assigned to them in this org, **carrying this campaign type**, where the lead's stage has `is_terminated = false` (no hardcoded stage names — picks up `new`/`contacting`/`on_hold`/`qualified`, and any future non-terminal stage, automatically)
2. `deficit = (weight / 100 * total_open_including_new_lead) - current_open_count`
3. Assign to whichever eligible user has the highest deficit; ties broken randomly

**Both halves of the deficit are measured in the same pool, and that is load-bearing.** Counting a user's whole open book instead would let a rep with 50 open *sales* leads look permanently over-served in the *hiring* rotation and starve them of hiring leads altogether — invisible on a small test dataset, systematic in production.

This deterministically converges to each user's target %, self-corrects as leads resolve (convert/reject/transfer), and is not retroactive — changing weights only affects future unassigned leads.

**No more silent nulls.** `resolveAutoAssignedUser` returns `{ userId, reason }` where `reason` is `'assigned' | 'no_weighted_users' | 'no_capable_users'`, replacing the bare `null` it used to return. The old shape could not tell a branch with nobody weighted apart from one whose weighted members all lack the LMS capability, and callers had nothing to log either way: 10 of 30 production branches sat with no weighted user and auto-assign failed silently for a long time before anyone noticed. Every caller now logs a non-`'assigned'` reason — intake emits `lead.autoassign_skipped` with `{ org_id, campaign_type, reason }`. A lead whose type cannot be resolved at all yields `'no_weighted_users'`, because no weight row can carry a NULL type; it does **not** fall back to an untyped cross-pool rotation.

**Managing weights:** `GET/PUT /users/assignment-weights` (identity-service; GET needs `admin.team.manage`, PUT still org-admin rank pending the capability-walls Phase 2). The PUT endpoint validates every `user_id` is actually eligible and that weights sum to exactly 100 (or all 0, disabling auto-assignment for the org) — both checked at the application layer inside the same transaction as the write, not via a DB constraint.

**The Python port (`meta-sync-scripts/common/lead_writer.py::resolve_auto_assigned_user`) mirrors this pool-scoped picker, with one known gap.** It ports the rank-ladder eligibility bounds and the type-scoped deficit formula (both halves of it) statement-for-statement, but does **not** replicate the `hasCapability(tenantId, roleName, CAPABILITY.LMS)` filter documented above — there is no Python equivalent of that RBAC lookup in this package. In practice this means a weighted org member whose role sits in-band on the rank ladder but holds no `LMS` capability grant could be selected by a Python-ingested lead (`sync_leads.py`, `import_downloaded_leads.py`) where the TypeScript path would exclude them. This predates the campaign-types phase and is a pre-existing TypeScript/Python divergence, not something introduced by campaign-type support — flagged here rather than fixed silently, per the scope boundary that keeps behavioural mismatches between the two paths visible instead of quietly patched in only one.

### Campaign-type routing

**What a campaign type is.** `marketing.campaign_types` is a tenant-scoped catalog — `sales`, `hiring`, whatever a tenant adds next — carrying `department_id` (the team it routes to; NULL = visible to everyone), `match_keywords`, `is_default` and `match_priority`. Every tenant is seeded with `sales` (the `is_default` catch-all) and `hiring` by `entity.seed_tenant_rbac()`.

**Who sees which type (1.51.1).** `lms.fn_user_sees_campaign_type`, inside `lms.marketing_leads`' RLS, separates departments both ways: a department-bound type is visible to roles in that department, the three anchors, and holders of `lms.leads.view.all_types`. The `is_default` type (Sales) is additionally visible to roles with **no** department (read_only, unwired roles) — but, since 1.51.1, **not** to a role in another department, so HR roles stop seeing the Sales pool. The Leads page Type filter (navbar `filterSlot`) is shown to, and honoured by leads-service for, `lms.leads.view.all_types` holders only. `db_scripts/one_time/report_default_type_fence_dryrun.sql` lists who loses the default pool before the change reaches a server.

**How a lead gets one.** `resolveCampaignForLead(tx, orgId, input)` in `leads-service/src/lib/campaign-resolution.ts` resolves it, most specific first:

1. the `campaign_type_id` the caller supplied — the Meta path, where **meta-conversion-api** resolved the mapping from `ext.meta_campaigns` and passed it in;
2. the page/form default (`ext.meta_page_form_org_map.default_campaign_type_id`), likewise **passed in** by the caller;
3. the tenant's `is_default` type — walk-ins, the public `POST /public/v1/leads` API, manual lead creation, anything with no Meta campaign at all.

Both caller-supplied ids are checked against the org's tenant before use, and a foreign or unknown id is a **400, never a silent fall-through to the default** — the public intake route spreads the caller's whole body through, so `campaign_type_id` is genuinely attacker-controlled there.

**leads-service never reads `ext.*`.** That schema belongs to meta-conversion-api, which holds the Graph token and owns the campaign → type mapping; the resolved ids arrive as arguments instead. This is why step 2 is a parameter rather than a lookup, and it is what keeps the two services separable with no new cross-service grant. (`lead_svc` does hold `SELECT` on `ext.meta_campaigns` from 1.49.0's grants; this phase deliberately does not use it.)

**Branch projection of a Meta campaign.** Given a `meta_campaign_id`, resolution looks up `marketing.ad_campaigns` on `(org_id, meta_campaign_id)` and, on a miss, creates that branch's row carrying the type — platform and status resolved exactly as `meta-sync-scripts/sync_campaigns.py` does, against the *campaign's* tenant, with the name falling back to `Meta Campaign <id>`. The insert is `ON CONFLICT (org_id, meta_campaign_id) WHERE meta_campaign_id IS NOT NULL DO NOTHING` followed by a re-select: concurrent webhook deliveries for a brand-new campaign race routinely, and the partial unique index would otherwise turn the loser into a `23505` that fails a perfectly good lead. The `WHERE` in the conflict target is **not optional** — Postgres only infers a *partial* unique index when the predicate is repeated, and without it the statement fails outright. A tenant missing the platform/status catalog row yields no campaign rather than an error: the lead still gets its type, is still created and still routes. Dropping an inbound lead over a missing dropdown entry would be the worse failure.

`meta-sync-scripts/common/campaign_resolution.py` is the Python port of both this resolution and `campaign-mapping.service.ts`'s `ext.meta_campaigns` cache/insert (the two collapse into one module there — see its own docstring for why), called by `lead_writer.create_lead` before auto-assignment. Both paths resolve the type by calling `marketing.fn_match_campaign_type()` — never by reimplementing the keyword match in either language — so a campaign types identically whichever path ingests its first lead.

Meta campaign ids are carried as **strings** end to end. They run to 17 digits, past `Number.MAX_SAFE_INTEGER`, so a JSON number would arrive with its low digits already corrupted and match the wrong campaign; every query casts with `::bigint` instead.

**Reclassification — `POST /internal/campaign-reclassify`.** meta-conversion-api calls this immediately after an admin confirms a campaign → type mapping, because leads-service owns the leads and the routing rules. It is registered on the service's **existing** `/internal` router group, behind the same `authenticateInternal` shared-secret preHandler as `/internal/leads/reassign-org`. Body: `{ meta_campaign_id, campaign_type_id, dry_run, actor_id? }`; `dry_run` defaults to **true**, so a caller that forgets the flag gets an impact preview rather than an unrequested fan-out. One transaction does two different things:

- **Relabel** — unconditional. Every `marketing.ad_campaigns` row for that Meta campaign, and every lead on them, in **every branch**, gets the corrected type.
- > **Superseded in 1.51.0** — see [Meta lead routing (1.51.0)](#meta-lead-routing-1510).

- **Re-route** — deliberately narrow. A lead changes hands only if it is auto-assigned and untouched by a person since (an `initial` row in `lms.lead_assignment_log` with no later `reassigned`/`bulk_assigned`/`self_assigned`/`reclassified`), sits in a non-terminated stage, has **zero** `lms.lead_interactions`, **and** its current assignee holds no weight for the new type in that branch. Each one is re-picked **in its own branch's** rotation for the new type; an empty target pool leaves it unassigned with a logged reason, never silently back on the old pool.

This conservatism is a product decision, not a heuristic: a lead someone has already called stays with them and only its label is corrected, because yanking a lead mid-conversation is worse than a wrong label. The last condition is also what keeps the fan-out quiet in the common case — a rep weighted for both pools simply keeps their lead.

The move is written as **one** `UPDATE` setting `assigned_user_id` and `campaign_type_id` together. That is the only way `lms.log_lead_assignment()` records it as `reclassified` rather than a plain `reassigned`; splitting it into an unassign then an assign would write `unassigned` + `initial` and the timeline would no longer say *why* the lead moved. Consequently the bulk relabel deliberately **excludes** the re-route candidates, so their type is still `DISTINCT` by the time that statement runs. The per-lead note goes through the `app.lead_transition_note` GUC, which the trigger reads into `lead_assignment_log.note`.

The dry run and the real run share the same counting queries, so the preview cannot promise an impact different from the one the admin confirms. Response: `{ dry_run, campaigns_relabelled, leads_relabelled, leads_reassigned, leads_left_unassigned, by_branch[] }`.

The whole operation runs under `withServiceTx` (BYPASSRLS) — a campaign's leads are spread across every branch that ran it, so there is no single org to scope an RLS transaction to. **The tenant fence is therefore restated explicitly in SQL**, on the campaign type's own `tenant_id`, in every query.

**Managing types:** `GET/POST/PATCH/DELETE /campaign-types` (leads-service), gated on `lms.campaign_types.view` / `lms.campaign_types.manage` — **by capability, never by role name**. Writes go through `withTenantConfigTx`, not `withRoleTx`: `marketing.campaign_types` is tenant-scoped and its write policy keys on `app.current_tenant_id`, a GUC `withRoleTx`'s `app_user` branch never sets. That transaction pins the tenant and **not** `app.current_org_id`, so these reads deliberately join nothing from `iam.departments` or `lms.marketing_leads` — both are fenced on the org GUC and would return zero rows with no error. The delete guard's usage counts therefore run separately, under a documented service transaction, because a type is tenant-wide while its leads live in branches the acting admin may not be scoped to.

Deleting a type is refused while it is the tenant default, or while any lead, campaign or assignment weight still points at it — the FKs are `ON DELETE RESTRICT` but this is a *soft* delete, which they do not police at all.

`name` is not editable and `is_default` is not settable through this API: the name is what weight rows, the Python sync and saved reports refer to a pool by, and moving `is_default` makes that type unconditionally visible to everyone (see `lms.fn_user_sees_campaign_type`), which is a provisioning decision rather than a CRUD field.

**Visibility is the database's answer, not the API's.** Which types a user can see at all is decided by `lms.fn_user_sees_campaign_type()` inside `lms.marketing_leads`' RLS `USING` clause. The `campaign_type_ids` filter on `GET /leads` and `GET /assignments/mine` only *narrows* what the caller may already see.

**CRM campaign CRUD** (`/campaigns`) accepts and returns `campaign_type_id`. Classifying a **Meta** campaign is not done there: that mapping is per Meta campaign and tenant-wide, so it lives in meta-conversion-api, while `/campaigns` edits one branch's record. Changing the type on a campaign relabels the **campaign only** — existing leads keep the type they were routed under, since `lms.sync_lead_campaign_type()` fills a lead's NULL type from its campaign but never overwrites one. Moving the leads too is the reclassify fan-out's job.

### Meta lead routing (1.51.0)

The goal: every Meta lead — webhook, scheduled catch-up or manual pull — reaches the right **tenant and
branch** (from its **page**) and the right **department** (from its **campaign type**), and is auto-assigned
from that branch × type pool. Product decisions of 2026-09-26 behind this section: page is the branch key
(a form-level row is kept only as an override for pages shared by several branches); one shared Meta app;
a campaign never spans tenants; unconfirmed campaigns route on the rules immediately; re-typing a campaign
moves **all** its open leads; the scheduled catch-up only stages; roles get LMS access via capabilities (no
role seeding).

**The type ladder, per lead** (`meta-conversion-api/src/services/campaign-mapping.service.ts::resolveCampaignType`):

1. the campaign's **confirmed** type (`ext.meta_campaigns.campaign_type_id`, written ONLY by an admin confirm);
2. the first matching **ordered rule** (`marketing.campaign_type_rules`, first match wins in `rule_order`),
   evaluated on the campaign, lead-form, ad-set and ad **names** by `marketing.fn_match_campaign_type_rules`;
3. the page (or form-override) **default type** (`ext.meta_page_form_org_map.default_campaign_type_id`);
4. the tenant's **default** type.

The campaign-name-only rule result is also stored on the campaign as `suggested_campaign_type_id` (+
`matched_rule_id`) for the admin grid — a suggestion is never read back as the campaign's type. Before
1.51.0 an unmatched or unnamed campaign stored the fallback (usually Sales) as its type and every later lead
inherited it. Form / ad-set / ad names are resolved by `lead-names.service.ts`: cache first
(`ext.meta_forms`, `ext.meta_adsets`, `ext.meta_ads`), one short Graph call per NEW id, and **only for fields
the tenant has a live rule on**. A campaign row owned by another tenant is flagged (`conflict_reason`) and not
applied; the lead is still typed from its own rules/defaults.

**Assignment** is unchanged in shape (`leads-service/src/lib/assignment.ts`): branch × type pool, role
department must equal the type's department, LMS capability, weights. What changed: the reason a pick leaves a
lead unowned is **stored** on `lms.marketing_leads.auto_assign_reason` (`no_campaign_type` — new, previously
misreported as `no_weighted_users` — `no_weighted_users`, `no_department_match`, `no_capable_users`), cleared
by trigger the moment anyone owns the lead; intake returns `assigned_user_id`, so the webhook's `lead:created`
event carries the real assignee (it was hard-coded null); and a lead inserted with an owner now writes an
`initial` log row (`trg_lead_assignment_log_insert`).

**Re-typing a campaign** (`POST /internal/campaign-reclassify`) re-routes **every open lead** of the campaign
(active, not superseded, non-terminated stage) whose owner is not in the new type's pool — interactions and
manual assignment no longer protect a lead, because a lead of the wrong type sits with a team RLS may not even
let see it. Unassigned open leads are picked too. An empty target pool unassigns the lead with the reason
stored. Leads whose branch campaign row was never created are found through `metadata.campaign_id`.
Re-run Auto-Assignment now also takes untyped leads (typed to the tenant default on the way).

**Campaign discovery (shared app).** `ext.meta_ad_accounts` (platform-level, RLS on with no app policy,
`root_service` only) lists every ad account `/me/adaccounts` returns; a super admin enables the ones to walk.
"Fetch campaigns" (`campaign-sync.service.ts::syncCampaigns`) walks the enabled accounts with
`adsets{promoted_object}` and `ads` expanded, and attributes each campaign to the ONE tenant its promoted pages
are mapped to — never to the tenant that pressed the button. No tenant → reported as `unattributed`; several →
reported as a conflict and flagged. `?tenant_id=` on the route only narrows the writes.
`ext.meta_tenant_config.ad_account_ids` is deprecated.

**Leads that do not land** — unmapped page, missing phone, sync error — are parked in `ext.meta_lead_inbox`
with their field data (the webhook still answers 200, so Meta never redelivers). A super admin maps the page and
presses Retry (`lead-inbox.service.ts::retryInbox`), which goes through the same `syncLeadToDatabase`. The
row resolves itself when the lead later lands by any route (webhook redelivery, Retry, pull Apply).

**Lead pull additions.** Campaign mode (`filters.mode='campaign'`) walks `GET /{campaign}/ads` then
`/{ad}/leads` on the promoted page's token — only the selected campaigns' leads. Pages mapped to another tenant
are never walked in either mode. Reconcile predicts each staged lead's type with the ladder above (grid column
"Routes to"). `POST /lead-pull/runs/:id/remap` re-resolves the branch of unmapped staged rows after an inline
mapping, and Apply accepts an `applied` run again while it has pending importable rows. A scheduled catch-up
(`trigger_kind='scheduled'`, `META_CATCHUP_INTERVAL_HOURS` default 6, `META_CATCHUP_WINDOW_DAYS` default 3, 0
disables) stages one run per tenant with active mappings in its own slot, never applied automatically.

**Console (lookup-admin, super admin).** Campaign Types & Rules (`/dashboard/campaign-types`: types →
department, ordered rules with reorder, rule tester), Meta Ad Accounts, Meta Lead Inbox, and the updated Meta
Campaign Mapping (pages, suggestion + matched rule, conflicts, add-rule-on-confirm), Meta Page Mapping (default
type, form picker, other tenants' pages hidden) and Meta Lead Pull (mode, Branch / Routes-to columns, map-here +
remap, scheduled run).

**New routes** (gateway → service; all super-admin except the tenant-staff capability path on rules):
`GET/POST/PATCH/DELETE /campaign-types/rules`, `PUT /campaign-types/rules/order`, `POST /campaign-types/rules/test`
(leads-service; capability `lms.campaign_types.view/manage`, or super admin with `?tenant_id=`);
`GET /meta/ad-accounts`, `POST /meta/ad-accounts/sync`, `PATCH /meta/ad-accounts/:id`;
`GET /meta/pages/:pageId/forms`; `GET /meta/lead-inbox`, `POST /meta/lead-inbox/:id/retry|ignore`;
`POST /meta/lead-pull/runs/:id/remap`; `GET /meta/lead-pull/runs/latest?trigger_kind=`.

### Multi-branch users on the roster (`GET /users`)

Membership is one row per branch in `iam.user_org_mapping`, but a roster row's
`org_id`/`org_name` resolve `iam.users.org_id` — the user's **home** branch only.
Every row therefore also carries **`org_memberships`**: a JSON array of
`{ org_id, org_name, role_label, is_home }`, home branch first, aggregated by a
`LEFT JOIN LATERAL` in `listUsers` and scoped to the row's own tenant.

`org_id`/`org_name` keep their old meaning, so this is additive for every
existing caller. The rule for new code is the one the Team screen got wrong: any
question of the form *"is this user in branch X"* must read `org_memberships`,
never `org_id`. Filtering the Admin → Team grid on a single home id silently
dropped everyone whose second branch was the one being filtered for — a wingman
working two sectors vanished from the branch he actually works.

The aggregate runs inside the same `withRoleTx` as the listing, so RLS decides
which mapping rows are visible: an org-scoped actor sees only the memberships
they are entitled to, and the array can never widen past the tenancy the scope
clause already established. Admin → Team's Branch filter is gated on
`RANKS.TENANT_ADMIN` regardless, and its option list comes from `/orgs/all` so a
branch staffed only by non-home members is still selectable.

### Assignee picker vs. Assigned-To filter (`GET /users/assignable`)

One endpoint serves two different questions, told apart by `purpose`:

| | `purpose=assign` (default) | `purpose=filter` |
|---|---|---|
| Question | "whom may I hand this lead to?" | "who works leads in this branch?" |
| Authority | the actor's `lms.leads.assign.reports/.peers/.any` grants (server-derived; `scope`/`max_rank` from the query string are ignored for LMS) | the same eligibility rule as auto-assignment (`getAssignmentWeights`) |
| Rank rule | relative to the actor — delegation / collaboration / unlimited, bounded by `ANCHOR_RANK.ORG_ADMIN` | absolute band: `> ANCHOR_RANK.READ_ONLY` and `< ANCHOR_RANK.ORG_ADMIN`. **No** actor-relative ceiling |
| Capability gate | `CAPABILITY.LMS` / `.TASKS` — the product root | `CAPABILITY.LMS_LEADS` — the tool node |
| Orgs | one (`org_id`) | one or many (`org_ids`, comma-separated) |

The filter half drops the actor-relative ceiling because the grid shows every lead in scope
regardless of the assignee's rank, so a relative ceiling can never agree with the rows — it left
the Leads History "Assigned To" dropdown listing almost nobody.

The two remaining predicates are both load-bearing, verified against the live capability matrix:
`lms.leads` is the only one that drops `hr_admin` (rank 75) and the fitness roles, which clear the
rank band; the rank band is the only one that drops `super_admin` and `read_only`, which hold
`lms.leads`. Note `org_admin` and `tenant_admin` hold the `lms` root but **not** `lms.leads` —
gating on the root is why admins and non-lead staff appeared while reps did not.

Both halves list **active** users only (`u.is_active`, `NOT u.is_deleted`, `uom.is_active`), so a
rep who has left still appears in the grid but cannot be filtered on.

**The filter is scoped to the branches the actor COVERS, not the one they are switched into.**
`ctx.org_id` is only the branch currently selected in the BranchSwitcher; coverage is every active
`iam.user_org_mapping` row, resolved by `getCoveredOrgIds`, which deliberately mirrors
`getMyOrgs` (`GET /auth/my-orgs`) so the branch picker and the data behind it cannot drift:

- tenant-wide platform role (`isTenantWideRole`) → every org in the tenant;
- everyone else → their mapped branches, falling back to the current org if they have none.

Coverage is resolved for **every** actor, not only those the capability ladder calls cross-org.
That gate is about reaching branches you were never granted; coverage is about the ones you were.
A Wingman resolves to `org` on the ladder yet is mapped to six branches — gating coverage on the
ladder pinned them to one. Likewise `tenant_admin` holds no `lms.leads.view.*` leaf at all, while
`getLeadsHistoryAssignedToScope` gives it a tenant-wide *row* scope, so the dropdown offered a
single name against a tenant-wide result set.

**`effectiveOrgIds = requested ∩ covered`.** A client-supplied org list narrows and can never
widen: an id the actor does not cover is dropped, so a forged `org_ids` returns *fewer* rows rather
than another branch's roster, and an empty intersection is a real deny — never a fallback to full
coverage. Multi-branch coverage cannot be read under the caller's own branch-scoped role, so the
read is elevated; what bounds it is the explicit id list plus the `o.tenant_id` assertion in SQL,
never the role.

**Both purposes are coverage-scoped**, because `iam.can_assign_to(org, actor, target)` takes the
org as a *parameter* and requires both parties mapped in it — so a candidate in any branch the
actor covers is genuinely assignable. What differs is what the caller should pass:

- an **assignee picker for one lead** sends the **lead's** `org_id`, since that is the org the
  write is judged against — otherwise a six-branch Wingman is offered names only the lead's own
  branch could accept;
- the **filter** sends the selected branches, or nothing to mean "everywhere I cover".

The rank ceiling and the product-capability gate are unchanged on both paths: coverage decides
*which branches*, never *who* within them.

**Every picker sends a branch.** The Assignments page, the leads grid's edit modal and the
walk-in/edit modal all resolve candidates for the org of the lead in hand (`useAssignableCandidates`
in `@lms/web`, keyed on the lead's `org_id`); Bulk Assign sends the branch selected in its own
dropdown. Passing nothing is reserved for callers with genuinely no single lead in context.

Bulk Assign's own **Stage** and **Assigned To** filters are the exception to that picker rule: they
narrow the table, they do not choose a target, so their options are derived from the fetched rows
(plus the response's `stage_options` for label and pipeline order) rather than from
`/users/assignable`. Deriving them is what makes every name in the CURRENTLY ASSIGNED column
selectable — the assignable list answers "who may I assign *to*", which can omit a lead's current
owner — and it gives the *Unassigned* bucket, which `/leads` cannot express (`assigned_to` is a
single UUID there). Both filters are client-side over the one 5000-row fetch the page already
makes, and both reset when the branch changes.

**Membership is a mapping, not a home org.** The write side asks the same branch question the
picker does: `getUserForAssignment(ctx, targetUserId, orgId)` resolves the target through
`iam.user_org_mapping` **in the lead's branch**, so the returned rank is their rank there and a null
row means "not an active member of that branch". Comparing the lead's org against `iam.users.org_id`
— the target's *home* branch — is what rejected valid assignees with "The assignee must belong to
the org the leads live in" whenever someone was mapped into one branch and homed in another.

**Rows come back alphabetically** — `lower(coalesce(nullif(btrim(full_name),''), email))` — which is
the label the pickers render. The previous seniority-first order (`rank DESC`) sorted on a field no
picker displays, so the lists read as unordered. The web side sorts again in `toAssignableUsers`, so
a caller that merges lists cannot undo it.

## Face verification (attendance)

Optional per-org verification of attendance punch selfies against an enrolled
reference photo, using a **self-hosted CompreFace (Exadel)** instance. Governed by
`hr.attendance_rules` columns: `require_face_match` (off by default),
`face_match_threshold` (default 85), `face_match_action` (`flag` | `block`),
`photo_change_cooldown_days` (default 30 — self-service reference-photo change
rate limit), and `image_retention_days` (default 90 — how long daily punch
selfies are kept before the retention job deletes them).

**The reference photo IS the user's profile avatar.** Avatars are platform-wide
(`iam.users.photo_key` + consent metadata; bytes in `@platform/blob-storage`,
served by identity-service at `GET /users/:id/photo` with an ETag). Enrollment no
longer carries an image — hr-service reads the stored avatar and registers it with
CompreFace, so the displayed avatar and the biometric reference are always the same
image. Because `hr_svc` has SELECT-only on `iam`, **identity-service is the sole
writer of `photo_key`**; hr-service only reads it. Daily check-in/out selfies are a
separate, shorter-lived store (`punch/<userId>/<YYYYMMDD>_chkin|chkout.jpg`) that the
retention job prunes; avatars (`avatar/<userId>/<epochMs>.jpg`) are never auto-deleted.

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

**Enrollment.** Two steps, orchestrated by the client:
1. **Upload the avatar** — `POST /users/me/photo` (self) or `POST /users/:id/photo`
   (admin, rank ≥ 40 + rank ceiling) on identity-service, with `consent: true`
   (DPDP — `photo_consent_at` stamped; false/absent → 422 `PHOTO_CONSENT_REQUIRED`).
2. **Enroll** — `POST /hr/attendance/face/enroll { user_id, consent }` (no image).
   A member may enroll **themselves**; hr_admin/org_admin may enroll anyone in-org.
   hr-service reads the avatar (`FACE_NO_PHOTO` if none), registers it with
   CompreFace (subject id = user UUID; re-enrollment replaces the faces), and stamps
   `face_enrolled_at` / `face_consent_at`. Self-service re-enrollment is rate-limited
   by `photo_change_cooldown_days` (measured from `face_enrolled_at`, so a pre-upload
   check and the enroll re-check always agree; **admins bypass it**) → 422
   `FACE_CHANGE_COOLDOWN`. `GET /hr/attendance/face/me` returns the self context
   (`has_photo`, `enrolled`, `require_face_match`, `can_change_photo`,
   `next_change_allowed_at`) that drives the check-in gate and the upload modal.

Unenroll (`DELETE …/face/enroll/:userId`, admin) drops the subject and clears the
profile columns (the avatar itself remains). There is no automatic hook from
identity-service user deactivation (that would couple the services) — unenroll-on-exit
is an ops task, documented in `docs/FACE_VERIFICATION.md`.

**Check-in gate (UI).** When `require_face_match` is on, the check-in button first
ensures the user is enrolled: no avatar → the shared photo-upload modal opens
(capture or gallery + consent), then auto-enrolls and proceeds; avatar but not yet
enrolled → silent enroll; enrolled → straight to the punch. Check-out is never gated.

**Retention.** `msq-deploy/retention/retention-cleanup.sh` deletes `punch/**` selfies
older than each org's `image_retention_days` (using the date embedded in the key, not
mtime) and never touches `avatar/**`; `setup-cron.sh` installs the daily job.

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

Fire-and-forget: every service calls `@platform/audit-log`'s `logActivity()` in-process (writes are `void`'d or errors are swallowed internally). This ensures activity logging never blocks or fails a user-facing request. Reads (`GET /activities`) are served by leads-service, gated on the `lms.history.view.org` capability (not a rank), and scoped by RLS via `withRoleTx` **plus** an explicit session-tenant predicate in `listActivities` — a super_admin transaction runs BYPASSRLS, so RLS alone let it read every tenant's feed. leads-service reads as `lms_svc`, which needs `USAGE ON SCHEMA audit` + `SELECT ON audit.activities` (07_grants.sql). Every activity is filed under the **acting user's own verified org** — never a client-supplied one: `org_switch_denied` used to be filed under the org the caller asked for, which put tenant A user ids into tenant B's feed (fixed 1.54.0).

## Meta Conversion API

Bidirectional integration with Meta (Facebook) Lead Ads:

### Inbound flow (Meta → CRM)
1. Meta sends a webhook POST to `/meta/webhook/:integrationId` (per-tenant app) or `/meta/webhook` (shared app, no integrationId) through the gateway
2. Gateway forwards raw bytes (not re-serialized JSON) via `proxyToRaw()` for HMAC integrity
3. Meta-conversion-api resolves Meta app credentials from `ext.meta_tenant_config`: by `integrationId` when present (a specific tenant's app), or the single row with `tenant_id IS NULL` when absent (a shared app covering multiple tenants)
4. HMAC-SHA256 verification using the resolved row's `app_secret`
5. Fetches full lead data from Meta Graph API using the resolved row's `access_token`
6. Always inserts a new `lms.marketing_leads` row (source resolved from Meta's per-lead `platform` field when present — `fb`→`facebook`, `ig`→`instagram`, `wa`→`whatsapp` — falling back to the static `ext.meta_page_form_org_map.platform` config value if Meta omits or returns an unrecognized platform; stage=new). If an active lead with the same `(org_id, phone)` already exists, the old row is marked `is_active=false, superseded_by=<new_id>` and a `lms.lead_links` record (`link_type='merge'`) is written for audit. A linked `ext.meta_leads` row is created referencing the new marketing lead.
7. Org (and, for the shared-app path, tenant) is resolved from `ext.meta_page_form_org_map`: an exact `form_id` row wins (`form_id` is globally unique across all tenants), else the Page's **page-level** row (`form_id IS NULL`), else the lead is unmapped and skipped. The page-level fallback is restricted to `form_id IS NULL` as of 1.48.1 — it previously took the most recently created active row for the Page whatever its `form_id`, so an unknown form could be attributed to a branch mapped for some unrelated form, disagreeing with the Python `common/mappings.py::resolve()` reading the same table.
8. Field extraction uses the resolved tenant's `field_mappings` (from `ext.meta_tenant_config.field_mappings`, JSONB) merged over the hardcoded `DEFAULT_FIELD_MAPPINGS` — lets a tenant remap Meta form field keys without a redeploy
9. Address/job/demographic fields are written to `ext.meta_lead_addresses`, `ext.meta_lead_professional`, `ext.meta_lead_demographics` (1:1, only when at least one field is present)
10. Any remaining unmapped form fields stored in `ext.meta_lead_custom_fields`
11. **Campaign attribution and typing.** Before the intake call (the type is an *input* to routing, not a later relabel), `lead-sync.service.ts` resolves the lead's campaign type through `campaign-mapping.service.ts::resolveCampaignType` and forwards `meta_campaign_id`, `meta_campaign_name`, `meta_campaign_status`, `meta_platform`, `campaign_type_id` and `default_campaign_type_id` to leads-service, with `campaign_id`/`adset_id`/`ad_id` in `metadata`. Until 1.49.0's service work these were written into `ext.meta_leads` and forwarded **nowhere** — `IntakeLeadPayload` had no campaign fields at all — so `lms.marketing_leads.campaign_id` was NULL for every live Meta lead and the Campaign row on the lead-edit screen always read `-`.

### Inbound failure diagnostics
Step 6 delegates the `lms.marketing_leads` insert to leads-service `POST /api/v1/intake/webhook`; a rejection there surfaces in meta-conversion-api as `evt: webhook.lead_sync_failed`. Two things make that line self-diagnosing:
- It carries `orgId`, `tenantId`, `pageId`, `formId` alongside `metaLeadId`/`integrationId`. The org is the routing key for every follow-up query, so a failure can be traced to a branch without correlating logs across services.
- `err.details.upstream` carries leads-service's structured rejection reason. For a `lms.check_*_fk_org_scope()` trigger RAISE (translated to a 404 by `translatePgError`), that is `{ constraint: 'fk_org_scope', field: '<column>' }` — e.g. `assigned_user_id` when auto-assignment picked a user the trigger's `iam.fn_actor_can_act_in_org` check rejects.

**Only field names cross the service boundary, never values.** The intake request body is a lead's name, phone, email and every Meta form answer, so the client deliberately does not echo the upstream body into the error message; `details` is safe precisely because leads-service builds it from a fixed list of column literals.

Note: the webhook still returns 200 after a per-lead failure, so Meta does not retry and the lead is not persisted anywhere — these log fields are currently the only record of it.

### Campaign discovery and typing

`ext.meta_campaigns` is the **single source of truth** for which type a Meta campaign carries, and meta-conversion-api owns it — it holds the Graph token and owns the whole `ext.*` schema. Rows arrive by two routes.

> **Superseded in 1.51.0** — see [Meta lead routing (1.51.0)](#meta-lead-routing-1510).

**From a lead (`first_seen_source='lead'`).** `campaign-mapping.service.ts::resolveCampaignType` runs on the webhook path inside the existing `withServiceTx` (an inbound Meta delivery carries no session — the same documented system operation as the two page/form resolvers), so every statement filters `tenant_id` explicitly rather than relying on RLS. A **hit** returns the row's type, `suggested` or `confirmed` alike: **routing never waits for a human.** A **miss** inserts the row typed by `marketing.fn_match_campaign_type` — `suggested` with the winning `matched_keyword` when a keyword fires, otherwise `unmapped` with the form default and then the tenant default, so the lead still routes somewhere sane while the row sits in the admin's "needs mapping" grid. The insert is `ON CONFLICT (meta_campaign_id) DO NOTHING` plus a re-select, for the same race that `ensureBranchCampaign` guards against.

**From the Fetch button (`first_seen_source='fetch'`).** `campaign-sync.service.ts` iterates `ext.meta_tenant_config.ad_account_ids`, cursor-paging `GET /act_<id>/campaigns`, and runs a three-way upsert per campaign in its own `withTenantConfigTx` — one transaction per campaign, so a single conflicting row cannot roll back the hundreds already written:

| existing row | what happens |
|---|---|
| none | insert, `first_seen_source='fetch'`, run the matcher |
| `mapping_status='confirmed'` | refresh `name` / `objective` / `effective_status` / `last_synced_at` **only** |
| `suggested` or `unmapped` | refresh metadata **and** re-run the matcher, since `match_keywords` may have improved |

**A confirmed mapping is never overwritten.** That is the product's explicit "works from next time onwards" guarantee and it is an invariant, not a preference: an inferred type is provisional, an admin's decision is not. `confirmed_by` and `confirmed_at` appear in neither the insert nor the update list — not touching a column is a stronger guarantee than writing it back to itself. `RETURNING (xmax = 0)` is what separates the insert arm from the update arm, which is what makes "a second run reports `0 inserted`" checkable at all; and since a freshly inserted row can never be `confirmed`, `xmax <> 0 AND mapping_status = 'confirmed'` is exactly "a confirmed mapping this fetch left alone".

**One Graph call per NEW campaign, never per lead.** The `ext.meta_campaigns` row is the cache — once it exists, no campaign-name lookup is ever made again. The remaining window is the one *before* the first row commits, when a new campaign goes live and a burst of leads all miss at once; an in-process LRU keyed on campaign id closes it by caching the in-flight **promise**, so concurrent callers share one request. A rejected lookup is evicted rather than cached, so a throttled call does not poison the next five minutes.

**A Graph failure never fails a lead.** `fetchCampaign` returns null instead of throwing, the resolution path is wrapped so that *any* error yields nulls, and the lead is created and routed from the form/tenant default with a `webhook.campaign_name_fetch_failed` warning and an `unmapped` row for the admin to fix. Dropping a real customer lead because a metadata lookup was rate-limited is strictly worse than a temporarily mistyped one.

**Retry and backoff.** `graphGet` retries on 429, 5xx, a dropped socket, and Meta's rate-limit error codes (4, 17, 32, 613, 80004) with exponential backoff and full jitter, and reads `X-Business-Use-Case-Usage` to slow itself *before* Meta blocks it. Permanent failures — #190 expired token, #200 missing `ads_read` — are deliberately **not** retried. `estimated_time_to_regain_access` is in *minutes* and is honoured only as a signal to wait the capped maximum, never literally: this runs from a button, and hanging an admin's request for an hour is not an option. A failing ad account is recorded in `errors` and the run continues; partial success is the honest answer for an operation spanning several accounts. The token needs **`ads_read`**.

For contrast, `msq-lms/meta-sync-scripts/common/graph_api.py` is a bare `requests.get` with a 15s timeout and no retry, backoff or 429 handling at all. That is survivable for a supervised CLI run someone watches and re-runs; it is not survivable for a button, and it is a warning rather than a template.

**Admin surface.** `campaign-admin.service.ts` is kept out of `campaign-mapping.service.ts` for the reason `page-org-map.service.ts` had to be split: the mapping module is the BYPASSRLS webhook path, while every admin operation is an authenticated super_admin acting on **one selected tenant** through `withTenantConfigTx`. All three routes require an explicit `?tenant_id=` and read `ctx.tenant_id` nowhere — platform staff administer a tenant other than their own, and a silent fallback is the exact bug removed from the page/form API one phase earlier. The list query carries **no literal `tenant_id` filter** on purpose: `admin_tenant_config_policy` is the scope, and a redundant filter would make the cross-tenant test pass whether or not the policy works.

`PATCH …?dry_run=true` returns the impact preview and **writes nothing** — not the mapping, not the learned keyword, not the reclassification. An admin checking what a correction would cost must be able to walk away having changed nothing. On a real confirm the mapping commits *first*, in its own transaction, and only then is leads-service asked to fan out: if the fan-out fails the mapping still stands and re-pressing Confirm retries it, whereas fanning out first would leave leads relabelled against a mapping that was never saved.

> **Superseded in 1.51.0** — see [Meta lead routing (1.51.0)](#meta-lead-routing-1510).

`learn_keyword` is opt-in per request. `HIR_Gurugram_Trainer_Sep26` offers `gurugram` as readily as `trainer`, and a wrong keyword silently mistypes every future campaign containing it — so the server proposes the longest unused token and the admin decides. The append is `array_append` guarded by a `NOT … = ANY(…)`, never a rewrite of the whole array, so two admins confirming different campaigns onto the same type cannot lose each other's keyword.

**Shared ad accounts.** `uq_meta_campaigns_campaign_id` is global, not per-tenant. A campaign already registered to tenant A therefore cannot be inserted for tenant B, and the conflicting row is invisible to B under RLS — Postgres answers with a `23505` or `42501`, which the engine reports per campaign as *"Campaign is already registered to a different tenant"* rather than failing the run or leaking whose row it is.

### Lead pull — the backfill for what the webhook missed

The webhook above is the live path, and it misses things: an integration that
was down, a page mapped late, a form nobody knew about. The only remedy used to
be a three-stage Python CLI (`download_page_leads.py` → `check_leads_against_db.py`
→ `import_downloaded_leads.py`) run by hand from a laptop against `output/<run>/`
CSVs. Schema 1.50.0 moves that into the console: a super admin picks orgs, pages
and campaigns plus a start date, pulls, sees what is genuinely missing versus
already present, and applies only the missing rows.

**Two Meta constraints this is designed *with*, not around.**

1. **There is no campaign-scoped lead edge.** Leads come
   page → `/{page-id}/leadgen_forms` → `/{form-id}/leads`, and `campaign_id` is
   only a *field* on each lead. So the campaign filter is **post-fetch** and
   narrowing campaigns cannot make a pull faster or cheaper. Both the campaigns
   endpoint and the run status say so explicitly, because otherwise the first
   thing an admin does is select one campaign, wait exactly as long as for all of
   them, and file a bug.
2. **Meta ignores the `time_created` filter** (observed; it is why the Python's
   `in_window()` re-filters every lead client-side). It is sent anyway as an
   optimisation and **always** re-applied locally — keeping leads whose
   `created_time` is unparseable rather than dropping them, because losing a real
   customer to a format surprise is worse than one extra row in a review grid.
   The newest-first early stop is kept too: once a *whole* page lands before
   `since`, nothing newer remains behind it, which is what keeps a bounded pull
   from crawling years of history.

**Page-first, not form-first.** `ext.meta_page_form_org_map`'s `form_id` list
goes stale the moment someone creates a new form, so a form-driven sync silently
stops seeing new leads — confirmed live, `ext.meta_leads` already holds form ids
with no mapping row. The engine asks each Page what forms it has *right now* and
pulls from all of them, mapped or not. An unmapped form's leads are staged with
`org_id IS NULL` and reported, never guessed into an org.

**Page access tokens are mandatory.** `/leadgen_forms` and `/{form-id}/leads`
accept a Page token only; the tenant-level token on `ext.meta_tenant_config` is a
User/System-User token both edges reject with Meta **#190**. `getManagedPageTokens`
resolves them via `GET /me/accounts` first. A selected page absent from that
result is counted as an error **with the reason** ("the Page moved to another
Business, or the token lost access") and skipped — never swallowed.

**The run row is the queue.** There is no job/queue infrastructure in this repo,
so `POST /runs` inserts `queued` and returns `run_id` in one fast transaction
(nothing rides on the gateway timeout) and `workers/pull-poller.ts` claims work
with `FOR UPDATE SKIP LOCKED`, following notifications-service's `followup-checker`
`setInterval` + `running` boolean pattern. Both guards are needed: the boolean
stops a tick landing on a slow one, and only SKIP LOCKED survives a second
replica. A **reaper** fails runs whose `heartbeat_at` (written per page) has gone
stale — without it a deploy mid-pull strands the run in `running` and the 409
guard locks that tenant out forever. See `docs/DB_model.md` for the tables.

**Apply reuses the canonical write path.** It calls `syncLeadToDatabase` — the
same function the webhook calls — once per importable row rather than writing
leads itself, so campaign typing, pool routing and every `ext.meta_lead_*` child
table come for free, and idempotency does too: that function re-checks
`ext.meta_leads.meta_lead_id` before acting *and* again inside its transaction,
**at apply time against live data** rather than against a staging snapshot that
may be hours old. Pressing Apply twice inserts nothing. Four of its behaviours
are handled explicitly by the caller: it takes no `tenant_id` (that travels in
`syncContext`), it **throws** on a missing phone and a non-numeric lead id (caught
**per row**, recorded as `applied_status='failed'`, never aborting the batch),
`isMetaTestLead` is exported but *not* called inside it (the caller applies it —
that gap is how 20 Lead Ads Testing Tool submissions once became real leads), and
its intake call sits between the two dedup checks, so rows are applied
sequentially under a single SKIP LOCKED claim rather than concurrently.

### Outbound flow (CRM → Meta CAPI) — "Conversion Leads" (schema 1.79.0)

The goal is **lead quality**: Meta learns from how a lead it generated progressed (contacted → qualified → converted) and shifts delivery toward people who resemble the good ones. This is Meta's *Conversions API for CRM / Conversion Leads* integration, not pixel-style web events.

**One Meta app, two system users, a dataset per ad account.**

- **One app** serves every tenant. Its webhook secret and verify token are the single shared (`tenant_id IS NULL`) row of `ext.meta_tenant_config`; the console edits it on *Meta Connection*. Page → tenant/org routing still comes from `ext.meta_page_form_org_map`.
- **Two platform system users** in `ext.meta_platform_credentials` (encrypted, one ACTIVE per purpose): `LEADS_READ` (pages, leads, ad accounts, campaigns — `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `ads_read`) and `CAPI_WRITE` (sends events to datasets — `ads_management`). A compromised events token cannot read leads, and vice versa. `integration.service.ts` overlays the active `LEADS_READ` token onto the integration row, so every existing Graph caller uses it unchanged; the row's own `access_token`/`pixel_id` (pre-1.79.0) are only a fallback until the credentials are entered.
- **A dataset (pixel) per ad account.** `ext.meta_business_portfolios` (owned by exactly one tenant — the brand is a tenant too) → `ext.meta_datasets` (composite FK `(tenant_id, portfolio_id)`, so a dataset can never sit under another tenant's portfolio) → `ext.meta_dataset_ad_accounts` (`UNIQUE ad_account_id`: an ad account feeds one dataset). `ext.meta_org_dataset_map` is a per-branch **fallback** only.
- **A lead reports to its ORIGIN's dataset, decided once.** At ingestion `lead-sync` records the campaign's ad account on `ext.meta_leads.ad_account_id` and, when a dataset resolves, snapshots `capi_dataset_id`/`capi_resolution`. `ext.fn_resolve_capi_dataset(tenant, org, ad_account)` is the single resolver (ad account → dataset, else the branch fallback; both pinned to the lead's tenant, `DISABLED` datasets never returned). A lead later transferred between branches or departments keeps its snapshot — signals still go to the pixel whose ad produced it. `org_id`/`department_id` ride on every outbox row for reporting but never decide routing.

**Transactional outbox.** `ext.meta_capi_outbox` is written **in the stage-change transaction**: `leads.repository.updateLead` calls `ext.fn_enqueue_capi_events(lead, stage, now, 'auto_stage_change', actor)` inside a SAVEPOINT (a failure to queue is logged and never blocks the rep's save). The function is `SECURITY DEFINER` and refuses a lead outside the org the transaction is pinned to. It: confirms the lead is a Meta lead (source `facebook`/`instagram`/`whatsapp` **and** a linked `ext.meta_leads` row, following `lms.lead_links` back through a cross-branch transfer); finds this tenant's event for the stage (`lead_stage_capi_event_map`); resolves the dataset; **queues the stages a jump skipped first** (Meta requires earlier stages to have been sent — reaching *Converted* enqueues *Lead, Contacted, Qualified* with strictly earlier times); and skips anything already in the outbox or the pre-outbox log. A lead with no resolvable dataset is **parked** (`SKIPPED_NO_DATASET`), not lost; `ext.fn_requeue_capi_skipped(tenant)` re-queues parked events after a dataset is linked. A Meta lead's first stage (*Lead*) is queued by `lead-sync` after ingest. `POST /capi/auto-trigger` (internal secret) remains as a door to the same function for an older leads-service image during a rollout.

**The worker** (`workers/capi-outbox.ts`, `services/capi-outbox.service.ts`) is a `setInterval` poller like the lead-pull poller (`META_CAPI_OUTBOX_INTERVAL_MS`, default 15 s). Each tick: expire rows past Meta's 7-day window; hand back rows stuck in `SENDING`; claim due rows `FOR UPDATE SKIP LOCKED` (an earlier funnel stage of the same lead still in flight or backing off holds a later one back); group by dataset and send whole leads per request (≤200 events) with `Authorization: Bearer`, `appsecret_proof` and `test_event_code` (while a dataset is in test mode). Outcomes: `SENT`; `FAILED` + backoff (1 min doubling to 1 h) for transient errors until `META_CAPI_OUTBOX_MAX_ATTEMPTS` (12) → `DEAD`; a request Meta rejects permanently is retried lead-by-lead so one bad event cannot hold back the rest; an access error (Graph #10/#102/#190/#200) marks the dataset `NO_ACCESS` and retries every 30 min without ever killing the row. Runs on `withServiceTx` (cross-tenant by nature) — isolation is that every row already carries the one dataset it may go to.

**Payload** (`capi-payload.builder.ts`): `user_data.lead_id` (the leadgen id, **as a string** — 17 digits exceed `Number.MAX_SAFE_INTEGER`), hashed `em`/`ph`/`fn`/`ln` arrays from the Meta record (not the CRM edit, so hashes keep matching) and `external_id`; `action_source: system_generated`; `custom_data.event_source = 'crm'` and `lead_event_source`; `event_time` is the **stage-change time** clamped into `[lead creation, now]`; `event_id = sha256(metaLeadId:eventName)` (unchanged from the old sender, so already-delivered events still de-duplicate). No `wa` field (not a Meta field).

**Event vocabulary.** `ext.meta_capi_event_types` is global; `funnel_rank` orders the sequence (Lead 10, ContactedLead 20, QualifiedLead 30, ConvertedLead 40) and `is_negative` marks `UnqualifiedLead` (sent when reached, never queued as a skipped stage). The old catch-all `Other` is retired (inactive). The stage → event map stays **per tenant** (`lead_stage_capi_event_map`), so each tenant defines its own funnel.

**Console (lookup-admin → Meta tabs):** *Connection* (app + the two system users: status, scopes, expiry, verify, rotate — secrets write-only), *Datasets* (portfolios, datasets, ad-account links, branch fallback, *Verify*), *Ad Accounts* (shows each account's dataset; filter *No Dataset*), *Page Mapping* (token + subscription + **leads access**; *Subscribe* per page), *CAPI Outbox* (tenant-scoped: counts, the *leads waiting for a dataset* worklist, retry / dismiss / re-queue, payload drawer). All super-admin only (gateway `withSuperAdmin` + a service-side `requireSuperAdmin`); the tenant-scoped ones run under `withTenantConfigTx` pinned to the administered tenant so RLS is the fence.

**Per-page onboarding** (each page must be shared to our portfolio with Leads access, assigned to the `LEADS_READ` system user, and subscribed to the app's `leadgen` webhook — *Page Mapping → Validate* shows which step is missing; *Subscribe* does the last one). Each dataset must be assigned to the `CAPI_WRITE` system user with *Manage dataset* and connected to the ad account that runs the ads (*Datasets → Verify* proves reachability; Meta's side of the ad-account link is checked in Events Manager). Click-to-WhatsApp / DM leads carry no leadgen id and are **out of scope** (they would need `ctwa_clid` and `business_messaging`).

**Limits worth knowing.** Meta rejects an `event_time` more than 7 days old; there is no documented cap on pages or datasets per app, but system users per portfolio depend on the app's access tier and the business's verification.

## Permissions

> **Stale since schema 1.40.0:** the per-product rank tables this section originally described
> (`lms.member_roles`/`hr.member_roles`/`task.member_roles`, each backing its own `*_RANKS` scale)
> were **dropped** — see `docs/DB_model.md` → "Retired: per-product role tables". Role/rank
> resolution now runs through the single `iam.user_roles` table (rank range widened to 0-1000,
> global anchors `read_only`=0 / `org_admin`=980 / `tenant_admin`=990 / `super_admin`=1000, with
> tenant-defined roles occupying ranks between them) via `iam.fn_user_org_role`. The `*_RANKS`
> constant objects in `@lms/authz`/`@hr/authz`/`@task/authz` may still exist as in-memory display
> scales, but they no longer read from a `<product>.member_roles` table — verify against current
> package source before relying on the specific numeric values below; they are left here as the
> last-known ladder pending a source-code re-check.

Since P1.3 there is no single global rank. Each product owns its own rank scale
(comparable only within that product), and `@platform/authz` keeps only the coarse
platform tiers. Rank is resolved **from the DB per request** (see JWT & auth above), never a header.

**Platform tiers** (`@platform/authz` `RANKS`; from `platform_role`): `member` 0 · `org_admin` 80 · `tenant_admin` 90 · `super_admin` 100.

**LMS** (`@lms/authz` `LMS_RANKS`, last known): read_only 0 · sales_representative 20 · senior_sales_executive 40 · org_manager 60 · org_sr_manager 70 · lms_admin 80.

**HR** (`@hr/authz` `HR_RANKS`, last known): hr_viewer 0 · hr_staff 40 · hr_manager 70 · hr_admin 80.

**Tasks** (`@task/authz` `TASK_RANKS`, last known): task_member 20 · task_lead 40 · task_admin 80.

Reach across branches splits in two since `1.76.0` (see *Capability walls* below). **Platform identity** — moving a user between branches, the branch switcher, the password-policy override — stays keyed on `platform_role` (`tenant_admin`/`super_admin`): a product rank tops out per-org at its admin tier and cannot express "sees every org in the tenant". **Product reach** — Leads History tiers, cross-branch analytics, the unassigned queue, the tenant-wide leave/attendance defaults, branch-vs-tenant API tokens — is a capability a tenant grants on the Capability Matrix.

**Leads History scope (`getLeadsHistoryAssignedToScope(actor)`, `@lms/authz`)** is the **widest rung held** on the `lms.history.view` ladder (`resolveScope`): `all` → `all`, `tenant` → `tenant`, `org` → `org`, and `own` (or no rung) → `none`, meaning only leads assigned to the caller. It used to be decided by `platform_role` and a per-tenant rank knob (`minRankForLeadsHistoryTeamScope`, SSE 40); `1.76.0` moved it onto the ladder and wrote the grants that reproduce the old behaviour (super_admin `all`, tenant_admin `tenant`, rank ≥ 40 `org`, everyone else `own`). There is no `team` rung: it was deleted because it never had a reach. `org` means **every branch the actor covers**, not one branch:

- The old `team` tier restricted managers to their `iam.reporting_lines` subtree inside a single branch; branch coverage replaced it, so a manager sees lead activity from people who do not report to them within their own branches.
- The leads *page* `view_scope` is a separate concept and remains subtree-based (`leads.repository.ts`); `LeadsHistoryScope` keeps its `team` member for it.

`can_assign_to(org_id, acting_user_id, target_user_id)` is a PostgreSQL function (3-param, SECURITY DEFINER). Admins and tenant_admins may assign within/across their org/tenant; everyone else is judged on the `lms.leads.assign.any/.peers/.reports` ladder against the target's rank.

**`org_id` must be the LEAD's org, not the caller's current branch.** The function looks up *both* parties' active mapping in the org it is given, so passing the caller's branch made every cross-branch assignment fail — a Wingman mapped to six branches could not hand a lead in one of their own branches to the rep who works there, because that rep holds no mapping in the branch the Wingman happened to be switched into. `follow-ups.repository` always resolved the lead's real org via `resolveLeadWriteScope`; `leads.repository.updateLead` passed `ctx.org_id` and has been corrected to match. Coverage remains the bound: an actor with no mapping in the lead's org fails on the function's first lookup.

### A denied parent silently kills its whole subtree

`iam.fn_role_capability_matrix` walks the `iam.capabilities` tree (tool → page → tab →
operation → scope) and hard-cascades an ancestor denial — `WHEN NOT w.granted THEN FALSE`.
A page node set to `is_granted = FALSE` therefore zeroes every operation and scope beneath
it, no matter what those child rows say. The stored grants and the effective permission
disagree, and the role editor shows the children ticked, so this is invisible until someone
reports a missing screen.

Seen in production on the tenant role `pre_sales_captain`, which denied `lms.users` and
`lms.assignments` while granting `lms.users.view`, `lms.users.view.team`,
`lms.assignments.view` and `lms.assignments.edit`. All four resolved FALSE, so `canOpenTeam`
and `canOpenAssignments` redirected the role away from both pages. Repaired by
`db_scripts/one_time/fix_pre_sales_captain_page_grants.sql`. **When granting an operation,
grant its ancestors too** — and when auditing a role, read
`iam.fn_role_capability_matrix(tenant)`, never `iam.role_capabilities` alone.
(The keys above are the ones that incident used; `lms.users*` is `admin.team*` since
`1.45.0` — see *Capability namespace split* below. The failure mode is unchanged, and the
namespace split is itself an instance of it: every role granted an `admin.*` child had to be
granted the `admin` tool in the same migration, or the child would have resolved to nothing.)

Note the asymmetry: a `page`/`tab` child with no explicit row *inherits* its parent
(`COALESCE(g.is_granted, w.nav_inherited)`), while an `operation`/`scope` child with no row
defaults to FALSE. An absent row and an explicit FALSE are not the same thing.

### UI gating reads capabilities, never a role-name list

Frontend gates must ask `can(actor, CAPABILITY.…)` from `@platform/rbac`. A literal list of
role names cannot work here: tenant-defined roles are created per tenant and no hardcoded
array will ever contain them, so the gate fails closed against exactly the roles a tenant
invented for itself.

`LeadDashboardShell` gated its assignee-candidate fetch on an `INLINE_ASSIGN_ROLES` array of
six built-in names. A Pre Sales Captain (a tenant role holding `lms.leads.assign`) matched
none of them, so no candidates were fetched and the "Assigned To" dropdown rendered empty —
while the identical `LeadEditModal` reached from Follow-ups was populated, because
`useLeadEditData` already asked the capability. Both now use
`can(actor, CAPABILITY.LMS_LEADS_ASSIGN)`.

This is advisory UI gating only, as always: `GET /users/assignable`, `iam.can_assign_to` and
RLS remain the enforcement boundary.

### Team is one shared module, scoped to the reporting line (`1.45.0`)

The people directory used to exist twice — `lms-web`'s Users and `admin-web`'s Team, forks of one
screen that had drifted (only one had export, only one had the password-policy override, they
disagreed about who could set a password). It is now a single module, `@platform/team-web`,
following `@hr/web`'s pattern: the package exports the page-level `TeamShell`, its capability
predicates and a server loader, and a host mounts it with a workspace dep, a `transpilePackages`
entry and a thin `page.tsx`. Mounted in admin-web (`/admin/dashboard/team`) and lookup-admin
(`/sa/dashboard/users`, tenant-scoped — see below); lms-web's `/dashboard/users` redirects to the
admin-web mount and its `/dashboard/team` stays a `Placeholder`.

**Super admin: another tenant's users, by explicit scope (lookup-admin `/sa/dashboard/users`).**
lookup-admin's scope is the **session**: the same tenant/branch `BranchSwitcher` every tool's navbar
renders. It used to run a separate SA-only Tenant / Org selection (cookies `msq_admin_tenant_id` /
`msq_admin_org_id`, dropdowns passed as `scopeSlot`), so the SA console and the product apps could
silently sit in two different tenants; those dropdowns and cookies are gone. `src/lib/tenant-scope.ts`
now answers `getSelectedTenantId()` = the session's `tenant_id` and `getSelectedOrgId()` = the
session's `org_id`, or `undefined` when the session is "All branches" (`all_branches`) — every SA
page already read the scope through those two helpers, so no page changed. **Every tenant-scoped SA
screen names its tenant** (2026-10-06): `getSelectedTenantName()` is the third helper (`session.tenant_name`
off the same request-cached `/auth/me`, so it always agrees with the id across a cross-tenant switch), and
each screen passes it to `PageHeader`'s `scope` prop, which renders it as a chip beside the heading. This
exists because login re-mints the session into the user's **home** tenant: a super admin who switched
tenant, edited a catalog and logged back in was looking at a different tenant's rows, which is
indistinguishable from an edit that failed to save unless the page says whose data it is. The chip is
omitted where there is no tenant to name — the "Pick a tenant" empty states, platform-scoped
`lookups/[table]` entries, and the Lead Inbox's tenant-less rows. Branch-level lookups
(Designations, Holidays, Shifts, Holiday Calendars) ask for a branch when the session is on "All
branches"; platform pages (Tenants, Org Types, Catalogs, Plans) ignore it. The super-admin-only APIs
still take an explicit, server-validated `tenant_id` / `org_id` — only its source moved. The Users
screen used to ignore the scope entirely — `GET /users` read only the session tenant. It now mounts
`@platform/team-web`'s `TeamShell` (People) plus a read-only **Reporting lines** view inside a
`UserAdminScopeProvider` (`@platform/ui-kit`), and every users call names the selected tenant:

- **identity-service** takes an optional `tenant_id` on every `/users*` route (query param, DELETE
  included; body schemas unchanged). `resolveTargetScope` honours it for `super_admin` **only**
  and checks the tenant exists; anyone else gets their session tenant regardless. An `org_id` must
  sit inside the resolved tenant for **every** actor (400 otherwise).
- **`scopeContext`** re-points the request context at that tenant (and branch) so catalogs, manager
  candidates, assignable users, weights, create and update run against it unchanged. It rewrites
  **only** a super admin's context: for every other role `ctx.org_id` is the
  `app.current_org_id` their RLS keys on, and re-pointing it would hand them another branch's rows.
  A super admin working a tenant other than its session's must name a branch where the route
  would otherwise fall back to "the caller's branch" (weights, manager candidates, team, org chart),
  and may not use the legacy `role_name`-only create (it lands in the caller's own branch).
- **By-id fences.** `super_admin` runs on the unrestricted service connection, and the org-mapping
  routes use the service connection for everyone, so no RLS policy fenced them to a tenant. Every
  by-id route (`GET/PATCH/DELETE /users/:id`, reset-password, org-mappings list/add/remove) now
  asserts the target user belongs to the resolved tenant (home branch or any mapping) and 404s
  otherwise; org-mappings list drops rows from other tenants; remove also checks the branch.
  Before this, `GET /users?org_id=` read any tenant's branch, and a tenant admin could list or
  revoke another tenant's user's mappings by id.
- **UI.** `UserAdminScopeProvider` is set by lookup-admin alone; the shared users resource, the
  UserForm hooks (`useRoleCatalog`, `useCampaignTypeCatalog`, `ManagerSelect`, `useWeightStatus`)
  and team-web's modals read it and append `tenant_id`. No provider (admin-web, lms-web) means no
  param and unchanged behaviour. `loadTeamData(cookie, scope, { tenantId, orgId })` reads the
  roster for that tenant and its branches from `/lookups/organizations`. A new user starts in the
  selected branch (or the tenant's first) instead of the super admin's own.

**The roster follows the org chart, not the rank ladder.** `GET /users` previously scoped by
branch or tenant and then filtered `ur.rank < actorRank` — "everyone below me in my branch", which
is not the same thing as "my team": a manager saw their peers' reports, and a manager with no
reports saw a full branch roster. It now takes `scope=reports|org|tenant`:

| scope | source | rank band |
|---|---|---|
| `reports` | joins `iam.vw_user_team_members` (the actor's subtree at any depth) | `ur.rank <= actorRank` |
| `org` | the actor's branch | `ur.rank < actorRank` |
| `tenant` | every branch in the tenant | `ur.rank < actorRank` |

The subtree was already there and unused by this screen: `iam.reporting_lines` is the hierarchy,
`iam.fn_subtree_members` walks it, and `iam.vw_user_team_members` wraps that with the user/role
joins and a `depth`. (`iam.users.manager_id` is a display mirror — its own trigger comment says
never to read it for authority.) Note `getTeamMembers` is **not** a substitute: it hard-filters
`org_id = ctx.org_id`, so a multi-branch manager's reports elsewhere are invisible to it.

The band relaxing to `<=` under `reports` only is deliberate and worth not "fixing": inside the
subtree, membership is the authority for whom the actor may act on, and `canManageUser` has always
permitted a peer at the same rank — so a same-rank direct report should be visible and manageable.
The branch and tenant scopes keep the strict `<`, so no existing admin's view changed.

Scope is resolved **server-side** from the actor's `admin.team.view.*` rung
(`resolveScope`), with `canSeeOrgFilter` as the platform-tier half because tenant_admin holds no
`admin.team.view.*` scope at all. The default is the WIDEST rung held, so admins saw no change on
deploy. A client may only narrow: a requested scope above what the actor holds is silently
downgraded, and the response echoes the scope actually run so the switcher cannot mislabel what is
on screen.

**Departments give no isolation.** A user has no department; it reaches them through the role
(`iam.user_roles.department_id`) and is a UI filter over the role dropdown. A sales manager sees
their sales subtree because those people report to them — so if a fitness trainer's reporting line
points at a sales manager, that manager sees them. Correct, but it means the feature is only as
good as the reporting-line data: where `iam.reporting_lines` is sparse, `reports` is an empty
screen.

### Capability namespace split: `admin.*` is the tenant console (`1.45.0`)

Two consoles with confusingly similar names, and the namespace belonged to the wrong one.

| console | origin | port | what it is |
|---|---|---|---|
| `lookup-admin` | `/sa` (`ADMIN_URL`) | 3005 | the **platform operator** console — cross-tenant lookups, role/grant definition |
| `admin-web` | `/admin` (`ADMIN_WEB_URL`) | 3004 | the **tenant admin** console — Team, API tokens, Leave, Attendance |

`admin.*` belonged to lookup-admin and was never assignable to a tenant role: admin-service's
`putGrants` refuses it below `super_admin`, because `admin.roles.manage` **defines capability
grants** — holding it means being able to grant yourself anything. Meanwhile admin-web, which
tenants actually use, had **no namespace at all**: Team borrowed `platform.write` for its nav
entry and sat behind a `rank >= ORG_ADMIN` floor on the whole console, so its screens could not
be delegated by permission. A role granted the directory capability still could not reach it.

The split gives each console its own root:

- **`superadmin.*`** — the operator keys, unchanged in meaning (`superadmin.lookups`,
  `superadmin.lookups.manage`, `superadmin.roles.manage`). `@platform/rbac`'s
  `isSuperAdminCapability()` (was `isPlatformAdminCapability`) is the shared prefix test that
  `putGrants` and the Capability Matrix both call. The matrix now **hides** that subtree for a
  role that cannot hold it rather than rendering it locked — a visible control invites the click,
  and the one beneath it hands out the ability to grant anything. The hide is an affordance; the
  server-side refusal remains the boundary and was not relaxed.
- **`admin.*`** — the tenant console, freely assignable like any product tool, holding
  `admin.team` (was `lms.users` — the directory manages fitness, HR-only and every other user,
  and is mounted outside the CRM) and `admin.api_tokens` (was `platform.api_tokens` — a console
  screen, so it sits with the console's others).
- **`platform.*`** keeps only `platform.write`. The dividing line: `admin.*` is a console's
  screens, `platform.*` is behaviour that applies everywhere regardless of console.
  `platform.write` must **not** move — it decides whether an account can write at all, in every
  app, and as `admin.write` every role needing to write anything would also need the `admin`
  tool, putting the console in everyone's nav.

Renames, not aliases, following `platform.api_tokens`' own move out of `lms.apiclients*`: exactly
one name per capability, the old key stays gone.

**One deny did not survive the move.** Grants are repointed with `is_granted` carried through
unchanged, because an explicit `FALSE` is a deny and losing one silently *grants* access. That
holds for operations and scopes. It does **not** hold for the page node: a `lms.users` deny meant
"hide the Users page from the CRM sidebar", and tenants set them freely — they were never the gate
on admin-web's Team, which ran on rank + `platform.write`. Carried onto `admin.team` they hard-prune
the subtree, and on UAT that left `tenant_admin` and `org_admin` unable to open Team in either
tenant (and `super_admin` locked out in one) while their `admin.team.view`/`.manage` rows all read
as granted — the *stored grants disagree with effective permission* failure again. The migration
now drops page-level denies, which cannot widen access because opening Team still requires an
affirmative `admin.team.view` grant plus a scope; `fix_admin_team_page_denies.sql` repairs a
database migrated before that correction.

**The coupling that makes this delicate.** `iam.fn_user_can_manage_users` resolves its capability
key *by name*, and the write policies in the section below call it. Move the grants without the
function, or the reverse, and every tenant-defined role loses the ability to write users — so
`db_scripts/one_time/apply_capability_namespace_split.sql` does the whole thing in one
transaction. The function short-circuits `super_admin`/`tenant_admin`/`org_admin` to TRUE before
the lookup, so anchor roles are never at risk — **and therefore prove nothing**: only a
tenant-defined role below rank 980 holding `admin.team.manage` can verify the migration.

Two further rules the migration encodes. Grants are repointed by capability id with `is_granted`
carried through **unchanged**, because an explicit `FALSE` is a deny and losing one silently
*grants* access. And every role receiving an `admin.*` child is granted the `admin` tool in the
same statement — without it the child resolves to nothing, the failure documented under
*Denying a page prunes its subtree* above.

With the namespace in place, admin-web's rank floor became a capability question: the console
opens if `filterNavGroups(ADMIN_NAV, session)` returns anything, so a `senior_sales_executive`
granted `admin.team.view.team` gets in and sees only Team.

The cross-product **"Admin" pill** in `AppNavbar` (the LMS/HRMS switcher row) was still gated on
`rank >= ANCHOR_RANK.ORG_ADMIN`, so that same user could reach the console only by typing its
URL — the pill never appeared. It now uses `canOpenAdminConsole(actor)` from `@platform/rbac`
(holds any `admin.*` capability), the shell-side equivalent of the `filterNavGroups` guard, so
the affordance and the guard admit the same people.

### The "SA" pill: lookup-admin joins the switcher row

`lookup-admin` (`/sa`) was reachable only by typing its URL, and once there a super admin had no
way back out to any product — the console rendered no switcher at all. It now appears as an **"SA"
pill** in the same unified group as LMS / HRMS / Tasks / Admin, on every app, and carries the full
switcher itself so the hop works in both directions.

Like Admin, SA is **not a product**. It stays out of `productOrigins()`, `usableProducts()` and
`PRODUCT_LANDING`, riding in through `ProductSwitcher`'s `extraLinks` instead, so it can never be
chosen as a post-login landing target by `sessionDestination()` nor compete for the active chip.
Its URL is `adminOrigin()` (`ADMIN_URL`), newly re-exported from `@platform/ui-kit`'s main barrel —
it was previously reachable only from the `/middleware` entrypoint, which Server Components do not
import. An unset `ADMIN_URL` hides the pill outright.

The gate is **`canOpenLookupAdmin(actor)`** in `@platform/rbac`: `superadmin.lookups.manage` **and**
`rank >= SUPER_ADMIN`. That pair already existed, inlined in lookup-admin's own dashboard layout;
it moved into the shared package precisely because a second caller appeared. The pill and the
console must ask one question, or the pill renders a link into the console's own "Access
restricted" page — the render-then-403 shape the capability tree exists to remove. The rank half
is not belt-and-braces: admin-service re-checks `rank >= SUPER_ADMIN` on every route behind the
console independently of any capability, so the capability alone was only ever enough to make the
console *open*, never to make it *work*.

Sizing note: `ProductSwitcher`'s grid is capped at 5 columns, which is now exactly the full set
(LMS + HRMS + Tasks + Admin + SA). A sixth pill requires raising that cap or it wraps on mobile.

### One navbar for all five apps

`AppNavbar` (`@platform/ui-kit/shell`) is now the **only** header. LMS / HRMS / Tasks always used
it; `admin-web` and `lookup-admin` each hand-rolled their own, and that is precisely why the pill
row broke on a phone: `AppNavbar` mounts `ProductSwitcher` **twice** — inline inside a
`hidden … sm:flex` wrapper, and again in a `sm:hidden` full-width second row under the bar — while
the consoles mounted it once, inline, at every breakpoint. `ProductSwitcher`'s root is
`w-full sm:w-auto` around the 5-column grid, so inside a console's single non-wrapping flex row it
was pushed off the right edge of the screen. The PWA's `viewport-fit=cover` + safe-area padding
narrows the usable width further, making it worse on an installed app than in the browser.

Two props let the consoles drop their copies:

- **`activeExtra: 'admin' | 'sa'`** — says *this app is that console*. The pill gets the
  current-page treatment and points at `homeHref` instead of the cross-origin URL. It cannot be
  expressed as `activeProduct` (which is now optional) because neither console is a licensed
  product — see the two sections above. No capability check is applied on this arm: the console's
  own layout already ran the identical guard to render the page at all.
- **`scopeSlot`** — the same slot contract as the LMS-only `notificationSlot`, for a host whose
  scope is NOT the session. No host passes one today (lookup-admin moved to the session switcher);
  the contract is kept for such a console. It renders inline on `sm:+` and in the mobile second row
  below, where the selects go full-width (`w-full sm:w-[200px]`) instead of a fixed 200px that
  would overflow. Passing a `scopeSlot` also hides `BranchSwitcher` — the slot is that console's
  scope, and the actor's session branch is not.
- **`filterSlot`** — a page filter placed immediately after the branch pill (inline on `sm:+`,
  mobile second row below). lms-web passes `LeadTypeFilter` (`@lms/web`), the Leads page "Type"
  filter, which renders `null` off `/dashboard/leads` and for anyone without
  `lms.leads.view.all_types`; its selection travels to `LeadDashboardShell` as `?types=<id,id>`.
  Because it may render nothing, the mobile row counts it through
  `has-[nav,[data-slot=filter]:not(:empty)]` rather than unconditionally.

The mobile strip's `has-[nav]:border-t` trick — which collapses it to zero height when
`ProductSwitcher` returns `null` for a single-product user — does not apply when a `scopeSlot` is
passed, since that always renders; `AppNavbar` swaps to an unconditional border/padding in that
case. Both consoles also gained the FitClass logo (a copy of `fitclass-emblem.png` now sits in
each app's `public/`, as `lms-web` already did), the branch pill (admin-web only — see `scopeSlot`
above), and a sticky header.

#### The active chip needs `withBasePath()`

`ProductSwitcher` renders raw `<a>` elements because most of its chips are cross-origin. Next
applies `basePath` to `<Link>`, router navigation and `/_next/*` — **never to a raw anchor** — so
the ACTIVE chip, which is the only same-app link in the group, must go through `withBasePath()`.
Un-prefixed, `/attendance` resolves against the origin root, which under the single-origin topology
is auth-web, and 404s. That was a live bug: clicking HRMS while already on HR sent the user to
`https://<host>/attendance`. The rule now lives in one place, `productHref()` in
`shell/products.ts`, whose two arms are deliberately asymmetric — inactive concatenates
`origins[p]` (the prefix is already in the base URL), active prefixes the landing path. Extra links
(Admin/SA) run through `withBasePath()` directly, which returns an absolute URL untouched, so only
the active console's own `homeHref` is affected.

The same rule applies to `AppErrorBoundary`'s "Back to …" button, which each app feeds an
app-relative `homeHref`. Its sibling "Sign in again" anchor stays `href="/"` un-prefixed on
purpose: that root is auth-web, which resolves the session and redirects.

### User management is a capability, per branch (`1.43.0`)

Creating a user is authorized by **`admin.team.manage`, evaluated against the target branch** — not by a rank floor and not by the session's `org_id`. (The key was `lms.users.manage` until `1.45.0`; the mechanism below is unchanged.)

Before `1.43.0` four layers gated one `POST /users` and disagreed with each other: the UI showed the button to whoever held the capability, identity-service required `rank >= 40`, the service layer required `platform_role` ∈ {`tenant_admin`, `super_admin`} to touch any branch but the session's, and the RLS policies underneath required `iam.fn_user_org_rank(...) >= 980`. Granting `lms.users.manage` to a tenant-defined role was therefore inert — the request passed every application gate and the `iam.user_org_mapping` INSERT was refused by the database, surfacing as *"You do not have permission to grant access in this organisation."* The only way to delegate user creation was to hand out `org_admin`.

`iam.fn_user_can_manage_users(user_id, org_id)` is now the single predicate. It resolves the actor's **effective role in that org** via `iam.fn_user_org_role`, then the grant via `iam.fn_role_capability_matrix` — the same function `@platform/db`'s capability cache reads, so SQL and application code apply tenant-override precedence and ancestor pruning identically and cannot disagree about a grant. It returns `TRUE` unconditionally for `org_admin`/`tenant_admin`/`super_admin`, so nothing that worked before stopped working.

Five write policies moved onto it, each testing **the row's** `org_id` against `iam.fn_user_active_orgs(actor)` rather than `app.current_org_id`:

| Table | Policies |
|---|---|
| `iam.user_org_mapping` | `org_admin_read_policy`, `org_admin_insert_policy`, `org_admin_update_policy` |
| `iam.users` | `users_org_write` (INSERT) |
| `iam.reporting_lines` | `org_admin_manage_policy` (a create supplying `manager_id` writes here too) |

That second half is what makes **multi-branch** administration work. Membership is many-to-many, so an actor mapped into three branches now administers users in all three; previously they could only act in whichever branch they had switched into. Tenancy is unchanged — every org in `fn_user_active_orgs` is one the actor holds a mapping row for, and `tenant_isolation_policy` still fences the `tenant_admin` pool.

Rank did not go away; it answers a different question. `canGrantRole` / `canManageUser` still stop an admin granting a role above their own or editing someone senior to them. Rank stopped answering *"may you manage users at all"*, which is a capability question.

`users_org_update` on `iam.users` deliberately keeps the narrower `org_id = current_org_id` rule — editing an existing user across branches is a separate change.

The branch picker follows the same rule: tenant-wide actors choose from `GET /orgs/all`, everyone else from `GET /auth/my-orgs` (their own mapping rows), merged by `branchOptionsForActor` in `@platform/ui-kit`.

Existing databases: `db_scripts/one_time/apply_user_create_capability_authz.sql` (with a `_dryrun` that reports which roles gain the ability, and an `_ON_SERVER.sh` for UAT/prod).

### Emailing the affected user on a Team action (`admin.team.notify`, `1.46.0`)

Creating a user, resetting a password, or moving someone between branches from the **Team** modals can now email that person directly. Each modal carries a **"Notify user by email"** checkbox, ticked by default; unticking it skips the send.

- **Gate**: a new operation capability `admin.team.notify` under `admin.team`. `identity-service`'s `users.controller` computes `notify = checkbox-not-unticked AND hasCapability(admin.team.notify)` and passes it to the service. The capability is authoritative for **every** role — anchor roles included, no `rank ≥ org_admin` short-circuit — because `admin.team.notify` ships with a per-tenant back-fill pinned to `admin.team.manage` (`03_roles_and_grants.sql`), so every role that can manage the team already holds it, and a tenant that unticks it in the Capability Matrix (`is_granted = FALSE`) genuinely turns the emails off. The checkbox is hidden in the UI (`canNotifyUser` in `team-web`) when the actor lacks the grant, but the controller is the real enforcement: a forged `send_email_notification: true` from a role without the capability sends nothing. This is **authorization for an outbound notification only** — unlike `admin.team.manage` it has no `iam.fn_user_can_manage_users` / RLS coupling and touches no write path, so removing the short-circuit can never lock anyone out (worst case: an email not sent).
- **Transport**: `users.service` calls `lib/communication-service-client.ts` → `communication-service` `POST /api/v1/communications/public-send` with `X-Internal-Secret` (the gateway no longer exposes the direct `/communications/{email,whatsapp,send}` routes at all; only `/communications/status` and the API-key `/public/v1/communications/send` remain — the controller already authorized). The call is **fire-and-forget**, same posture as `logActivity`: a mail failure only `console.error`s, it never fails the admin's request, and the temporary password is still returned in the HTTP response for manual relay. Bodies are built inline in `api/v1/users/user-emails.ts` (no `comms.message_templates` renderer yet).
- **Content**: account-created (login URL + temp password), password-reset (temp password included only when system-generated — never when the admin typed a specific one), branch-changed (added/removed branch names + new home branch). `APP_NAME` / `AUTH_URL` drive the product name and sign-in link.

Existing databases: `db_scripts/one_time/apply_admin_team_notify_capability.sql` (+ `_dryrun`).

### Team create/edit keeps the member's HR profile in step (`hr.employee_profiles`)

Every HRMS attendance, leave-accrual and Employees screen (the HRMS left-nav **Employees** page since 1.56.0; formerly Leave Administration → Employees) reads `hr.employee_profiles`, but until this change nothing in the product wrote it — the Team panel wrote only `iam.*`, and `POST /hr/employees` had no UI caller — so every member added after the 2026-08 seed/backfill was invisible to HR.

- **Flow**: after identity-service's own writes for `POST /users` and `PATCH /users/:id`, `users.service#syncHrProfile` calls `lib/hr-service-client.ts` → hr-service `POST /api/v1/internal/employees/sync` with `X-Internal-Secret`, body `{ user_id, tenant_id, home_org_id, is_active, date_of_joining?, actor_id }`. `tenant_id` is resolved from the home branch (`getTenantIdForOrg`), `actor_id` from the verified session — never from the browser. The route is **not** in the api-gateway allowlist (it is `EXEMPT` in hr-service's gateway-route-coverage test).
- **Upsert (hr-service `internal.repository`)**: idempotent. Verifies the branch belongs to the tenant and the user holds an active mapping there, then creates the profile (joining date from the Add member form, default today) or re-files `org_id` to the home branch and mirrors `is_active`. It runs on the `tenant_admin` Postgres path (`tenantWide`), **not** `withServiceTx` — a home-branch move rewrites a row in another branch, which `org_isolation_policy` would hide, while `tenant_isolation_policy` still fences reads and `WITH CHECK` to the one tenant. Joining date, code, department, designation and weekly-off are **HR-owned** after creation (HRMS → Employees, `PATCH /hr/employees/:userId`) and never overwritten. A profile HR soft-deleted is reported (`outcome: 'deleted'`), not resurrected.
- **Not atomic, by design**: it has to run after identity commits (hr-service checks the mapping on its own connection). A failure never rolls back the identity change; the response carries `hr_profile_synced: false` (`PATCH /users/:id` now returns `200 { success, data: { hr_profile_synced } }` instead of `204`) and the Team modals show an amber notice. Re-saving retries; `db_scripts/one_time/backfill_hr_employee_profiles.sql` remains the bulk repair.
- **Manager field**: the leave approver chain walks `iam.reporting_lines`, so the Edit modal must not rewrite the line by accident. `ManagerSelect` only clears a selection once candidates for the *current* branch have loaded **and** the home branch has moved (`shouldClearManager`); the modal sends `manager_id` only when it changed or home moved. Previously the clear effect ran against the not-yet-loaded list, blanked the manager on open, and Save closed the reporting line — sending that user's leave approvals to the org-admin fallback.

### HRMS left nav: Employees and Reports (`1.56.0`)

hr-web's `HR_NAV` is **Attendance · Leave · Employees · Reports**, each filtered by `filterNav` on its own capability node and each route guarded by the same predicate its service uses:

| Entry | Route | Nav capability | Page guard (`@hr/authz`) | Was |
|---|---|---|---|---|
| Employees | `/hrms/employees` | `hr.employees.view` (operation, `exact`) | `canViewEmployees` (`hr.employees.view`); Edit column only with `canManageEmployees` | Leave Administration → Employees tab |
| Reports | `/hrms/reports` | `hr.reports.attendance.view` (operation, `exact`) | `canViewAttendanceReports` (`hr.reports.attendance.view`) | Attendance Administration → Reports tab (`hr.attendance.admin.reports`, now deactivated) |

The tabs were **moved, not duplicated**: Attendance Administration is Rules · Shifts · Assignments · Exceptions and Leave Administration is Policies · Leave cycle · Holidays · Adjustment, wherever those shells render (admin-web and the hr-web redirects). Employees opens when either the `leave` or `attendance` module is enabled (`HrModuleShell` takes a module list); Reports follows the `attendance` module.

### HRMS Stitch redesign — H0 foundation (branch `hrms-stitch-redesign`, uncommitted)

Plan: `C:\Users\ni3gi\.claude\plans\i-have-a-project-greedy-platypus.md` (Stitch project "HRMS" 7964813948240899929; phases H0–H6). H0 is no-feature groundwork:

- `HrModuleShell` passes `mobileTabs={HR_MOBILE_TABS}` (`apps/hr-web/src/config/navigation.ts`) — today Attendance · Leave · Employees · Reports, ids only. Home / Payroll / Team tabs are added by the phase that creates each route, never before.
- `packages/hr-web/src/lib/ui.ts` (shared field/label/empty-state classes) moved from hex to theme tokens, so tenant brand colour and appearance reach every form control that uses it. Screens still on inline hex are migrated as each is re-skinned (H1); HR keeps dark mode off until none remain.
- Branding: nav renaming already works for HR ids (`BRANDABLE_NAV`); HR `<Term>` keys are deferred until H1 touches the screens that use them.

**H1 (re-skin, no schema change).** All 44 hr-web files that carried hex / `slate-*` / palette classes now use theme tokens (a scripted, reviewed migration; status maps in `lib/attendance/format.ts` and `lib/leave/format.ts` use `var(--color-status-*)` / `--color-cat-*` for the calendar dots). New/changed screens: the Today card is the brand punch hero (`bg-primary-container`, live working-time counter from real punches, amber check-out), `MonthSummaryStrip` (worked / present / late / needs-attention from the loaded month), `RegularizationStats` (pending + approved-this-quarter from the employee's own list — the design's "compliance %" is intentionally not built, no policy target exists), team day KPI tiles + filter chips, leave balance ring (`BalanceCards`), approvals as cards, directory search + department filter, and phone card layouts for every table that previously scrolled sideways.

**H2a (no schema change).**
- `POST /hr/leave/requests/bulk-decision` (hr-service `leave.bulkDecide`; gateway route added). Body `{request_ids[1..100], decision: approve|reject, comment}` (comment required for reject). The controller checks `hr.leave.approve` / `hr.leave.reject` for the chosen decision; every request then runs through the SAME `approveLeave`/`rejectLeave` path as a single decision, so scope, the approval chain and notifications are unchanged. Not atomic by design: a failing request is skipped and reported with its `AppError` message (an unexpected error is logged server-side and reported generically). No new capability was needed.
- `/dashboard` is the HR home (landing `/` redirects here; nav id `dashboard`, renameable via `BRANDABLE_NAV`). It composes existing endpoints (`useTodayAttendance`, balances, holidays, pending-approvals count) rather than a new aggregate endpoint; punching hands off to `/attendance`. Blocks render only for the capabilities that back them. Announcements/activity arrive with H6.

**H2b — comp-off (schema `1.59.0`).** New `hr.comp_off_claims` (one live claim per user + worked date; RLS = org + tenant + self policy; decisions run in the service transaction). Flow: `POST /hr/leave/comp-off` (cap `hr.leave.comp_off.request`) → server checks the date against the claimant's own roster (weekly off or mandatory holiday, not future, ≤ 60 days back — `lib/leave/comp-off.ts`, pure and unit-tested) → level-1 approver resolved through the existing leave chain (`resolveApprovers`) → `GET /hr/leave/comp-off/queue` + `POST …/:id/approve|reject` (cap `hr.leave.comp_off.approve`; the assigned approver or a leave admin, never the claimant — same `hr.can_approve_leave` check as leave) → approval writes a `hr.leave_ledger` credit (`adjustment`, "Comp-off credit") on the tenant's `comp_off` leave type (already seeded for every tenant) and stamps `expires_on` = approval + 90 days. Spending a comp-off day is an ordinary leave request on that type. The daily `pnpm --filter hr-service lapse-comp-off` job writes a `lapse` entry once expired, capped at the remaining balance (`lapseAmount`) so it never goes negative, and stamps `lapsed_at` (idempotent). UI: "Claim comp-off" + "Comp-off claims" on `/leave`, a "Comp-off claims" queue on `/leave/approvals`. Not built: encashment, leave-approval SLA and "request more info" (deferred — they need policy fields and a new request state), a per-tenant expiry setting (fixed 90 days), and notifications for comp-off events (the notification pathway carries leave events only).

**H3 - Employee 360 + My profile (schema `1.60.0`).** New `hr.employee_personal`, `hr.emergency_contacts`, `hr.employee_notes`. **Privacy shape (deliberately not the usual org-wide policy):** everyone in an org may read the employee directory, but a colleague's date of birth, address and emergency contacts are not theirs to read, so the personal and contacts tables carry only a *self* policy for `app_user` plus a `tenant_admin` policy, and `employee_notes` has no `app_user` policy at all. Self routes (`/hr/profile/me...`, cap `hr.employees.profile.edit`) run in `withRoleTx`, so the database itself pins every statement to the caller's rows; the id is never taken from the request. HR reads another person through `GET /hr/employees/:userId/profile-360` (cap `hr.employees.profile360.view`, service transaction, the target must be in the caller's org else *not found*; opening it writes an `employee_360_viewed` audit row; HR notes are returned only with `hr.employees.notes.manage`) and adds timeline notes with `POST /hr/employees/:userId/notes`. UI: `/profile` (personal form + emergency-contact CRUD, nav id `profile`) and `/employees/[userId]` (hero + Overview / Leave / HR notes; directory names link there for holders of the capability). Verified directly in the database: as `app_user` an employee sees exactly their own personal and contact rows, zero notes, and cannot update a colleague's row. **Not built, on purpose:** statutory identifiers and bank details (PAN, Aadhaar, UAN, account number) and profile-change requests; they need an encryption-key decision (where the key lives, who may reveal, rotation) that has not been made, so no column exists yet. Also deferred: the Employee 360 attendance tab (use Reports), assets, documents.

**H4 - team roster + peer shift swap (schema `1.61.0`).** New `hr.shift_swap_requests` (status `pending_peer -> pending_manager -> approved | rejected`, or `declined` / `cancelled`). `GET /hr/attendance/roster?from=` (cap `hr.attendance.roster.view`) returns a Monday-to-Sunday grid per person (shift, weekly off, holiday, approved leave) for the caller's team - people they manage plus those sharing their manager - or the whole branch for holders of `hr.attendance.admin`. Swap flow (`/hr/attendance/swaps...`, caps `hr.attendance.swap.request` / `swap.approve`): the requester picks a teammate and a FUTURE day; the shifts are read server-side from both rosters (never the client), and `lib/attendance/swap.ts` (pure, 17 tests) refuses unless both are rostered to work (no weekly off / holiday / approved leave), the shifts differ and an 11-hour rest gap holds on both sides of the day for BOTH people. The peer accepts or declines; the level-1 approver (leave chain) or an attendance admin decides, never a participant. Approval re-checks the rules against today's rosters, then for each person shrinks (or soft-deletes) the assignment covering the day, inserts a one-day row with the other shift and a continuation row - rows only touch end to end, so `excl_shift_assignments_no_overlap` holds. Future days only, so no attendance day is resolved and no recompute is needed. **Privacy:** only the requester, peer and approver can read a swap (participant policy, no org-wide policy); writes are service-transaction only, org-fenced, foreign ids answer "not found". UI: `/team` (nav id `team`, phone tab) with the week grid (phone: card per person), "Waiting for your answer", approver queue and "My swaps". Not built: notifications for swap events (the notification pathway carries leave events only), org chart, per-tenant rest-gap setting (fixed 11h).

**H5 - payslip viewer + payroll month lock (schema `1.62.0`).** NOT a payroll engine: no PF/ESI/PT/TDS, salary structures, bank file or Form 16. HR types each employee's lines, the service totals them in whole paise (`lib/payroll/payroll.ts`, tested), and HR publishes. New `hr.pay_periods` (one row per org + month; absent = open), `hr.payslips`, `hr.payslip_lines`. **Privacy:** salary has NO org-wide policy: an employee reads only their own payslip and only once `published_at` is set (self policy; lines are readable exactly when their payslip is), so the database enforces "your own, once published" independently of the code; HR works through the service transaction behind `hr.reports.payroll.manage`. Routes (`/hr/payroll/...`): own list/detail (cap `hr.employees.payslip.view`, `withRoleTx`), and admin `overview`, `PUT payslips` (draft; a published payslip is immutable), `:month/publish`, `:month/lock`, `:month/unlock`. Audit rows record that a payslip was touched, never amounts. **The month lock** refuses creating or approving an attendance regularization for a date in a locked month, and a recompute whose range starts or ends in one (`assertPeriodOpen`, a clear 409 message). Live punches and the nightly resolve job are deliberately not blocked (they work on the current day); the lock protects the two human-driven correction paths. UI: `/payroll` (nav id `payroll`): latest-payslip hero, history, printable breakdown (browser print / save as PDF), and a "Payroll tools" section for managers (month picker, add/edit draft, publish, lock/unlock). **Not built:** CSV/XLSX import of payslips, payslip PDF generation server-side, tax planning / regime comparison, matrix day-codes and sign-off flow on the muster report, `supportsDark` for HR (hex still lingers in a few admin screens).

**H6 - announcements + assets (schema `1.63.0`).** New `hr.announcements`, `hr.announcement_reads`, `hr.assets`, `hr.asset_assignments`. **Announcements:** everyone in the branch reads PUBLISHED, unexpired ones (app_user policy; drafts are HR's), `announcement_reads` has a self policy (a person records and reads only their own, enforced by the database); posting, publishing and retiring run in the service transaction behind `hr.employees.announcements.manage`. UI: an Announcements block on the Home dashboard with unread dots, mark as read, and Post / Retire for HR. **Assets:** inventory is HR data with NO app_user policy, so every read and write runs in the service transaction; the employee view (`GET /hr/assets/mine`, cap `hr.employees.assets.view`) is scoped to `request.auth.user_id` in SQL, and an asset is held by at most one person at a time (partial unique index on open assignments; assign refuses an already-assigned or retired asset). UI: "My equipment" on `/profile`, and an Assets tab on Employee 360 (assign from stock, take back, add new asset) for `hr.employees.assets.manage`. Capabilities back-filled from effective holders of `hr.employees.view` (the view ones) and `hr.employees.manage` (the manage ones). **Not built:** audience targeting by department, attachments, asset retire/edit UI, notifications for new announcements, Tasks (the nav already reaches the To-Do product via the product switcher).

**H7 - the remaining Stitch gaps (schema `1.64.0`).**
- **Leave.** `hr.leave_policies` gains `sla_hours` (default 48), `encashable`, `max_encash_days` (admin policy form updated). *SLA countdown*: the pending-approvals cards show "Due in 5h / Overdue by 3h" from `created_at + sla_hours` (`vw_leave_requests_enriched.sla_hours`, the effective policy); it is a countdown for the approver, never an auto-decision. *Request more info*: `POST /leave/requests/:id/request-info` (cap `hr.leave.approve`, assigned approver or override) stores the question on the request (`info_requested_at/info_request_note`); the request STAYS pending (no new status), the requester sees "Your approver asked: ..." and answers by editing it, which clears the question. *Encashment*: new `hr.leave_encashment_requests`; `POST /leave/encashments` (cap `hr.leave.encashment.request`) is refused unless the type's policy is `encashable`, the days fit `max_encash_days` and the balance (less other pending requests) covers them (`lib/leave/encashment.ts`, tested); the same approver rule as comp-off; approval re-checks, then writes a NEGATIVE `encashment` ledger entry. *Policy summary*: `GET /leave/policy-summary` (cap `hr.leave.view`) is the employee-safe projection of the effective policies (notice, caps, documents, encashment, approval window) - accrual and approval depth stay admin-only. The approvals page now has tabs: Approvals / Comp-off & encashment / Team availability.
- **Statutory and bank details - PLAIN TEXT, by product decision.** New `hr.employee_statutory` (PAN, Aadhaar, UAN, bank, tax regime; format CHECKs, mirrored by `statutoryFieldsSchema`) and `hr.profile_change_requests`. Encryption is deliberately deferred; until it lands, access control is the whole defence: a self policy and a `tenant_admin` policy and NO org-wide policy; the owner reads their own (`withRoleTx`); anyone who can open an Employee 360 gets the MASKED view (last four characters); only `hr.employees.statutory.manage` sees or edits the numbers, org-fenced, and every such view/edit/decision writes an audit row listing field NAMES, never values. Employees change their own details by REQUEST (one open request; HR approves and the payload is applied in the same transaction, re-validated; nobody decides their own). When encryption lands the columns become ciphertext + last-4 and the API masking stays.
- **Employee 360 / profile.** Tabs: Overview, Attendance (the person's month, read-only), Leave, Statutory & bank, Assets, HR notes, Audit trail (`GET /employees/:id/audit`: action, actor, time only, needs `hr.employees.notes.manage`). `/org-chart` (`GET /employees/org-chart`, cap `hr.employees.view`): reporting tree from `iam.users.manager_id`, cycle-safe. My profile gained Statutory & bank and a Security block (change-password link). **Not built:** a device/session list (sessions are stateless JWTs - there is nothing to list or revoke individually) and per-event notification preferences (nothing consumes them: the notification stream has no HR renderer yet).
- **Attendance.** *Punch log tab* (`GET /attendance/me/punches`): every punch with source, distance, geofence and face result, CSV export; the day detail now shows the break between slots. *Roster tools* (cap `hr.attendance.admin.override`, service transaction, org-fenced, payroll-lock aware, audited per person): `manual-punch` (stored with source `manual`, reason and actor in `device_info`, then the day is recomputed), `bulk-regularize` (the same write an approved regularization makes), `nudge` (only people who really have not punched; the audit row IS the reminder, shown as a banner on their Home and Attendance screens via `GET /attendance/me/nudges`). Bulk regularize skips the caller's own id (`ok: false`, "You cannot regularize your own attendance") — the same no-self-action rule as manual punch and regularization approval; the rest of the batch still applies.
- **Month-end sign-off (Reports).** `GET /payroll/admin/readiness?month=` (`hr.reports.payroll.manage`, org-fenced, counts only): headcount, pending regularizations, pending leave overlapping the month, missed-punch days, draft vs published payslips. Reports gains a "Month-end sign-off" section: KPI tiles linking to the queue that clears each item, then Lock / Unlock for payroll (locking over open items asks for confirmation).
- **Directory.** Status tabs (Active / Exited / All), a cards layout toggle and CSV export.
- **Dark mode is ON for HR** (`supportsDark`): no hex or `slate-*` remains in `hr-web` (`global-error.tsx` keeps its inline colours on purpose - it renders when the app shell, and so the tokens, may not exist).

**H8 - documents & compliance vault + Timesheet panel (schema `1.65.0`).**
- **Documents vault.** New `hr.employee_documents` (category, title, `file_key`, mime, size <= 3 MiB by CHECK, review state pending/verified/rejected with reviewer/time/note, optional `expires_on`, tax proofs carry `tax_section` + `amount`). Bytes live in the shared blob store under `documents/<org>/<user>/<uuid>.<ext>`; the row is metadata. **Privacy:** identity paperwork, so NO org-wide policy - an employee reads only their own rows (`self_policy`, app_user SELECT), tenant_admin has a tenant policy, and every write plus HR's reads run in the service transaction. Capabilities `hr.employees.documents.view` (own; back-filled from effective holders of `hr.employees.view`) and `hr.employees.documents.manage` (verify, read anyone's; from `hr.employees.manage`).
- **API** (`api/v1/documents/documents.router.ts`): `GET/POST /documents/mine` (identity from `request.auth`; upload is base64 JSON inside the 5 MB body limit; the file TYPE is sniffed from the bytes by `lib/documents/sniff.ts` - only PDF/JPEG/PNG/WebP, never the client's name or content-type; 100 documents per person), `GET /documents/employee/:userId` and `GET /documents/admin/pending` (manage), `GET /documents/:id/file` (owner or manage in the same org, else 404; `nosniff`, `no-store`; opening someone else's file is audited), `POST /documents/:id/review` (manage; nobody reviews their own; rejecting needs a reason), `DELETE /documents/:id` (owner until verified, HR any time; soft delete by UPDATE, file erased). Audit rows log the document id and action, never content.
- **UI.** `/documents` (nav item, `folder-open` icon): My documents (upload with type/expiry/tax fields, status chips, expiry warnings, remove) and, for reviewers, the branch review queue. Employee 360 gains a Documents tab (open, verify, reject, remove). Out of scope: DigiLocker pulls and expiry e-mail reminders.
- **Timesheet.** On wide screens the day breakdown (status, every in/out session, the break between sessions) opens as a side panel beside the calendar instead of a modal; phones keep the modal.
- Roll-out: `db_scripts/one_time/apply_documents_vault.sql` (+ `_dryrun`). **Service-login policies:** the HRMS one_time scripts (comp-off through documents) create `TO app_user` self policies, and `hr_svc` is NOINHERIT, so a `withRoleTx` read as `hr_svc` returns ZERO rows with no error until every policy also names the service logins. `apply_schema.ps1` does this at the tail of `08_rls.sql`; for a server updated only by one_time scripts run `db_scripts/one_time/apply_widen_service_login_policies.sql` (the documents script already includes the sweep). Verify with `SET LOCAL ROLE hr_svc; SELECT set_config('app.current_user_id', '<uuid>', true); SELECT count(*) FROM hr.payslips;` - a published own payslip must count. Found on 2026-10-04 by a real publish-then-view flow.

**H9 - roster planner part 1, employee org fields, configurable upload limit (schema `1.66.0`).**
- **Roster planner** (`/planner`, side nav "Roster planner", capability `hr.attendance.roster.manage`, back-filled from effective holders of `hr.attendance.admin.assignments.manage`). HR sees every active employee of the branch as a staff-by-day week grid; clicking a cell sets or clears that person's shift for a day or through a date; ticking people and "Assign shift pattern" sets a shift over a range for all of them; capacity cards show assigned vs required people per shift for today (or Monday) with a Short / Full / Over marker; "Publish roster" records the week as published (who, when, note) and the page then shows "N changes since" if assignments move afterwards. API: `GET /attendance/planner/week`, `PUT /attendance/planner/cells`, `PUT /attendance/planner/requirements`, `POST /attendance/planner/publish`; everything runs in the service transaction, org-fenced, actor from the session. Edits reuse `hr.shift_assignments`: `lib/attendance/planner.ts planRange` carves the dates out of the person's existing rows (shrink/delete first, then insert) so the no-overlap exclusion holds, and every edit is checked against the 11-hour rest rule - a person it would break is skipped and named in the response, not silently changed. Past days cannot be edited (they are already resolved into attendance). New tables `hr.shift_requirements` and `hr.roster_publications` (branch-readable, service-written). **Part 2 (built):** Day / Week / Month views (`view` query on `GET /attendance/planner/week`; day = one lane per shift plus an unassigned lane, month = compact grid; publishing is per week, so only the week view shows it); a capacity donut for the focus day; **Bulk reallocate** (`POST /attendance/planner/reallocate`: move everyone, or the ticked people, from one shift to another over a range - `overlapsOnShift` limits the change to days they were on the first shift, each rest-checked); and a **Swap requests** desk inside the planner for approvers (`hr.attendance.swap.approve`), using the existing swap approve/reject. **Still not built, deliberately:** weekly-off change requests, because moving a weekly off for one week would have to be honoured by attendance resolution, leave day counting, comp-off, muster and payroll reports (about a dozen places read `weekly_off_pattern`), and a half-honoured approval would silently misstate pay; and notify-on-publish, which needs an HR renderer on the notification stream. Both need a decision before they are built.
- **Employee org fields.** `hr.employee_profiles` gains `grade`, `squad`, `cost_center`, `notice_period_days` (0-365), `work_mode` (office/hybrid/remote), `seat_label`, all optional; editable in the employee edit form, returned by the employees list and both profile APIs, shown as tiles and chips on Employee 360.
- **Upload limit.** `hr.document_settings` (one row per org) holds the largest document upload, 100 KB to 3.5 MB (CHECK), default 3 MB. 3.5 MB is the ceiling because files travel as base64 inside the 5 MB JSON body. `GET/PUT /documents/settings` (read: anyone using the vault; write: `hr.employees.documents.manage`); the upload route and the form both use it. Larger needs a multipart upload route.
- Roll-out: `db_scripts/one_time/apply_planner_profile_fields.sql` (+ `_dryrun`), which includes the service-login policy sweep; it needs `apply_documents_vault.sql` first.

**H10 - leave apply page, punch hub in-page, swap desk, timesheet KPIs (schema `1.67.0`).**
- **Leave apply page** (`/leave`). The application is a section of the page (leave-type tiles, dates with the live working-days preview, start/end half-day choice, **handover colleague**, reason with dictation, **supporting document upload**, Submit, and **Save draft**), with Team availability (teammates on approved leave in the next two weeks) and Upcoming holidays beside it, and a history table with the LV number, reviewer and attachment link. `hr.leave_requests` gains `request_no` (sequence from 1001, shown LV-1001), `handover_user_id`, and `attachment_key/name/mime/size`; `hr.vw_leave_requests_enriched` appends them plus `handover_name` and `latest_approver_name`. **Upload:** `POST /leave/attachments` (base64 JSON, size from the document limit, type sniffed from the bytes) stores under `leave/<org>/<user>/<uuid>.<ext>` and returns a token; the request carries the token, and the server accepts it only if the key sits under the caller's own folder. `GET /leave/requests/:id/attachment` is allowed for the requester, an approver on the chain, or `hr.leave.view.org/tenant`, else 404; opening someone else's file is audited. An edit that sends no handover/attachment fields keeps them. **Drafts are browser-local on purpose:** a server `draft` status would have to be honoured by balance, overlap, approver-queue and attendance logic that treat every non-terminal request as open. Approver cards show the handover colleague and the attachment.
- **Punch hub in-page** (`/attendance`). Check in/out is a panel on the page (`PunchPanel`): a selfie card (live camera, capture, retake) and a Location & geofence card showing the distance from the office against the allowed radius before the person confirms. Office coordinates now come with the attendance rules (`office_lat/office_lng`, the branch's own, from `entity.organizations`); the geofence is still enforced on the server from the same coordinates. The regularization form is also on the page (`RegularizationFormModal inline`), with a history table below. The old punch modal is removed.
- **My team swap desk.** Swaps are ticket cards (your slot / peer slot, requested-ago, two-step sign-off progress, Withdraw), beside a Leadership & escalation card built from the reporting chain (now including each manager's email), with avatars and a YOU badge in the grid. **Timesheet KPIs:** worked vs target-to-date (full-day minutes from the branch rules x working days so far, excluding weekly offs and holidays) and an attendance rate. Not built: night allowance (decision D5), a map in the punch panel (decision D2), break punch (D3).
- Roll-out: `db_scripts/one_time/apply_leave_apply_page.sql` (+ `_dryrun`); it numbers existing requests oldest first from 1001.

**H11 - documents vault tabs, header search and bell, phone pass (no schema change).**
- **Documents vault** (`/documents`, Employee 360 Documents tab). `DocumentsVault` filters what the list endpoints already return: three tiles (identity dossier verified/total, tax proofs, needs attention = awaiting review + expiring), category tabs with counts (All / ID & address / Education & employment / Tax proofs / Medical & other, mapped from `category` in `lib/documents/types.ts`), search, Indian financial-year chips (April-March, derived from `created_at`; tax proofs only) and a tax-proofs-by-section summary (count and amount claimed per `tax_section`; no declared target exists, so no progress bar). **Download dossier (ZIP)**: `GET /hr/documents/mine/dossier` (documents.view, own folder from `request.auth`) and `GET /hr/documents/employee/:userId/dossier` (documents.manage, org-fenced, audited as `document_dossier_downloaded`, ids only). Verified and pending files, not rejected; refused above 25 MB in total. The archive is built by `lib/documents/zip.ts` (STORE method, CRC-32, no dependency); entry names are flattened and de-duplicated, so a title cannot write a path. Not built: a receipt/policy number and a per-section declared amount (both need columns).
- **Header search** (`HrHeaderSearch`, `searchSlot`, Ctrl+/). Pages the person may open (the sidebar's own capability-filtered list, matched in the browser) and people (`GET /hr/employees?search=`, so the server's branch fence and `hr.employees.view` decide who can match). A person links to `/employees/:id` only with `hr.employees.profile360.view`, otherwise to the directory. Salary, documents and notes are never searched.
- **Header bell** (`HrAttentionBell`, `notificationSlot`). "Waiting for you": counts from the queues the person can decide (leave `hr.leave.approve`, regularizations, shift swaps, documents to review), each linking to where it is handled; polled every 2 minutes and on open. It is deliberately not an event feed: HR events (`leave:info_requested`, `attendance:nudge`) are fire-and-forget and nothing stores them, so a feed would miss what happened while the tab was closed. A persistent HR notification store is the next step if a feed is wanted.
- **Phone pass.** The bottom bar listed seven tabs and ran off a 390 px screen; it is now Home / Attendance / Leave / Payroll (falling back to My team, then Employees) plus More. `PageHeader` actions wrap instead of `shrink-0`, which stopped the Roster planner's button row from pushing the page sideways.

**H12 - dashboard activity and slots, sidebar work cards, Timesheet slot tabs (no schema change).**
- **Recent activity** (`GET /hr/me/activity`, `ActivityPanel` on Home). Own rows only (user and org from `request.auth`), newest 10 across punches, regularization decisions, leave status changes, published payslips and reviewed documents. Each source is read only if the caller holds the capability behind its screen. Rows are labels (`kind, title, detail, at, href`), never document content or amounts; times are normalised to ISO. A failed read hides the panel.
- **Own shift** (`GET /hr/attendance/me/shift?date=`, `hr.attendance.view`). The caller's shift and its slots on a date, pinned to the session user. The Home and Attendance screens use it instead of the assignment list (which needs an admin capability), so a role without it no longer shows "None assigned".
- **Slot views without the photo capability.** Slot pairing now reads the caller's own punch log (`/attendance/me/punches`, `attendance.view`) when the per-day events read (`hr.attendance.photo.view`, can return anyone's selfies) is refused (`ownPunchesOnDate`). `SlotLog` is the shared view: scheduled window, in/out, time spent, Off slot / Still open flags; it appears under the Home hero for non-split shifts (a split shift already lists its slots in the Today card).
- **Timesheet tabs.** My month gains **Slot log** (day picker, per-slot chips for split shifts) and **Shift regularization** (the last 10 correction requests set against that day's shift and slots). A request still covers a whole day: targeting one slot needs a column on `hr.attendance_regularizations` (not built; schema review pending).
- **Sidebar work cards.** `AppShell`/`AppSidebar` gain an optional `sidebarFooter`/`footerSlot` (hidden when the rail is collapsed; other products unchanged). HR fills it with `HrWorkCards`: Working time (today vs the shift's length) and Assigned shift (with the current slot).

**Branch reach of reports** is the scope ladder under `hr.reports.attendance.view` — `.org` (the session branch) or `.tenant` (every branch of the tenant), read with `attendanceReportReach()`. The Reports page opens the combined sheet on "All branches" when the navbar switcher is on All branches (`session.all_branches`) and the actor holds `.tenant`, otherwise on the session branch, and offers a branch picker only to `.tenant` holders. hr-service re-checks the same scope and derives the branch list from the gateway-verified `tenant_id`, so the picker is a convenience, never the boundary. The report read runs on the service transaction (attendance RLS lets `app_user` read only its own rows), pinned to that server-derived list — the same justification as the detailed report.

Roll-out: `db_scripts/one_time/apply_hr_reports_capability.sql` (+ `_dryrun`) grants the new keys to every role that could **effectively** open the old tab (a grant row pruned by a denied ancestor is skipped), `.tenant` to tenant_admin / hr_admin / super_admin, then deactivates the old nodes. Ship it together with the hr-service / hr-web / api-gateway release.

## Tasks (To-Do) — Stitch redesign (`1.68.0`)

The Tasks product (`msq-todo`: `tasks-service`, `@task/web`, `todo-web`) follows the Stitch "ToDo" design. A **branch is an organization** (`entity.organizations`); every task and list is `org_id`-scoped, so "my branch" is the org the user is currently working in.

**Screens** (`apps/todo-web`, nav ids `tasks` / `tasks-team` / `tasks-lists`, phone tab bar `MOBILE_TABS`, overdue count badge on `tasks`):

| Route | Shell | Gate (advisory — the service re-checks) |
|---|---|---|
| `/tasks` | `TasksShell` → `TaskHubShell scope=own` | `tasks` |
| `/tasks/team` | `TeamTasksShell` → `TaskHubShell scope=team` | `tasks.view.team` |
| `/tasks/[id]` | `TaskDetailShell` (breadcrumbs, sibling-in-list rail, `TaskDetailPanel`) | `tasks.view`; the service answers 404 for a task the caller cannot read |
| `/tasks/lists` | `TaskListsShell` (cards by owner / tier / open-task count, create-edit-delete) | `tasks.lists.view`; manage / delete follow `tasks.lists.manage` / `.delete` and owner-or-`tasks.edit.any` (a **private** list: owner only) |

`TaskHubShell` is one orchestrator for both hub tabs: KPI tiles (click filters), quick-add, filter bar, **List / Board** toggle (board is desktop only; phones always get cards), server-side sort and paging (25 per page; the board loads one page of 100), bulk bar, Export CSV, "New task" dialog and the quick-edit drawer. Tables are a semantic, token-styled `<table>` rather than AG Grid: ToDo has no grid dependency and the data is already server-paged and server-sorted. Timeline view, sprints/velocity, subtasks, recurrence, attachments, departments, AI Polish and list templates from the design are **not built**; the "Sync health / latency / ledger block / reference panel" elements are mock decoration and are dropped.

**Lists & tiers.** The design's four tiers map onto the existing `task_lists.visibility` (`private` / `team` / `org`), relabelled **Private / Team / Branch** (the Branch word comes from the tenant's own `branch` brand term). No new tier, no schema change. Cross-tenant oversight is the existing super-admin **Switch tenant** flow (1.55.0), not a page: the user switches tenant, then reads that tenant's data under its normal RLS.

**API additions** (all behind `authenticate` + `requireModule('tasks')` + a capability, gateway routes in `api-gateway/src/server.ts`; static paths registered before `/tasks/:id`):

| Method / path | Capability | Notes |
|---|---|---|
| `GET /tasks/stats?scope=own\|team\|org&list_id=` | `tasks.view` (+ the scope's capability) | `open, todo, in_progress, blocked, completed, overdue, due_soon, unassigned` in one aggregate; same scope runner as the list, so tiles and rows cannot disagree |
| `GET /tasks/export?<list filters>` | `tasks.view` + `tasks.export` | `text/csv`, UTF-8 BOM, formula-injection guard (cells starting `= + - @` get a leading `'`), capped at 5,000 rows (`X-Export-Truncated: true` when hit), audited as `tasks_exported` |
| `POST /tasks/bulk` | `tasks.bulk` + `tasks.edit` (+ `tasks.assign` to reassign to anyone but yourself) | 1–100 ids; each id is authorised exactly like a single PATCH (visible **and** editable) in its own transaction; a task the caller may not touch is skipped and reported (`{results:[{id,ok,error?}], updated, failed}`), never failing the rest; audited as `tasks_bulk_updated` |
| `GET /tasks` | unchanged | gained `unassigned`, `sla_state`, `sort` (`created_at \| due_at \| priority \| status \| task_no \| title`, whitelisted to fixed SQL fragments) and `dir`; rows now carry `task_no`, `org_name`, `sla_state` |
| `GET /task-lists` | unchanged | rows gained `open_task_count` |

**Task code and SLA.** `TASK-<n>` is `task_no`, a per-branch running number from `task.task_counters` via the SECURITY DEFINER trigger (unreachable from a request). `sla_state` is derived from `due_at` in the view — overdue / due within 24h / on track; no policy table. Due dates are stored as **end of the chosen day in the user's timezone** so "due today" is not overdue until the day ends.

**Soft delete runs in the service transaction.** `DELETE /tasks/:id` and `DELETE /task-lists/:id` used to return 500 for everyone: the table RLS hides deleted rows (`USING … NOT is_deleted`) and Postgres re-applies that to an UPDATE's *new* row, so an `app_user` `UPDATE … SET is_deleted = TRUE` is always refused. (The old UI had no delete button, so it was latent.) Both repositories now soft-delete inside `withServiceTx`, fenced by the gateway-verified `org_id`, after the service has decided who may delete (creator or `tasks.edit.any` for tasks, after the same visibility check as a read; owner or `tasks.edit.any` for team / org lists), with the actor set for the audit trigger and an explicit refusal for read-only roles (no `platform.write`), which `withRoleTx` used to enforce. **A private list is owner-only for writes as well as reads**: `loadForWrite` answers 404 to anyone else, admins included, for both `PATCH` and `DELETE /task-lists/:id`. Deleting a list detaches its tasks (`list_id = NULL`), and a standalone task is visible to admins and managers, so an admin delete would have exposed the owner's private tasks. Because RLS no longer backs the delete, `softDeleteTaskList` repeats the rule in SQL (`visibility <> 'private' OR owner_id = caller`) and detaches tasks only when the list row was actually deleted. `DELETE /tasks/:id` loads through `loadVisible`, so a task inside someone else's private list is a 404 for an admin too.

**`tasks.assign` on every route.** Handing a task to someone else is an assignment whatever endpoint does it: `POST /tasks`, `PATCH /tasks/:id` and `POST /tasks/bulk` all require `tasks.assign` when `assignee_id` is anyone but the caller (`assertCanAssign` in `tasks.service.ts`). `PATCH` only gates a *change* — an edit form re-sending the current assignee passes — and taking a task yourself never needs it. Seeded roles without the capability: `sales_representative`, `hr_admin`, `read_only`.

## The single reporting hierarchy (P4, `1.27.0`)

**`iam.reporting_lines` is the one hierarchy.** LMS lead assignment, HR leave/attendance approval and Tasks team scope all resolve authority from the same table, so "who is on my team" has one answer everywhere. It replaced two trees that disagreed: `iam.users.manager_id` (LMS + Tasks) and `hr.reporting_lines` (HR approvals only).

It lives in `iam` rather than a product schema because `07_grants.sql` REVOKEs each product schema from the other products' logins — a tree owned by `hr` is unreadable by LMS and Tasks by construction.

**Three functions are the whole API.** All `STABLE SECURITY DEFINER`, all taking an as-of date:

| Function | Answers |
|---|---|
| `iam.fn_is_in_subtree(manager, member, as_of)` | *the* authority primitive — is this person under me? |
| `iam.fn_subtree_members(manager, as_of)` | everyone below me, at any depth |
| `iam.fn_manager_chain(user, as_of)` | everyone above me, nearest first (leave approver chains) |

`iam.vw_user_team_members` and `iam.vw_user_org_chart` are thin `as_of = CURRENT_DATE` wrappers over these, keeping their original names and columns so existing queries did not change. A view cannot be parameterized — for any other date, call the functions.

**Rules:**

- **Unlimited depth.** A manager reaches every level below them, for leads, leave and tasks alike.
- **Effective-dated.** Every row is `[effective_from, effective_to)`, one open line per user per org (GiST exclusion). Re-orging supersedes rather than overwrites, so "who did this person report to in March" stays answerable.
- **Acting is checked as of today; history is queried as of the record's date.** A leave's approver chain is materialized into `hr.leave_request_approvals` at apply time, so a re-org cannot strand an in-flight request.
- **Cross-org managers go through `iam.user_org_mapping` and nothing else.** `iam.check_reporting_line_membership()` requires both parties to hold an active mapping in the line's org, so a manager shared across branches has one mapping and one line **per branch**, and no chain ever crosses an org boundary. That is what lets the org-scoped RLS policy stay correct — it can never truncate a chain halfway.
- **Revoking a mapping closes the lines.** `iam.close_reporting_lines_on_mapping_revoke()` closes every open line in that org where the departing user is manager or report. Orphaned reports are left line-less (falling back to the `org_admin`/`hr_admin` approver) rather than silently reparented.
- **Reads stay org-pinned to the session.** A shared manager sees Org A's team in Org A context and switches branch (`/auth/switch-org`) for Org B. Approvals are unaffected — they key on the record's org, not the session's.
- **On a branch transfer the line follows the NEW home branch.** When `PATCH /users/:id` carries `org_assignments`, `manager_id` is *not* written through the generic user update — that path targets the branch being left, where a manager from the new branch holds no mapping, so `iam.check_reporting_line_membership()` would reject the insert and abort the transfer. `reconcileOrgAssignments` owns the line instead: it writes it against `home_org_id` after the new mappings exist, and `ensureManagerMembership` grants the manager a weight-0 mapping there if they lack one. The legacy single-`org_id` path still writes the line from the generic update.

**One person, one level; higher approvers may cover (schema 1.72.0).** On a multi-level leave or regularization request an approval always acts on the lowest pending level, and nobody approves two levels. Who may decide it (`hr-service/src/lib/approvals/authority.ts`, one pure rule shared by leave and regularization): the level's assigned approver; a *higher* assigned approver covering it on the lower approver's behalf; or an `hr_admin`/`org_admin`/`tenant_admin` override. A non-admin cannot act on a level above their own, and anyone who already approved a level (as themselves or on someone's behalf, `acted_by`) is refused. Rejecting is exempt, since it ends the request. When someone covers a lower level, that counts as their one approval and any level still assigned to them is **reassigned** (`reassigned_from` keeps who it was taken from): to the next manager up the reporting chain, else another `hr_admin`/`org_admin` of the branch, else a `tenant_admin`; with nobody left it stays put and an admin override finishes it. The chain rows are locked (`FOR UPDATE`) while deciding so two approvers acting together cannot both read the same pending level. `GET /leave/requests/:id/approvals` and `GET /attendance/regularizations/:id/approvals` return the chain plus `my_decision` (can this viewer decide it now, and why not) to org admins, anyone in the chain and the requester's managers; others get a 404. Lists show `Level n of N`, who it is pending with and who approved, from `hr.vw_leave_approval_summary` / `hr.vw_regularization_approval_summary`; the chain names the real approver when someone covered or overrode.

**Capabilities vs. hierarchy.** These answer different questions and both still apply: a capability (`lms.leads.edit.team`, `tasks.view.team`, `hr.leave.approve`) says *whether* you may act on a team at all; the hierarchy says *who is in it*. Admin tiers short-circuit before the hierarchy is consulted — `hr_admin`/rank ≥ 980/`tenant_admin` for HR, `org_admin`/`tenant_admin`/`super_admin` for LMS, `tasks.edit.any` for Tasks.

### Capability walls (schema `1.76.0`)

Every screen, tab and call except the super-admin console is now behind a capability; the audit that drove it found open pages, rank/role-name gates that overrode a granted capability, and ~30 keys nothing read. `db_scripts/one_time/apply_capability_walls.sql` (run with `-v dry=1` first) does it, and the cutover is **behaviour-neutral**: where a rank rule becomes a capability the migration writes the grant that reproduces today's access, in the tenant overrides *and* the role templates, so nobody gains or loses an action. It lists every grant it changed.

- **New operations** (back-filled to current holders): `lms.leads.export` (all download buttons), `hr.employees.statutory.view` (the 360 Statutory tab), `hr.leave.admin.tenant_wide`, `hr.attendance.admin.tenant_wide`, `admin.api_tokens.tenant_wide`. The `*_wide` keys are operations on purpose: a `.tenant` scope sibling would join the own/team/org/tenant ladder and outrank it.
- **Merged:** `hr.leave.reject` into `hr.leave.approve`, and `hr.attendance.regularization.reject` into `hr.attendance.regularization.approve` ("Approve or reject"). A role that held only approve gains reject — two live roles were affected (Fitclass `sales_representative`, MSquare `editor`), both tenant overrides.
- **Removed (no reader):** `lms.dashboard(.view)`, `lms.leads.edit.{own,team,any}` (edit reach is branch coverage, not a ladder), `lms.history.detail.view` (the history dialog reads `lms.history.view`), `lms.history.view.team`, `tasks.view.own`, `tasks.edit.{own,team}`, `hr.attendance.view.{own,org}`, `hr.leave.view.{own,team}`, `hr.leave.admin.holidays.view`, and the inactive `hr.attendance.admin.reports(.view)`.
- **Wired:** `lms.leads.unassigned.view` (replaces the rank-40 floor in leads-service, notifications-service and the dashboard card), `lms.analytics.org.view` (cross-branch analytics and the tenant report email, replacing a `tenant_admin`/`super_admin` role test), the `lms.history.view.*` ladder, and the HR admin **tab** nodes (`hr.leave.admin.{policies,cycle,holidays,adjustment}`, `hr.attendance.admin.{rules,shifts,assignments}` now hide their sections).
- **Rank checks removed where the capability already gates the route:** deleting a lead and writing campaigns no longer also require rank ≥ 980. Because those capabilities had been granted to roles the rank floor silently excluded (`org_manager`, `org_sr_manager`, MSquare `cto`), the migration denies them there — turn them on from the Capability Matrix if you mean to.
- **API tokens, tenant defaults:** the rank-980 floor on `/api-clients` is gone and branch-vs-tenant reach is `admin.api_tokens.tenant_wide`; the tenant-wide leave policy/cycle and attendance rules rows are `hr.leave.admin.tenant_wide` / `hr.attendance.admin.tenant_wide` (`canSetTenantLeaveDefaults` / `canSetTenantAttendanceDefaults` in `@hr/authz`).
- **Pages:** HR Home, Attendance and Leave, and Tasks (`/tasks`) now have page guards (`canOpenHrHome`, `canViewAttendance`, `canViewLeave`, `canViewTasks`); a failed guard redirects to the section the actor does hold or 404s, never loops. Nav entries ask exactly what their page asks; `NavItem.orCapabilities` expresses "this OR that" (Payroll, Documents, Home). The shell "Admin" pill (`canOpenAdminConsole`) now also admits holders of only the HR admin pages, matching admin-web's layout. Tasks: New task/quick add are `tasks.create`, the notes and audit tabs `tasks.comment` / `tasks.history.view`.
- **Closed routes:** see the gateway table — `POST /meta/crm-event` (cross-tenant), the direct `/communications/{email,whatsapp/*,send}` routes and `GET /users/team` were removed; `/meta/integration` is super-admin only; `GET /users/:id`, `/users/org-chart` and `/users/assignment-weights` need `admin.team.view` / `admin.team.manage`; hr-service `authenticate` now requires an active role in the org.

**Seniority vs. permission (final position).** A rank check that answers "who outranks whom" is kept; a rank check that answered "may you do this at all" was replaced. In the identity-service user routes both now apply: the rank/seniority check stays *and* the capability is required — `GET /users` needs `admin.team.view`; the role/manager/campaign-type catalogs, `PATCH`/`DELETE /users/:id`, reset-password, org-mappings and `PUT /users/assignment-weights` need `admin.team.manage` — so revoking the capability on the Capability Matrix now blocks the API, not only the screen. The tenant console's Team screen is unaffected (it already required these).

**Intentionally rank-based, closed as "by design"** (so the next audit does not re-flag them):
- identity `PATCH /users/:id` and the Team lists keep the rank ≥ 40 / ≥ 980 floors plus `canManageUser` / `canGrantRole` — hierarchy rules.
- the org geofence centre (`orgs.service`, rank ≥ 980): excludes `hr_admin` on purpose; the capability that would replace it (`hr.attendance.admin.rules.update`) is held by `hr_admin`, so a swap would widen it.
- `GET /hr/employees/:userId` rank ≥ 60 on top of `hr.employees.view`: a privacy floor for reading *other* people's profile; `hr.employees.profile360.view` is the delegating capability for the full dossier.
- platform-identity reach (BranchSwitcher, `switch-org`, moving a user's branch, password-policy override) stays on `platform_role`.
- leave approver routing by role name (`resolve-approvers.ts`) — routing, not access.
- gateway `/campaign-types` is deliberately not in `product-map.ts` (it would block a super admin working another tenant's types); leads-service `requireModule` covers it.

**Self-service data, no per-control capability by design:** the Attendance "My month" tabs, the My profile tabs, the Home activity panel and "My swap activity" (the caller's own swaps only) read the caller's own rows, scoped server-side by `request.auth.user_id`; the pages are gated by `hr.attendance.view` / `hr.employees.profile.edit`.

**Partner API:** `/public/v1/communications/send` uses platform-wide mail/WhatsApp settings (environment), not per-branch credentials, so a tenant-wide key's empty branch is harmless; the tenant allowlist and the `comms:send` / `comms:send:adhoc` scopes are the gates.

**Manage buttons inside the HR admin sections** now follow their operation keys: policies, holidays (both forms), shifts, shift assignments (assign/edit/recompute), the leave-cycle Save and the attendance-rules Save.

**`iam.users.manager_id` is a deprecated display mirror**, maintained by the `iam.sync_user_manager_mirror` trigger (home-org line first, then most recently effective). It exists so list screens, the manager dropdown and the auth session payload kept working; it is single-valued and so cannot represent a user who reports to different managers in different orgs. Never read it for authority. Scheduled for removal.

See `docs/DB_model.md#iamreporting_lines` for the table shape and `msq-hrms/services/hr-service/src/lib/leave/__tests__/resolve-approvers.integration.test.ts` for the tests pinning the convergence.

## Product entitlements (D6)

`entity.tenant_modules` licenses which products a tenant can use. Enforcement is centralized at the **api-gateway** — the single choke point: after JWT verify, `productGuard` maps the registered route prefix to a product and returns `403 PRODUCT_NOT_ENABLED` if the tenant lacks it. The table stores fine-grained modules; the gateway maps them to products:

| Product | Route prefixes (gateway) | Requires active module(s) |
|---|---|---|
| `lms` | `/leads*`, `/assignments*`, `/campaigns*`, `/follow-ups*`, `/analytics*`, `/activities*`, `/locations*`, `/dashboard*`, `/org/performance*` | `lms` |
| `hr` | `/hr/*` **except** `/hr/employees*` and `/hr/modules` (ungated) | `leave` OR `attendance` |
| `task` | `/tasks*`, `/task-lists*` | `tasks` |

Everything else (users, orgs, api-clients, lookups, meta, communications, auth, notifications) is ungated. `/notifications/*` covers `/notifications/stream` (SSE) **and** the Web Push registration routes (`POST`/`DELETE /notifications/push/subscribe`, `GET /notifications/push/public-key`); those are ungated on purpose — registering your own device to receive your own notifications is self-service, the same category as `/users/me/photo`, and no capability could meaningfully gate "may this user be told about their own work". They are still authenticated (JWT at the gateway, HMAC-signed headers at the service) and identity is never read from the request body. See the Web push & PWA section below and `msq-core/packages/web-push/README.md`. Per-service `require-module` middleware in **leads-service** (`lms`), **hr-service** (`leave`/`attendance`), and **tasks-service** (`tasks`) stays as **defense-in-depth** — a call that bypasses the gateway is still rejected. `@platform/authz.hasProduct()`/`assertProduct()` (async) resolve entitlement via a 60s per-tenant cached read; the DB source is injected at gateway startup (`configureProductSource`) so the package stays free of `@platform/db` and safe to import from the Next.js apps. The lead product's key is `lms` (renamed from legacy `crm`; the `crm`→`lms` schema rename landed in P1.0). Every tenant is backfilled with an active `lms` row, so the rollout is non-breaking.

## Web push & PWA

The platform is installable as a single Progressive Web App from a unified origin, with one push subscription covering every product.

### Unified origin topology

All six product apps run behind one host (`apps.fitclass.in` in production, `app.localhost` in development) with path-based routing, each compiled with its own `basePath`:

| URL prefix | App |
|---|---|
| `/` | auth-web |
| `/lms` | lms-web |
| `/hrms` | hr-web |
| `/todo` | todo-web |
| `/admin` | admin-web |
| `/sa` | lookup-admin |

**Caddy** (reverse proxy) dispatches by path prefix using a named matcher per app — `@lms path /lms /lms/*` followed by `handle @lms` — with a final bare `handle` for the root. Both the bare path and the wildcard must be listed: `/lms/*` does not match a bare `/lms` (nothing for `*` to match), so a hand-typed `apps.fitclass.in/lms` would fall through to auth-web and 404. Each app's `basePath` is compiled into its Docker image — changing a prefix is a rebuild, not an env flip.

### One compose project across four repos

The product apps and services live in the nested `msq-lms/`, `msq-hrms/` and `msq-todo/` repos, each with its own `docker-compose.yml`. The root `docker-compose.yml` pulls all three in with an **`include:`** block, and because all four files declare the same project name (`name: msq`), every service lands in one project on one default network (`msq_default`), addressable by container name. `docker compose --profile sso-proxy up --build` from the platform root therefore starts the whole platform — Caddy reaches `lms-web`/`hr-web`/`todo-web`, and the gateway reaches the product services (its `*_SERVICE_URL` values are hardcoded to those container names, because the `.env` values are `http://localhost:<port>` for native `pnpm turbo dev` and would point a container at itself).

Two rejected alternatives, both of which fail concretely:

- **`COMPOSE_FILE=a;b;c`** resolves every merged file's relative paths against the *project* directory, so each product repo's `context: ..` climbs one level above the platform root and the build dies on `GetFileAttributesEx …\msq-lms: The system cannot find the file specified`. `include:` resolves paths against each file's own directory, which is what these files were written for.
- **`docker network create platform-net` + `external: true`** needs an out-of-band setup step before anything works and leaves four separate projects whose `up`/`down` lifecycles drift apart.

Running a product repo standalone from its own directory still works unchanged; it then needs `DB_CONTAINER_NAME` / `API_GATEWAY_INTERNAL_URL` in its own `.env` pointing at msq-core's containers. Note that Compose interpolates `${VARS}` from the **project** `.env` — the platform root's — so the product repos' variables (`DB_LMS_SVC_USER`, `LEADS_SERVICE_PORT`, the `COMPREFACE_*` set, …) must exist there too; the per-repo `.env` files remain the source for the standalone path.

This single origin is **mandatory for push to work**: a PWA's scope and push subscription are per-origin. On iOS, navigating cross-origin drops the user out of the installed standalone mode into a separate storage jar, breaking the shared session cookie — so every unauthenticated bounce must stay within the same origin. The unified topology eliminates that failure mode and gives every user one install, one icon, one push subscription covering every product.

Environments are isolated by a **per-environment cookie name** (`fc_session` prod, `fc_session_uat`, `fc_session_dev`) rather than by cookie scope — a cookie is keyed by `(name, domain)`, so a distinct name means a sibling environment under the shared `fitclass.in` parent never reads it, even though `COOKIE_DOMAIN` (`.fitclass.in` on prod) would let the browser deliver it there. `COOKIE_DOMAIN` on each environment stays at its existing value; prod's `.fitclass.in` is deliberately left unchanged so a re-login overwrites the cookie in place and no session is dropped. Making prod's cookie host-only is a possible future tightening, but it orphans the wide-scoped cookie and needs a maintenance-window logout.

### Push delivery path

Follow-up due notifications flow through two channels:

1. **SSE (Server-Sent Events)** — for users with an open tab. `followup-checker` polls `lms.marketing_leads.scheduled_at` on an interval and delivers overdue/due-soon events via `connectionManager.sendToUser()` as `followup:due` / `followup:missed`.
2. **Web Push (device notifications)** — for users with the app closed or in the background. Push is a second delivery channel hung off the same call site. When no SSE stream is open, `followup-checker` sends the same events to Web Push instead. The client re-subscribes on every app launch (reconciling if the Home Screen icon was deleted), so the subscription is always live.

**Notification deep link.** The push payload's `url` is `/lms/dashboard/follow-ups?leadId=<id>`. lms-web has no per-lead detail *route* — `/dashboard/leads` carries no `[id]` segment, so `/lms/dashboard/leads/<id>` would open a 404 on the user's phone. The follow-ups grid accepts `?leadId=` instead and opens that lead's history on arrival (`FollowUpsShell`'s `focusLeadId`), so tapping a notification lands on the lead it is about. The id is a **hint, not an authorization**: the shell matches it against the follow-ups the API already scoped to the acting user and ignores anything it does not find, so the parameter can never be used to pull another user's lead. It is consumed once, so dismissing the modal does not re-open it.

**Leads page follow-up tiles.** The single "Follow-up Required" tile is split into **Follow-up Due** (scheduled now or later) and **Follow-up Overdue** (`scheduled_at < NOW()`), counted from the same `GET /follow-ups` response the embedded Follow-ups view renders (`useFollowUps`, fetched once by `LeadDashboardShell` and passed to `FollowUpsShell` as `pipeline`) — so a tile's number is always the number of rows its click shows. They are recounted on page load, on refetch and on realtime lead events, not on a clock. Clicking Due shows only the Upcoming section, Overdue only Missed. Both follow the navbar branch choice and the page's campaign-type filter.

Both channels **dedupe per lead+schedule** and reset daily in the tenant's timezone, preventing notification spam across restarts or deploys.

### Push subscriptions (`notify.push_subscriptions`)

The table holds WebPush subscriptions — one row per device per user. RLS enforces isolation:
- `org_id` and `tenant_id` for organization and tenant scope
- **`user_id` for personal scope** — a subscription belongs to one user and is never org-shared

The table is referenced only by the notifications-service for push sends; it never leaves the platform and is not synced elsewhere.

### Ungated registration routes (`/notifications/push/*`)

Push subscription routes are deliberately ungated like `/users/me/photo` — self-service, authenticated but not capability-gated. Registering your own device to receive your own notifications is not something that could meaningfully be blocked by a capability: the JWT already carries the user's identity, and no role should gate "may this user hear about their own work". The routes remain guarded by JWT verification at the gateway and identity is never read from the request body.

### Service worker caching & tenant isolation

The service worker implements a security rule from `.claude/CLAUDE.md`:

- **`/api/*` is never cached.** A cached API response writes tenant data to device storage that survives logout and outlives the session — a direct violation of the "no data leakage across tenant" rule. The service worker returns a network-only passthrough for any `/api/*` request.
- **`/_next/static/*` is cached** for fast app-shell loads on return visits (cache-first strategy).
- **`/`**, `/manifest.webmanifest`, `/icons/*`, `/offline` are cached on install.

This ensures that switching tenants/orgs, logging out, or uninstalling completely purges all persistent device storage belonging to the previous user.

### Icon set (`auth-web/public/icons/`)

All icons are generated from `assets/brand/fitclass-emblem.png` — the circular
brand emblem (navy ring + feather) on transparency — by
`scripts/generate-pwa-icons.py` (needs Pillow; re-run it if the branding
changes). They live in auth-web's `public/` because auth-web owns the root
origin — the paths are origin-absolute, so every product path under the
single-origin topology resolves them without its own copy.

Do **not** regenerate them from `fitclass-logo-white.webp`. That asset is the
full LOCKUP (emblem + FITCLASS wordmark + tagline) on a square 1600x1600
canvas. It used to also be the source for the navbar and login-panel logo,
but is not any more — see "UI emblem" below, where squeezing that square
lockup down to those elements' height turned out to crush it into an
illegible smudge. The icon set is emblem-only at every size, same reasoning.

| File | Size | Artwork | Used by |
|---|---|---|---|
| `icon-192.png` | 192x192 | emblem, 92% box | manifest; also the notification `icon`/`badge` in `sw.js` |
| `icon-512.png` | 512x512 | emblem, 92% box | manifest; splash screen |
| `icon-512-maskable.png` | 512x512 | emblem, 76% box | manifest `purpose: 'maskable'` |

**Per-tenant icons (schema 1.57.0).** These files are the platform default. A tenant whose Super Admin uploaded brand assets gets its own favicon, Apple touch icon and app icon: product layouts emit them via `brandedMetadata()` (`@platform/ui-kit/server`) and link `/manifest.webmanifest?b=<public_key>`. The manifest is a route handler (`auth-web/app/manifest.webmanifest/route.ts`) because a manifest fetch carries no session cookie — the rotatable public key selects display data only (name + app icon); an unknown or rotated key serves the default manifest. Tenant asset bytes come from `/api/public/branding/<key>/assets/<slot>?v=…` (immutable, `?v`-busted).
| `apple-touch-icon.png` | 180x180 | emblem, 90% box | iOS Home Screen, via `pwa/metadata.ts` |
| `favicon.png` | 256x256 | emblem, 94% box | browser tab, via `pwa/metadata.ts` |

### Blob storage layout & tenant branding (schema 1.73.0)

**Layout.** One blob root (`BLOB_STORAGE_DIR`, the same mounted volume for every service). Keys are tenant-first and built ONLY by `blobKeys` in `@platform/blob-storage` (`keys.ts`), which accepts lower-case UUID segments and whitelisted names and nothing else:

```
<tenant_id>/branding/<slot>/<epochMs>.<ext>                       tenant brand images (13 slots)
<tenant_id>/<branch_id>/<employee_id>/avatar/<epochMs>.<ext>      profile photo (also the face reference)
<tenant_id>/<branch_id>/<employee_id>/punches/<YYYY>/<MM>/<YYYYMMDD>_chkin|chkout_<n>.<ext>
<tenant_id>/<branch_id>/<employee_id>/documents/<docId>.<ext>     HR dossier
<tenant_id>/<branch_id>/<employee_id>/leave/<fileId>.<ext>        leave attachments
<tenant_id>/exports|imports/<YYYYMMDD>/<jobId>.<ext>              generated / staged files (short TTL)
_platform/branding/<slot>.<ext>                                   platform defaults (reserved; not served yet)
```
`branch_id` = `entity.organizations.id`, `employee_id` = `iam.users.id`. The branch segment is the branch the file was written in (identity avatars: the user's home org; HR punches/documents/leave: the org of the request); the **database column that stores the key stays the source of truth** — a key is never re-derived from ids, so a branch transfer cannot orphan a file. Replaceable files get a new timestamped key and the old one is left on disk (audit trail).

**Tenant guard.** Every authenticated read, serve or delete of a stored key calls `assertKeyInTenant(key, tenantId)` (`assertOwnKey` in identity-service `lib/blob.ts` and hr-service `lib/storage/photo-storage.ts`) with the tenant from the verified session, on top of the RLS that found the row. The public brand-asset route checks the key against the row's own tenant. Legacy keys (`avatar/…`, `punch/…`, `brand/…`, `documents/…`, `leave/…`) carry no tenant, so they pass only while `BLOB_ALLOW_LEGACY_KEYS` is not `false` (default true); `brand/<tenant>/…` is still verified. A leave attachment token is the key itself and only counts inside the caller's own `<tenant>/<org>/<user>/leave/` folder.

**Migration.** `msq-deploy/storage/migrate-blob-layout.sh` (dry run by default): `--apply` copies each legacy file, verifies it by sha256 and repoints the DB pointers (`iam.users.photo_key`, `hr.attendance_events.photo_url`, `hr.employee_documents.file_key`, `hr.leave_requests.attachment_key`, `tenant_branding.assets[*].key`) in one transaction; `--purge-legacy` later deletes an old file only when the DB points at the new key and the hashes match. Back up the blob volume AND the database first; set `BLOB_ALLOW_LEGACY_KEYS=false` only after the purge. `msq-deploy/retention/retention-cleanup.sh` understands both layouts and only ever touches `…/punches/…` (and legacy `punch/…`).

**Brand images (13 slots).** `logo`, `logo_dark`, `mark`, `favicon`, `app_icon`, `app_icon_maskable`, `apple_touch_icon`, `icon_192`, `push_icon`, `push_badge`, `email_logo`, `login_hero`, `splash`. **Ownership (2026-10-06):** the tenant admin (`admin.branding.manage`) may change colour, font and the default light/dark mode only, and only while the theme is unlocked; the database column GRANTs allow exactly `preset, seed_hex, font, default_mode, updated_by`. Everything else is Super Admin's: images, product names, renamed words, menu labels/icons, regional formats, the login link and the theme lock. The tenant admin sees them read-only. Super Admin uploads every size itself; nothing is resized or generated. Rules per slot (type, size cap, pixel rules) live in `identity-service/src/lib/brand-assets.ts` `SLOT_RULES` and are mirrored for the upload screens by `@platform/ui-kit/branding` `BRAND_ASSET_CATALOG`. The type is read from the bytes (PNG, JPEG — `login_hero` only — WebP, ICO, SVG), never from the client claim; an SVG is accepted only when it carries nothing executable or external (the prolog skip handles an XML declaration, comments, processing instructions and a DOCTYPE with an internal `[...]` subset; an SVG with `<!ENTITY` is `ASSET_SVG_UNSAFE`). `ASSET_WRONG_TYPE` names what was uploaded. Dimension errors: `ASSET_WRONG_SIZE`, `ASSET_NOT_SQUARE`, `ASSET_NOT_PORTRAIT`, `ASSET_TOO_SMALL`, `ASSET_TOO_WIDE`, `ASSET_BAD_IMAGE`. Upload: Super Admin only, `POST/DELETE /sa/tenants/:id/branding/assets/:slot` (rank-gated in the controller); it writes the `assets` column under a service transaction (the column is not grantable to application roles). There is no tenant-admin upload route, and `PUT /tenant/branding` is `.strict()` to the four theme fields, so a body carrying anything else is a 422.

**Where each slot renders.** `mark` and `logo`/`logo_dark` in the shell (`BrandMark`: the full logo replaces mark + name in the expanded rail, `logo_dark` is swapped in by CSS under `html[data-mode="dark"]`, the mark shows when collapsed); `favicon`/`apple_touch_icon` (else `app_icon`) via `brandedMetadata()`; `icon_192`/`app_icon`/`app_icon_maskable` + the tenant's theme colours in the manifest (`auth-web/app/manifest.webmanifest/route.ts`); `login_hero` behind the login hero panel; `push_icon`/`push_badge` carried IN the push payload by the sender (`notifications-service` follow-up checker, validated by `@platform/web-push` to same-origin brand-asset paths) because `public/sw.js` is static and cannot read a tenant; `email_logo` + the brand name in the team-management and reset emails (`loadEmailBrand`, fail-open to the platform fallback); `splash` is stored and served but not yet linked into the iOS splash tags. An empty slot shows the platform default.

**Platform default brand.** The default name, emblem and icon paths and manifest colours exist in ONE place: `DEFAULT_BRAND` (`@platform/ui-kit/branding/defaults.ts`, re-exported from `@platform/ui-kit/server`). Nothing else may spell the default brand name. `pnpm check:brand` (`scripts/check-brand-hardcoding.mjs`) fails the build on a hard-coded "FitClass"; `--locale` also lists ad-hoc date/number formatting still to move. Static by design (cannot read a tenant): `global-error.tsx`, the offline page (session-free so nothing outlives a session), `public/sw.js`, and the bundled default images.

**Regional formats (`locale_config`).** Super Admin managed (written with the other Super Admin fields via `PUT /sa/tenants/:id/branding`; the tenant admin sees them read-only), stored on `entity.tenant_branding`, whitelisted keys validated by `localeConfigSchema` (`@platform/validation`) and mirrored by `@platform/ui-kit/locale` (a test asserts the lists match): `locale, date_format, time_format, timezone, week_start, currency, currency_display, number_grouping, fiscal_year_start, phone_country_code`. `{}` = platform default (en-IN, DD/MM/YYYY, 12h, Asia/Kolkata, INR, Indian grouping, Monday, FY from April), so existing tenants see no change. `GET /me/branding` returns it as `locale`; `useLocale()` / `createFormatters()` are the one way to format a date, time, number or amount for display (a bare `YYYY-MM-DD` is a calendar date and never shifts a day; an instant honours a per-call `timeZone`, e.g. a branch's own). **Display only** — the database keeps UTC/ISO/NUMERIC and APIs keep their wire formats; a branch's `entity.organizations.timezone` still decides its working day. Screens and server-side exports/emails still using ad-hoc `toLocale*`/`Intl` are listed by `node scripts/check-brand-hardcoding.mjs --locale` and move over incrementally.

**Fine-tuned colour roles (`color_overrides`, schema 1.75.0).** The seed still derives the whole palette (Material 3 "fidelity" for the brand roles, fixed slate for surfaces / secondary / tertiary); on top of it a tenant admin (while the theme is unlocked), Super Admin, and — while unlocked — each user may hand-set individual roles. Stored **sparse** per mode: `{ light: { primary: '#0d4668' }, dark: { … } }` on `entity.tenant_branding.color_overrides` (tenant) and inside `iam.user_preferences.theme.color_overrides` (user). Roles not listed keep following the seed. 23 roles are editable (`COLOR_ROLE_IDS`: primary / secondary / tertiary families, background and the surface tiers, `onSurface`, `onSurfaceVariant`, `outline`, `outlineVariant`); **error and the status / categorical colours are fixed** and a body naming them is a 422. `onSurface` also drives `on-background`. **Server build gotcha (found on UAT, 2026-10-06):** `@material/material-color-utilities` 0.4.0 is ESM with extensionless internal imports, which webpack resolves but Node does not, so identity-service crash-looped with `ERR_MODULE_NOT_FOUND` the moment the new image started (0.3.0 loads but has a different API and different shades, so it is not a way out). `@platform/validation`'s build therefore ends with `scripts/bundle-theme-colors.mjs` (esbuild, devDependency) which inlines the library into `dist/theme-colors.js`; verify any change here by `require`-ing the built package inside a `node:20-alpine` container, not on the host.

- **Layering** (`resolveTheme`): platform default → tenant (seed + shades) → user. A layer that picks a different seed **drops everything beneath it** (shades tuned for one colour do not carry onto another) and applies its own; a layer that only carries shades or the mode leaves the seed alone and lays its shades on top, role by role. `buildScheme(seed, dark, overrides)` applies them over the derived shades; `buildFullScheme` is the always-complete variant used by the scoped preview. For the default seed in light mode with overrides only the overridden variables are emitted (theme.css still carries the rest).
- **Lock:** the DB trigger now also freezes `color_overrides`. While the theme is locked a user's colour overrides are not applied (the user layer carries only mode and text size) and a forged `color_overrides` in `PUT /me/preferences/theme` is ignored — the stored value is kept.
- **Readability floor (server-enforced):** text must keep **3:1** against its background (11 foreground/background pairs, `COLOR_CONTRAST_PAIRS`); below **4.5:1** the editor only warns. The check runs in the identity-service for every writer (tenant admin, Super Admin, user preference) against the shades the **effective seed** really derives for roles nobody touched, so the server carries a copy of the derivation: `@platform/validation` `theme-colors.ts` (`deriveColorRoles`, `findUnreadablePairs`, `seedFor`, `mergeOverrides`). A refusal is a 422 `COLOR_CONTRAST` with the failing pairs in `details.pairs`. Only a mode that carries overrides is checked. A seed change that makes a stored shade unreadable is refused too.
- **Drift guard:** `@platform/ui-kit/theme` `roles.ts` and `@platform/validation` `color-roles.ts` are separate copies on purpose (the browser must not bundle the engine with the Zod schemas); `theme/__tests__/color-overrides.test.ts` asserts the role list, contrast pairs, floors and preset seeds are identical **and that the server derives the same shade as `buildScheme` for every role, seed and mode**. Change both together.
- **UI:** `<FineTuneColors>` (`@platform/ui-kit`) is a collapsed "Fine-tune colours (optional)" row — role editor with per-role Reset, a preview scoped by CSS variables (light/dark, never recolours the page around it) and the Readability list with a one-click Fix. Hosts: tenant Branding (admin-web), Super Admin Tenant Branding (lookup-admin) and the user's Appearance modal (`base` = the company's shades so Reset returns to them; only the difference is stored; picking a new colour clears the user's own shades). Save is disabled while any pair is under 3:1.
- **Existing databases:** `db_scripts/one_time/apply_color_overrides.sql` (+ `_dryrun.sql`), then `apply_schema.ps1` (trigger + grants), **before** the new identity-service image (its SELECT names the column). Old images + new DB are fine.

Four constraints are baked into the generator and are easy to regress:

- **Every file is opaque RGB, backed with white.** iOS does not composite
  alpha at all and renders a transparent `apple-touch-icon` as a solid black
  square. White is the ground the emblem is drawn on, and its navy ring
  supplies the edge, so the icon still reads as a defined shape against both
  light and dark home screens.
- **The artwork is composited onto white BEFORE the downscale.** Resampling
  white-on-transparent RGBA directly produces dark fringing, because fully
  transparent pixels still carry RGB 0 and bleed into the antialiased edges.
- **The maskable icon keeps its artwork inside the centred 80% safe zone**
  (the generator uses a 76% content box). Android launchers crop maskable
  icons to a circle/squircle and anything outside that zone is clipped. The
  emblem is itself a circle, so it can use nearly all of the safe zone — a
  square lockup could only have used 80%/sqrt(2) = 57%.
- **The source is trimmed at an alpha threshold, not with `getbbox()`.** The
  master carries a band of near-invisible artefacts below the emblem (alpha
  <= 34, left over from the lockup's wordmark); a plain `getbbox()` includes
  them and pushes the emblem off-centre by ~40px.

Declaring `icons` in `pwa/metadata.ts` **suppresses Next's `app/icon.png`
file convention** for every app that spreads it, which is why the favicon has
to be listed there explicitly — omitting it drops the tab icon platform-wide.
Next does not basePath-prefix metadata icon hrefs (verified against
lookup-admin's `/sa`), so both entries stay origin-absolute and resolve
against auth-web at the root. The per-app `app/icon.png` files are therefore
unreferenced and still served at `<basePath>/icon.png`; the generator
overwrites all five with a copy of `favicon.png` so they cannot linger as
stale branding.

**Changing any icon is a service-worker change.** `sw.js` cache-firsts
`/icons/*` into `fc-static-<SW_VERSION>`, so installed clients keep serving
the previous artwork until `SW_VERSION` is bumped — see the release checklist
in `msq-deploy/deploy_linux.md`.

### UI emblem (`public/fitclass-emblem.png`, one copy per app)

The navbar (`AppNavbar.tsx`, every app) and four auth-web pages — `login`
(both the desktop aside and the mobile card), `no-access`, `offline`, and
`select-branch` — render the brand mark inline at a small fixed height
(`h-9`–`h-11`, 36–44px). All of them use `fitclass-emblem.png`, generated by
the same `scripts/generate-pwa-icons.py` as the icon set above, one copy per
app's `public/` (`UI_EMBLEM_DESTS`) — same distribution convention as
`fitclass-logo-white.webp`.

**These spots used to point at `fitclass-logo-white.webp` (the full square
lockup) and it rendered as an illegible smudge everywhere.** The lockup's
real file is square (1600x1600, aspect 1:1: emblem circle, "FITCLASS"
wordmark, and the tagline stacked vertically inside that square). Every one
of these call sites passed `next/image` a `width`/`height` prop describing a
*wide* aspect ratio (e.g. `220x50`, ~4.4:1) that did not match the real file,
paired with a CSS class like `h-9 w-auto object-contain`. The browser used
the declared (wrong) aspect ratio to size the element box — wide and short —
then `object-contain` fit the *real* square content inside that box by its
constraining dimension (the height), rendering the entire lockup, wordmark
and tagline included, into a ~36–44px square. At that size the stacked text
is not readable — confirmed live via an incognito fetch of the page (ruling
out any cache) and reproduced byte-for-byte by simulating the same CSS box
math in Pillow.

The fix is the same one already applied to the icon set: use the **emblem
alone** (no wordmark, no tagline) everywhere it has to render small, sized
correctly (`width={160} height={160}`, matching the real 1:1 file, so
`object-contain` no longer has a mismatched box to shrink into). Unlike the
icon set, this asset keeps a **transparent surround** rather than a white
fill — it has to sit on both the navbar's white background and the navy
(`#0b1f3a`) login/offline/no-access/select-branch cards without a visible
square edge on either. The lockup file remains correct and unchanged for any
future spot with enough room to render the wordmark and tagline legibly
(there is currently no such spot).

This is also a service-worker-cached asset (`.png` matches `isStaticAsset()`
in `sw.js`) — bump `SW_VERSION` whenever it changes, same as the icon set.

## Tenant provisioning & default catalogs (P3B)

A brand-new tenant is provisioned with a **private copy** of each licensed product's lookup catalog via `seedTenantDefaults(tenantId)` (`@platform/db`, backed by `entity.seed_tenant_defaults()` in `23_tenant-default-catalogs.sql`). Call it **after** the tenant's `entity.tenant_modules` rows are inserted — only catalogs whose gating module the tenant licenses are seeded. It runs under `withServiceTx` (BYPASSRLS system op; `tenantId` is server-derived at provisioning, never client input) and is idempotent — a catalog already recorded in `entity.tenant_catalog_versions` is never re-seeded, so re-running provisioning never clobbers a tenant's later edits.

Defaults are **versioned and immutable**: `entity.catalog_defaults` holds the rows per `version`, `entity.catalog_versions` points at the `current_version` a new tenant gets. Because seeding copies rows into the tenant's own tables, editing a default (shipped as a new version + `current_version` bump) only affects **future** tenants — existing tenants are never touched retroactively. An explicit opt-in `resetTenantCatalog(tenantId, catalogKey, version?)` restores one catalog to a default version (re-adds deleted defaults, restores default label/flags/sort_order, preserves row ids so FKs stay valid, leaves tenant-custom rows alone). See DB_model.md → "Tenant default catalogs". Wiring these into a self-serve provisioning API and the `lookup-admin` reset UI is Phase 3C.

## Shared packages

All packages live in `packages/` and are consumed via workspace references (`@crm/*`). They compile to ESM via `tsc` (`"module": "NodeNext"`). Services import from them; they never import from each other (no circular deps).

### Platform packages (`msq-core/packages/`)

| Package | Folder | Purpose |
|---|---|---|
| `@platform/db` | `db` | Connection pools, Drizzle schema, transaction helpers, blocklist |
| `@platform/types` | `types` | Shared TypeScript interfaces |
| `@platform/validation` | `platform-validation` | Zod schemas for request validation (folder is `platform-validation`; package name is `@platform/validation`, not `@crm/validation`) |
| `@platform/authz` | `platform-authz` | Identity/tenancy checks (`hasRole`, `hasMinimumRole`, `hasAnyRole`), org-scope resolution, user-management rank gates, product-grant primitive (`hasProduct`/`assertProduct`), and the coarse platform-tier `RANKS` + `platformRank()` (the shared cross-product ladder was dissolved in P1.3) |
| `@platform/rbac` | `rbac` | The capability primitive — `can(actor, CAPABILITY.…)` — read by the gateway, every service, `@platform/db`, and `@platform/ui-kit` for UI gating (see "UI gating reads capabilities" below) |
| `@platform/ui-kit` | `ui` | Shared Next.js shell/middleware for every product app — `AppSidebar`, `MobileSidebar`, `UserMenu`, `ProductSwitcher`, `createProductMiddleware()` (SSO cookie verification + redirect), `shell/nav` (`NavGroup`/`filterNavGroups`; each `NavItem` may name an `icon` drawn by `shell/NavIcon` — inline Lucide-derived SVGs keyed by name so nav configs stay plain data, plus the custom `fan-out` glyph for Bulk Assign; an entry without one falls back to its initials in the collapsed rail), `branchOptionsForActor`; plus the filter-toolbar primitives every screen's filter bar is built from — `MultiSelect`, `UserPicker`, `FilterField` (the label-over-control wrapper that keeps a bare input on the same baseline as a `MultiSelect`) and `useAnchoredPanel` (fixed-position geometry for a dropdown that must escape a dialog; anchors by `bottom` when it flips upward) |
| `@platform/audit-log` | `audit-log` | `logActivity()` — fire-and-forget writer to `audit.activities`, called in-process by every service (see "Activity logging") |
| `@platform/blob-storage` | `blob-storage` | Avatar/photo byte storage driver — backs `iam.users.photo_key` and the punch-selfie store used by face verification |
| `@platform/http` | `http` | Shared HTTP client helpers for inter-service calls |
| `@platform/logger` | `logger` | Shared `pino` logger wrapper |
| `@platform/service-auth` | `service-auth` | Internal-service-secret auth — verifies the gateway-injected `X-Internal-Secret` header |
| `@platform/auth-constants` | `auth-constants` | `authCookieName()` (per-env session cookie name), `hs256Accepted()`, `requireStrongSecret()`, JWT issuer/audience and other auth constants |
| `@platform/team-web` | `team-web` | Shared team-management UI (`TeamShell`, `TeamTable`, `CreateUserModal`, `EditUserModal`, `ResetPasswordModal`) — extracted out of `admin-web` for reuse |
| `@crm/permissions` | — | **Deprecated compat barrel** — re-exports the four `*/authz` packages so existing imports keep working; being migrated away and then removed |
| `@crm/internal-client` | — | HTTP client for inter-service calls (superseded by `@platform/http` in newer services) |

### Grids share one column-filter config (`@platform/ui-kit/grid`)

Every grid in the platform is a bare `AgGridReact` (AG Grid 35.3 Community) — there is no wrapper component, and each of the six grid files used to declare its own copy of `defaultColDef` with no `filterParams` at all, so column filtering ran entirely on undocumented AG Grid defaults.

`@platform/ui-kit/grid` is now the single source of truth for that config: `GRID_DEFAULT_COL_DEF` (assign it straight to the grid's `defaultColDef`), `TEXT_FILTER_PARAMS`, and `normalizeFilterText`. `normalizeFilterText` is wired in as the text filter's `textFormatter`, which AG Grid applies to **both** the cell value and the text typed into the filter box — NFD-normalise, strip combining marks, trim, lowercase — so a column filter matches regardless of case, accents or stray whitespace, and stays that way across AG Grid upgrades rather than depending on `caseSensitive` happening to default to `false`.

Two rules when adding a grid:

- **Assign `GRID_DEFAULT_COL_DEF`; never re-declare the literal.** It is a module-level constant, so no `useMemo` is needed. The shared default deliberately does **not** set `filter` — columns opting out with `filter: false` (the pinned action columns, FollowUpGrid's "Due In") must stay off, and number/date columns must keep resolving to their own filter type instead of being forced to text.
- **A column whose `cellRenderer` shows a label must have a `valueGetter` returning that same label.** The filter matches the column value, so a Status column rendering a `StatusBadge` reading "Call Attempted" while its `valueGetter` returned the raw stage `contacting` made typing the on-screen text return nothing (fixed in `LeadsTable`).

The module is exposed on the `./grid` subpath, not the root barrel, and imports nothing from `ag-grid-community` — apps with no grid (`auth-web`, hr-web, todo-web) import `@platform/ui-kit` and must not be made to resolve AG Grid.

Current grids: `TeamTable` (`@platform/team-web`, also lookup-admin's Users), `LookupTable` (lookup-admin), `LeadsTable` + `FollowUpGrid` + `LeadsHistoryShell` (`@lms/web`).

### Per-product packages (nested repos: `msq-lms`, `msq-hrms`, `msq-todo`)

Each product repo carries the same three-package shape, plus a web-component package consumed by that product's own app (and cross-linked from `admin-web`/`lookup-admin` where relevant):

| Product | Authz | Validation | Web components |
|---|---|---|---|
| LMS (`msq-lms/packages/`) | `@lms/authz` — sales roles + LMS business rules (`leads`, `assignments`, tenant business rules) + `LMS_RANKS` | `@lms/validation` | `@lms/web` |
| HR (`msq-hrms/packages/`) | `@hr/authz` — leave/attendance/employee management authority | `@hr/validation` | `@hr/web` |
| Tasks (`msq-todo/packages/`) | `@task/authz` — task scope gates | `@task/validation` | `@task/web` |

## Lookup table administration

`services/admin-service` (port 4006) exposes super_admin-only REST CRUD (GET list, POST create, PATCH update — no hard delete) at `/lookups/{slug}` through the gateway for the 4 remaining **shared** system-wide lookup tables: `entity.org_types`, `entity.tenant_domains`, `entity.tenant_plan_types`, `iam.user_roles`. (Post N-6, every product-schema lookup — including the 7 formerly-here `lms`/`marketing` marketing lookups `lead_stage`, `lead_stage_outcome`, `interaction_types`, `follow_up_statuses`, `lead_sources`, `marketing_platforms`, `campaign_statuses` — moved to its owning product service and became tenant-scoped; see "Tenant-scoped lookup tables" below.)

`services/admin-service` also exposes super_admin-only REST CRUD (GET list, POST create, PATCH update — no hard delete) for `entity.tenants` at `/lookups/tenants[/:id]` and for `entity.organizations` at `/lookups/organizations[/:id]` (tenant-scoped; includes geo address fields — country/state/city).

### Tenant-scoped lookup tables (P3.1 + P3.3 + N-6)

`db_scripts/22_tenant-scope-lookups.sql` (P3.1) converted 8 lookup tables to per-tenant catalogs (`task.task_statuses`, `task.task_priorities`, `hr.leave_types`, `hr.employment_types`, `hr.attendance_statuses`, `lms.roles`, `hr.roles`, `task.roles`), and `db_scripts/26_tenant-scope-lms-lookups.sql` (N-6 Half B) did the same for the 7 remaining `lms`/`marketing` marketing lookups (`lms.lead_stage`, `lms.lead_stage_outcome`, `lms.interaction_types`, `lms.follow_up_statuses`, `lms.lead_sources`, `marketing.marketing_platforms`, `marketing.campaign_statuses`) — repointing every dependent FK (`marketing_leads`, `lead_follow_ups`, `lead_status_log`, `lead_interactions`, `ad_campaigns`, `lead_stage_capi_event_map`) to per-tenant copies. All 15 now carry `tenant_id NOT NULL`, are unique per `(tenant_id, name)`, and have RLS. Runtime RLS is **SELECT-only** for ordinary `app_user`/`tenant_admin` (tenant users never edit their own catalog); super_admin **management** writes go through a separate tenant-pinned admin RLS policy — see below.

**N-6 — who owns the admin CRUD (complete).** Every product-schema lookup/role table's super_admin management CRUD (`/lookups/{slug}`) lives in the **owning product service**, not admin-service — the 8 above plus the 7 LMS marketing lookups all route to **leads/hr/tasks-service** (`task-*` → tasks-service; `leave-types`/`employment-types`/`attendance-statuses`/`hr-roles` → hr-service; `lms-roles` + the 7 marketing lookups → leads-service). A shared service cannot write `lms`/`hr`/`task` after the D8 per-product grants, and routing through `root_service`/BYPASSRLS would defeat both isolation axes — so instead the product service (whose login `lms_svc`/`hr_svc`/`task_svc` is a member of `app_user`) performs the write via `@platform/db withTenantConfigTx`, which pins `app.current_tenant_id` to the super_admin-**selected** tenant (the required `?tenant_id=` query param). `db_scripts/25` (the 8) and `db_scripts/26` (the 7) add a permissive `FOR ALL TO app_user` admin policy on each table keyed on `app.current_tenant_id` plus `INSERT, UPDATE` GRANTs scoped to that product role — so a write is **physically confined to the selected tenant's rows** (cross-tenant contamination is impossible), and normal runtime traffic (which sets `app.current_org_id`, never `app.current_tenant_id`) gets nothing extra. The gateway proxies `/lookups/{slug}` to the product service (ungated at the entitlement layer — super_admin is platform staff, not a product licensee); the product service enforces the super_admin gate via `authenticateSuperAdmin` (platform-role gate, not product membership). The repositories keep an explicit `WHERE tenant_id` as defense-in-depth.

> **Runtime reads** of the now-tenant-scoped LMS lookups are scoped by RLS: reads under `withRoleTx` (the leads UI dropdowns, lead create/transfer) auto-filter to the caller's tenant. The two BYPASSRLS (`withServiceTx`) paths that resolved a stage/source by name — gateway-less **intake** (`'new'` stage, named source) and cross-org **transfer** (`'new'`/`'transferred_out'`) — were made explicitly tenant-scoped via the lead's `org_id → tenant`.
>
> **New-tenant seeding (follow-up):** a tenant created after `26` runs gets zero rows in these 7 tables until seeded, and `marketing_leads.stage_id` is `NOT NULL` — so lead intake for a brand-new tenant needs these 7 wired into the versioned catalog-defaults (`db_scripts/23` / `seedTenantDefaults`), the same two-step pattern P3.1→P3.2 used for the first 8. Tracked in `26`'s KNOWN FOLLOW-UP.

`apps/lookup-admin` (port 3005) is a separate Next.js app providing the super_admin-only web UI for managing these lookup tables, tenants, and organizations (all 15 tenant-scoped tables now via their owning product service; the 4 shared iam/entity lookups + tenants/organizations via admin-service), plus a Users management UI (`app/dashboard/users/`) — `@platform/team-web`'s `TeamShell` scoped to the navbar's selected tenant/branch via `UserAdminScopeProvider` (see "Super admin: another tenant's users, by explicit scope"). For the 15 tenant-scoped tables, the table page renders a `TenantSelector` (a `<select>` driven by the URL's `tenant_id` search param) above the grid; no tenant selected means an empty/prompt state instead of a fetch, and "New"/edit actions (and parent-lookup option fetches, e.g. lead-stage for a stage-outcome) pass the selected `tenant_id` through. This selector is advisory only — the real enforcement is the backend's required `tenant_id` query param, the `authenticateSuperAdmin` gate, and the tenant-pinned admin RLS.

**Shell (module-grouped nav).** The dashboard is built on `@platform/ui-kit/shell` (the same `AppSidebar`/`MobileSidebar`/`UserMenu` chrome every product app uses). The left rail groups every table by `LookupTableDef.module` (`platform`/`lms`/`hr`/`tasks`/`capabilities`, see `src/lib/lookupTableConfig.ts`) via `NavGroup`/`filterNavGroups` (added to `@platform/ui-kit/shell/nav` for this); each module's rail icon comes from `ModuleDef.icon` — flat `NavItem[]` usage in the other product apps is untouched. Each group lands on `/dashboard/m/[module]`, a card pane listing that module's tables (plus a few hand-built screens folded in as extra cards: Users and Catalog Versions under Platform, Meta Page Mapping / Meta Campaign Mapping / Meta Lead Pull under LMS, the Capability Matrix under Capabilities); a table card opens the existing `/dashboard/lookups/[table]` CRUD page.

**FK fields.** `LookupFieldConfig`'s old `select`/`geo-select` types (backed by a bare `selectOptionsFrom` string, plus a hardcoded country→state→city cascade component) were replaced by a single `fk` type carrying an `FkConfig` (`table` or `endpoint`, optional `dependsOn` for chaining, `scope: 'tenant'|'global'`). One `FkSelect` component resolves the option list, chains to any depth (the geo cascade is now just three ordinary fields), disables until its parent has a value, and surfaces a fetch error instead of silently rendering an empty list.

**Meta page → branch mapping.** The LMS module exposes a bespoke screen at `/dashboard/meta-mappings`
(registered as an `EXTRA_CARDS` entry on `/dashboard/m/lms`, not in `lookupTableConfig.ts`) for
`ext.meta_page_form_org_map` — the table that decides which branch every inbound Meta lead lands
in. It reads and writes the gateway's `/meta/page-org-map` routes (super_admin, `?tenant_id=`), with
`/meta/pages` populating a page picker so an admin selects a named Page instead of pasting a raw
numeric id. Page discovery is best-effort: it spends the tenant's stored Meta credentials on a live
Graph API call, so a tenant with no active integration degrades to a raw-id input rather than taking
the screen down. The table does not fit the generic `[table]` grid — a row is a `(page_id, form_id)`
routing key, and a **NULL `form_id` is meaningful** (the page-level catch-all covering every form on
that page, at most one active per page). `page_id`/`form_id` are immutable on edit (they are the
row's identity); only branch and `is_active` are patchable, and removal is a deactivate, never the
DELETE route. The navbar org scope narrows the grid **client-side**, because the list route validates
its query with `tenantScopedQuerySchema` (tenant_id only) and would silently drop an `org_id`.

**Meta lead pull.** The LMS module also exposes a bespoke screen at `/dashboard/lead-pull`
(registered as an `EXTRA_CARDS` entry on `/dashboard/m/lms`, not in `lookupTableConfig.ts`) that moves
the three-stage backfill CLI (download -> reconcile -> import) a developer used to run by hand into a
button: pick branches/pages/campaigns and a required `since` date, `POST /meta/lead-pull/runs`
(super_admin, `?tenant_id=`) enqueues a background run and returns immediately with a `run_id`, and
the client polls `GET /meta/lead-pull/runs/:runId` — backing off when the tab is hidden, stopping once
the run reaches a terminal status (`completed`/`failed`/`applied`). The delta summary renders the
run's live `verdict_summary` (computed from the staged rows, not the run's own `counts.verdicts`
snapshot), and every number opens the staged rows behind it via `GET .../runs/:runId/leads?verdict=`
in an AG Grid. `POST .../runs/:runId/apply` is enabled only once a run is `completed`; it is
idempotent server-side (re-applying inserts nothing — every row comes back `already_synced`), but the
button still disables during `applying` rather than relying on that alone. The two duplicate verdicts
(`phone_duplicate`, `email_duplicate`) are importable on purpose — the UI explains why next to the
Apply button, matching the backend comment in `lead-reconcile.service.ts`. The campaign filter is
applied **post-fetch** (Meta has no campaign-scoped lead edge), and the form says so next to the
campaign control so narrowing it is never mistaken for making the pull cheaper. A `truncated` run
(the per-form Graph page cap was hit) renders a prominent, non-dismissable warning rather than a
footnote, since the pull's data is then genuinely incomplete. Page discovery reuses the same
best-effort `/meta/pages` call `meta-mappings` makes and degrades the page filter to a typed
comma-separated id list under the same conditions.

**Known doc/code mismatch (reported, not worked around):** the phase brief that drove this screen
lists `hiring_form` as its own verdict bucket. `lead-reconcile.service.ts` does not classify leads
that way — that behaviour was deliberately removed once campaign types could route a recruitment
lead somewhere (see that file's header comment). A lead on a hiring-shaped form still gets a normal
verdict and is separately flagged per row with `is_hiring_form` + `suggested_campaign_type_id`; the
UI surfaces that as a badge in the staged-leads grid rather than as a summary bucket that does not
exist server-side.

**Capability administration.** The Capabilities module additionally exposes a Capability Matrix screen (`/dashboard/capabilities/matrix`) for granting/revoking `iam.capabilities` nodes to a role, per tenant — the UI side of the endpoints documented above. It reads the global capability tree once, then per (tenant, role) reads `iam.role_capabilities` (platform defaults + that tenant's overrides) and PUTs the diff. `iam.capabilities`/`iam.role_capabilities` gained Drizzle table definitions in `@platform/db/schema` for this (they previously had none, despite existing in the DB since Tier C3). Role catalog CRUD (the `user-roles`/`lms-roles`/`hr-roles`/`task-roles` cards in this module) still goes through the existing `/lookups/{slug}` tables, unchanged.

> **RLS note:** `iam.role_capabilities`' `admin_tenant_config_policy` (`db_scripts/06_rls.sql`) derives the writable tenant from the actor's **current org** (`app.current_org_id → entity.organizations.tenant_id`), not `app.current_tenant_id` directly — unlike the newer N-6 product-lookup policies that `withTenantConfigTx` targets. A super_admin managing an arbitrary tenant has no "current org" there, so the write path (`capabilities.repository.ts`) resolves one org under the target tenant and pins `app.current_org_id` to it before writing.

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
- `iam.fn_user_can_manage_users(user_id, org_id)` — may this actor create/manage users in **that** org (SECURITY DEFINER; capability, not rank — see User management below)

### Meta-specific tables (`ext` schema)
- `ext.meta_org_config` — per-org Meta credentials, pixel ID, CAPI trigger stages, `field_mappings` (JSONB, runtime-reloadable form field key overrides)
- `ext.meta_leads` — raw Meta lead data (BIGINT meta_lead_id) linked to lms.marketing_leads via FK
- `ext.meta_lead_custom_fields` — unmapped form fields (1:many)
- `ext.meta_lead_addresses` — address fields from Meta lead forms (1:1)
- `ext.meta_lead_professional` — job/company fields from Meta lead forms (1:1)
- `ext.meta_lead_demographics` — demographic fields from Meta lead forms (1:1)
- `ext.meta_capi_outbound_logs` — CAPI event audit trail with idempotency index

## Tooling & operations

Operational tooling that sits outside the request-flow diagram — not user-facing products, but part of "every tool we have."

| Tool | Location | Purpose |
|---|---|---|
| **msq-e2e-validation** | own nested git repo (gitignored) | Playwright-based E2E validation harness that crawls every UI tool with every role, cross-checks results directly against Postgres, and produces severity-ranked findings (`results/SUMMARY.md`). Suites: `core` (auth-web + lookup-admin), `lms`, `hr`, `todo`, `capability`, `concurrency`, `visual`, `admin`, `tenant`. |
| **msq-deploy/** | repo root | Deployment tooling — `build-deploy.ps1` builds/ships images; `artifacts/` bundles compose files + `db_scripts/` + `bootstrap-db.sh`/`deploy.sh` for target servers; `pg-backup/`/`pg-restore/` are cron-driven DB backup/restore scripts; `reports/` runs the daily lead-report job (`send-lead-report.sh` + cron setup, the job behind `lms.lead_report_snapshot`); `retention/retention-cleanup.sh` + `setup-cron.sh` install the daily punch-selfie retention job referenced in "Face verification" above. |
| **scripts/** | repo root | `setup-env.js` (env scaffolding), `docker-ship.sh`/`docker-load.md` (image build/transfer between environments), `clean.js` (`make clean`/`clean-all`: dist/.next per workspace, plus a tree-wide sweep of .turbo, tsbuildinfo, Python caches and — `all` only — node_modules/venvs, covering non-workspace dirs like msq-e2e-validation and msq-lms/meta-sync-scripts). |
| **db_scripts/tools/** | repo root | One-off tenant/org operational SQL scripts (branch onboarding, lead redistribution, deactivation), each paired with a `_dryrun` variant. |
| **db_scripts/apply_schema.ps1 / db_deploy.ps1** | repo root | Schema apply/deploy runners — see `db_scripts/README.md` for file ordering (`00`–`10` base files, then `reference_data/`, then any pending `one_time/` scripts). |
| **infra/** | repo root | `Caddyfile` (the local SSO reverse-proxy config, see the `caddy` service in the request-flow diagram above) and `maintenance.html`. |

Also see "Database pools" above for the three postgres.js connection pools, and `docs/DB_model.md` for the full schema reference.

## Text size (2026-10-05)

Users pick one of four text sizes (Small 87.5 % / Default 100 % / Large 112.5 % / Extra large 125 %) in **User menu → Appearance → Text size**. It is stored as `font_size` in `iam.user_preferences.theme` (no DDL), validated by `themeChoiceSchema`, gated by the existing `platform.appearance` capability, and — unlike colour and font — **not** covered by the tenant theme lock. `<ThemeStyle>` emits it as `html{font-size:<pct>%}` so every rem-based token, spacing and grid scales together; a save reloads the page (server-rendered, no flash). Rules that make it work: new code uses rem/tokens, never `text-[Npx]` (the ~270 existing ones were converted to `text-[N/16rem]`); AG Grid CSS is rem and `rowHeight`/`headerHeight` go through `scalePx()` from `@platform/ui-kit/grid`; chart font sizes are rem strings. Not themed on purpose: payslip print, emails, `global-error.tsx`.

**Guard:** `pnpm check:theme` (`scripts/check-theme-tokens.mjs`) fails on hex colours, raw palette classes (`slate-*`, `bg-white`…) and px font sizes in all frontends. Skipped on purpose: `global-error.tsx`, payslip print, emails, manifests, `theme.css`.

## auth-web session pages — Stitch redesign (select-branch, change-password, offline, no-access)

All four now render through `components/auth/AuthCard` (centred card, theme tokens only; `width="lg"` for the branch list, `topSlot` for a static brand mark, `iconTone="error"` for denial screens). Behaviour, routes, API calls and form ids (`#cur-pw`, `#new-pw`, `#confirm-pw`) are unchanged.

- `/select-branch`: branded card (session tenant via `getEffectiveBranding`), one full-width row per branch, tenant grouping kept for super admins, `· Default` marker kept (the e2e login helper clicks the row containing it). A client-side search box appears when there are more than 6 branches (filters the already-fetched list; display only).
- `/change-password`: unchanged flow; "Cancel and go back" moved inside the card (voluntary change only); 44px fields/buttons.
- `/offline`: static and session-free by design (cached by the service worker, must survive logout). "Try reconnecting" is a plain same-URL link so it works even when the cached page cannot hydrate. No cached-data/"work offline" promises.
- `/no-access`: same facts as before (email, branch, organisation, role) plus a "Switch branch" link to the existing `/select-branch` picker; sign-out stays.

## LMS leftovers — Stitch redesign (Assignments, Leads History, No Access)

- **Assignments** (`AssignmentsClient`): header card in the same pattern as Leads/Follow-ups; 44px search, New assignment and mobile Edit taps; mobile cards now show the Superseded pill too. A status banner appears when any row has no assignee (derived from the rows already loaded). Behaviour, routes, `canOpenAssignments` gate and the assignee modal are unchanged. The design's counselor-weight console (weight, availability, "receives no leads" at weight 0) is **not built**: `GET /assignments` returns lead assignments, and no endpoint exposes `lms.lead_assignment_weights` to the web app.
- **Leads History** (`LeadsHistoryShell`): filters lay out as a 2-column grid on phones with 44px controls and 44px History button; mobile cards regrouped (date + branch, lead, stage/outcome/source strip, assignee). Data, filters, server-side sort and the `lms.history.detail.view` gate unchanged. The design's audit-trail rows (field changed, from -> to, changed by) and KPI tiles are not built: the list is leads, not mutations.
- **No Access** (`/dashboard/no-access` -> `NoAccessCard` in `@lms/web`): replaces the "coming in a later phase" `Placeholder` with an explanatory card (signed-in name/email, role label, branch, guidance) and a Sign out button (`auth.logout()` then full navigation to `buildLoginUrl()`). The page stays gated on the session only, never on a capability (loop guard).

## admin-web / team-web — Stitch redesign (Admin Home, Team, API Tokens, Branding)

Presentation only; routes, API calls, capability gates and validation are unchanged.

- **Admin Home** — `PageHeader` + `PageBody`; cards are still derived from `ADMIN_NAV` filtered by capability, now with the nav icon and a chevron (row-style on phones).
- **Team** (`@platform/team-web`, also mounted by LMS and lookup-admin) — `TeamShell` uses `PageHeader` (scope switcher + New user as actions). `TeamTable` keeps AG Grid on desktop (pinned `button[title="Edit"]` kept for e2e), adds initials avatars, and renders separate cards on phones with 44px Edit targets. Create/Edit user use the new `Sheet`.
- **API Tokens** — table gains a client-side name/key/scope filter and status chips (counts derived from the loaded rows); scope chips and key pill; cards below `lg`. Create/Edit use `Sheet`; Rotate/Revoke stay `Modal` confirms.
- **Branding** — `PageHeader` chrome, 44px controls on phones. Locked-theme and read-only asset/name/login-key behaviour untouched.
- **`Sheet`** (`@platform/ui-kit`, `components/Modal/Sheet.tsx`) — same contract as `Modal` but a full-screen sheet on phones and a right-hand drawer from `sm` up.
- Leave / Attendance administration are rendered by `@hr/web` (`LeaveAdminShell`, `AttendanceAdminShell`) and belong to the HR redesign, not this package.

## Concurrency backstops and client-error mapping (schema 1.74.0)

Found by the cycle-6 E2E run (see `openissues.md`).

- **Leave decisions are serialised per request.** `hr-service leave.repository.ts loadRequestForAction(tx, id, { lock: true })` takes `FOR UPDATE OF lr` for approve, reject, amend, cancel and request-info. The second of two simultaneous decisions waits, re-reads the committed status and fails the `pending` check with 409. The approval UPDATE is also conditional (`AND action = 'pending' ... RETURNING`), so a stale reader can never decide a level twice. Before this, approve + approve wrote two `consumption` rows and debited the balance twice. Backstop: `uix_leave_ledger_consumption` (one consumption row per request). Read-only callers (`getRequestApprovals`) must not pass `lock`.
- **Lead transfer is serialised and typed.** `leads.service.transferLead` resolves the lead's real branch with `resolveLeadOrgId` + `leadWriteCtx` (same as update/delete), so tenant admins, multi-branch managers and super_admin can transfer a lead outside their session branch, and an invisible lead is a 404. `leads.repository.transferLead` reads the source `FOR UPDATE`: unknown lead 404, already transferred 409, target branch missing or in another tenant 404 (identical answer, nothing leaks). Backstop: `uix_lead_links_transfer_source`.
- **Postgres class-22 data errors are 400s.** `translatePgError` (hr-service, leads-service, meta-conversion-api, tasks-service) maps `22P02` (bad uuid/int), `22007`/`22008` (bad or impossible date, month 13), `22003` (out of range), `22021`/`22P05` (NUL byte) to `400 One of the supplied values is not valid`. Route-level `params`/`query` schemas are still the primary defence; this is the backstop so a future route cannot answer a malformed id with a 500. The four copies are identical; keep them in step until they move to a shared package.

**Minimum rest between shifts (schema `1.77.0`).** The hard-coded 11-hour rule is now policy. `hr.attendance_rules.min_rest_hours` (default 11, 0-24, 0 = off; tenant default row, org row overrides, edited on Attendance admin -> Rules -> Roster) and an optional per-shift `hr.shifts.min_rest_hours` (NULL = follow the policy); the gap between two shifts is owed to the shift that starts after it, so that shift's value wins. The roster planner (`PUT /hr/attendance/planner/cells`, `POST /hr/attendance/planner/reallocate`) no longer skips a person who would break it: nothing is written for them, they come back in `warnings`, and the UI offers "Assign anyway", which re-sends only those people with `confirm_rest_warnings: true` (audited as `rest_warning_confirmed`). Shift swaps honour the same policy but still refuse. Existing databases: `db_scripts/one_time/apply_min_rest_hours.sql`; deploy it before the hr-service image.

**Cycle-7 fixes (schema `1.78.0`, 2026-10-09).**
- `iam.departments`: `tenant_admin` now holds INSERT/UPDATE and its policy is `FOR ALL` with a tenant `WITH CHECK`, so department create/edit no longer 500s. One-shot: `db_scripts/one_time/apply_departments_tenant_admin_write.sql` (also enables deny-all RLS on the `iam.*_bak_*` capability backups).
- `DELETE /hr/profile/me/contacts/:id` soft-deletes in a service transaction (the `self_policy` `WITH CHECK ... NOT is_deleted` rejects a soft delete under the caller's role) with the `user_id` predicate from the session.
- `POST /hr/payroll/admin/:month/{publish,lock,unlock}` validate `:month` (`payrollMonthQuerySchema`) and `monthStart` throws `BadRequestError`: a malformed month is a 400.
- `GET /analytics/dashboard/campaigns` is branch-scoped unless the caller holds `lms.analytics.org.view` (same rule as the dashboard).
- Lead edit: a role without `lms.followups.create` is not offered follow-up stages and the form never sends follow-up fields.
- Gateway: `PUT /tenants/:id/modules` is `withSuperAdmin`; `/auth/reset-password` has its own rate-limit bucket (failed resets no longer lock login).
- `@platform/ui-kit` `LocalDateTime` renders timestamps without a hydration mismatch (fixed en-US/UTC on the server, the browser's locale after mount); used on API Tokens, Branding and the Meta admin screens.

## Info tips and dense pages (2026-10-09)

Explanatory copy no longer sits in the page body. `@platform/ui-kit` exports `InfoTip`, a 10px (i) with a 7px "i" and a padded hit area, that opens a tooltip on hover, click or Enter and closes on Escape or an outside press. `PageHeader` and `PageSection` take an optional `info` prop that renders it beside the title, and `PageBody` takes an optional `dense` prop (`space-y-3 px-3 pb-4 pt-3 sm:px-4`). Defaults are unchanged, so unconverted screens do not shift. Keep `subtitle` to a short phrase. Errors, warnings, validation and status banners stay on the page; only reference copy moves into the tip. Converted (2026-10-09): every Super Admin screen (Meta pipeline, Campaign Types, Capability Matrix, module consoles, lookup tables, tenant branding), admin-web (Admin home, Branding, API Tokens, Team, Attendance and Leave admin), LMS (Analytics, Follow-ups, Bulk assign, Assignments, Leads history), HR (Profile, Planner, Attendance, Leave, Reports, Documents, Payroll, Employees, Team roster, Approvals, Org chart) and Tasks (Lists, hub, detail). The four Super Admin screens that rendered a bare `p-4 sm:p-6` div when no tenant is selected (Lead Pull, Page Mapping, Campaign Mapping, CAPI Outbox) now use `PageHeader` and `PageBody`. Cards that are links (module console, Admin home) place the (i) beside the link, never inside it, because a button nested in an anchor is invalid. Not converted on purpose: auth-web, the LMS no-access page, status banners, warnings and form validation. Stat-tile hints in Tasks and HR stay visible because most carry data.
