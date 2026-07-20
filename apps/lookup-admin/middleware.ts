import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, importSPKI, decodeProtectedHeader } from 'jose';

type ImportedKey = Awaited<ReturnType<typeof importSPKI>>;
import type { JwtPayload } from '@platform/types';
import { AUTH_COOKIE_NAME, JWT_ISSUER, JWT_AUDIENCE } from '@platform/auth-constants';

const PUBLIC_PATHS = new Set(['/login', '/change-password', '/api/auth/login', '/api/auth/logout']);
const PROTECTED_PREFIXES = ['/dashboard', '/api/'];

// PEM values are commonly stored in env with escaped newlines.
function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

// Lazily import + cache the RS256 public key so we verify asymmetric tokens the
// same way the backend does. Falls back to the HS256 shared secret otherwise.
let rsaPublicKeyPromise: Promise<ImportedKey> | null = null;
function getRsaPublicKey(): Promise<ImportedKey> | null {
  const pem = process.env['JWT_PUBLIC_KEY'];
  if (!pem) return null;
  if (!rsaPublicKeyPromise) {
    rsaPublicKeyPromise = importSPKI(normalizePem(pem), 'RS256');
  }
  return rsaPublicKeyPromise;
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*', '/login', '/change-password'],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/');
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtected || isPublic) {
    return NextResponse.next();
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  try {
    // Select the verification key by the token's own alg header so both legacy
    // HS256 and new RS256 tokens verify during (and after) the RS256 migration.
    const alg = decodeProtectedHeader(token).alg;
    const rsaKey = alg === 'RS256' ? getRsaPublicKey() : null;
    const key = rsaKey ? await rsaKey : new TextEncoder().encode(jwtSecret);

    const { payload } = await jwtVerify(token, key, {
      algorithms: rsaKey ? ['RS256'] : ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const typed = payload as unknown as JwtPayload;

    // Force password change: redirect to /change-password for all protected routes
    // except /change-password itself (already in PUBLIC_PATHS) and API auth routes.
    if (typed.force_password_change && !pathname.startsWith('/api/')) {
      const changeUrl = new URL('/change-password', request.url);
      return NextResponse.redirect(changeUrl);
    }

    return NextResponse.next();
  } catch {
    const isApiRoute = pathname.startsWith('/api/');
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return redirectToLogin(request);
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}
