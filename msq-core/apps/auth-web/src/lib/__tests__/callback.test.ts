import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionUser } from '@platform/types';
import { resolveCallback, sessionDestination, NO_ACCESS_PATH } from '../callback';

// productOrigins()/allowedRedirectOrigins() read these at call time, so each test
// sets the topology it needs rather than relying on the ambient environment.
const ENV_KEYS = [
  'NEXT_PUBLIC_AUTH_URL',
  'NEXT_PUBLIC_LMS_URL',
  'NEXT_PUBLIC_HR_URL',
  'NEXT_PUBLIC_TASK_URL',
  'NEXT_PUBLIC_ADMIN_URL',
];
const saved: Record<string, string | undefined> = {};

// The single-origin topology: one host, one PWA scope, a path prefix per app.
// Every value is a BASE URL carrying that prefix, not a bare origin.
const HOST = 'https://apps.app.com';

function splitTopology() {
  process.env['NEXT_PUBLIC_AUTH_URL'] = HOST;
  process.env['NEXT_PUBLIC_LMS_URL'] = `${HOST}/lms`;
  process.env['NEXT_PUBLIC_HR_URL'] = `${HOST}/hrms`;
  process.env['NEXT_PUBLIC_TASK_URL'] = `${HOST}/todo`;
  process.env['NEXT_PUBLIC_ADMIN_URL'] = `${HOST}/sa`;
}

function singleHostDev() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const sessionWith = (capabilities: string[]) =>
  ({ capabilities, email: 'a@b.com' }) as unknown as SessionUser;

const HR_ONLY = ['hr.attendance', 'hr.attendance.view', 'hr.leave', 'hr.leave.view'];
const LMS_ONLY = ['lms', 'lms.leads', 'lms.leads.view'];

describe('resolveCallback — open-redirect guard', () => {
  beforeEach(splitTopology);

  it('honors an absolute callback on one of our own origins', () => {
    expect(resolveCallback(`${HOST}/hrms/attendance`)).toBe(`${HOST}/hrms/attendance`);
  });

  it('honors a deep path under a product prefix', () => {
    // The allowlist entry is `${HOST}/lms`, so a literal comparison against
    // url.origin would reject this. Normalizing each entry to its origin is
    // what keeps the return target intact.
    expect(resolveCallback(`${HOST}/lms/dashboard/leads?page=2`)).toBe(
      `${HOST}/lms/dashboard/leads?page=2`,
    );
  });

  it('rejects a foreign absolute origin', () => {
    // Previously this fell back to a hardcoded LMS URL; it must now be null so
    // the caller derives a destination. What it must NEVER be is the raw input.
    expect(resolveCallback('https://evil.example')).toBeNull();
    expect(resolveCallback('https://evil.example/dashboard/leads')).toBeNull();
  });

  // THE property this guard exists for, and the one most at risk from widening
  // the comparison to an origin match: matching on origin must not decay into
  // matching a substring or a suffix of the host.
  it('still rejects a foreign origin that resembles ours', () => {
    // Suffixed host — apps.app.com.evil.example is not apps.app.com.
    expect(resolveCallback('https://apps.app.com.evil.example/lms/dashboard')).toBeNull();
    // Subdomain of an attacker's host.
    expect(resolveCallback('https://evil.apps.app.com/lms/dashboard')).toBeNull();
    // Our host embedded in the path, or in userinfo — the host is theirs.
    expect(resolveCallback('https://evil.example/https://apps.app.com/lms')).toBeNull();
    expect(resolveCallback('https://apps.app.com@evil.example/lms')).toBeNull();
    // Right host, wrong scheme — a different origin, and not a secure context.
    expect(resolveCallback('http://apps.app.com/lms/dashboard')).toBeNull();
    // Right host, wrong port.
    expect(resolveCallback('https://apps.app.com:8443/lms/dashboard')).toBeNull();
  });

  it('rejects a protocol-relative path', () => {
    expect(resolveCallback('//evil.example')).toBeNull();
  });

  it('rejects a relative path when origins are configured (split topology)', () => {
    expect(resolveCallback('/dashboard/leads')).toBeNull();
  });

  it('returns null for a missing callback', () => {
    expect(resolveCallback(undefined)).toBeNull();
    expect(resolveCallback('')).toBeNull();
  });

  it('accepts a relative path only in single-host dev', () => {
    singleHostDev();
    expect(resolveCallback('/dashboard/leads')).toBe('/dashboard/leads');
    expect(resolveCallback('//evil.example')).toBeNull();
  });
});

describe('sessionDestination', () => {
  beforeEach(splitTopology);

  it('lands an HRMS-only tenant on HR, not the CRM dashboard', () => {
    expect(sessionDestination(['hr'], sessionWith(HR_ONLY))).toBe(`${HOST}/hrms/attendance`);
  });

  it('lands an HR-only user in an LMS+HR tenant on HR', () => {
    expect(sessionDestination(['lms', 'hr'], sessionWith(HR_ONLY))).toBe(`${HOST}/hrms/attendance`);
  });

  it('still prefers LMS when the user can use it', () => {
    expect(sessionDestination(['lms', 'hr'], sessionWith([...LMS_ONLY, ...HR_ONLY]))).toBe(
      `${HOST}/lms/dashboard/leads`,
    );
  });

  it('sends a user with no usable product to the no-access page', () => {
    expect(sessionDestination(['lms'], sessionWith(HR_ONLY))).toBe(NO_ACCESS_PATH);
    expect(sessionDestination([], sessionWith(LMS_ONLY))).toBe(NO_ACCESS_PATH);
  });

  it('falls back to a bare path in single-host dev', () => {
    singleHostDev();
    expect(sessionDestination(['hr'], sessionWith(HR_ONLY))).toBe('/attendance');
  });
});

// lookup-admin bounces to this auth origin like any product app, but it is NOT
// a product: it must be an accepted RETURN target without ever becoming a
// landing destination or appearing in the product switcher.
describe('resolveCallback — lookup-admin origin', () => {
  beforeEach(splitTopology);

  it('honors a callback back to the admin console', () => {
    expect(resolveCallback(`${HOST}/sa/dashboard/users`)).toBe(`${HOST}/sa/dashboard/users`);
  });

  it('still accepts the /sa path when NEXT_PUBLIC_ADMIN_URL is unset', () => {
    // A deliberate consequence of the single-origin move, not a regression.
    // lookup-admin shares auth-web's host, so dropping its base URL no longer
    // makes /sa a foreign target — the auth entry already covers that origin.
    // Nothing is weakened: /sa is our own app either way, and lookup-admin's
    // own middleware plus the gateway's capability gates are the real boundary.
    // What must NOT change is that a lookalike host stays rejected.
    delete process.env['NEXT_PUBLIC_ADMIN_URL'];
    expect(resolveCallback(`${HOST}/sa/dashboard`)).toBe(`${HOST}/sa/dashboard`);
    expect(resolveCallback('https://admin.evil.example/sa/dashboard')).toBeNull();
  });

  it('never lands a user on the admin console by default', () => {
    // sessionDestination reads productOrigins(), which deliberately excludes the
    // admin base URL — an LMS-capable user goes to LMS, never to admin.
    expect(sessionDestination(['lms'], sessionWith(LMS_ONLY))).toBe(
      `${HOST}/lms/dashboard/leads`,
    );
  });
});
