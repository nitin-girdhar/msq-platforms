import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionUser } from '@platform/types';
import { resolveCallback, sessionDestination, NO_ACCESS_PATH } from '../callback';

// productOrigins()/allowedRedirectOrigins() read these at call time, so each test
// sets the topology it needs rather than relying on the ambient environment.
const ENV_KEYS = ['NEXT_PUBLIC_AUTH_URL', 'NEXT_PUBLIC_LMS_URL', 'NEXT_PUBLIC_HR_URL', 'NEXT_PUBLIC_TASK_URL'];
const saved: Record<string, string | undefined> = {};

function splitTopology() {
  process.env['NEXT_PUBLIC_AUTH_URL'] = 'https://auth.app.com';
  process.env['NEXT_PUBLIC_LMS_URL'] = 'https://lms.app.com';
  process.env['NEXT_PUBLIC_HR_URL'] = 'https://hr.app.com';
  process.env['NEXT_PUBLIC_TASK_URL'] = 'https://todo.app.com';
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
    expect(resolveCallback('https://hr.app.com/attendance')).toBe('https://hr.app.com/attendance');
  });

  it('rejects a foreign absolute origin', () => {
    // Previously this fell back to a hardcoded LMS URL; it must now be null so
    // the caller derives a destination. What it must NEVER be is the raw input.
    expect(resolveCallback('https://evil.example')).toBeNull();
    expect(resolveCallback('https://evil.example/dashboard/leads')).toBeNull();
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
    expect(sessionDestination(['hr'], sessionWith(HR_ONLY))).toBe('https://hr.app.com/attendance');
  });

  it('lands an HR-only user in an LMS+HR tenant on HR', () => {
    expect(sessionDestination(['lms', 'hr'], sessionWith(HR_ONLY))).toBe(
      'https://hr.app.com/attendance',
    );
  });

  it('still prefers LMS when the user can use it', () => {
    expect(sessionDestination(['lms', 'hr'], sessionWith([...LMS_ONLY, ...HR_ONLY]))).toBe(
      'https://lms.app.com/dashboard/leads',
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
