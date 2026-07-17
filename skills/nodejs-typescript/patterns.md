# Node.js Backend — Patterns Reference

Copy-paste templates matching `services/*`. Replace `<Domain>` / `<domain>` / `<Entity>` /
`<entity>` / `<schema>` with real names. Read `SKILL.md` first. All relative imports use `.js`.

---

## 1. `api/v1/index.ts` — mount routers

```ts
import type { FastifyInstance } from 'fastify';
import { <domain>Router } from './<domain>/<domain>.router.js';
import { <other>Router } from './<other>/<other>.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(<domain>Router);
  await app.register(<other>Router);
}
```

---

## 2. Router

```ts
import type { FastifyInstance } from 'fastify';
import { create<Entity>Schema, update<Entity>Schema } from '@crm/validation';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { <Domain>Controller } from './<domain>.controller.js';
import { list<Entity>QuerySchema } from './<domain>.schema.js';

const ctrl = new <Domain>Controller();

export async function <domain>Router(app: FastifyInstance) {
  app.get('/<domain>',       { preHandler: [authenticate, validate({ query: list<Entity>QuerySchema })] }, ctrl.list);
  app.post('/<domain>',      { preHandler: [authenticate, validate({ body: create<Entity>Schema })] },     ctrl.create);
  app.get('/<domain>/:id',   { preHandler: [authenticate] },                                               ctrl.getById);
  app.patch('/<domain>/:id', { preHandler: [authenticate, validate({ body: update<Entity>Schema })] },     ctrl.update);
  app.delete('/<domain>/:id',{ preHandler: [authenticate] },                                               ctrl.delete);
}
```

---

## 3. Controller

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Create<Entity>Input, Update<Entity>Input } from '@crm/validation';
import { RANKS } from '@crm/permissions';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './<domain>.service.js';
import type { List<Entity>Query } from './<domain>.schema.js';

export class <Domain>Controller {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const q = request.query as List<Entity>Query;
    const result = await service.list<Entity>({ org_id, user_id, role, tenant_id }, {
      page: q.page, page_size: q.page_size, ...(q.search ? { search: q.search } : {}),
    });
    return reply.send({ success: true, data: result.rows, total: result.total, page: result.page, page_size: result.page_size });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    const row = await service.get<Entity>ById({ org_id, user_id, role, tenant_id }, id);
    return reply.send({ success: true, data: row });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const result = await service.create<Entity>({ org_id, user_id, role, tenant_id }, request.body as Create<Entity>Input);
    return reply.status(201).send({ success: true, data: { id: result.id } });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id } = request.auth;
    const { id } = request.params as { id: string };
    await service.update<Entity>({ org_id, user_id, role, tenant_id }, id, request.body as Update<Entity>Input);
    return reply.status(204).send();
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

---

## 4. Service (function module)

```ts
import type { RoleTxContext } from '@crm/db';
import { logActivity } from '@crm/audit-log';
import { NotFoundError } from '../../../lib/errors.js';
import { publishEvent } from '../../../events/publisher.js';
import * as repo from './<domain>.repository.js';
import type { List<Entity>Filters } from './<domain>.repository.js';
import type { Create<Entity>Input, Update<Entity>Input } from '@crm/validation';

export async function list<Entity>(ctx: RoleTxContext, filters: List<Entity>Filters) {
  return repo.list<Entity>(ctx, filters);
}

export async function get<Entity>ById(ctx: RoleTxContext, id: string) {
  const row = await repo.get<Entity>ById(ctx, id);
  if (!row) throw new NotFoundError('<Entity> not found');
  return row;
}

export async function create<Entity>(ctx: RoleTxContext, data: Create<Entity>Input) {
  const result = await repo.create<Entity>(ctx, data);
  await logActivity({ action_type: '<entity>_created', performed_by: ctx.user_id, org_id: ctx.org_id });
  publishEvent('<entity>:created', { id: result.id, org_id: ctx.org_id, tenant_id: ctx.tenant_id, actor_id: ctx.user_id });
  return result;
}

export async function update<Entity>(ctx: RoleTxContext, id: string, data: Update<Entity>Input) {
  const result = await repo.update<Entity>(ctx, id, data);
  if (!result) throw new NotFoundError('<Entity> not found');
  await logActivity({ action_type: '<entity>_updated', performed_by: ctx.user_id, org_id: ctx.org_id });
  publishEvent('<entity>:updated', { id, org_id: ctx.org_id, tenant_id: ctx.tenant_id, actor_id: ctx.user_id });
  return result;
}

export async function delete<Entity>(ctx: RoleTxContext, id: string) {
  await repo.delete<Entity>(ctx, id);
  await logActivity({ action_type: '<entity>_deleted', performed_by: ctx.user_id, org_id: ctx.org_id });
  publishEvent('<entity>:deleted', { id, org_id: ctx.org_id, tenant_id: ctx.tenant_id, actor_id: ctx.user_id });
}
```

---

## 5. Repository (RLS boundary)

