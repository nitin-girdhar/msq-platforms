import { Readable } from 'node:stream';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export interface UserContext {
  user_id: string;
  platform_role: string;
  org_id: string;
  tenant_id?: string;
}

export interface ProxyOptions {
  forwardCookies?: boolean;
  extraHeaders?: Record<string, string>;
}

// Injects the acting user's identity headers (verified by the gateway from the
// JWT) plus the inter-service secret. Centralised so the three proxy variants
// stay in lockstep.
function withUserHeaders(
  base: Record<string, string>,
  userCtx?: UserContext,
): Record<string, string> {
  base['X-Internal-Secret'] = config.serviceSecret;
  if (userCtx) {
    base['X-User-Id'] = userCtx.user_id;
    // P1.3: inject only the coarse platform_role. Product role/rank is no longer
    // carried in the token or forwarded — each service resolves it from the DB.
    base['X-Platform-Role'] = userCtx.platform_role;
    base['X-Org-Id'] = userCtx.org_id;
    if (userCtx.tenant_id) base['X-Tenant-Id'] = userCtx.tenant_id;
  }
  return base;
}

// Forwards all Set-Cookie headers from an upstream response (Headers.get only
// returns the first; getSetCookie preserves every cookie).
function forwardSetCookies(upstream: Response, reply: FastifyReply): void {
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    reply.header('Set-Cookie', cookies);
  } else {
    const single = upstream.headers.get('set-cookie');
    if (single) reply.header('Set-Cookie', single);
  }
}

export async function proxyTo(
  targetUrl: string,
  path: string,
  request: FastifyRequest,
  reply: FastifyReply,
  userCtx?: UserContext,
  options?: ProxyOptions,
): Promise<void> {
  const url = new URL(path, targetUrl);

  const rawQuery = (request.raw.url ?? '').split('?')[1];
  if (rawQuery) url.search = rawQuery;

  const forwardHeaders = withUserHeaders({}, userCtx);

  if (options?.forwardCookies && request.headers['cookie']) {
    forwardHeaders['Cookie'] = request.headers['cookie'] as string;
  }

  if (options?.extraHeaders) {
    Object.assign(forwardHeaders, options.extraHeaders);
  }

  const method = request.method.toUpperCase();
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);

  let body: string | undefined;
  if (hasBody && request.body !== undefined) {
    body = JSON.stringify(request.body);
  }

  // Only advertise a JSON body when we are actually forwarding one. Previously
  // this always set `Content-Type: application/json`, so a body-less proxied
  // POST (e.g. /auth/logout) reached the upstream Fastify JSON parser with an
  // empty body and 500'd before the handler ran. Set the header only when a
  // body is present.
  if (body !== undefined) {
    forwardHeaders['Content-Type'] =
      (request.headers['content-type'] as string | undefined) ?? 'application/json';
  }

  try {
    const upstream = await fetch(url.toString(), {
      method,
      headers: forwardHeaders,
      ...(body !== undefined ? { body } : {}),
    });

    forwardSetCookies(upstream, reply);
    reply.header('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    // Preserve attachment filenames for file downloads (e.g. attendance CSV/xlsx).
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) reply.header('Content-Disposition', disposition);
    reply.status(upstream.status);

    if (upstream.body) {
      return reply.send(Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>));
    }
    return reply.send('');
  } catch {
    return reply.status(502).send(JSON.stringify({ error: 'Upstream service unavailable' }));
  }
}

/**
 * SSE proxy: opens a long-lived connection to an upstream SSE endpoint and
 * streams events back to the client without buffering. Used for real-time
 * notifications where the gateway must keep the connection open indefinitely.
 */
export async function proxySSE(
  targetUrl: string,
  path: string,
  request: FastifyRequest,
  reply: FastifyReply,
  userCtx?: UserContext,
): Promise<void> {
  const url = new URL(path, targetUrl);

  const forwardHeaders = withUserHeaders({ 'Accept': 'text/event-stream' }, userCtx);

  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: forwardHeaders,
    });

    reply.hijack();

    // Disable socket timeouts — SSE connections must stay open indefinitely
    request.raw.socket.setTimeout(0);
    request.raw.socket.setKeepAlive(true, 30_000);

    const origin = request.headers.origin ?? '';
    const allowedOrigin = origin === config.webUrl ? origin : '';
    reply.raw.writeHead(upstream.status, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(allowedOrigin ? {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Credentials': 'true',
      } : {}),
    });

    if (upstream.body) {
      const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();

      request.raw.on('close', () => {
        reader.cancel().catch(() => {});
      });

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(value);
          }
        } catch {
          // Client disconnected or upstream closed
        } finally {
          reply.raw.end();
        }
      })();
    }
  } catch {
    if (!reply.raw.headersSent) {
      return reply.status(502).send(JSON.stringify({ error: 'Upstream service unavailable' }));
    }
  }
}

/**
 * Raw-body proxy: forwards the original request body byte-for-byte to the
 * upstream service. Required for Meta webhooks where the downstream service
 * needs the unmodified bytes for HMAC-SHA256 verification.
 *
 * Relies on the gateway's custom content-type parser storing `rawBody` on the
 * request before the route handler runs.
 */
export async function proxyToRaw(
  targetUrl: string,
  path: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const url = new URL(path, targetUrl);

  const rawQuery = (request.raw.url ?? '').split('?')[1];
  if (rawQuery) url.search = rawQuery;

  const forwardHeaders = withUserHeaders(
    { 'Content-Type': request.headers['content-type'] ?? 'application/json' },
  );

  // Forward Meta's signature header for HMAC verification downstream
  const sig = request.headers['x-hub-signature-256'];
  if (typeof sig === 'string') forwardHeaders['X-Hub-Signature-256'] = sig;

  try {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;

    const fetchInit: RequestInit = {
      method: request.method,
      headers: forwardHeaders,
    };
    if (rawBody && rawBody.length > 0) fetchInit.body = rawBody;

    const upstream = await fetch(url.toString(), fetchInit);

    reply.header('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    reply.status(upstream.status);

    if (upstream.body) {
      return reply.send(Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>));
    }
    return reply.send('');
  } catch {
    return reply.status(502).send(JSON.stringify({ error: 'Upstream service unavailable' }));
  }
}
