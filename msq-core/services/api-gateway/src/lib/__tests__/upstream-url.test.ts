import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { buildUpstreamUrl, isSafePathParam, rejectUnsafePathParams } from '../upstream-url.js';

const BASE = 'http://leads-service:4002';
const ID = '6f1c1b1e-8f0a-4d7e-9a53-2f6c0c1d2e3f';

describe('buildUpstreamUrl', () => {
  it('accepts a plain path and a uuid param', () => {
    expect(buildUpstreamUrl(BASE, '/api/v1/leads')?.toString()).toBe(`${BASE}/api/v1/leads`);
    expect(buildUpstreamUrl(BASE, `/api/v1/leads/${ID}/transfer`)?.pathname).toBe(`/api/v1/leads/${ID}/transfer`);
  });

  it('accepts params the routes already use: months, slugs, encoded values', () => {
    expect(buildUpstreamUrl(BASE, '/api/v1/payroll/periods/2026-10/lock')).not.toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/lookups/lead_stage')).not.toBeNull();
    expect(buildUpstreamUrl(BASE, `/api/v1/pages/${encodeURIComponent('a b&c')}/forms`)).not.toBeNull();
  });

  it('rejects dot segments, however they arrive', () => {
    // What `..%2Finternal%2Fleads%2Freassign-org%23` decodes to inside a param.
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/../internal/leads/reassign-org#/transfer')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/../internal/leads/reassign-org')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/./x')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/..')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/%2e%2e/internal')).toBeNull();
  });

  it('rejects anything that would cut or re-shape the path', () => {
    expect(buildUpstreamUrl(BASE, `/api/v1/leads/${ID}?x=/transfer`)).toBeNull();
    expect(buildUpstreamUrl(BASE, `/api/v1/leads/${ID}#/transfer`)).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/..\\internal')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads//internal')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/..%2Finternal')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/a%5Cb')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/a b')).toBeNull();
    expect(buildUpstreamUrl(BASE, '/api/v1/leads/a\nb')).toBeNull();
  });

  it('never leaves the upstream origin', () => {
    expect(buildUpstreamUrl(BASE, '//evil.example/api')).toBeNull();
    expect(buildUpstreamUrl(BASE, 'http://evil.example/api')).toBeNull();
    expect(buildUpstreamUrl(BASE, 'api/v1/leads')).toBeNull();
  });
});

describe('isSafePathParam', () => {
  it('accepts ordinary single-segment values', () => {
    for (const v of [ID, '2026-10', 'lead_stage', '1234567890', 'logo-dark']) {
      expect(isSafePathParam(v)).toBe(true);
    }
  });

  it('rejects separators, query/fragment marks, dots and control characters', () => {
    for (const v of ['../internal/leads/reassign-org#', 'a/b', 'a\\b', 'a?b', 'a#b', '.', '..', 'a\u0000b']) {
      expect(isSafePathParam(v)).toBe(false);
    }
  });
});

// The real router, the real hook: what a crafted URL turns into by the time a
// handler would interpolate it, and that the hook stops it first.
describe('rejectUnsafePathParams (through Fastify routing)', () => {
  const build = (withHook: boolean) => {
    const app = Fastify();
    if (withHook) app.addHook('preValidation', rejectUnsafePathParams);
    app.post('/leads/:id/transfer', async (req) => ({ id: (req.params as { id: string }).id }));
    app.get('/tasks/:id/comments', async (req) => ({ id: (req.params as { id: string }).id }));
    return app;
  };
  const ATTACK = '/leads/..%2Finternal%2Fleads%2Freassign-org%23/transfer';

  it('without the hook, the router hands the handler a traversal string', async () => {
    const res = await build(false).inject({ method: 'POST', url: ATTACK, payload: {} });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { id: string }).id;
    expect(id).toBe('../internal/leads/reassign-org#');
    // ...which the proxy's own guard also refuses.
    expect(buildUpstreamUrl(BASE, `/api/v1/leads/${id}/transfer`)).toBeNull();
  });

  it('with the hook, encoded separators in a param are a 400', async () => {
    const app = build(true);
    for (const url of [ATTACK, '/leads/..%2Finternal%2Femployees%2Fsync%3Fx=/transfer', '/leads/..%5Cinternal/transfer']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode, url).toBe(400);
      expect(res.json()).toEqual({ error: 'Invalid path parameter' });
    }
  });

  it('an encoded dot-dot segment never reaches a handler', async () => {
    // Normalised away before routing (404) rather than matched as a param.
    const res = await build(true).inject({ method: 'POST', url: '/leads/%2E%2E/transfer', payload: {} });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('with the hook, ordinary params still reach the handler', async () => {
    const app = build(true);
    const ok = await app.inject({ method: 'POST', url: `/leads/${ID}/transfer`, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: ID });
    const get = await app.inject({ method: 'GET', url: '/tasks/2026-10/comments' });
    expect(get.statusCode).toBe(200);
  });
});
