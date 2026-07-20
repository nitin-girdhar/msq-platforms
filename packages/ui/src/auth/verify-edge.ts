import { jwtVerify, importSPKI, decodeProtectedHeader } from 'jose';
import type { JwtPayload } from '@crm/types';
import { JWT_ISSUER, JWT_AUDIENCE } from '@crm/auth-constants';

// Edge- and Node-safe session-token verification shared by every product web
// app (its `middleware.ts`) and the server session helpers. Depends only on
// `jose`, so it runs unchanged in the Next.js Edge middleware runtime and in
// Server Components. Verification mirrors identity-service's dual-signing:
// RS256 via the public key when the token advertises it, else the legacy HS256
// shared secret — so both coexist during the RS256 rollout.
//
// SSO note: product apps should carry ONLY `JWT_PUBLIC_KEY` (verify), never the
// signing secret. identity-service alone holds `JWT_PRIVATE_KEY`. HS256 stays
// as a dev/transition fallback and disappears once every token is RS256.

type ImportedKey = Awaited<ReturnType<typeof importSPKI>>;

// PEM values are commonly stored in env with escaped newlines.
function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

let rsaPublicKeyPromise: Promise<ImportedKey> | null = null;
function getRsaPublicKey(): Promise<ImportedKey> | null {
  const pem = process.env['JWT_PUBLIC_KEY'];
  if (!pem) return null;
  if (!rsaPublicKeyPromise) {
    rsaPublicKeyPromise = importSPKI(normalizePem(pem), 'RS256');
  }
  return rsaPublicKeyPromise;
}

// Verify the session cookie's JWT and return its payload, or null on any
// failure (missing key, bad signature, wrong iss/aud, expiry). Never throws.
export async function verifySessionJwt(token: string): Promise<JwtPayload | null> {
  try {
    // Select the verification key by the token's own alg header so both legacy
    // HS256 and new RS256 tokens verify during (and after) the RS256 migration.
    const alg = decodeProtectedHeader(token).alg;
    const rsaKey = alg === 'RS256' ? getRsaPublicKey() : null;

    let key: ImportedKey | Uint8Array;
    if (rsaKey) {
      key = await rsaKey;
    } else {
      const secret = process.env['JWT_SECRET'];
      if (!secret) return null;
      key = new TextEncoder().encode(secret);
    }

    const { payload } = await jwtVerify(token, key, {
      algorithms: rsaKey ? ['RS256'] : ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
