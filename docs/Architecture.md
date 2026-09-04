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
| POST | `/assignments/bulk` | leads |
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
| GET/POST | `/lookups/organizations` (super_admin only) — GET lists orgs **across all tenants** (each row carries `tenantId`; callers filter client-side). This is lookup-admin's org source for the navbar Org scope and the departments `org_id` FK; identity-service's `/orgs/all` is NOT usable there, as it omits `tenant_id` and is pinned to the caller's own tenant | admin-service |
| PATCH | `/lookups/organizations/:id` (super_admin only, tenant-scoped) | admin-service |
| GET | `/capabilities` (super_admin only) — the global `iam.capabilities` tree (tool→page→tab→operation→scope) | admin-service |
| GET | `/roles/:id/capabilities?tenant_id=` (super_admin only) — platform defaults + this tenant's overrides for one role | admin-service |
| PUT | `/roles/:id/capabilities` (super_admin only) `{ tenant_id, grants: [{capability_id, is_granted}] }` — upserts tenant override rows in `iam.role_capabilities` | admin-service |
| GET | `/departments?tenant_id=` (super_admin only) — read-only; `iam.departments` is written by hr-service | admin-service |
| POST | `/hr/attendance/check-in`, `/hr/attendance/check-out` | hr |
| GET/PUT | `/hr/attendance/rules`, `/hr/attendance/rules/admin` (incl. `require_face_match` / `face_match_threshold` / `face_match_action` / `photo_change_cooldown_days` / `image_retention_days`) | hr |
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

- **Cookie**: `fc_session` (httpOnly, sameSite=lax, `path=/`, secure in production). `COOKIE_DOMAIN` is now **host-only** (`app.localhost` / `apps.fitclass.in`, no leading dot): all six apps share one origin and differ only by path prefix, so `path=/` alone carries the session across `/lms`, `/hrms`, `/todo`, `/admin` and `/sa` — one login authenticates all. Dropping the leading dot is a **tightening**: the cookie is no longer offered to any sibling subdomain. Moving to a new host logs everyone out once, by design, since the old parent-domain cookie is not sent to it.
- **Algorithm**: HS256 with `JWT_SECRET` by default; RS256 when `JWT_PRIVATE_KEY`/`JWT_KID` are configured (public key served via JWKS). Verifiers — gateway, identity-service, and every web app's Edge middleware + server session helpers (`@platform/ui-kit`) — select the key by the token's `alg` header, so both coexist during migration. In the split topology (P4.3) product apps carry **only** `JWT_PUBLIC_KEY` (verify); identity-service alone holds the signing key. Issuer `fitclass-crm`, audience `fitclass-crm:web`.
- **SSO across product apps (P4.3)**: each product app's `middleware.ts` is `createProductMiddleware()` from `@platform/ui-kit/middleware` — it verifies the shared cookie and, when absent/invalid, redirects to `<AUTH_URL>/login?callbackUrl=<full-url>`. The `sso.ts` helpers (`authOrigin()`, `productOrigins()`, `adminOrigin()`, `adminWebOrigin()`) resolve **base URLs**, not bare origins: a value may carry a path prefix (`https://apps.app.com/lms`) so all six apps can sit behind one host — one PWA scope, one push subscription. Every URL is therefore built by CONCATENATION (`${base}/login`); `new URL('/login', base)` would discard the prefix. Because the cookie is already present on the auth host, a user switching products via the in-navbar `ProductSwitcher` lands authenticated with no re-login. `auth-web` validates the post-login `callbackUrl` against `allowedRedirectOrigins()`, each entry normalized to its origin, before redirecting; an attacker-supplied host is rejected and the user falls back to the session-derived landing (`sessionDestination()`, or `/no-access`) rather than a hardcoded product. Under one host that check accepts any path on that host — deliberate and correct, since every internal path is then our own app; see the comment on `resolveCallback`.
- **`basePath` and what Next does *not* prefix**: each product app compiles a `basePath` (`/lms`, `/hrms`, `/todo`, `/admin`, `/sa`) into its image — changing a prefix is a rebuild and redeploy, never an env flip. Next applies it automatically to `<Link>`/router navigation, `next/image`, `/_next/*` assets, `rewrites()` **sources**, and middleware **matchers**; it deliberately leaves absolute rewrite destinations alone, which is why `/hrms/api/leave` reaches the gateway as `/leave`. Two consequences are easy to get wrong: (1) `config.matcher` and `protectedPrefixes` are **app-relative** — Next prepends the prefix at build time and `request.nextUrl.pathname` arrives with it already stripped, so spelling it out yourself yields `/hrms/hrms/...`, which matches nothing and silently leaves routes unauthenticated; (2) `fetch()` gets **no** prefixing, so a bare `fetch('/api/…')` under one origin would hit auth-web at the root instead of the calling app. `createApiClient()` resolves its mount through `withBasePath()` (`packages/ui/src/api/base-path.ts`), which reads the value Next compiles in — so all call sites keep passing `'/api'`, and a shared package built into two apps gets the right prefix in each.
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

