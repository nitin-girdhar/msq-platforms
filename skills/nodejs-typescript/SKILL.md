# Node.js Backend — CRM Monorepo Skill

> **Authoritative baseline for every backend service under `services/*`.**
> This documents how the services are *actually* built. Match these patterns exactly.

Stack: **Fastify 5 · TypeScript (ESM, `.js` import specifiers) · Drizzle ORM · PostgreSQL with
Row-Level Security · Zod · Pino · `tsx` runtime.** Services are small and single-domain, sit
behind an **API gateway**, and share code through workspace packages:

| Package            | Provides                                                                 |
|--------------------|--------------------------------------------------------------------------|
| `@crm/db`          | DB pools, Drizzle clients, **`withRoleTx` / `withServiceTx`** (the RLS boundary), schema (`@crm/db/schema`) |
| `@crm/validation`  | Shared Zod request schemas + inferred input types                        |
| `@platform/authz`  | Shared `RANKS` ladder, identity/tenancy checks, org-scope resolution, user-management rank gates, async product entitlement (`hasProduct`/`assertProduct` — cached read of `entity.tenant_modules`; source injected via `configureProductSource`) |
| `@lms/authz`       | Sales roles + LMS per-tenant business rules and access checks             |
| `@hr/authz`        | HR authority helpers (leave / attendance / employee management)           |
| `@task/authz`      | Task scope gates                                                          |
| `@crm/permissions` | **Deprecated compat barrel** re-exporting the four `*/authz` packages — existing imports still resolve; prefer the product package for new code |
| `@crm/service-auth`| `readAuthContext(headers, secret)` — verifies gateway-injected identity  |
| `@crm/audit-log`   | `logActivity(...)`                                                        |
| `@crm/types`       | Shared domain/view types                                                  |

## When this skill applies

Any backend work: a new service, a new `api/v1/<domain>` module, a new route, a repository
change, or touching auth / RLS / validation.

---

## ⚠️ Security is Non-Negotiable — RLS is the boundary

> **Every DB access happens inside `withRoleTx(ctx, tx => …)`.** That helper sets the Postgres
> role (`app_user` / `tenant_admin`) and the session GUCs (`app.current_org_id`,
> `app.current_user_id`, `app.current_tenant_id`) that the database's RLS policies read.
> This is what stops one org/tenant from seeing another's data. **Never** run a domain query on a
> raw pool, and **never** bypass RLS with `withServiceTx` / the service role except for genuine
> system operations (cross-tenant jobs, gateway-less intake). The acting identity always comes
> from `request.auth` (set by the gateway), never from the request body or query.

---

## 1. Service Structure

```
services/<name>-service/
├── src/
│   ├── api/
│   │   └── v1/
│   │       ├── index.ts                     ← mounts every domain router
│   │       └── <domain>/
│   │           ├── <domain>.router.ts       ← Fastify routes + preHandlers only
│   │           ├── <domain>.controller.ts   ← class of arrow handlers (request/reply)
│   │           ├── <domain>.service.ts       ← MODULE of functions (business logic)
│   │           ├── <domain>.repository.ts    ← MODULE of functions (DB via withRoleTx)
│   │           └── <domain>.schema.ts        ← local Zod (when not in @crm/validation)
│   ├── middleware/
│   │   ├── auth.middleware.ts                ← authenticate preHandler → request.auth
│   │   └── validate.middleware.ts            ← validate({ body|query|params })
│   ├── lib/
│   │   ├── errors.ts                         ← AppError + subclasses
│   │   └── auth-context.ts / <helpers>
│   ├── events/publisher.ts                   ← publishEvent(...) (pg NOTIFY / bus)
│   ├── config/index.ts                       ← env access (the only place reading process.env)
│   ├── global.d.ts                           ← Fastify request augmentation (request.auth)
│   └── server.ts                             ← Fastify factory + setErrorHandler + listen
```

Note: services do **not** own DB schema or migrations — those live in `@crm/db` (Drizzle
schema) and `db_scripts/*.sql` (authoritative SQL). See the PostgreSQL skill.

### Layer responsibilities

