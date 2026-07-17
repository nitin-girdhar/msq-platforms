import type { FastifyRequest, FastifyReply } from 'fastify';

// Lightweight in-memory fixed-window rate limiter, keyed per client IP. Used to
// blunt credential stuffing / brute force against unauthenticated endpoints
// (login, webhook key guessing) without pulling in an external dependency.
//
// Note: state is per-process. Behind multiple gateway instances, run a shared
// limiter (e.g. Redis) instead; this covers the single-instance default deploy.

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

export function createRateLimiter(opts: RateLimitOptions) {
  const buckets = new Map<string, Window>();

  // Opportunistic sweep so the map does not grow unbounded.
  function sweep(now: number): void {
    if (buckets.size < 10_000) return;
    for (const [key, w] of buckets) {
      if (w.resetAt <= now) buckets.delete(key);
    }
  }

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const now = Date.now();
    const key = request.ip;
    let win = buckets.get(key);

    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, win);
      sweep(now);
    }

    win.count += 1;

    if (win.count > opts.max) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({ error: 'Too many requests. Please try again later.' });
    }
  };
}
