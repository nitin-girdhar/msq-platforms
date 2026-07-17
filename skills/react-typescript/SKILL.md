# React / Next.js — CRM Monorepo Skill

> **Authoritative baseline for all frontend work in `apps/web` (and `apps/lookup-admin`).**
> This skill documents how the frontend is *actually* built in this repo. When you add or
> refactor code, match these patterns exactly so every screen reads the same way. If a
> requirement seems to demand a different approach, flag it before diverging.

Stack: **Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS v4 · SWR + hand-rolled
hooks · AG Grid · Zod · `jose`**. Shared UI + fetch primitives live in the `@crm/ui` workspace
package; shared types in `@crm/types`; permission ranks in `@crm/permissions`.

---

## Core Principles

1. **The web app is a separate deployable from every backend service.** It talks to backends
   only over HTTP, through the Next.js route handlers under `app/api/**` (which proxy to the
   API gateway). It never imports service code, DB clients, or Drizzle schema.

2. **All browser data access flows through `apps/web/src/lib/api/client.ts`.** That file builds
   typed `api.*` namespaces on top of the generic `request()` returned by `createApiClient()`
   from `@crm/ui`. Components and hooks call `api.<resource>.<method>()` — never `fetch` directly.

3. **Styling is Tailwind utility classes written inline in JSX.** There is no CSS-module design
   system and no per-tenant CSS theming. Multi-tenancy is enforced by the backend (RLS +
   gateway), not by the frontend. A handful of `*.module.css` files exist only for a few
   complex widgets — do not introduce new ones without reason.

4. **Reusable, domain-agnostic UI primitives live in `@crm/ui`** (`Modal`, `Pagination`,
   `DownloadButton`, `MonthGrid`, `Placeholder`, plus `useDropdown` / `useIsMobile`). Build
   there when a component is generic; build in `apps/web/components/<domain>` when it carries
   CRM domain knowledge.

5. **Field and param names are `snake_case`**, matching the backend JSON contract
   (`assigned_user_id`, `page_size`, `org_ids`). Do not camelCase API payloads.

---

## 1. Directory Structure (`apps/web`)

Path alias: `@/*` → `apps/web/*`. So `@/components/...`, `@/hooks/...`, `@/src/lib/...`.

```
apps/web/
├── app/                                ← App Router. Routes + route-handler proxies ONLY.
│   ├── layout.tsx                      ← Root layout (fonts, <body> chrome)
│   ├── globals.css                     ← `@import "tailwindcss"` + a few global rules
│   ├── login/ | change-password/ | select-branch/
│   ├── api/                            ← Route handlers that proxy to the gateway (server-side)
│   ├── dashboard/
│   │   ├── layout.tsx                  ← Dashboard shell (navbar, module gating)
│   │   ├── leads/page.tsx              ← Server Component: session → render Shell
│   │   ├── team/ | users/ | assignments/ | follow-ups/ | analytics/ | api-clients/ …
│   ├── attendance/ | leave/ | tasks/   ← HR/attendance/task modules
│
├── components/
│   ├── <domain>/                       ← One folder per domain (leads, users, assignments, …)
│   │   ├── <Domain>Shell.tsx           ← 'use client' orchestrator: owns state + hooks
│   │   ├── <Domain>Table.tsx | *Modal.tsx | *Selector.tsx …
│   ├── dashboard/                      ← DashboardNavbar, LeadDashboardShell, MultiSelect, RoleBadge
│   ├── layout/                         ← App chrome
│   ├── common/                         ← Small shared bits (UserPicker, SearchBar-like)
│   └── auth/
│
├── hooks/                              ← Client data/UI hooks — NO JSX. `useLeads`, `useOrgs`, …
│
├── src/
│   ├── lib/
│   │   ├── api/client.ts               ← THE browser API layer (api.auth, api.leads, …)
│   │   ├── server-session.ts           ← getServerSession() for Server Components
│   │   ├── require-session.ts
│   │   ├── modules.ts                  ← getEnabledModules() (tenant module gating)
│   │   ├── permissions/ | leads/ | leave/ | attendance/ | tasks/ | export/
│   ├── types/                          ← Web-only types + re-exports (index.ts, leads.ts)
│   └── config/navigation.ts            ← Nav config (no JSX)
│
├── next.config.ts · postcss.config.mjs · tsconfig.json
```

### Enforcement table