When a new lead is created without an explicit `assigned_user_id` (Meta sync, manual lead creation), `resolveAutoAssignedUser(tx, orgId)` in leads-service (`services/leads-service/src/lib/assignment.ts` — moved out of `@platform/db` in P-1, it is LMS business logic) picks who receives it. Applies uniformly across every lead-creation path — both `services/meta-conversion-api/.../lead-sync.service.ts` and `services/leads-service/.../leads.repository.ts createLead()` call it.

**Eligibility:** active `iam.user_org_mapping` row for the org, an **active, non-deleted `iam.users` row**, an `lms.lead_assignment_weights` row with `weight > 0`, a role rank strictly between `READ_ONLY` and `ADMIN` (org admins and read-only users are never auto-assigned leads), and a role holding the `LMS` capability.

Since `1.44.0` the weight lives in `lms.lead_assignment_weights`, keyed by the membership's surrogate `iam.user_org_mapping.id`, rather than in a `lead_assignment_weight` column on the mapping itself — the mapping is shared by every product and only LMS ever read that column. **No row means weight 0**, so the picker's join to the weights table does the `> 0` filtering that the column's `NOT NULL DEFAULT 0` used to require an explicit predicate for. See *Per-product settings on a membership* in `docs/DB_model.md` for the pattern other products should follow instead of adding a column here.

The user-row condition mirrors `iam.fn_actor_can_act_in_org`, which `lms.check_lead_fk_org_scope()` re-runs on insert. **The two predicates must stay identical.** When they drifted, a user deactivated via edit-user (which sets `iam.users.is_active = false` but leaves the mapping untouched — unlike `softDeleteUser`, which cascades) stayed selectable: the picker chose them, the trigger rejected them, and the insert RAISEd. Because a user who can never receive a lead keeps an open-lead count of 0, their deficit stays maximal and they win *every* pick — so the branch fails 100% of the time, not intermittently. Via the Meta webhook that surfaced as a 404 from intake and every inbound lead for that branch was silently dropped (Gurugram - Sector 104, Aug 13-24 2026).

Deactivating a user now zeroes the weight on every one of their memberships in the same transaction as the `is_active` write (identity-service `updateUser`). The mappings stay active so reactivation restores membership; weights are not restored, since the share has to be redistributed while the user is away. `moveUserBranch` does the same for the branch being left — before `1.44.0` it handled the weight not at all, orphaning it on the deactivated mapping.

**Who owns the leads a departing user leaves behind.** Both flows that remove a user from a branch — deactivation and a branch move — carry an optional `reassign_leads_to` on `PATCH /users/:id`, and the field is deliberately **three-valued**: a uuid hands the open leads to that user, `null` **unassigns** them (`lms.marketing_leads.assigned_user_id = NULL`), and `undefined` means the caller said nothing, so no reassignment runs at all. Identity-service forwards all three to leads-service's `POST /internal/leads/reassign-org`, which accepts a null `to_user_id` and stamps the run as a bulk unassign.

