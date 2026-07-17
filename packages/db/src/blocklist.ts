import { sql } from 'drizzle-orm';
import { serviceDrizzle } from './drizzle.js';

export interface RevokeTokenInput {
  jti?: string;
  user_id?: string;
  org_id?: string;
  tenant_id?: string;
  expires_at: Date;
  revoked_by?: string;
  reason?: string;
  /**
   * When the revocation takes effect. Bulk revocations only invalidate tokens
   * issued *before* this instant (isTokenRevoked compares revoked_at > iat), so
   * callers that mint a replacement token must set this to the new token's iat
   * to avoid revoking the freshly issued session. Defaults to NOW().
   */
  revoked_at?: Date;
}

export interface IsTokenRevokedInput {
  jti: string;
  user_id?: string;
  org_id?: string;
  tenant_id?: string;
  /** JWT iat (issued-at) in seconds */
  issued_at?: number;
}

/**
 * Insert a revocation entry. One of jti/user_id/org_id/tenant_id is required.
 * Passing user_id/org_id/tenant_id alongside a jti only attaches audit context to that
 * single token's revocation. Bulk revocation of all tokens for a user/org/tenant issued
 * before revoked_at only happens when jti is omitted.
 *
 * Idempotent per jti: the api-gateway revokes a JTI immediately at the edge (so other
 * services reject it without waiting on the identity-service round trip), then identity-service
 * revokes the same JTI again as part of its own logout flow. ON CONFLICT DO NOTHING
 * absorbs that expected double-write instead of throwing a duplicate-key error.
 */
export async function revokeToken(input: RevokeTokenInput): Promise<void> {
  const db = serviceDrizzle();
  await db.execute(sql`
    INSERT INTO iam.token_blocklist (jti, user_id, org_id, tenant_id, expires_at, revoked_by, reason, revoked_at)
    VALUES (
      ${input.jti ?? null},
      ${input.user_id ?? null}::uuid,
      ${input.org_id ?? null}::uuid,
      ${input.tenant_id ?? null}::uuid,
      ${input.expires_at.toISOString()},
      ${input.revoked_by ?? null}::uuid,
      ${input.reason ?? null},
      COALESCE(${input.revoked_at ? input.revoked_at.toISOString() : null}::timestamptz, NOW())
    )
    ON CONFLICT (jti) WHERE jti IS NOT NULL DO NOTHING
  `);
}

/**
 * Check whether a token is revoked. Returns true if any of these match:
 * 1. The specific JTI is in the blocklist.
 * 2. There is a bulk user-level revocation (jti IS NULL) issued after this token was minted.
 * 3. There is a bulk org-level revocation (jti IS NULL) issued after this token was minted.
 * 4. There is a bulk tenant-level revocation (jti IS NULL) issued after this token was minted.
 *
 * The user_id/org_id/tenant_id columns on a per-JTI row (set by single-session logout,
 * for audit purposes) must NOT trigger bulk matching — otherwise logging off one user
 * would revoke every other session in the same org/tenant. Bulk revocation rows are
 * distinguished by having no jti.
 */
export async function isTokenRevoked(input: IsTokenRevokedInput): Promise<boolean> {
  const db = serviceDrizzle();
  const issuedAt = input.issued_at
    ? new Date(input.issued_at * 1000).toISOString()
    : new Date(0).toISOString();

  const result = await db.execute<{ revoked: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM iam.token_blocklist
      WHERE expires_at > NOW()
        AND (
          -- Specific token revoked by JTI
          (jti = ${input.jti})
          -- All tokens for this user revoked since this token was issued
          OR (jti IS NULL AND user_id   = ${input.user_id ?? null}::uuid   AND revoked_at > ${issuedAt}::timestamptz)
          -- All tokens for this org revoked since this token was issued
          OR (jti IS NULL AND org_id    = ${input.org_id ?? null}::uuid    AND revoked_at > ${issuedAt}::timestamptz)
          -- All tokens for this tenant revoked since this token was issued
          OR (jti IS NULL AND tenant_id = ${input.tenant_id ?? null}::uuid AND revoked_at > ${issuedAt}::timestamptz)
        )
    ) AS revoked
  `);

  return Boolean((result as unknown as Array<{ revoked: boolean }>)[0]?.revoked);
}
