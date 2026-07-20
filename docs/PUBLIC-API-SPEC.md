# Public / Partner API — Design & Security Specification

**Status:** Phases 1–4 implemented. Remaining follow-up: the dedicated
15-min-access-token + refresh-token issuance flow for external consumers (Phase 4
shipped RS256 signing + JWKS + dual-verify; see §7 note).
**Scope:** Expose four capabilities to other applications — (1) lead generation (write),
(2) get branches per tenant/branch (read), (3) get users per tenant/branch (read),
(4) send communications (email/WhatsApp). Plus (5) allow other apps to *verify*
CRM-issued auth tokens.

**Consumers:** both first-party (our own products) and third-party partners.
The design therefore targets the stricter third-party bar throughout.

---

## 1. Guiding principles

1. **Never extend the internal trust model outward.** Today everything behind the
   gateway trusts a static `INTERNAL_SERVICE_SECRET` plus `X-User-*` headers. That
   is fine *behind* the gateway. External callers must authenticate with a
   *separate* mechanism (API keys / verifiable tokens) that the gateway translates
   into the existing internal headers. Services stay unchanged.
2. **Tenant/branch is resolved server-side from the credential, never from the
   request body.**
3. **Least privilege.** Every credential carries explicit scopes; a key can do only
   what it is granted.
4. **Reuse, don't duplicate.** The public routes are thin; they call the same
   service handlers via `proxyTo`. New code = auth prehandler + key model + a few
   field-minimized read endpoints.
5. **Defence in depth for reads.** PII endpoints enforce tenant scope by RLS *and*
   an explicit `WHERE tenant_id = <key tenant>` and a whitelisted column list.

---

## 2. Where it lives & how it reuses existing code

**Decision (recommended): a versioned path `/public/v1/*` on the existing
api-gateway**, with its own key-auth prehandler. No new service, no duplicated
proxy plumbing.

```
External product ──HTTPS + API key──▶ api-gateway  /public/v1/...
                                         │  publicApiKeyAuth prehandler
                                         │    - resolve key -> {tenant_id, org_id, scopes}
                                         │    - enforce required scope
                                         │    - per-key rate limit
                                         │    - audit log
                                         │    - inject internal headers (X-Org-Id, X-Tenant-Id, ...)
                                         ▼
                                      proxyTo(service, /api/v1/...)   ← existing handlers, unchanged
```

- Business logic is **not** duplicated. `POST /public/v1/leads` proxies to the same
  leads-service intake handler used by `/intake/leads`.
- Only when a public response must differ (e.g. minimized user list) do we add one
  new internal endpoint returning a whitelisted DTO.
- Upgrade path: if third-party volume later needs isolated ingress/scaling, extract
  `/public/v1` into a dedicated `public-gateway` service. The prehandler + routes
  move as-is; nothing else changes.

---

## 3. Credential model — `ext.api_clients` + `ext.api_client_orgs`

New tables (the legacy intake-only `lms.org_api_keys` table has since been
removed — it had no external traffic and its one use case, website lead
intake, is superseded by `leads:write` on this table):

```sql
CREATE TABLE ext.api_clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES entity.tenants(id),
  name              text NOT NULL,                 -- "Acme Partner – lead intake"
  key_prefix        text NOT NULL,                 -- "crmlk_live_a1b2c3" (shown in UI, used for lookup)
  key_hash          text NOT NULL,                 -- HMAC-SHA256(server_pepper, raw_key)
  scopes            text[] NOT NULL,               -- {'leads:write','users:read',...}
  rate_limit_per_min integer NOT NULL DEFAULT 60,
  scope_all_orgs    boolean NOT NULL DEFAULT false, -- true = tenant-wide (all branches)
  is_active         boolean NOT NULL DEFAULT true,
  expires_at        timestamptz NULL,
  last_used_at      timestamptz NULL,
  revoked_at        timestamptz NULL,
  created_by        uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_api_clients_prefix ON ext.api_clients(key_prefix);
CREATE INDEX ix_api_clients_tenant ON ext.api_clients(tenant_id);

-- Which branches a client is bound to. Zero rows + scope_all_orgs = true means
-- tenant-wide; zero rows + scope_all_orgs = false is not a valid state (every
-- key must be bound to at least one branch, or explicitly the whole tenant).
CREATE TABLE ext.api_client_orgs (
  api_client_id uuid NOT NULL REFERENCES ext.api_clients(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES entity.organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (api_client_id, org_id)
);
```