Both server paths therefore gate on `!== undefined`, never on truthiness — `reassignUserLeadsInOrg` (deactivation) always did; `moveUserBranch` did not until this change, so a null branch move was indistinguishable from an omitted one and silently skipped the reassign, leaving the pipeline pointed at a user no longer in that org. That is precisely what the reassign-then-move saga exists to prevent, so the two paths now draw the same line.

The UI never omits the key while the reassign panel is open: it requires a successor whenever the branch still has anyone eligible (`/users/assignable`, which gates on real branch membership and the LMS capability, not the rank ladder), and sends `null` only when it does not. Leads are never left owned by a login that can no longer act on them. The reassign only fires when the user actually **leaves** the branch — `homeMoved && !stillHoldsOldOrg` — so moving home between branches they keep strands nothing and is correctly a no-op.

**Algorithm — deficit-based weighted round-robin:**
1. Count each eligible user's current *open* workload: leads assigned to them in this org where the lead's stage has `is_terminated = false` (no hardcoded stage names — picks up `new`/`contacting`/`on_hold`/`qualified`, and any future non-terminal stage, automatically)
2. `deficit = (weight / 100 * total_open_including_new_lead) - current_open_count`
3. Assign to whichever eligible user has the highest deficit; ties broken randomly

This deterministically converges to each user's target %, self-corrects as leads resolve (convert/reject/transfer), and is not retroactive — changing weights only affects future unassigned leads. If no users in the org have a weight set, `resolveAutoAssignedUser` returns `null` and the lead stays unassigned (today's default behavior, unchanged).

**Managing weights:** `GET/PUT /users/assignment-weights` (identity-service, org-admin rank required for PUT). The PUT endpoint validates every `user_id` is actually eligible and that weights sum to exactly 100 (or all 0, disabling auto-assignment for the org) — both checked at the application layer inside the same transaction as the write, not via a DB constraint.

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

Fire-and-forget: every service calls `@platform/audit-log`'s `logActivity()` in-process (writes are `void`'d or errors are swallowed internally). This ensures activity logging never blocks or fails a user-facing request. Reads (`GET /activities`, admin-only) are served by leads-service and scoped by RLS via `withRoleTx` — never bypassed for the read path.

## Meta Conversion API

Bidirectional integration with Meta (Facebook) Lead Ads:

