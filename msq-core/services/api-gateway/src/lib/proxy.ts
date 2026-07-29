import { Readable } from 'node:stream';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  fetchWithTimeout,
  fetchStreamWithConnectTimeout,
  UpstreamTimeoutError,
} from '@platform/http';
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
    const upstream = await fetchWithTimeout(url.toString(), {
      method,
      headers: forwardHeaders,
      ...(body !== undefined ? { body } : {}),
      timeoutMs: config.proxyTimeoutMs,
      // The registered route pattern, not the resolved URL — keeps record ids
      // out of an error string that is logged and may reach a client.
      target: request.routeOptions?.url ?? path,
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
  } catch (err) {
    return replyUpstreamError(request, reply, err);
  }
}

/**
 * Maps a proxy transport failure to a response.
 *
 * A timeout is reported as 504, not 502: the two mean different things to an
 * operator (upstream too slow vs. upstream unreachable) and to a client deciding
 * whether a retry is worth attempting. Previously every failure was an
 * indistinguishable 502 and the cause was SWALLOWED — `catch {}` with no log —
 * so a slow dependency was invisible in the gateway's own telemetry.
 *
 * Sends an object, not `JSON.stringify(...)`: passing a pre-serialized string to
 * `reply.send` makes Fastify emit it as text/plain, so clients that parsed the
 * error body got a string where every other gateway error is JSON.
 */
function replyUpstreamError(
  request: FastifyRequest,
  reply: FastifyReply,
  err: unknown,
): void {
  const route = request.routeOptions?.url ?? request.url;
  if (err instanceof UpstreamTimeoutError) {
    request.log.error(
      { err, route, timeoutMs: err.timeoutMs, target: err.target },
      'upstream request timed out',
    );
    reply.status(504).send({ error: 'Upstream service timed out' });
    return;
  }
  request.log.error({ err, route }, 'upstream request failed');
  reply.status(502).send({ error: 'Upstream service unavailable' });
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
    // Connect-only deadline. A full request timeout would abort the event stream
    // itself the moment it expired, which is the opposite of what an SSE proxy
    // needs; this bounds only the wait for response headers, so a notifications
    // service that accepts the socket and then never answers is cut loose instead
    // of leaking a connection for the life of the process.
    const { response: upstream, abort } = await fetchStreamWithConnectTimeout(url.toString(), {
      method: 'GET',
      headers: forwardHeaders,
      connectTimeoutMs: config.sseConnectTimeoutMs,
      target: request.routeOptions?.url ?? path,
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
        // Cancelling the reader detaches us from the body, but the underlying
        // upstream request stays open until it is aborted — without this a
        // client that disconnects leaks a notifications-service connection.
        abort();
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
  } catch (err) {
    if (!reply.raw.headersSent) {
      return replyUpstreamError(request, reply, err);
    }
    // Headers already flushed — the stream is live and we cannot change the
    // status, so record the fault rather than dropping it silently.
    request.log.error({ err, route: request.routeOptions?.url ?? path }, 'SSE proxy failed after headers sent');
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

    const fetchInit = {
      method: request.method,
      headers: forwardHeaders,
      timeoutMs: config.proxyTimeoutMs,
      target: request.routeOptions?.url ?? path,
    } as Parameters<typeof fetchWithTimeout>[1];
    if (rawBody && rawBody.length > 0) fetchInit.body = rawBody;

    const upstream = await fetchWithTimeout(url.toString(), fetchInit);

    reply.header('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    reply.status(upstream.status);

    if (upstream.body) {
      return reply.send(Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>));
    }
    return reply.send('');
  } catch (err) {
    return replyUpstreamError(request, reply, err);
  }
}
