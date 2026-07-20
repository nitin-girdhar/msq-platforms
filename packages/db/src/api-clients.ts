import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { serviceDrizzle } from './drizzle.js';

// ── Key format & hashing ─────────────────────────────────────────────────────
// Raw key:  crmk_<env>_<43-char base64url>   (~256 bits of entropy)
// Stored:   key_prefix (display only) + key_hash = HMAC-SHA256(pepper, raw)
// Lookup is by key_hash (indexed, unique), so no plaintext ever touches the DB.

export interface GeneratedApiKey {
  raw: string;
  prefix: string;
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const random = crypto.randomBytes(32).toString('base64url');
  const raw = `crmk_${env}_${random}`;
  // Display prefix: scheme + first 6 chars of the random part.
  const prefix = `crmk_${env}_${random.slice(0, 6)}`;
  return { raw, prefix };
}

export function hashApiKey(raw: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(raw).digest('hex');
}

// ── Resolution (service role — bypasses RLS for the auth lookup) ──────────────

export interface ResolvedApiClient {
  id: string;
  tenant_id: string;
  org_ids: string[];
  scope_all_orgs: boolean;
  scopes: string[];
  rate_limit_per_min: number;
  is_active: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
}

export async function getApiClientByHash(keyHash: string): Promise<ResolvedApiClient | null> {
  const db = serviceDrizzle();
  const rows = (await db.execute(sql`
    SELECT
      c.id, c.tenant_id, c.scopes, c.rate_limit_per_min, c.scope_all_orgs,
      c.is_active, c.expires_at, c.revoked_at,
      COALESCE(array_agg(o.org_id) FILTER (WHERE o.org_id IS NOT NULL), '{}') AS org_ids
    FROM iam.api_clients c
    LEFT JOIN iam.api_client_orgs o ON o.api_client_id = c.id
    WHERE c.key_hash = ${keyHash}
    GROUP BY c.id
    LIMIT 1
  `)) as unknown as ResolvedApiClient[];
  return rows[0] ?? null;
}

// Best-effort last-used stamp; callers should not await this on the hot path.
export async function recordApiClientUsage(id: string): Promise<void> {
  const db = serviceDrizzle();
  await db.execute(sql`UPDATE iam.api_clients SET last_used_at = NOW() WHERE id = ${id}::uuid`);
}
