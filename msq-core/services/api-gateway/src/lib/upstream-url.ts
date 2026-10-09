import type { FastifyReply, FastifyRequest } from 'fastify';

// Every proxied request carries X-Internal-Secret, and the services' /internal/*
// routes trust that secret alone. So the path the gateway sends upstream must be
// exactly the path the route handler built: a path param that decodes to
// `../internal/...` (find-my-way decodes %2F inside a param) would otherwise be
// collapsed by `new URL` into a route no browser is meant to reach.

// `?` and `#` would cut the path short and drop the route's static suffix; `\` is
// treated as `/` by the URL parser; %2f / %5c would be decoded again upstream.
const UNSAFE_PATH = /[?#\\\u0000-\u001f\u007f]|\/\/|%2f|%5c/i;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

// The same rule for a single path param, before any handler interpolates it.
const UNSAFE_PARAM = /[/\\?#\u0000-\u001f\u007f]/;

export function isSafePathParam(value: string): boolean {
  return value !== '.' && value !== '..' && !UNSAFE_PARAM.test(value);
}

// Global preValidation hook (registered in server.ts): a path param is one segment.
// find-my-way decodes %2F / %3F / %23 inside a param, so `..%2Finternal%2F...`
// would reach a handler as `../internal/...`. Refused before any handler runs.
export async function rejectUnsafePathParams(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = request.params as Record<string, unknown> | undefined;
  if (!params) return;
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && !isSafePathParam(value)) {
      await reply.status(400).send({ error: 'Invalid path parameter' });
      return;
    }
  }
}

/**
 * Resolves `path` against the upstream base URL, or returns null when the result
 * would not be that exact path on that exact origin.
 */
export function buildUpstreamUrl(targetUrl: string, path: string): URL | null {
  if (!path.startsWith('/') || UNSAFE_PATH.test(path) || DOT_SEGMENT.test(path)) return null;
  let url: URL;
  try {
    url = new URL(path, targetUrl);
    if (url.origin !== new URL(targetUrl).origin) return null;
  } catch {
    return null;
  }
  return url.pathname === path ? url : null;
}
