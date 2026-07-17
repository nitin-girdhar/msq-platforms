# Node.js Backend — Pre-Delivery Checklist

Run every item before marking a backend task complete or opening a PR.

## Security / RLS (non-negotiable)
- [ ] Every domain DB access runs inside `withRoleTx(ctx, tx => …)` — no queries on a raw pool
- [ ] `withServiceTx` / service role used ONLY for documented system operations (no user context)
- [ ] Acting identity comes from `request.auth`, never from request body/query
- [ ] Writes rely on RLS `WITH CHECK` for scope; no client-supplied `org_id`/`tenant_id` trusted blindly
- [ ] No user input string-concatenated into SQL — all via parameterised `sql`` templates

## Layering
- [ ] Router is `export async function <domain>Router(app)`; routes list preHandlers only
- [ ] Controller reads `request.auth`, does coarse rank/role gates, shapes the envelope — no DB/business logic
- [ ] Service is a **function module** (`import * as service`) holding business rules; no `request`/`reply`
- [ ] Repository is a **function module**; the only layer with DB access; reads from `vw_*` views
- [ ] `authenticate` is the first preHandler on every protected route; `validate({...})` on input routes

## Validation & types
- [ ] Every input route has a Zod schema (shared in `@crm/validation`, or local `<domain>.schema.ts`)
- [ ] Query/param schemas coerce + bound values (`z.coerce.number().int().min().max()`)
- [ ] No `any` / `as any` / `@ts-ignore`; service/repo params explicitly typed
- [ ] Field names are `snake_case` end-to-end

## Errors
- [ ] Expected failures throw `AppError` subclasses (`NotFoundError`, `ForbiddenError`, …) — never raw `Error`
- [ ] `server.ts` `setErrorHandler` maps `AppError` and `ZodError` to the standard envelope
- [ ] 401/403/404/422 all return `{ success: false, error, details? }`

## Response contract
- [ ] Single → `{ success: true, data }`; list → `{ success: true, data, total, page, page_size }`
- [ ] 201 on create, 204 (`reply.status(204).send()`) on delete/no-content
- [ ] Envelope shape identical across every endpoint

## Audit, events, logging
- [ ] Every create/update/delete calls `logActivity({ action_type, performed_by, org_id, … })`
- [ ] Domain events published via `publishEvent('<entity>:<verb>', …)` with IDs only (no PII)
- [ ] No tokens/passwords/PII in logs

## Config & ESM
- [ ] `process.env` read only in `config/index.ts`; missing required vars throw at startup
- [ ] Every relative import uses the `.js` specifier
- [ ] `request.auth` typed via Fastify augmentation in `global.d.ts`

## Data reads
- [ ] Multi-table reads query a `<schema>.vw_*` view (created `WITH (security_invoker = true)`) — no ad-hoc TS joins
- [ ] Soft delete uses `is_deleted = true`; reads filter `NOT is_deleted`
- [ ] Any new/changed view is confirmed and added to `db_scripts/*.sql` + `@crm/db/schema` (see PostgreSQL skill)

## Docs & tests
- [ ] Bruno files in `/api-testing/` updated for any API change
- [ ] Relevant `.md` docs updated
