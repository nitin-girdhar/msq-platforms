import { AUTH_COOKIE_NAME, JWT_MAX_AGE_SECONDS } from '@platform/auth-constants';
import { config } from '../config/index.js';

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAge: number;
  // Present only when COOKIE_DOMAIN is configured (SSO across subdomains). When
  // set, the cleared cookie MUST carry the same domain or the browser keeps it.
  domain?: string;
}

export function sessionCookieOptions(): CookieOptions {
  // sameSite: 'lax' is correct for SSO — top-level navigation between product
  // subdomains (lms.→hr.) is a same-site GET, so the cookie rides along. 'none'
  // would be needed only for cross-site embedding, which we don't do.
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: JWT_MAX_AGE_SECONDS,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export function clearedSessionCookieOptions(): CookieOptions {
  return {
    ...sessionCookieOptions(),
    maxAge: 0,
  };
}

export { AUTH_COOKIE_NAME };
