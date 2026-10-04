import { cache } from 'react';
import { cookies } from 'next/headers';
import { DEFAULT_BRANDING, brandingFromApi, type Branding } from '../branding/types';
import type { EffectiveTheme } from '../theme/presets';

const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

/**
 * The current request's tenant branding: theme (tenant branding, then the
 * user's own appearance override — unless the tenant's theme is locked, when
 * only the user's light/dark choice survives — then the platform default),
 * product names, terms, menu overrides and logo URLs.
 *
 * The precedence and the lock are applied by identity-service from the
 * gateway-verified session (GET /me/branding); this helper only forwards the
 * cookie. Never trust a client-sent tenant/user id for it.
 *
 * Fails OPEN to the platform default — unlike getEnabledModules, branding is
 * cosmetic, and a broken branding row must never take the app down (or block
 * the login page, which has no session at all).
 *
 * Wrapped in React cache(): the root layout, generateMetadata and the shell in
 * one request share a single gateway call.
 */
export const getEffectiveBranding = cache(async (): Promise<Branding> => {
  try {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return DEFAULT_BRANDING;
    const res = await fetch(`${GATEWAY_URL}/me/branding`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return DEFAULT_BRANDING;
    const body = (await res.json()) as { data?: unknown };
    return brandingFromApi(body.data);
  } catch {
    return DEFAULT_BRANDING;
  }
});

/** The theme half of {@link getEffectiveBranding}. */
export async function getEffectiveTheme(): Promise<EffectiveTheme> {
  return (await getEffectiveBranding()).theme;
}
