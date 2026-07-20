import { jwtVerify, importSPKI, decodeProtectedHeader } from 'jose';
import { JWT_ISSUER, JWT_AUDIENCE } from '@platform/auth-constants';
import type { JwtPayload, JwtVerifyResult } from '@platform/types';
import { config } from '../config.js';
import { isTokenRevoked, revokeToken } from '@platform/db';

const encoder = new TextEncoder();

function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

// Lazily import + cache the RS256 public key for verification.
let rsaPublicKeyPromise: ReturnType<typeof importSPKI> | null = null;
function getRsaPublicKey(): ReturnType<typeof importSPKI> | null {
  if (!config.jwtPublicKey) return null;
  if (!rsaPublicKeyPromise) {
    rsaPublicKeyPromise = importSPKI(normalizePem(config.jwtPublicKey), 'RS256');
  }
  return rsaPublicKeyPromise;
}

// DB-backed revocation — survives restarts and works across multiple instances.
// Supports revocation at JTI, user, org, and tenant level.
export async function revokeJti(
  jti: string,
  exp: number,
  payload: { user_id?: string; org_id?: string; tenant_id?: string },
): Promise<void> {
  await revokeToken({
    jti,
    expires_at: new Date(exp * 1000),
    reason: 'logout',
    ...(payload.user_id ? { user_id: payload.user_id } : {}),
    ...(payload.org_id ? { org_id: payload.org_id } : {}),
    ...(payload.tenant_id ? { tenant_id: payload.tenant_id } : {}),
  });
}

export async function verifyJwtEdge(token: string): Promise<JwtVerifyResult> {
  if (!config.jwtSecret) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    // Select the verification key by the token's alg header so both legacy HS256
    // and new RS256 tokens verify during the migration window.
    let header: { alg?: string };
    try {
      header = decodeProtectedHeader(token);
    } catch {
      return { ok: false, reason: 'invalid' };
    }

    const rsaKey = header.alg === 'RS256' ? getRsaPublicKey() : null;
    const key = rsaKey ? await rsaKey : encoder.encode(config.jwtSecret);
    const algorithms = rsaKey ? ['RS256'] : ['HS256'];

    const { payload } = await jwtVerify(token, key, {
      algorithms,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const typed = payload as unknown as JwtPayload;

    if (typed.jti) {
      const revoked = await isTokenRevoked({
        jti: typed.jti,
        user_id: typed.sub,
        org_id: typed.org_id,
        tenant_id: typed.tenant_id,
        ...(typed.iat !== undefined ? { issued_at: typed.iat } : {}),
      });
      if (revoked) return { ok: false, reason: 'invalid' };
    }

    return { ok: true, payload: typed };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}