| Layer          | Knows about                                             | Never touches                                  |
|----------------|--------------------------------------------------------|------------------------------------------------|
| **Router**     | HTTP verb/path, preHandler chain                       | Business rules, DB                             |
| **Controller** | `request`/`reply`, `request.auth`, coarse role/rank gate | DB queries, multi-step business logic         |
| **Service**    | Business rules, orchestration, audit + events          | `request`/`reply`, HTTP status codes          |
| **Repository** | `withRoleTx`, Drizzle/SQL, views for reads             | Business rules, HTTP                           |
| **Middleware** | Auth, validation                                       | Domain rules                                  |

---

## 2. Router (Fastify)

```ts
// api/v1/<domain>/<domain>.router.ts
import type { FastifyInstance } from 'fastify';
import { create<Entity>Schema, update<Entity>Schema } from '@crm/validation';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { <Domain>Controller } from './<domain>.controller.js';
import { list<Entity>QuerySchema } from './<domain>.schema.js';

const ctrl = new <Domain>Controller();

export async function <domain>Router(app: FastifyInstance) {
  app.get('/<domain>',      { preHandler: [authenticate, validate({ query: list<Entity>QuerySchema })] }, ctrl.list);
  app.post('/<domain>',     { preHandler: [authenticate, validate({ body: create<Entity>Schema })] },     ctrl.create);
  app.get('/<domain>/:id',  { preHandler: [authenticate] },                                               ctrl.getById);
  app.patch('/<domain>/:id',{ preHandler: [authenticate, validate({ body: update<Entity>Schema })] },     ctrl.update);
  app.delete('/<domain>/:id',{ preHandler: [authenticate] },                                              ctrl.delete);
}
```

- Every router is `export async function <domain>Router(app: FastifyInstance)`.
- Note ESM `.js` specifiers on every relative import.
- `authenticate` is always first; `validate({...})` follows on input routes.
- `api/v1/index.ts` registers each router; `server.ts` mounts `v1Router` at `/api/v1`.

---

## 3. Controller

A class of arrow-function handlers. Reads `request.auth`, does coarse role/rank gating, calls
the service module, shapes the response envelope. Throws `AppError` subclasses — no `next`.

```ts
// api/v1/<domain>/<domain>.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Create<Entity>Input, Update<Entity>Input } from '@crm/validation';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './<domain>.service.js';
import type { List<Entity>Query } from './<domain>.schema.js';

export class <Domain>Controller {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    const q = request.query as List<Entity>Query;
    const result = await service.list<Entity>(
      { org_id, user_id, role, tenant_id },
      { page: q.page, page_size: q.page_size, ...(q.search ? { search: q.search } : {}) },
    );
    return reply.send({
      success: true, data: result.rows, total: result.total, page: result.page, page_size: result.page_size,
    });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const data = request.body as Create<Entity>Input;
    const result = await service.create<Entity>({ org_id, user_id, role, tenant_id }, data);
    return reply.status(201).send({ success: true, data: { id: result.id } });
  };

  delete = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    if (rank < RANKS.ADMIN) throw new ForbiddenError('Only admins can delete');
    const { id } = request.params as { id: string };
    await service.delete<Entity>({ org_id, user_id, role, tenant_id }, id);
    return reply.status(204).send();
  };
}
```

- `request.auth` shape: `{ org_id, user_id, role, tenant_id, rank }` (see `@crm/service-auth`).
- Pass the first four as the `RoleTxContext` (`{ role, org_id, tenant_id, user_id }`) to the service.
- Coarse gates (rank thresholds, `checkXAccess` from `@crm/permissions`) live here; deep
  business rules live in the service.
- Response envelope: `{ success: true, data, total?, page?, page_size? }`. `snake_case` keys.
  201 on create, 204 (`.send()`) on delete/no-content.

---

## 4. Service — a module of functions

Services are **modules of exported functions**, not classes. First param is always the
`RoleTxContext`. They hold business rules, call the repository, write audit logs, publish events.

