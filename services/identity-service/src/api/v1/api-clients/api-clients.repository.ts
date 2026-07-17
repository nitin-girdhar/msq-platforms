import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx } from '@crm/db';
import type { RoleTxContext, DrizzleTx } from '@crm/db';

export interface ApiClientRow extends Record<string, unknown> {
  id: string;
  org_ids: string[];
}

export interface InsertApiClientData {
  tenant_id: string;
  org_ids: string[];
  scope_all_orgs: boolean;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  rate_limit_per_min: number;
  expires_at: string | null;
  created_by: string;
}

// Renders a text[] as a Postgres array literal so it binds as a single param.
function toTextArrayLiteral(items: string[]): string {
  return `{${items.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
}

const SELECT_COLUMNS = sql`
  c.id, c.name, c.key_prefix, c.scopes, c.rate_limit_per_min, c.scope_all_orgs,
  c.is_active, c.expires_at, c.last_used_at, c.revoked_at, c.created_at,
  COALESCE(array_agg(o.org_id) FILTER (WHERE o.org_id IS NOT NULL), '{}') AS org_ids
`;

async function insertOrgBindings(
  tx: DrizzleTx,
  apiClientId: string,
  orgIds: string[],
): Promise<void> {
  if (orgIds.length === 0) return;
  await tx.execute(sql`
    INSERT INTO ext.api_client_orgs (api_client_id, org_id)
    SELECT ${apiClientId}::uuid, org_id FROM unnest(${toTextArrayLiteral(orgIds)}::uuid[]) AS org_id
  `);
}

// Confirms every id in orgIds belongs to the given tenant and is active —
// used to validate a caller-supplied branch set before binding it to a key.
export async function orgsBelongToTenant(orgIds: string[], tenantId: string): Promise<boolean> {
  if (orgIds.length === 0) return true;
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM entity.organizations
      WHERE id = ANY(${toTextArrayLiteral(orgIds)}::uuid[])
        AND tenant_id = ${tenantId}::uuid
        AND NOT is_deleted
    `)) as Array<{ count: number }>;
    return (rows[0]?.count ?? 0) === orgIds.length;
  });
}

export async function insertApiClient(ctx: RoleTxContext, data: InsertApiClientData): Promise<ApiClientRow> {
  return withRoleTx(ctx, async (tx) => {
    // The id is generated up front (rather than via INSERT ... RETURNING) so the
    // branch bindings can be inserted before any row is read back. For an
    // org_admin (app_user), the org_isolation_policy's USING clause requires a
    // matching ext.api_client_orgs row to exist — RETURNING evaluates that
    // policy immediately after the parent insert, before bindings exist, and
    // would otherwise fail with "new row violates row-level security policy".
    const idRows = (await tx.execute(sql`SELECT gen_uuidv7() AS id`)) as Array<{ id: string }>;
    const id = idRows[0]!.id;

    await tx.execute(sql`
      INSERT INTO ext.api_clients
        (id, tenant_id, name, key_prefix, key_hash, scopes, rate_limit_per_min, scope_all_orgs, expires_at, created_by)
      VALUES (
        ${id}::uuid,
        ${data.tenant_id}::uuid,
        ${data.name},
        ${data.key_prefix},
        ${data.key_hash},
        ${toTextArrayLiteral(data.scopes)}::text[],
        ${data.rate_limit_per_min},
        ${data.scope_all_orgs},
        ${data.expires_at ? sql`${data.expires_at}::timestamptz` : sql`NULL`},
        ${data.created_by}::uuid
      )
    `);
    await insertOrgBindings(tx, id, data.org_ids);

    const rows = (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.id = ${id}::uuid
      GROUP BY c.id
    `)) as Array<ApiClientRow>;
    return rows[0]!;
  });
}

export async function listApiClients(ctx: RoleTxContext) {
  return withRoleTx(ctx, async (tx) => {
    return (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.tenant_id = ${ctx.tenant_id}::uuid
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `)) as Array<Record<string, unknown>>;
  });
}

export async function getApiClientById(ctx: RoleTxContext, id: string) {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.id = ${id}::uuid AND c.tenant_id = ${ctx.tenant_id}::uuid
      GROUP BY c.id
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
}

