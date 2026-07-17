import { createPublicKey } from 'node:crypto';
import { config } from '../config.js';

function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

let cachedJwks: { keys: Record<string, unknown>[] } | null = null;

// Builds the JWKS document from the configured RS256 public key. Other apps fetch
// this to verify CRM-issued tokens without ever holding a signing secret. Returns
// an empty key set when asymmetric signing is not configured (legacy HS256 mode).
export function getJwks(): { keys: Record<string, unknown>[] } {
  if (cachedJwks) return cachedJwks;
  if (!config.jwtPublicKey || !config.jwtKid) {
    cachedJwks = { keys: [] };
    return cachedJwks;
  }
  const jwk = createPublicKey(normalizePem(config.jwtPublicKey)).export({ format: 'jwk' }) as Record<string, unknown>;
  cachedJwks = {
    keys: [{ ...jwk, kid: config.jwtKid, use: 'sig', alg: 'RS256' }],
  };
  return cachedJwks;
}