```ts
// api/v1/<domain>/<domain>.service.ts
import type { RoleTxContext } from '@crm/db';
import { logActivity } from '@crm/audit-log';
import { NotFoundError, AppError, ForbiddenError } from '../../../lib/errors.js';
import { publishEvent } from '../../../events/publisher.js';
import * as repo from './<domain>.repository.js';
import type { List<Entity>Filters } from './<domain>.repository.js';

export async function list<Entity>(ctx: RoleTxContext, filters: List<Entity>Filters) {
  return repo.list<Entity>(ctx, filters);
}

export async function get<Entity>ById(ctx: RoleTxContext, id: string) {
  const row = await repo.get<Entity>ById(ctx, id);
  if (!row) throw new NotFoundError('<Entity> not found');   // typed error, never raw Error
  return row;
}

export async function create<Entity>(ctx: RoleTxContext, data: Create<Entity>Input) {
  const result = await repo.create<Entity>(ctx, data);
  await logActivity({ action_type: '<entity>_created', performed_by: ctx.user_id, org_id: ctx.org_id });
  publishEvent('<entity>:created', { id: result.id, org_id: ctx.org_id, tenant_id: ctx.tenant_id, actor_id: ctx.user_id });
  return result;
}
```

- `import * as service` in the controller; `import * as repo` in the service.
- Throw `AppError` subclasses. Never `throw new Error(...)` for expected conditions.
- Log every create/update/delete via `logActivity({ action_type, performed_by, org_id, … })`.
- Publish domain events via `publishEvent('<entity>:<verb>', payload)` where downstream services react.

---

## 5. Repository — the RLS boundary

Repositories are also **modules of functions**. Every DB operation is wrapped in
`withRoleTx(ctx, async (tx) => …)`. Reads target **views** (`<schema>.vw_<name>`); writes target
base tables via the Drizzle table objects from `@crm/db/schema`.

```ts
// api/v1/<domain>/<domain>.repository.ts
import { sql, and, eq, asc } from 'drizzle-orm';
import { withRoleTx } from '@crm/db';
import type { RoleTxContext } from '@crm/db';
import { <entity>Table } from '@crm/db/schema';

export interface List<Entity>Filters {
  page: number; page_size: number; search?: string;
}

export async function list<Entity>(ctx: RoleTxContext, filters: List<Entity>Filters) {
  return withRoleTx(ctx, async (tx) => {
    const offset = (filters.page - 1) * filters.page_size;
    const where = and(
      sql`NOT is_deleted`,
      filters.search ? sql`full_name ILIKE ${`%${filters.search}%`}` : undefined,
    );
    const rows = (await tx.execute(sql`
      SELECT *, COUNT(*) OVER () AS total_count
      FROM <schema>.vw_<entity>
      ${where ? sql`WHERE ${where}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${filters.page_size} OFFSET ${offset}
    `)) as Array<Record<string, unknown>>;
    const total = rows[0] ? Number(rows[0]['total_count'] ?? 0) : 0;
    return { rows, total, page: filters.page, page_size: filters.page_size };
  });
}