**RLS**
- `tenant_admin`: full access to every client where `tenant_id = app.current_tenant_id`, regardless of branch binding.
- `app_user` (org_admin): full access only to clients explicitly bound to their own branch via `ext.api_client_orgs` — never a `scope_all_orgs` (tenant-wide) client, and never another branch's.
- `root_service`: full (BYPASSRLS) for the resolver and super_admin.

### Key format & hashing
- Raw key: `crmlk_<env>_<43-char base62>` (~256 bits of entropy).
  - `env` ∈ `live` / `test`; helps prevent test keys hitting prod data.
- Stored: `key_prefix` (first ~14 chars, cleartext, for lookup/display) and
  `key_hash = HMAC-SHA256(PUBLIC_API_KEY_PEPPER, raw_key)` (hex).
  - HMAC with a server-side pepper means a DB dump alone cannot be used to forge or
    reverse keys. (Plain SHA-256 is acceptable only because keys are high-entropy;
    the pepper is cheap insurance and recommended.)
- The raw key is shown **once** at creation and never stored.

### Lifecycle
- **Rotation:** issue a new key, dual-run, then revoke the old (`revoked_at`).
- **Expiry:** optional `expires_at`; resolver rejects expired keys.
- **Revocation:** `revoked_at` / `is_active=false`; resolver rejects immediately.
- **Usage:** `last_used_at` updated asynchronously (best-effort, not on hot path).

---

## 4. Scope matrix

| Scope            | Grants                                             | Endpoints |
|------------------|----------------------------------------------------|-----------|
| `leads:write`    | Create leads into the key's tenant/branch          | `POST /public/v1/leads` |
| `branches:read`  | List branches (orgs) in the key's tenant/branch    | `GET /public/v1/branches` |
| `users:read`     | List users (minimized) in the key's tenant/branch  | `GET /public/v1/users` |
| `comms:send`     | Send **approved templates** to tenant users/leads   | `POST /public/v1/communications/send` |
| `comms:send:adhoc` | Additionally allow **free-form** message bodies   | `POST /public/v1/communications/send` |

A key holds only the scopes it needs. Read and write are separate; comms is always
its own scope because of its abuse profile. `comms:send:adhoc` is an *additive*
scope granted only to vetted clients; without it a `comms:send` key is restricted
to approved templates.

---

## 5. Auth prehandler flow (`publicApiKeyAuth`)

For every `/public/v1/*` request:

1. Extract `Authorization: Bearer crmlk_...` (or `X-Api-Key`).
2. Look up by `key_prefix`; if missing → `401`.
3. Compute `HMAC-SHA256(pepper, raw)` and compare to `key_hash` with a
   constant-time comparison; mismatch → `401`.
4. Reject if `is_active=false`, `revoked_at IS NOT NULL`, or `expires_at < now()`.
5. Enforce the route's **required scope** against `scopes`; missing → `403`.
6. **Per-key rate limit** (`rate_limit_per_min`); exceed → `429` + `Retry-After`.
   (The current limiter is per-IP; this adds a per-key bucket keyed by client id.)
7. Write an `audit.audit_log` entry (client id, route, outcome).
8. Inject internal headers derived from the key — `X-Tenant-Id`, `X-Org-Id`
   (if branch-bound), `X-Internal-Secret`, plus a synthetic actor
   (`X-User-Id = client:<id>`, `X-User-Role = api_client`, `X-Rank = 0`) so audit
   triggers and RLS GUCs have a subject.
9. `proxyTo` the target service.

Note: the synthetic actor's rank is `0`; public endpoints must not depend on rank
for authorization — the **scope** is the authorization, and the tenant/branch is the
isolation. Services must treat `api_client` as a first-class, minimally-privileged
role.

