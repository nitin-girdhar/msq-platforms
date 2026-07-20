# Phase 0 — Boundary Cleanup (in-monorepo, non-breaking)

> **Goal:** draw the product boundaries while it's still one repo and cheap. No behavior change, no repo split, no Docker/registry work.
> **Ships as:** one PR (or three stacked PRs A/B/C). All reversible.
> **Reference:** `docs/Platform_Architecture_Decisions.md` (D3, D5, D6, D8).

---

## PR-A — Split `@crm/permissions` into `@platform/authz` + `@lms/authz` + `@hr/authz` + `@task/authz`

> **Naming:** `@crm/permissions` is the *existing* package being split (keep the name until its shim is deleted). The lead product's output package is **`@lms/authz`** (Lead Management System) — not `@crm/authz`.

**Why:** today one package mixes platform, sales, HR, and task authorization on a single rank ladder. Every product imports the whole thing (~81 files). Splitting by *what the code knows about* is the prerequisite for per-product roles (D3) and the repo split.

### Target packages & what moves where

| New package | Owns | Moves from today's `packages/permissions/src/` |
|---|---|---|
| `@platform/authz` | Identity, tenancy, product-grant, account-level rank tiers | `index.ts` (`hasRole`, `hasMinimumRole`, `hasAnyRole`); `scope.ts` (`resolveActorOrgIds`); `user-management.ts` (`canGrantRole`, `canManageUser`); platform tiers `{ READ_ONLY:0, ADMIN:80, TENANT_ADMIN:90, SUPER_ADMIN:100 }` |
| `@lms/authz` | Sales roles + LMS business rules | `leads.ts`, `assignments.ts`, `business-rules.ts`; LMS ranks `{ SE:20, SSE:40, MANAGER:60, SR_MANAGER:70 }` |
| `@hr/authz` | HR roles + HR authority | `hr.ts`; HR rank `{ HR_ADMIN:75 }` |
| `@task/authz` | Task scope gates | `tasks.ts` |

`@lms/authz`, `@hr/authz`, `@task/authz` each depend on `@platform/authz`, never on each other.

### The rank ladder during Phase 0 (important, keeps it non-breaking)

