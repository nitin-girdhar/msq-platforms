import { describe, it, expect } from 'vitest';
import type { ProductKey } from '@platform/types';
import { usableProducts, landingFor } from '../products';

// Capability sets copied from the shipped defaults in db_scripts/07 (the tool
// nodes plus enough beneath them to satisfy the "something usable under it"
// rule). Trimmed to what these tests exercise.
const HR_ADMIN = [
  'platform', 'platform.write',
  'hr.attendance', 'hr.attendance.view', 'hr.attendance.view.org',
  'hr.leave', 'hr.leave.view', 'hr.leave.approve',
  'hr.employees', 'hr.employees.view',
];

const LMS_ADMIN = [
  'platform', 'platform.write',
  'lms', 'lms.leads', 'lms.leads.view', 'lms.dashboard', 'lms.dashboard.view',
];

const ORG_ADMIN = [...LMS_ADMIN, ...HR_ADMIN, 'tasks', 'tasks.view', 'tasks.lists.view'];

const actor = (capabilities: string[]) => ({ capabilities });

const ALL: ProductKey[] = ['lms', 'hr', 'task'];
const ORIGINS: Record<ProductKey, string> = {
  lms: 'https://lms.app.com',
  hr: 'https://hr.app.com',
  task: 'https://todo.app.com',
};

describe('usableProducts', () => {
  it('drops a licensed product the user holds no capability for', () => {
    // The case that shipped broken: an HR person in an LMS+HR tenant was handed
    // a CRM tab leading to an empty sidebar and 403-ing data calls.
    expect(usableProducts(['lms', 'hr'], actor(HR_ADMIN))).toEqual(['hr']);
    expect(usableProducts(['lms', 'hr'], actor(LMS_ADMIN))).toEqual(['lms']);
  });

  it('drops a capable product the tenant has not licensed', () => {
    // 07 grants lms.* to org_admin by default, so the tenant license is the only
    // thing keeping CRM off an HRMS-only tenant's nav.
    expect(usableProducts(['hr'], actor(ORG_ADMIN))).toEqual(['hr']);
  });

  it('keeps every product when both halves agree', () => {
    expect(usableProducts(ALL, actor(ORG_ADMIN))).toEqual(ALL);
  });

  it('treats HR as usable via any of its three tool nodes', () => {
    expect(usableProducts(['hr'], actor(['hr.leave', 'hr.leave.view']))).toEqual(['hr']);
    expect(usableProducts(['hr'], actor(['hr.attendance', 'hr.attendance.view']))).toEqual(['hr']);
    expect(usableProducts(['hr'], actor(['hr.employees', 'hr.employees.view']))).toEqual(['hr']);
  });

  it('drops a tool node granted with nothing usable beneath it', () => {
    // Nav grants cascade, so holding the bare `lms` tool is not evidence the user
    // can open anything inside it — the same trap filterNav guards against.
    expect(usableProducts(['lms'], actor(['lms']))).toEqual([]);
  });

  it('fails closed on a null actor or empty capabilities', () => {
    expect(usableProducts(ALL, null)).toEqual([]);
    expect(usableProducts(ALL, undefined)).toEqual([]);
    expect(usableProducts(ALL, actor([]))).toEqual([]);
  });

  it('accepts a Set of capabilities as well as an array', () => {
    expect(usableProducts(['hr'], { capabilities: new Set(HR_ADMIN) })).toEqual(['hr']);
  });
});

describe('landingFor', () => {
  it('follows lms → hr → task priority', () => {
    expect(landingFor(['hr', 'lms'], ORIGINS)).toBe('https://lms.app.com/dashboard/leads');
    expect(landingFor(['task', 'hr'], ORIGINS)).toBe('https://hr.app.com/attendance');
    expect(landingFor(['task'], ORIGINS)).toBe('https://todo.app.com/tasks');
  });

  it('skips a product with no configured origin rather than linking a broken host', () => {
    expect(landingFor(['lms', 'hr'], { ...ORIGINS, lms: '' })).toBe('https://hr.app.com/attendance');
  });

  it('returns null when nothing is reachable', () => {
    expect(landingFor([], ORIGINS)).toBeNull();
    expect(landingFor(['lms'], { lms: '', hr: '', task: '' })).toBeNull();
  });
});