### Inbound flow (Meta → CRM)
1. Meta sends a webhook POST to `/meta/webhook/:integrationId` (per-tenant app) or `/meta/webhook` (shared app, no integrationId) through the gateway
2. Gateway forwards raw bytes (not re-serialized JSON) via `proxyToRaw()` for HMAC integrity
3. Meta-conversion-api resolves Meta app credentials from `ext.meta_tenant_config`: by `integrationId` when present (a specific tenant's app), or the single row with `tenant_id IS NULL` when absent (a shared app covering multiple tenants)
4. HMAC-SHA256 verification using the resolved row's `app_secret`
5. Fetches full lead data from Meta Graph API using the resolved row's `access_token`
6. Always inserts a new `lms.marketing_leads` row (source resolved from Meta's per-lead `platform` field when present — `fb`→`facebook`, `ig`→`instagram`, `wa`→`whatsapp` — falling back to the static `ext.meta_page_form_org_map.platform` config value if Meta omits or returns an unrecognized platform; stage=new). If an active lead with the same `(org_id, phone)` already exists, the old row is marked `is_active=false, superseded_by=<new_id>` and a `lms.lead_links` record (`link_type='merge'`) is written for audit. A linked `ext.meta_leads` row is created referencing the new marketing lead.
7. Org (and, for the shared-app path, tenant) is resolved from `ext.meta_page_form_org_map` via `page_id`/`form_id` — `form_id` is authoritative (globally unique across all tenants), `page_id` is a fallback. Unmapped leads are skipped.
8. Field extraction uses the resolved tenant's `field_mappings` (from `ext.meta_tenant_config.field_mappings`, JSONB) merged over the hardcoded `DEFAULT_FIELD_MAPPINGS` — lets a tenant remap Meta form field keys without a redeploy
9. Address/job/demographic fields are written to `ext.meta_lead_addresses`, `ext.meta_lead_professional`, `ext.meta_lead_demographics` (1:1, only when at least one field is present)
10. Any remaining unmapped form fields stored in `ext.meta_lead_custom_fields`

### Inbound failure diagnostics
Step 6 delegates the `lms.marketing_leads` insert to leads-service `POST /api/v1/intake/webhook`; a rejection there surfaces in meta-conversion-api as `evt: webhook.lead_sync_failed`. Two things make that line self-diagnosing:
- It carries `orgId`, `tenantId`, `pageId`, `formId` alongside `metaLeadId`/`integrationId`. The org is the routing key for every follow-up query, so a failure can be traced to a branch without correlating logs across services.
- `err.details.upstream` carries leads-service's structured rejection reason. For a `lms.check_*_fk_org_scope()` trigger RAISE (translated to a 404 by `translatePgError`), that is `{ constraint: 'fk_org_scope', field: '<column>' }` — e.g. `assigned_user_id` when auto-assignment picked a user the trigger's `iam.fn_actor_can_act_in_org` check rejects.

**Only field names cross the service boundary, never values.** The intake request body is a lead's name, phone, email and every Meta form answer, so the client deliberately does not echo the upstream body into the error message; `details` is safe precisely because leads-service builds it from a fixed list of column literals.

Note: the webhook still returns 200 after a per-lead failure, so Meta does not retry and the lead is not persisted anywhere — these log fields are currently the only record of it.

### Outbound flow (CRM → Meta CAPI)
- **Auto-trigger**: When a lead's stage actually changes *and* the lead's source is a Meta one (`lms.lead_sources.name` in `facebook`/`instagram`/`whatsapp` — `META_LEAD_SOURCE_NAMES`, mirrored independently in `lead-sync.service.ts` and `meta-capi-trigger.ts` since the two are separate services), leads-service fires a fire-and-forget HTTP call to meta-conversion-api. Both conditions are checked before the call, so a website/walk-in/referral lead never reaches the CAPI service at all.
- **Eligibility, re-checked server-side** (`capi-trigger.service.ts`, in order): lead exists → source is Meta (`SOURCE_NOT_META`) → a linked `ext.meta_leads` row supplies `meta_lead_id`/`form_id` (`NOT_META_ORIGIN`) → tenant has an active integration → the new stage maps to an event via `ext.vw_lead_stage_capi_event_map` → no prior `SUCCESS` for this (lead, event). The source check is what protects the manual path, which can name any lead id; it is also why an intake email-dedup merge (a Meta lead folded into an existing website lead) no longer causes that website lead to report to Meta. Credentials are resolved by the lead's tenant_id, falling back to the shared-app row if the tenant has no dedicated app.
- **Manual trigger**: `POST /meta/crm-event` (protected, JWT-authenticated) allows users to manually send conversion events.
- `ext.meta_tenant_config.capi_trigger_stages` is stored and PATCHable but **not** evaluated — stage gating is `ext.lead_stage_capi_event_map` alone.
- Skips are not persisted: `ext.meta_capi_outbound_logs` records only real send attempts, so the `reason_code` on the `capi.trigger` log line is the only durable signal for a skip.
- PII is SHA256-hashed before transmission. Deterministic `event_id` ensures Meta deduplication.
- Partial unique index on `ext.meta_capi_outbound_logs(marketing_lead_id, event_name) WHERE delivery_status = 'SUCCESS'` prevents duplicate events.

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

Cross-org / tenant-wide capabilities (e.g. Leads History "tenant"/"all" scope, moving a user's branch, tenant leave-admin) are **platform** concerns keyed on `platform_role` (`tenant_admin`/`super_admin`), not a product rank — a product rank tops out per-org at its admin tier (80) and cannot express "sees every org in the tenant".

**Leads History scope (`getLeadsHistoryAssignedToScope`)** returns `all` for super_admin, `tenant` for tenant_admin, and otherwise `org` at or above `minRankForLeadsHistoryTeamScope` (SSE 40), `none` below it. It no longer returns `team`, and `org` now means **every branch the actor covers**, not one branch:

- The old `team` tier restricted everyone between SSE (40) and `LMS_RANKS.ADMIN` (**980**) to their `iam.reporting_lines` subtree inside a single branch — that is every Wingman (60), Senior Manager (70) and SSE, i.e. essentially every manager, since no real role sits between 80 and 979. `minRankForLeadsHistoryOrgScope` was removed with the merge; it gated a distinction that no longer exists and was unreachable in practice.
- **This is a visibility widening:** branch coverage, not the reporting hierarchy, now decides what a manager sees on this page, so they see lead activity from people who do not report to them within their own branches. Below the threshold nothing changes — a Sales Representative still sees only their own leads however many branches they are mapped to.
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
entry and a thin `page.tsx`. Mounted today in admin-web only; lms-web's `/dashboard/users`
redirects to it and its `/dashboard/team` stays a `Placeholder`, so adding a second mount later is
those same three lines rather than a third fork.

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
- **Transport**: `users.service` calls `lib/communication-service-client.ts` → `communication-service` `POST /api/v1/communications/public-send` with `X-Internal-Secret` (bypassing the gateway's `read_only` send-guard, which is correct — the controller already authorized). The call is **fire-and-forget**, same posture as `logActivity`: a mail failure only `console.error`s, it never fails the admin's request, and the temporary password is still returned in the HTTP response for manual relay. Bodies are built inline in `api/v1/users/user-emails.ts` (no `comms.message_templates` renderer yet).
- **Content**: account-created (login URL + temp password), password-reset (temp password included only when system-generated — never when the admin typed a specific one), branch-changed (added/removed branch names + new home branch). `APP_NAME` / `AUTH_URL` drive the product name and sign-in link.

Existing databases: `db_scripts/one_time/apply_admin_team_notify_capability.sql` (+ `_dryrun`).

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

**Capabilities vs. hierarchy.** These answer different questions and both still apply: a capability (`lms.leads.edit.team`, `tasks.view.team`, `hr.leave.approve`) says *whether* you may act on a team at all; the hierarchy says *who is in it*. Admin tiers short-circuit before the hierarchy is consulted — `hr_admin`/rank ≥ 980/`tenant_admin` for HR, `org_admin`/`tenant_admin`/`super_admin` for LMS, `tasks.edit.any` for Tasks.

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

The **`COOKIE_DOMAIN` is host-only** (`apps.fitclass.in`, no leading dot) rather than the parent domain — all six apps share one origin and differ only by path prefix, so `path=/` alone carries the session across every product. The cookie is no longer offered to sibling subdomains, tightening the surface. Moving to a new host logs everyone out once, by design.

### Push delivery path

Follow-up due notifications flow through two channels:

1. **SSE (Server-Sent Events)** — for users with an open tab. `followup-checker` polls `lms.marketing_leads.scheduled_at` on an interval and delivers overdue/due-soon events via `connectionManager.sendToUser()` as `followup:due` / `followup:missed`.
2. **Web Push (device notifications)** — for users with the app closed or in the background. Push is a second delivery channel hung off the same call site. When no SSE stream is open, `followup-checker` sends the same events to Web Push instead. The client re-subscribes on every app launch (reconciling if the Home Screen icon was deleted), so the subscription is always live.

**Notification deep link.** The push payload's `url` is `/lms/dashboard/follow-ups?leadId=<id>`. lms-web has no per-lead detail *route* — `/dashboard/leads` carries no `[id]` segment, so `/lms/dashboard/leads/<id>` would open a 404 on the user's phone. The follow-ups grid accepts `?leadId=` instead and opens that lead's history on arrival (`FollowUpsShell`'s `focusLeadId`), so tapping a notification lands on the lead it is about. The id is a **hint, not an authorization**: the shell matches it against the follow-ups the API already scoped to the acting user and ignores anything it does not find, so the parameter can never be used to pull another user's lead. It is consumed once, so dismissing the modal does not re-open it.

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

All icons are generated from `auth-web/public/fitclass-logo-white.webp` by
`scripts/generate-pwa-icons.py` (needs Pillow; re-run it if the branding
changes). They live in auth-web's `public/` because auth-web owns the root
origin — the paths are origin-absolute, so every product path under the
single-origin topology resolves them without its own copy.

| File | Size | Artwork | Used by |
|---|---|---|---|
| `icon-192.png` | 192x192 | emblem only | manifest; also the notification `icon`/`badge` in `sw.js` |
| `icon-512.png` | 512x512 | full lockup | manifest; splash screen |
| `icon-512-maskable.png` | 512x512 | full lockup, 60% content box | manifest `purpose: 'maskable'` |
| `apple-touch-icon.png` | 180x180 | emblem only | iOS Home Screen, via `pwa/metadata.ts` |
| `favicon.png` | 256x256 | emblem on transparency | browser tab, via `pwa/metadata.ts` |

Three constraints are baked into the generator and are easy to regress:

- **Every file is opaque RGB, backed with `#0F172A`.** The source artwork is
  white on transparency, so a transparent icon vanishes on light surfaces —
  and iOS does not composite alpha at all, rendering a transparent
  `apple-touch-icon` as a solid black square.
- **The maskable icon keeps its artwork inside the centred 80% safe zone**
  (the generator uses a 60% content box). Android launchers crop maskable
  icons to a circle/squircle and anything outside that zone is clipped.
- **The small sizes use the emblem alone, not the full lockup.** The
  "A Series of Luxury Gyms" tagline is illegible below ~256px, and
  `icon-192.png` renders as small as 24px as a notification badge.

`favicon.png` is a copy of the `app/icon.png` each product app already ships,
not a regenerated asset — it is the emblem on transparency rather than on
navy, so it reads on both light and dark browser chrome.

Declaring `icons` in `pwa/metadata.ts` **suppresses Next's `app/icon.png`
file convention** for every app that spreads it, which is why the favicon has
to be listed there explicitly — omitting it drops the tab icon platform-wide.
Next does not basePath-prefix metadata icon hrefs (verified against
lookup-admin's `/sa`), so both entries stay origin-absolute and resolve
against auth-web at the root. The per-app `app/icon.png` files are now
unreferenced; they are harmless and still served at `<basePath>/icon.png`,
but `public/icons/favicon.png` is the one the browser actually loads.

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
| `@platform/ui-kit` | `ui` | Shared Next.js shell/middleware for every product app — `AppSidebar`, `MobileSidebar`, `UserMenu`, `ProductSwitcher`, `createProductMiddleware()` (SSO cookie verification + redirect), `shell/nav` (`NavGroup`/`filterNavGroups`), `branchOptionsForActor`; plus the filter-toolbar primitives every screen's filter bar is built from — `MultiSelect`, `UserPicker`, `FilterField` (the label-over-control wrapper that keeps a bare input on the same baseline as a `MultiSelect`) and `useAnchoredPanel` (fixed-position geometry for a dropdown that must escape a dialog; anchors by `bottom` when it flips upward) |
| `@platform/audit-log` | `audit-log` | `logActivity()` — fire-and-forget writer to `audit.activities`, called in-process by every service (see "Activity logging") |
| `@platform/blob-storage` | `blob-storage` | Avatar/photo byte storage driver — backs `iam.users.photo_key` and the punch-selfie store used by face verification |
| `@platform/http` | `http` | Shared HTTP client helpers for inter-service calls |
| `@platform/logger` | `logger` | Shared `pino` logger wrapper |
| `@platform/service-auth` | `service-auth` | Internal-service-secret auth — verifies the gateway-injected `X-Internal-Secret` header |
| `@platform/auth-constants` | `auth-constants` | `AUTH_COOKIE_NAME` and other auth constants |
| `@platform/team-web` | `team-web` | Shared team-management UI (`TeamShell`, `TeamTable`, `CreateUserModal`, `EditUserModal`, `ResetPasswordModal`) — extracted out of `admin-web` for reuse |
| `@crm/permissions` | — | **Deprecated compat barrel** — re-exports the four `*/authz` packages so existing imports keep working; being migrated away and then removed |
| `@crm/internal-client` | — | HTTP client for inter-service calls (superseded by `@platform/http` in newer services) |

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

`apps/lookup-admin` (port 3005) is a separate Next.js app providing the super_admin-only web UI for managing these lookup tables, tenants, and organizations (all 15 tenant-scoped tables now via their owning product service; the 4 shared iam/entity lookups + tenants/organizations via admin-service), plus a Users management UI (`app/dashboard/users/`) that calls the pre-existing identity-service Users CRUD, reset-password, and org-mappings endpoints. For the 15 tenant-scoped tables, the table page renders a `TenantSelector` (a `<select>` driven by the URL's `tenant_id` search param) above the grid; no tenant selected means an empty/prompt state instead of a fetch, and "New"/edit actions (and parent-lookup option fetches, e.g. lead-stage for a stage-outcome) pass the selected `tenant_id` through. This selector is advisory only — the real enforcement is the backend's required `tenant_id` query param, the `authenticateSuperAdmin` gate, and the tenant-pinned admin RLS.

**Shell (module-grouped nav).** The dashboard is built on `@platform/ui-kit/shell` (the same `AppSidebar`/`MobileSidebar`/`UserMenu` chrome every product app uses). The left rail groups every table by `LookupTableDef.module` (`platform`/`lms`/`hr`/`tasks`/`capabilities`, see `src/lib/lookupTableConfig.ts`) via `NavGroup`/`filterNavGroups` (added to `@platform/ui-kit/shell/nav` for this) — flat `NavItem[]` usage in the other product apps is untouched. Each group lands on `/dashboard/m/[module]`, a card pane listing that module's tables (plus a couple of hand-built screens folded in as extra cards: Users under Platform, the Capability Matrix under Capabilities); a table card opens the existing `/dashboard/lookups/[table]` CRUD page.

**FK fields.** `LookupFieldConfig`'s old `select`/`geo-select` types (backed by a bare `selectOptionsFrom` string, plus a hardcoded country→state→city cascade component) were replaced by a single `fk` type carrying an `FkConfig` (`table` or `endpoint`, optional `dependsOn` for chaining, `scope: 'tenant'|'global'`). One `FkSelect` component resolves the option list, chains to any depth (the geo cascade is now just three ordinary fields), disables until its parent has a value, and surfaces a fetch error instead of silently rendering an empty list.

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
| **scripts/** | repo root | `setup-env.js` (env scaffolding), `docker-ship.sh`/`docker-load.md` (image build/transfer between environments), `clean.js` (workspace clean). |
| **db_scripts/tools/** | repo root | One-off tenant/org operational SQL scripts (branch onboarding, lead redistribution, deactivation), each paired with a `_dryrun` variant. |
| **db_scripts/apply_schema.ps1 / db_deploy.ps1** | repo root | Schema apply/deploy runners — see `db_scripts/README.md` for file ordering (`00`–`10` base files, then `reference_data/`, then any pending `one_time/` scripts). |
| **infra/** | repo root | `Caddyfile` (the local SSO reverse-proxy config, see the `caddy` service in the request-flow diagram above) and `maintenance.html`. |

Also see "Database pools" above for the three postgres.js connection pools, and `docs/DB_model.md` for the full schema reference.
