'use client';

import { useEffect } from 'react';
import { ErrorState } from './ErrorState';

// The body of every app's `app/error.tsx`. Each app's file is a one-liner over
// this, the same way `middleware.ts` is a one-liner over createProductMiddleware.

export interface AppErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Where "Go back" should land, e.g. '/dashboard'. */
  homeHref: string;
  homeLabel?: string;
}

/**
 * Distinguishes an expired session from a genuine fault.
 *
 * This is the case that made the missing boundaries actively confusing rather
 * than merely ugly: a server component whose `/auth/me` call 401s throws, and
 * without a boundary the user saw a blank screen or a raw error page. Telling
 * them to sign in again is both accurate and actionable — but only when we are
 * reasonably sure that IS the cause, so the match is on an explicit 401/session
 * signal rather than on anything that merely failed to fetch.
 */
function looksLikeAuthFailure(error: Error & { status?: number }): boolean {
  if (error.status === 401) return true;
  return /\b401\b|unauthorized|not authenticated|session (expired|has been revoked)/i.test(
    error.message ?? '',
  );
}

export function AppErrorBoundary({ error, reset, homeHref, homeLabel = 'Go back' }: AppErrorBoundaryProps) {
  useEffect(() => {
    // Next only surfaces the digest in production; the full error is client-side
    // here, so this is the one place it can be recorded from.
    console.error('[error-boundary]', error);
  }, [error]);

  const isAuth = looksLikeAuthFailure(error);

  const buttonClass =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors';

  return (
    <ErrorState
      title={isAuth ? 'Your session has ended' : 'Something went wrong'}
      description={
        isAuth
          ? 'You have been signed out, or your session expired. Sign in again to continue.'
          : 'This page could not be loaded. Trying again often resolves it — if it keeps happening, share the reference below.'
      }
      // The message is shown only for genuine faults. On an auth failure it adds
      // nothing a user can act on.
      detail={isAuth ? undefined : error.message}
      digest={error.digest}
      actions={
        isAuth ? (
          // A full navigation, not a router push: the middleware must re-run to
          // perform the bounce to the auth origin, and a client-side transition
          // would skip it.
          <a href="/" className={`${buttonClass} bg-slate-900 text-white hover:bg-slate-800`}>
            Sign in again
          </a>
        ) : (
          <>
            <button
              type="button"
              onClick={reset}
              className={`${buttonClass} bg-slate-900 text-white hover:bg-slate-800`}
            >
              Try again
            </button>
            <a
              href={homeHref}
              className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            >
              {homeLabel}
            </a>
          </>
        )
      }
    />
  );
}
