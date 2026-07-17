# React / Next.js — Pre-Delivery Checklist

Run every item before marking a frontend task complete or opening a PR.

## Structure & layering
- [ ] `page.tsx` only resolves session, gates access, and renders a Shell — no state/handlers
- [ ] Authenticated pages export `const dynamic = 'force-dynamic'`
- [ ] Client orchestration lives in a `'use client'` `<Domain>Shell`; leaf components take props only
- [ ] No JSX in any file under `hooks/`
- [ ] Components are `export default`; hooks and the api layer are named exports

## Data access
- [ ] No `fetch`/axios in components or hooks — all calls go through `api.*` in `src/lib/api/client.ts`
- [ ] New endpoints added as a typed `export const <resource> = { … }` namespace in `client.ts`
- [ ] Response envelope typed inline (`{ success: true; data; total?; page?; page_size? }`)
- [ ] Query strings built with the `URLSearchParams(Object.entries().filter().map())` pattern
- [ ] All request/response fields are `snake_case`
- [ ] No backend/service/DB/Drizzle import anywhere in `apps/web`

## Hooks
- [ ] Hook name starts with `use`; returns a typed named object (never a tuple, never `undefined`)
- [ ] Exposes `loading` and `error: string | null`; errors caught, not thrown to render
- [ ] Effects depend on stringified keys (`ids?.join(',')`), not array/object identity
- [ ] Optimistic updates revert via a silent refetch on failure

## TypeScript
- [ ] No `any` / `as any` / `@ts-ignore`
- [ ] Domain types imported from `@crm/types`; web-only types in `src/types`
- [ ] Error narrowing uses `err instanceof Error`; HTTP status read from `ApiRequestError.status`

## Styling
- [ ] Tailwind utility classes inline in JSX (consistent with neighbouring components)
- [ ] No new `*.module.css` files or token/theme layer introduced
- [ ] Conditional classes composed with template strings (no `clsx`)
- [ ] Reused generic primitives come from `@crm/ui` (`Modal`, `Pagination`, …), not re-implemented

## Auth & access
- [ ] Session resolved server-side via `getServerSession()` and passed down as props
- [ ] Role/rank/module gating uses `@crm/permissions` ranks + enabled modules
- [ ] No frontend check is relied on as a security boundary (backend RLS/gateway is authoritative)

## UX
- [ ] Loading, empty, and error states handled for every async view
- [ ] Mutations show inline errors (from `ApiRequestError.message`, which flattens server details)
- [ ] Modals use `@crm/ui` `Modal` (Escape-to-close, `role="dialog"`, `aria-modal`)
- [ ] Icon-only buttons have `aria-label`
