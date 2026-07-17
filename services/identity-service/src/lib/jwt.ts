import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import {
  JWT_EXPIRES_IN,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ALGORITHM,
  JWT_MAX_AGE_SECONDS,
} from '@crm/auth-constants';
import type { JwtPayload, JwtVerifyResult } from '@crm/types';
import {
  revokeToken as dbRevokeToken,
  isTokenRevoked as dbIsTokenRevoked,
} from '@crm/db';
import { config } from '../config/index.js';

export { JWT_MAX_AGE_SECONDS };

// PEM values are commonly stored in env with escaped newlines.
function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

const rsaPrivateKey = config.jwtPrivateKey ? normalizePem(config.jwtPrivateKey) : null;
const rsaPublicKey = config.jwtPublicKey ? normalizePem(config.jwtPublicKey) : null;
const useRsa = Boolean(rsaPrivateKey && config.jwtKid);

export function signJwt(claims: Omit<JwtPayload, 'iat' | 'exp' | 'jti'>): string {
  const payload = { ...claims, jti: randomUUID() };
  const common = { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER, audience: JWT_AUDIENCE } as const;

  // RS256 when an asymmetric key is configured, so third parties can verify via
  // the JWKS public key without ever holding a signing secret.
  if (useRsa && rsaPrivateKey) {
    return jwt.sign(payload, rsaPrivateKey, { ...common, algorithm: 'RS256', keyid: config.jwtKid! });
  }
  return jwt.sign(payload, config.jwtSecret, { ...common, algorithm: JWT_ALGORITHM });
}

export function verifyJwt(token: string): JwtVerifyResult {
  try {
    // Pick the verification key by the token's own alg header so we can accept
    // both legacy HS256 and new RS256 tokens during the migration window.
    const decoded = jwt.decode(token, { complete: true });
    const alg = decoded && typeof decoded !== 'string' ? decoded.header.alg : JWT_ALGORITHM;

    let key: string;
    let algorithms: jwt.Algorithm[];
    if (alg === 'RS256' && rsaPublicKey) {
      key = rsaPublicKey;
      algorithms = ['RS256'];
    } else {
      key = config.jwtSecret;
      algorithms = [JWT_ALGORITHM];
    }

    const payload = jwt.verify(token, key, {
      algorithms,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as JwtPayload;
    return { ok: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

export function decodeJwtUnchecked(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | null;
  } catch {
    return null;
  }
}

export async function revokeJti(
  jti: string,
  exp: number,
  context?: { user_id?: string; org_id?: string; tenant_id?: string },
): Promise<void> {
  await dbRevokeToken({
    jti,
    expires_at: new Date(exp * 1000),
    reason: 'logout',
    ...(context?.user_id ? { user_id: context.user_id } : {}),
    ...(context?.org_id ? { org_id: context.org_id } : {}),
    ...(context?.tenant_id ? { tenant_id: context.tenant_id } : {}),
  });
}

/**
 * Bulk-revoke every session for a single user by inserting a jti-less blocklist
 * row scoped to the user. All tokens issued before `revokedAt` (default NOW())
 * are rejected by isTokenRevoked at the gateway and at /auth/me.
 *
 * IMPORTANT: only user_id is set. Setting org_id/tenant_id on a jti-less row
 * would match the org-/tenant-level bulk branches in isTokenRevoked and revoke
 * every session in the org/tenant, not just this user.
 *
 * When the caller mints a replacement token (self-service password change),
 * pass that token's iat as `revokedAt` so the new session is not caught by its
 * own revocation.
 */
export async function revokeAllUserSessions(
  userId: string,
  opts?: { revokedBy?: string; reason?: string; revokedAt?: Date },
): Promise<void> {
  await dbRevokeToken({
    user_id: userId,
    expires_at: new Date(Date.now() + JWT_MAX_AGE_SECONDS * 1000),
    reason: opts?.reason ?? 'password_changed',
    ...(opts?.revokedBy ? { revoked_by: opts.revokedBy } : {}),
    ...(opts?.revokedAt ? { revoked_at: opts.revokedAt } : {}),
  });
}

export async function isJtiRevoked(
  jti: string,
  context?: { user_id?: string; org_id?: string; tenant_id?: string; issued_at?: number },
): Promise<boolean> {
  return dbIsTokenRevoked({
    jti,
    ...(context?.user_id ? { user_id: context.user_id } : {}),
    ...(context?.org_id ? { org_id: context.org_id } : {}),
    ...(context?.tenant_id ? { tenant_id: context.tenant_id } : {}),
    ...(context?.issued_at !== undefined ? { issued_at: context.issued_at } : {}),
  });
}