export async function revokeApiClient(ctx: RoleTxContext, id: string) {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE ext.api_clients
      SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW()
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenant_id}::uuid
      RETURNING id
    `)) as Array<{ id: string }>;
    return rows[0] ?? null;
  });
}

export interface UpdateApiClientData {
  name?: string;
  scopes?: string[];
  rate_limit_per_min?: number;
  expires_at?: string | null;
  org_ids?: string[];
  scope_all_orgs?: boolean;
}

export async function updateApiClient(ctx: RoleTxContext, id: string, data: UpdateApiClientData): Promise<ApiClientRow | null> {
  return withRoleTx(ctx, async (tx) => {
    const existing = (await tx.execute(sql`
      SELECT id FROM ext.api_clients WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenant_id}::uuid LIMIT 1
    `)) as Array<{ id: string }>;
    if (!existing[0]) return null;

    await tx.execute(sql`
      UPDATE ext.api_clients SET
        name               = COALESCE(${data.name ?? null}, name),
        scopes              = COALESCE(${data.scopes ? toTextArrayLiteral(data.scopes) : null}::text[], scopes),
        rate_limit_per_min  = COALESCE(${data.rate_limit_per_min ?? null}, rate_limit_per_min),
        scope_all_orgs      = COALESCE(${data.scope_all_orgs ?? null}, scope_all_orgs),
        expires_at          = CASE WHEN ${data.expires_at !== undefined} THEN ${data.expires_at ? sql`${data.expires_at}::timestamptz` : sql`NULL`} ELSE expires_at END,
        updated_at          = NOW()
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenant_id}::uuid
    `);

    if (data.org_ids !== undefined) {
      await tx.execute(sql`DELETE FROM ext.api_client_orgs WHERE api_client_id = ${id}::uuid`);
      await insertOrgBindings(tx, id, data.org_ids);
    }

    const rows = (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.id = ${id}::uuid AND c.tenant_id = ${ctx.tenant_id}::uuid
      GROUP BY c.id
      LIMIT 1
    `)) as Array<ApiClientRow>;
    return rows[0]!;
  });
}

// Rotates a key: revokes the existing row and inserts a fresh one carrying the
// same binding/scopes, in a single transaction.
export async function rotateApiClient(
  ctx: RoleTxContext,
  id: string,
  next: { key_prefix: string; key_hash: string },
): Promise<ApiClientRow | null> {
  return withRoleTx(ctx, async (tx) => {
    const existing = (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.id = ${id}::uuid AND c.tenant_id = ${ctx.tenant_id}::uuid AND c.is_active = TRUE
      GROUP BY c.id
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    const prev = existing[0];
    if (!prev) return null;

    await tx.execute(sql`
      UPDATE ext.api_clients
      SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW()
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenant_id}::uuid
    `);

    // id generated up front, insert without RETURNING, bindings inserted before
    // the final read — see the comment in insertApiClient for why.
    const idRows = (await tx.execute(sql`SELECT gen_uuidv7() AS id`)) as Array<{ id: string }>;
    const newId = idRows[0]!.id;
    const orgIds = (prev['org_ids'] as string[]) ?? [];

    await tx.execute(sql`
      INSERT INTO ext.api_clients
        (id, tenant_id, name, key_prefix, key_hash, scopes, rate_limit_per_min, scope_all_orgs, expires_at, created_by)
      VALUES (
        ${newId}::uuid,
        ${ctx.tenant_id}::uuid,
        ${prev['name'] as string},
        ${next.key_prefix},
        ${next.key_hash},
        ${toTextArrayLiteral(prev['scopes'] as string[])}::text[],
        ${prev['rate_limit_per_min'] as number},
        ${prev['scope_all_orgs'] as boolean},
        ${prev['expires_at'] ? sql`${prev['expires_at'] as string}::timestamptz` : sql`NULL`},
        ${ctx.user_id}::uuid
      )
    `);
    await insertOrgBindings(tx, newId, orgIds);

    const rows = (await tx.execute(sql`
      SELECT ${SELECT_COLUMNS}
      FROM ext.api_clients c
      LEFT JOIN ext.api_client_orgs o ON o.api_client_id = c.id
      WHERE c.id = ${newId}::uuid
      GROUP BY c.id
    `)) as Array<ApiClientRow>;
    return rows[0]!;
  });
}