---

## 6. Endpoints

### 6.1 `POST /public/v1/leads` — scope `leads:write`
- Reuses `createWebhookLead` (dedup by phone/email + auto-assign already implemented).
- `org_id` (branch): if the key is bound to exactly one branch, forced to that
  branch (gateway injects `X-Org-Id`). If the key is bound to a subset of
  branches or the whole tenant, the body **must** name a `branch_id`, which is
  validated against the key's allowed set (`X-Allowed-Org-Ids`) or, for a
  tenant-wide key, against `key.tenant_id` (reject otherwise). Never trusted
  blindly — the body's `org_id` is always ignored.
- Input validation: reuse/extend the intake Zod schema; enforce max payload size.
- **Idempotency:** accept an `Idempotency-Key` header; store and de-dupe retries to
  avoid double leads on network retries (complements existing content dedup).
- Response: `201 { id, is_duplicate }` — no internal fields.

### 6.2 `GET /public/v1/branches` — scope `branches:read`
- Returns orgs where `tenant_id = key.tenant_id` (or just `key.org_id` if bound).
- Whitelisted columns only: `id, name, code, city, is_active`.
- Pagination (`page`, `page_size`, capped).

### 6.3 `GET /public/v1/users` — scope `users:read`
- Returns users in the key's tenant (or branch).
- **Field minimization (hard rule):** only `id, full_name, email, role_label,
  is_active`. Never `password_hash`, `force_password_change`, internal audit fields,
  or `rank`.
- Executed via a **SELECT-only, tenant-scoped path** — a dedicated read role or an
  explicit `WHERE tenant_id = key.tenant_id` under the service role. Do **not** reuse
  the `tenant_admin` role (it has full write authority).
- Pagination + optional `branch_id` filter (validated ⊆ tenant).

### 6.4 `POST /public/v1/communications/send` — scope `comms:send`
Highest-abuse surface. **Decisions (locked):**
- **Content:** approved templates only by default. Free-form bodies require the
  additive `comms:send:adhoc` scope, granted only to vetted clients.
- **Recipients:** every recipient must resolve to a **CRM user OR a lead in the
  key's tenant** (matched by email/phone, server-side). Addresses that match
  neither are rejected — no arbitrary blast lists, ever, on any scope.

Additional controls (with the earlier M1 hardening):
- Fixed, tenant-configured From-address/domain (caller cannot spoof sender).
- Per-key send quota (daily + per-minute), separate from the generic rate limit.
- Every send audited with client id + recipient count (not full PII in logs).

**Resolution rule:** for each recipient, look up an active, non-deleted match in
`iam.users` (email/mobile) or `lms.marketing_leads` (email/phone) scoped to the
key's tenant. Reject the whole request if any recipient is unresolved (fail-closed),
returning which recipients were invalid.

---

## 7. Auth token verification for other apps (verify-only)

Requirement: other apps must **verify** CRM-issued tokens — not run SSO. The current
HS256 scheme cannot support this safely (the verify key is also the signing key, so
sharing it enables forgery of any user/role, including `super_admin`).

### Target design
- **Decision (locked): RS256** — broadest verifier compatibility for third-party
  consumers. identity-service holds the private key; sets a `kid` (key id) in the
  JWT header.
- **Decision (locked): 15-minute access-token TTL + refresh tokens.** Keeps the
  offline-verification / revocation window small (see caveats below).
- Publish **`GET /.well-known/jwks.json`** as a public gateway route exposing only
  the public key(s). Other apps verify against it; they can never sign.
- Add claims: `aud` (audience — per consuming app), `scope`, keep `iss`.
- Consuming apps validate `iss`, `aud`, `exp`, and signature against the JWKS.

### Migration (coordinated — touches every token)
1. Add asymmetric keypair + `kid`; keep HS256 active.
2. Verifiers accept **both**: token with `kid` → RS256 via JWKS; no `kid` → legacy
   HS256. (Gated so it cannot half-deploy.)