| Location                     | Allowed                                                     | Never allowed                                              |
|------------------------------|------------------------------------------------------------|------------------------------------------------------------|
| `app/**/page.tsx`            | `await getServerSession()`, redirect, render a Shell       | `useState`/`useEffect`, event handlers, business logic     |
| `app/**/layout.tsx`          | Chrome, module gating, providers                           | Domain data fetching                                       |
| `app/api/**/route.ts`        | Proxy to gateway, forward cookies/headers                  | Business logic, DB access                                  |
| `components/<domain>/*Shell` | `'use client'`, state, hooks, mutation handlers            | `fetch` (use `api.*`), server-only imports                 |
| `components/<domain>/*` (leaf)| Props in, typed callbacks out, Tailwind classes           | Data fetching, owning cross-cutting state                  |
| `hooks/`                     | State, effects, `api.*` calls, return named object         | JSX / returning component trees                            |
| `src/lib/api/client.ts`      | All `request()` calls, typed `api.*` namespaces            | React imports, JSX                                         |
| `@crm/ui`                    | Domain-agnostic primitives, `createApiClient`              | CRM domain types, CRM endpoints                            |

---

## 2. The API Layer

### `@crm/ui` provides the generic fetch wrapper — never add endpoints here

`createApiClient(basePath)` returns `{ request<T>() }`. It handles credentials, JSON headers,
204/empty-body, and normalizes errors into an `ApiRequestError` (`.status`, `.body`) whose
message flattens Zod `details`. See `packages/ui/src/api/http.ts`.

### `apps/web/src/lib/api/client.ts` — the CRM domain layer

```ts
import { createApiClient } from '@crm/ui';

const { request } = createApiClient('/api');   // '/api' → Next route handlers → gateway

export const leads = {
  list: (params: LeadsListParams = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    return request<{
      success: true;
      data: import('@crm/types').LeadView[];
      total: number; page: number; page_size: number;
      stage_options: unknown[]; stage_outcomes: unknown[];
    }>(`/leads${qs ? `?${qs}` : ''}`);
  },

  update: (id: string, data: Record<string, unknown>) =>
    request<void>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};
```

**Rules for `client.ts`:**
- One `export const <resource> = { ... }` namespace per backend resource; group by comment banner.
- Response envelope is typed **inline** on each call: `{ success: true; data: ...; total?; page?; page_size? }`.
- Use `import('@crm/types').X` inline type references for domain shapes; promote to a named
  import only when reused heavily.
- `snake_case` for every param and body field. Build query strings with the
  `URLSearchParams(Object.entries(...).filter(...).map(...))` pattern shown above.
- Response bodies are **not** re-validated with Zod on the client — the gateway/services own
  validation. Trust the typed envelope; keep unknown/opaque fields as `unknown[]`.

---

## 3. Pages — Server Components

Pages resolve the session, gate access, and render a client Shell. No state, no handlers.

```tsx
// app/dashboard/leads/page.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from '@/src/lib/server-session';
import { getEnabledModules } from '@/src/lib/modules';
import LeadDashboardShell from '@/components/dashboard/LeadDashboardShell';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const result = await getServerSession();
  if (!result) redirect('/login?callbackUrl=%2Fdashboard%2Fleads');
  const enabledModules = await getEnabledModules(result.cookieHeader);
  return <LeadDashboardShell actor={result.session} enabledModules={enabledModules} />;
}
```

- Add `export const dynamic = 'force-dynamic'` for any authenticated, per-request page.
- `getServerSession()` returns `{ session, cookieHeader }` or `null`; redirect to `/login`
  with an encoded `callbackUrl` when null.
- Pass the resolved `actor` (session user) and any gating data **down as props** to the Shell.

---

## 4. Shells — Client Orchestrators

A `<Domain>Shell` is `'use client'`, owns local state, calls hooks, wires child components,
and handles mutations. It is the only layer that coordinates async + state for its screen.

```tsx
'use client';
import { useLeads } from '@/hooks/useLeads';
import type { SessionUser } from '@crm/types';

export default function LeadDashboardShell({ actor, enabledModules }: {
  actor: SessionUser;
  enabledModules: string[];
}) {
  const { leads, loading, error, updateLead, refetch, statusOptions } = useLeads();

  async function handleStageChange(payload: UpdatePayload) {
    try {
      await updateLead(payload);          // optimistic inside the hook; throws on failure
    } catch (e) {
      // surface inline; the hook already reverted
    }
  }

  // …render filters + AG Grid table + modals, passing data down as props…
}
```

- Default-export Shells and page-level components (matches `LeadDashboardShell`) — **component
  files use `export default`; hooks and the api layer are named exports.** (Note: `@crm/ui`
  re-exports its primitives as *named* exports from the barrel, so consume them as
  `import { Modal } from '@crm/ui'`.)
- Keep mutation error handling in the Shell (or hook) and show it inline near the action.
- Tables are **AG Grid** (`ag-grid-react`) configured in the Shell/Table component.

---

## 5. Data Hooks (`apps/web/hooks/`)

Two accepted patterns — pick per case, but always `'use client'`, always return a **named
object** with a declared `interface …Return`, never JSX.

**A. Hand-rolled (`useState` + `useEffect` + `useCallback` + `useRef`)** — used when the hook
owns rich derived state, optimistic updates, and silent refetch (see `hooks/useLeads.ts`):

