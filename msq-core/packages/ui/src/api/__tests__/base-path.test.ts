import { describe, it, expect, afterEach } from 'vitest';
import { appBasePath, withBasePath } from '../base-path';

// Next's DefinePlugin substitutes these as literals at build time; in a plain
// vitest process they are ordinary env vars, which is exactly the "no basePath
// configured" case the helper has to degrade to.
const KEYS = ['NEXT_PUBLIC_BASE_PATH', '__NEXT_ROUTER_BASEPATH'];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('appBasePath', () => {
  it('is empty when nothing is configured — the auth-web / pre-basePath case', () => {
    expect(appBasePath()).toBe('');
  });

  it('reads the value Next compiles in', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    expect(appBasePath()).toBe('/hrms');
  });

  it('lets NEXT_PUBLIC_BASE_PATH override the Next-internal name', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    process.env['NEXT_PUBLIC_BASE_PATH'] = '/admin';
    expect(appBasePath()).toBe('/admin');
  });

  it('never keeps a trailing slash, so concatenation cannot double it', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/lms/';
    expect(appBasePath()).toBe('/lms');
    expect(withBasePath('/api')).toBe('/lms/api');
  });
});

describe('withBasePath', () => {
  it('prefixes a root-relative path — the fetch() case Next does not handle', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    expect(withBasePath('/api')).toBe('/hrms/api');
    expect(withBasePath('/api/leave/balance')).toBe('/hrms/api/leave/balance');
  });

  it('is a no-op with no basePath, preserving pre-single-origin behavior', () => {
    expect(withBasePath('/api')).toBe('/api');
  });

  it('leaves absolute URLs alone', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    expect(withBasePath('https://apps.app.com/api')).toBe('https://apps.app.com/api');
  });

  it('leaves a protocol-relative URL alone rather than making it a path', () => {
    // '//evil.example' is a HOST, not a path. Prefixing it would turn it into
    // the relative '/hrms//evil.example'; returning it untouched keeps this
    // helper from quietly changing what a caller asked for.
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    expect(withBasePath('//evil.example')).toBe('//evil.example');
  });

  it('leaves a relative path alone', () => {
    process.env['__NEXT_ROUTER_BASEPATH'] = '/hrms';
    expect(withBasePath('api/leads')).toBe('api/leads');
  });
});