3. Flip signing to RS256. New tokens are asymmetric.
4. After the max legacy token age (`JWT_MAX_AGE_SECONDS`) elapses, remove HS256
   verification.
5. Rotate keys periodically; JWKS can advertise multiple `kid`s during rotation.

### Caveats to document for consumers
- **Revocation is server-side** (`iam.token_blocklist`). An external app verifying a
  token offline won't see a revocation until the token expires. Therefore keep
  **access-token TTL short** (e.g. 15 min) and rely on refresh; treat long-lived
  authority as belonging to the CRM, not the verifier.
- For actions (not just identity checks) external apps should still call CRM APIs so
  RLS/authorization is enforced centrally.

---

## 8. Cross-cutting controls

- **Per-key rate limiting** (§5.6) plus the existing per-IP limiter.
- **Audit:** all public calls → `audit.audit_log` (client id, route, tenant, outcome).
- **Response DTOs:** public endpoints return explicit whitelisted shapes; never spread
  DB rows.
- **Ingress (partners):** optional IP allowlist / mTLS in front of `/public/v1`
  (easier if later extracted to a dedicated service).
- **Secrets/config:** `PUBLIC_API_KEY_PEPPER` (required in prod), plus the RS256
  private key + `kid` for identity-service. Reject weak/placeholder values in prod
  (same guard pattern added to the gateway config).
- **Versioning:** `/public/v1`; breaking changes → `/public/v2`.

---

## 9. Key-management API (Org Admin, Tenant Admin, Super Admin)

Branch/tenant admins manage their own clients via the first-party
(JWT-authenticated) API, gated at rank `org_admin`+ (`RANKS.ADMIN`):
- `POST /api-clients` — issue (returns raw key **once**).
- `GET /api-clients` — list (prefix + metadata, never the hash).
- `PATCH /api-clients/:id` — edit name, scopes, branch bindings, or expiry — never the key/hash.
- `POST /api-clients/:id/rotate` — issue a replacement key (same bindings/scopes), revoking the old one.
- `DELETE /api-clients/:id` — revoke.

**Branch scoping (create/edit body):** `org_ids: string[]` (specific branches)
and/or `scope_all_orgs: boolean` (tenant-wide). For `org_admin`, both fields
are ignored server-side — the client is always forced to the caller's own
branch, regardless of what the request body contains. `tenant_admin`/
`super_admin` may pick any subset of branches in their tenant, or all of them.

All scoped by RLS: `tenant_admin`/`super_admin` see every client in the
tenant; `org_admin` sees only clients bound to their own branch (never a
tenant-wide client).

---

## 10. Rollout phases

1. **Foundation + leads — ✅ IMPLEMENTED:** `ext.api_clients`, key
   issuance/verification, scope + per-key rate-limit prehandler, audit,
   `POST /public/v1/leads`, key-management API.
2. **Reads — ✅ IMPLEMENTED:** `GET /public/v1/branches`, `GET /public/v1/users`
   with field minimization + tenant-scoped read path (service role + explicit
   `WHERE tenant_id`, never `tenant_admin`).
3. **Comms — ✅ IMPLEMENTED:** `POST /public/v1/communications/send`; gateway
   guard enforces content gating (`comms:send:adhoc` for free-form) and the
   tenant recipient allowlist (users + leads only) before dispatch.
4. **Auth migration — ✅ IMPLEMENTED (core):** RS256 signing + `kid`, JWKS
   endpoint, dual HS256/RS256 verification. Opt-in via configured keys; falls
   back to HS256 when unset so existing deploys are unaffected.

Phases 2–4 all depend on the Phase 1 credential spine.

### As-built (phases 2–4)
- **Reads:** identity-service `api/v1/public/*` (`public-read.controller/repository`);
  gateway routes `GET /public/v1/branches|users` (`branches:read`/`users:read`).
  User DTO whitelists `id, full_name, email, org_id, role_label, is_active`.
