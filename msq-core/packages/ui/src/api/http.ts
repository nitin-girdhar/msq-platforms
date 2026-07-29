// Generic fetch wrapper — zero domain knowledge. Each app/module builds its own
// `api.<resource>.*` namespaces on top of the `request()` function this returns
// (see apps/web/src/lib/api/client.ts for the CRM example). Never add
// domain-specific endpoints here.

export interface ApiRequestError extends Error {
  status: number;
  body: unknown;
}

/**
 * Reloads the current URL so the Next.js middleware re-runs and performs the
 * bounce to the auth origin.
 *
 * Before this, a 401 from an expired or revoked session surfaced as an ordinary
 * error toast ("Unauthorized") on whatever screen the user was on. The page kept
 * rendering stale data, every subsequent action failed the same way, and nothing
 * ever told them to sign in again — the middleware only runs on navigation, and
 * a client-side fetch is not one.
 *
 * `location.assign(location.href)` rather than a router refresh: the redirect
 * decision belongs to middleware, which a client-side transition would skip.
 */
function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  // Guard against a redirect storm when several in-flight requests 401 at once.
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  window.location.assign(window.location.href);
}

let redirectingToLogin = false;

export interface ApiClientOptions {
  /**
   * Set false for callers that must handle 401 themselves — e.g. a login form,
   * where a 401 means "wrong password" and reloading would throw away the typed
   * credentials and the error message.
   */
  redirectOnUnauthorized?: boolean;
}

export function createApiClient(basePath: string, options: ApiClientOptions = {}) {
  const redirectOnUnauthorized = options.redirectOnUnauthorized ?? true;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${basePath}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401 && redirectOnUnauthorized) {
        handleUnauthorized();
      }
      const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
        details?: unknown;
      };
      const detailMessages =
        err.details && typeof err.details === 'object'
          ? Object.values(err.details as Record<string, unknown>)
              .flat()
              .filter((v): v is string => typeof v === 'string')
          : [];
      const message = detailMessages.length > 0 ? detailMessages.join(' ') : (err.error ?? res.statusText);
      throw Object.assign(new Error(message), {
        status: res.status,
        body: err,
      }) as ApiRequestError;
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return res.json() as Promise<T>;
  }

  return { request };
}