```ts
'use client';
export function useLeads(orgIds?: string[], platforms?: string[]): UseLeadsReturn {
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await leadsApi.list({ page: 1, page_size: MAX_PAGE_SIZE /* … */ });
      setLeads(data.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(false); }, [/* stable string keys */ fetchData]);

  return { leads, loading, error, refetch: () => fetchData(true), /* … */ };
}
```

**B. SWR** — for straightforward read-through caching (`swr` is a dependency). Use a stable
key, `revalidateOnFocus: false`, and return the same named-object shape.

**Hook rules:**
- Name starts with `use`; file has no JSX.
- Return a typed named object; never a bare tuple, never `undefined` (default to empty/null).
- For hand-rolled hooks, mirror changing inputs into refs and depend on **stringified keys**
  (`orgIds?.join(',')`) in effects to avoid array-identity churn — see `useLeads`.
- Errors are caught and exposed as `error: string | null`; the caller decides how to show them.

---

## 6. Styling — Tailwind v4

- `app/globals.css` starts with `@import "tailwindcss";` then a small set of global rules
  (box-sizing, the `body.dashboard-shell` viewport policy). PostCSS via `@tailwindcss/postcss`.
- Write utilities **inline** in JSX. Brand values are expressed as arbitrary values
  (`text-[#0F172A]`, `bg-[#F8FAFC]`) or the Tailwind `slate` palette; this is the established
  convention — stay consistent with neighbouring components rather than inventing tokens.
- Compose conditional classes with template strings (`` `... ${cond ? 'a' : 'b'}` ``); there is
  no `clsx` dependency.
- `*.module.css` is reserved for the few widgets that already use it. Do not add new CSS modules
  or a token layer without discussing it first.

```tsx
<button
  type="button"
  onClick={onClose}
  aria-label="Close"
  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
>
```

---

## 7. Shared UI Primitives (`@crm/ui`)

Import generic building blocks from `@crm/ui` rather than re-implementing:

- `Modal` — controlled (`open`, `onClose`, `title`, `maxWidth`, `locked`); Escape-to-close,
  `role="dialog"` + `aria-modal`. See `packages/ui/src/components/Modal/Modal.tsx`.
- `Pagination`, `DownloadButton`, `MonthGrid`, `Placeholder`.
- Hooks: `useDropdown`, `useIsMobile`.
- `createApiClient` (fetch wrapper).

Build a component in `@crm/ui` when it has **zero CRM domain knowledge** and is reused across
apps/modules. Otherwise build it under `apps/web/components/<domain>/`.

---

## 8. TypeScript Discipline

1. **No `any`.** Use `unknown` + narrowing; opaque server fields stay `unknown` / `unknown[]`.
2. **`interface` for component props and hook return types.** `type` for unions/aliases.
3. **Domain types come from `@crm/types`** (`LeadView`, `SessionUser`, `UserOrgOption`, …) —
   imported normally or via inline `import('@crm/types').X` in the api layer. Web-only types
   live in `apps/web/src/types`.
4. **Error narrowing:** `err instanceof Error ? err.message : 'Unknown error'`. When you need
   HTTP status, the thrown object is an `ApiRequestError` (`.status`, `.body`).
5. Keep API field names `snake_case` end-to-end; only convert to display strings in the view.

---

## 9. Auth, Session & Roles

- **Server side:** `getServerSession()` (`@/src/lib/server-session`) reads the session cookie
  and returns `{ session, cookieHeader }`. Use it in pages/layouts; pass results down as props.
- **Role/rank gating:** ranks come from `@crm/permissions` (`RANKS`, numeric ladder). Gate UI on
  the actor's rank/role, but treat the frontend as advisory only — the backend RLS + gateway are
  the real enforcement. Never rely on hiding a button for security.
- **Module gating:** `getEnabledModules(cookieHeader)` returns the tenant's enabled modules;
  the dashboard layout hides nav for disabled ones.

---

## 10. Absolute Prohibitions

Flag and redesign if a requirement demands any of these:

- Import backend/service code, a DB client, or Drizzle schema into `apps/web`.
- Call `fetch` (or axios) from a component/hook instead of `api.*` in `src/lib/api/client.ts`.
- Put `useState`/`useEffect`/handlers in a `page.tsx`.
- Return JSX from a hook, or fetch data inside a leaf presentational component.
- camelCase an API request/response field (contract is `snake_case`).
- Introduce a new CSS-module/token system or a per-tenant CSS theme layer.
- Use `any` / `as any` / `@ts-ignore`.
- Treat a frontend role check as a security boundary.

---

## Read next

- `patterns.md` — copy-paste templates for pages, Shells, hooks, api namespaces, modals.
- `checklist.md` — run before marking any frontend task complete.