The JWT still carries **one global numeric rank** in Phase 0 — we are only relocating code, not changing the runtime auth model (that's Phase 1). All product packages therefore still compare against the **same numeric scale**. Rule:
- `@platform/authz` owns the account tiers (`ADMIN/TENANT_ADMIN/SUPER_ADMIN/READ_ONLY`) — the shared contract.
- Each product package declares only the thresholds it owns (`@lms/authz` declares `SSE` etc.).
- Cross-package numeric comparisons (`@hr/authz` needing `ADMIN`) import the tier from `@platform/authz`.
- **Document that the single numeric scale is a temporary shared contract, dissolved in Phase 1** when per-product role tables land and the JWT stops carrying a global rank.

### New: product-grant primitive in `@platform/authz`

Add the entitlement check that D6 needs (even before the JWT carries it — define the contract now):
```ts
// @platform/authz
export type ProductKey = 'lms' | 'hr' | 'task';
// PR-C update: these are async (backed by a cached DB read) — the fail-open sync
// stub shipped in PR-A had no call sites, so PR-C changed the signature.
export function hasProduct(session: SessionUser, product: ProductKey): Promise<boolean>;
export function assertProduct(session: SessionUser, product: ProductKey): Promise<void>; // throws 403
```
Backed by `entity.tenant_modules` (PR-C), read through a 60s per-tenant cache. The DB source is *injected* via `configureProductSource()` at backend startup (not a static `@crm/db` import) so the package stays safe to import from the Next.js apps.

### Migration mechanics
1. Create the four package folders under `packages/` with `package.json` + `tsconfig` (copy an existing package's shape). Names: `@platform/authz`, `@lms/authz`, `@hr/authz`, `@task/authz`.
2. Move the files per the table. Keep function signatures **identical** — this is a move, not a rewrite.
3. **Compatibility shim:** keep `@crm/permissions` as a thin barrel that re-exports from the four new packages, so the ~81 import sites keep working. Then migrate imports repo-wide in a follow-up mechanical commit and delete the shim. (Shim first = the PR stays green at every step.)
4. `pnpm install` to link; `pnpm typecheck` must pass with zero behavior change.

### Acceptance
- `pnpm typecheck` + `pnpm test` green.
- No file imports a product authz package from a different product.
- `@platform/authz` imports nothing sales/HR/task-specific.

---

## PR-B — Dependency-lint wall

**Why:** package.json boundaries stop *declared* cross-product deps, but not accidental deep imports. Add a CI guard so a product can never import another product, and `@platform/*` can never import a product.

### Primary enforcement (free)
Each product package's `package.json` lists only `@platform/*` — never a sibling product. pnpm won't resolve an undeclared package.

### Guard (CI) — `dependency-cruiser`
`.dependency-cruiser.cjs` at repo root:
```js
module.exports = {
  forbidden: [
    { name: 'platform-no-product', severity: 'error',
      from: { path: 'packages/platform/' },
      to:   { path: 'packages/(lms|hr|task)/' } },
    { name: 'lms-no-sibling', severity: 'error',
      from: { path: 'packages/lms/' }, to: { path: 'packages/(hr|task)/' } },
    { name: 'hr-no-sibling', severity: 'error',
      from: { path: 'packages/hr/' }, to: { path: 'packages/(lms|task)/' } },
    { name: 'task-no-sibling', severity: 'error',
      from: { path: 'packages/task/' }, to: { path: 'packages/(lms|hr)/' } },
    // services follow the same rule via their package name imports
  ],
};
```
Add `"depcruise": "depcruise packages services apps"` to root scripts; run in `turbo` lint pipeline / pre-push.

### Acceptance
- `pnpm depcruise` exits 0 on current tree.
- A deliberate cross-product import fails the check (verify once, then revert).

---

## PR-C — `entity.tenant_products` (entitlements) — close the gaps on the existing table

**Finding:** `entity.tenant_modules` already exists (`id, tenant_id, module, is_active, enabled_at`) and is enforced per-service via `require-module.middleware.ts` in **hr-service** and **tasks-service**. Gaps vs. D6:
- **leads-service (LMS) is not gated at all** — inconsistent enforcement.
- Enforcement is per-service, not the central gateway choke point D6 wants.
- Confirm tenant RLS on the table (a tenant must only see its own product rows).

### Scope (deliberately keep the table; defer the cosmetic rename)
1. **Do not rename `tenant_modules` → `tenant_products` yet** — it's cosmetic and touches 13 files + SQL. Note it as a later mechanical rename. Treat "module" and "product" as synonyms for now.
2. **Add/verify tenant RLS** on `entity.tenant_modules`: `tenant_isolation_policy` on `app.current_tenant_id`; writes restricted to `tenant_admin`/`super_admin`.
3. **Centralize enforcement at the gateway (D6 choke point):** a static route-prefix → product map (`/leads*, /assignments*, /analytics* → lms`; `/hr/* → hr`; `/tasks*, /task-lists* → task`), checked after JWT verify against the tenant's active products. Keep the per-service `require-module` middleware as defense-in-depth.
4. **Close the LMS gap:** the leads/LMS routes are now gated by the gateway map (fixes leads-service being ungated).
5. **Backfill + product-key rename:** the existing entitlement key for the lead product is `'crm'` in `entity.tenant_modules.module`. Rename it to `'lms'` — update the `module` CHECK constraint (`'crm'`→`'lms'`) and existing rows — and ensure every tenant has an active `lms` row (and `hr`/`task` where already used) so nothing 403s on deploy. *(This is the entitlement-key half of the crm→lms rename; the schema rename itself is P1.0.)*
6. Point `@platform/authz`'s `hasProduct()` (PR-A) at this table via a cached read.

### Acceptance
- A tenant without an active product row for a prefix gets 403 at the gateway.
- Existing tenants unaffected (backfill verified).
- Tenant A cannot read tenant B's product rows (RLS test).

---

## Sequencing & risk

- **Order:** A → B → C (B depends on A's package layout; C is independent but references A's `hasProduct`).
- **Blast radius:** PR-A touches ~81 import sites but via a compatibility shim it's green at every step; the import migration is a separate mechanical commit.
- **Non-breaking:** no runtime auth change, no JWT change, no repo split, no Docker change. Phase 1 (per-product role tables, JWT shrink) comes after and builds on these boundaries.
- **Reversibility:** every step is a code move + config; revert is clean.

### Explicitly NOT in Phase 0 (belongs to Phase 1+)
- Per-product role tables / `(product, role)` grants; shrinking the JWT.
- `hr.reporting_lines` (hierarchy decoupling).
- Splitting `apps/web` into per-product apps.
- Repo extraction, git-tags, `pnpm deploy` image wiring.
- `tenant_modules` → `tenant_products` rename.
