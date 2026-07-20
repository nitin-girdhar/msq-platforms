// Generic fetch wrapper — zero domain knowledge. Each app/module builds its own
// `api.<resource>.*` namespaces on top of the `request()` function this returns
// (see apps/web/src/lib/api/client.ts for the CRM example). Never add
// domain-specific endpoints here.

export interface ApiRequestError extends Error {
  status: number;
  body: unknown;
}

export function createApiClient(basePath: string) {
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