```ts
import { sql, and, eq } from 'drizzle-orm';
import { withRoleTx } from '@crm/db';
import type { RoleTxContext } from '@crm/db';
import { <entity>Table } from '@crm/db/schema';

export interface List<Entity>Filters {
  page: number; page_size: number; search?: string; org_ids?: string[];
}

// READ — from the view, inside withRoleTx (RLS applies through security_invoker views)
export async function list<Entity>(ctx: RoleTxContext, filters: List<Entity>Filters) {
  return withRoleTx(ctx, async (tx) => {
    const offset = (filters.page - 1) * filters.page_size;
    const where = and(
      sql`NOT is_deleted`,
      filters.org_ids?.length ? sql`org_id = ANY(${filters.org_ids}::uuid[])` : undefined,
      filters.search ? sql`full_name ILIKE ${`%${filters.search}%`}` : undefined,
    );
    const rows = (await tx.execute(sql`
      SELECT *, COUNT(*) OVER () AS total_count
      FROM <schema>.vw_<entity>
      ${where ? sql`WHERE ${where}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${filters.page_size} OFFSET ${offset}
    `)) as Array<Record<string, unknown>>;
    return { rows, total: rows[0] ? Number(rows[0]['total_count'] ?? 0) : 0, page: filters.page, page_size: filters.page_size };
  });
}

export async function get<Entity>ById(ctx: RoleTxContext, id: string) {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT * FROM <schema>.vw_<entity> WHERE id = ${id}::uuid AND NOT is_deleted LIMIT 1
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

// WRITE — base table; RLS WITH CHECK enforces org/tenant scope
export async function create<Entity>(ctx: RoleTxContext, data: Create<Entity>Input) {
  return withRoleTx(ctx, async (tx) => {
    const [row] = await tx.insert(<entity>Table).values({
      orgId: data.org_id ?? ctx.org_id,   // camelCase Drizzle keys map to snake_case columns
      // …map remaining fields…
    }).returning({ id: <entity>Table.id });
    return { id: row.id };
  });
}

export async function update<Entity>(ctx: RoleTxContext, id: string, data: Update<Entity>Input) {
  return withRoleTx(ctx, async (tx) => {
    const [row] = await tx.update(<entity>Table)
      .set({ /* …map fields… */ })
      .where(eq(<entity>Table.id, id))
      .returning({ id: <entity>Table.id });
    return row ?? null;
  });
}

export async function delete<Entity>(ctx: RoleTxContext, id: string) {
  return withRoleTx(ctx, async (tx) => {
    await tx.update(<entity>Table).set({ isDeleted: true }).where(eq(<entity>Table.id, id));
  });
}
```

---

## 6. Validation schema (local)

```ts
// api/v1/<domain>/<domain>.schema.ts
import { z } from 'zod';

export const list<Entity>QuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().min(1).max(5000).default(50),
  search:    z.string().max(200).optional(),
  org_ids:   z.string().optional(),   // CSV of uuids; split in the controller
});
export type List<Entity>Query = z.infer<typeof list<Entity>QuerySchema>;
```

Shared body schemas belong in `@crm/validation` (snake_case, `.refine()` for cross-field rules):

```ts
// packages/validation/src/<domain>.ts
import { z } from 'zod';
export const create<Entity>Schema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  email:      z.string().email('Invalid email address').optional(),
  org_id:     z.string().uuid('Invalid org_id').optional(),
}).refine((d) => Boolean(d.email), { message: 'Email is required' });
export type Create<Entity>Input = z.infer<typeof create<Entity>Schema>;
```

---

## 7. validate middleware

```ts
// middleware/validate.middleware.ts
import type { FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

interface Schemas { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema; }

export function validate(schemas: Schemas) {
  return async (request: FastifyRequest): Promise<void> => {
    if (schemas.body)   request.body   = schemas.body.parse(request.body);
    if (schemas.query)  request.query  = schemas.query.parse(request.query);
    if (schemas.params) request.params = schemas.params.parse(request.params);
    // ZodError propagates → server.ts setErrorHandler → 422
  };
}
```

---

## 8. Events publisher

```ts
// events/publisher.ts  — fire-and-forget domain events (pg NOTIFY / bus)
import { notify } from '@crm/db';

export function publishEvent(event: string, payload: Record<string, unknown>) {
  void notify(event, payload);   // never block the request on delivery
}
```

Consumers (e.g. notifications-service) subscribe and react. Payloads carry
`{ id/lead_id, org_id, tenant_id, actor_id, … }` — IDs only, no PII.

---

## 9. Config

```ts
// config/index.ts — the ONLY place reading process.env
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[<name>-service] Missing required env var: ${name}`);
  return v;
}
export const config = {
  port: parseInt(process.env['<NAME>_SERVICE_PORT'] ?? '4000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseUrlService: requireEnv('DATABASE_URL_SERVICE'),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
} as const;
```

---

## 10. Request augmentation

```ts
// global.d.ts
import type { AuthContext } from '@crm/service-auth';
declare module 'fastify' {
  interface FastifyRequest { auth: AuthContext; }   // { org_id, user_id, role, tenant_id, rank }
}
```

---

## 11. System operation (bypass RLS deliberately)

```ts
import { withServiceTx } from '@crm/db';

// ONLY for genuine system work with no user context (cross-tenant job, gateway-less intake).
// Document why RLS is bypassed every time.
export async function reconcileAllTenants() {
  return withServiceTx(async (tx) => {
    // runs as the BYPASSRLS service role — no org/tenant scoping
  });
}
```