export async function create<Entity>(ctx: RoleTxContext, data: Create<Entity>Input) {
  return withRoleTx(ctx, async (tx) => {
    const [row] = await tx.insert(<entity>Table).values({ /* map snake_case cols */ }).returning({ id: <entity>Table.id });
    return { id: row.id };
    // RLS WITH CHECK enforces org/tenant on the write — the DB rejects out-of-scope inserts.
  });
}
```

**Rules:**
- **Reads:** query a view via raw `sql` template (parameterised — never string-concatenate
  user input) or `tx.select().from(view)`. Views already resolve FK→label and join related tables.
- **Writes:** `tx.insert/update/delete` on a base `*Table`. Rely on RLS `WITH CHECK` to enforce
  scope on writes; do not hand-roll org filtering that duplicates a policy.
- Soft delete = set `is_deleted = true` (boolean), not a `deleted_at` timestamp. Filter reads
  with `NOT is_deleted`.
- `withServiceTx(tx => …)` (BYPASSRLS service role) is **only** for system operations with no
  user context. Justify every use in a comment.

---

## 6. Auth Middleware

```ts
// middleware/auth.middleware.ts
import type { FastifyRequest } from 'fastify';
import { readAuthContext } from '@crm/service-auth';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  request.auth = result.auth;   // { org_id, user_id, role, tenant_id, rank }
}
```

Identity is injected by the gateway and verified via the internal HMAC secret. Services never
parse client tokens directly and never trust an identity from the request body/query.
`request.auth` is declared in `src/global.d.ts` (Fastify module augmentation).

---

## 7. Validation

Prefer shared schemas from `@crm/validation` for request bodies; put list/query schemas local
in `<domain>.schema.ts`. `validate()` runs as a preHandler and throws a `ZodError` that
`server.ts` maps to a 422.

```ts
// api/v1/<domain>/<domain>.schema.ts
import { z } from 'zod';
export const list<Entity>QuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().min(1).max(5000).default(50),
  search:    z.string().max(200).optional(),
});
export type List<Entity>Query = z.infer<typeof list<Entity>QuerySchema>;
```

Shared schema example (`@crm/validation`) uses `snake_case` fields and `.refine()` for
cross-field rules — see `packages/validation/src/leads.ts`.

---

## 8. Errors & Server Bootstrap

```ts
// lib/errors.ts
export class AppError extends Error {
  constructor(message: string, public readonly statusCode = 500, public readonly details?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}
export class NotFoundError     extends AppError { constructor(m = 'Not found')     { super(m, 404); } }
export class UnauthorizedError extends AppError { constructor(m = 'Unauthorized')  { super(m, 401); } }
export class ForbiddenError    extends AppError { constructor(m = 'Forbidden')     { super(m, 403); } }
export class BadRequestError   extends AppError { constructor(m: string, d?: unknown) { super(m, 400, d); } }
```

```ts
// server.ts
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config/index.js';
import { v1Router } from './api/v1/index.js';
import { AppError } from './lib/errors.js';
import { closeAllPools } from '@crm/db';

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    ...(config.nodeEnv !== 'production' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  },
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    app.log[error.statusCode >= 500 ? 'error' : 'warn']({ err: error, path: request.url }, error.message);
    const body: Record<string, unknown> = { success: false, error: error.message };
    if (error.details !== undefined) body['details'] = error.details;
    return reply.status(error.statusCode).send(body);
  }
  if (error instanceof ZodError) {
    return reply.status(422).send({ success: false, error: 'Validation failed', details: error.flatten().fieldErrors });
  }
  app.log.error({ err: error, path: request.url }, 'Unhandled error');
  return reply.status(500).send({ success: false, error: 'Internal server error' });
});

app.register(v1Router, { prefix: '/api/v1' });
app.get('/health', async () => ({ status: 'ok', service: '<name>-service' }));

const start = async () => {
  try { await app.listen({ port: config.port, host: '0.0.0.0' }); }
  catch (err) { app.log.error(err); process.exit(1); }
};
const stop = async () => { await app.close(); await closeAllPools(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
start();
```

---

## 9. Config

`src/config/index.ts` is the **only** place that reads `process.env`. It uses a `requireEnv`
helper and exports a frozen `config` object (`config.port`, `config.nodeEnv`, `config.databaseUrl`,
`config.databaseUrlService`, …). Missing required vars throw at startup.

```ts
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[<name>-service] Missing required env var: ${name}`);
  return value;
}
export const config = {
  port: parseInt(process.env['<NAME>_SERVICE_PORT'] ?? '4000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlService: requireEnv('DATABASE_URL_SERVICE'),
} as const;
```

---

## 10. Response Contract

```
Single:     { "success": true, "data": { … } }
List:       { "success": true, "data": [ … ], "total": 150, "page": 1, "page_size": 50 }
No content: HTTP 204, empty body
Error:      { "success": false, "error": "message", "details"?: { … } }
```

Keys are `snake_case` (`page_size`). Never return naked arrays/objects; never vary the envelope.

---

## 11. Absolute Prohibitions

- Run a domain query outside `withRoleTx` (or use `withServiceTx`/the service role without a
  documented system-operation reason).
- Trust an identity from the request body/query instead of `request.auth`.
- Put a DB query in a service or business logic in a controller.
- Write a service or repository as a class (they are function modules) — or a router without the
  `export async function <domain>Router(app)` shape.
- `throw new Error(...)` for an expected condition — use an `AppError` subclass.
- Read `process.env` outside `config/index.ts`.
- String-concatenate user input into SQL — always parameterise via `sql`` templates.
- Join multiple tables ad hoc in TypeScript for a read — query the `vw_*` view instead.
- Omit the ESM `.js` suffix on relative imports.
- Log tokens, passwords, or PII.

---

## Read next

- `patterns.md` — copy-paste templates (router/controller/service/repo, RLS tx, events, config).
- `checklist.md` — run before completing any backend task.
- PostgreSQL skill — views, RLS policies, schemas, lookup tables.