- **Comms:** scope `comms:send` (+ additive `comms:send:adhoc`); gateway
  `publicCommsGuard` (`public-comms.ts`) + `@crm/db` `findUnknownRecipients`
  (email exact / phone last-10 match against tenant users + leads);
  communication-service `POST /api/v1/communications/public-send`
  (internal-secret only, no rank floor — scope is the authz).
- **Auth:** identity `signJwt`/`verifyJwt` (RS256 when `JWT_PRIVATE_KEY`+`JWT_KID`
  set), gateway `verifyJwtEdge` picks key by token `alg`, `GET /.well-known/jwks.json`
  (`jwks.ts`). Config: `JWT_PRIVATE_KEY` (identity), `JWT_PUBLIC_KEY`+`JWT_KID`
  (both). Alg-confusion-safe: HS256 verified only with the secret, RS256 only with
  the public key.

### Phase 4 — remaining follow-up (not yet built)
The **15-minute access token + refresh-token flow** is intentionally deferred:
shortening the first-party cookie session to 15 min without a refresh subsystem
would break the web app's UX. RS256 already lets other apps verify the existing
CRM token via JWKS. The short-lived-token + refresh flow should be added as a
**dedicated external/OAuth token issuance** path (separate from the first-party
cookie session), so it doesn't regress the web app. Also still pending: dropping
HS256 once all legacy tokens have expired, and per-consumer `aud`/`scope` claims.

### Phase 1 — as-built reference
- **DB:** `ext.api_clients` + `ext.api_client_orgs` (+ RLS `tenant_isolation_policy`/
  `org_isolation_policy`, grants) in `db_scripts/01_init-db.sql`; drizzle models
  `packages/db/src/schema/tables/api-clients.table.ts` and `api-client-orgs.table.ts`.
- **Key helpers:** `generateApiKey` / `hashApiKey` (HMAC-SHA256 + pepper) /
  `getApiClientByHash` / `recordApiClientUsage` in `packages/db/src/api-clients.ts`.
  Lookup is by `key_hash`; the raw key is shown once and never stored.
- **Scopes:** `packages/auth-constants/src/api-scopes.ts` (`API_SCOPES`).
- **Gateway:** `services/api-gateway/src/lib/public-auth.ts` (`publicApiKeyAuth(scope)`
  prehandler + per-key rate limiter + `publicUserContext` + `publicScopeHeaders`);
  route `POST /public/v1/leads`. First-party key-management routes `/api-clients*`
  (including `PATCH /api-clients/:id`).
- **Identity-service:** `api/v1/api-clients/*` (org_admin+-gated CRUD: create, list,
  update, rotate, revoke — org_admin forced to their own branch server-side).
- **Leads-service:** `POST /api/v1/intake/public` (`publicApiLead`) — resolves branch
  from `X-Org-Id` (single-branch keys) or validates a body `branch_id` against
  `X-Allowed-Org-Ids`/`X-Scope-All-Orgs` (multi-branch/tenant-wide keys).
- **Config:** `PUBLIC_API_KEY_PEPPER` (gateway + identity; required in production).
- **Constraints:** multi-branch/tenant-wide keys must pass `branch_id` per lead;
  single-branch keys don't. `org_id` in the body is always ignored.
- **Admin UI:** `apps/web/app/dashboard/api-clients/page.tsx` +
  `apps/web/components/api-clients/*` — create/edit/revoke screen for Org Admin,
  Tenant Admin, and Super Admin; shows the raw key once at creation/rotation.

---

## 11. Decisions — RESOLVED

1. **Public surface:** path on the existing gateway (`/public/v1`). ✅ (Phase 1 built)
2. **Comms content:** approved templates by default; free-form behind additive
   `comms:send:adhoc` scope for vetted clients. ✅
3. **Comms recipients:** restricted to CRM users + leads in the key's tenant;
   no arbitrary recipients on any scope. ✅
4. **Token signing:** RS256. ✅
5. **Access-token TTL:** 15 minutes + refresh tokens. ✅
6. **Partner ingress:** API-key-over-TLS at launch; per-partner IP allowlist / mTLS
   added later as needed (not a launch blocker). ✅ (recommendation adopted)
