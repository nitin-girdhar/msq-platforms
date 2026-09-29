import { describe, expect, it } from 'vitest';
import { shouldClearManager } from '../managerSelection';
import type { ManagerCandidate } from '../types';

const cand = (id: string): ManagerCandidate => ({
  id, full_name: id, email: `${id}@x.in`, role_name: 'r', role_label: 'R', rank: 50, in_branch: true,
});

const base = {
  value: 'mgr',
  homeOrgId: 'org-a',
  initialHomeOrgId: 'org-a',
  fetchedFor: 'org-a' as string | null,
  loading: false,
  candidates: [cand('other')],
};

describe('shouldClearManager', () => {
  it('keeps the value before any candidate list has loaded (the edit-open race)', () => {
    expect(shouldClearManager({ ...base, fetchedFor: null, candidates: [] })).toBe(false);
  });

  it('keeps the value while a fetch is in flight', () => {
    expect(shouldClearManager({ ...base, homeOrgId: 'org-b', loading: true })).toBe(false);
  });

  it('keeps a recorded manager missing from the ORIGINAL branch list', () => {
    expect(shouldClearManager(base)).toBe(false);
  });

  it('keeps the value while the list still belongs to the previous branch', () => {
    expect(shouldClearManager({ ...base, homeOrgId: 'org-b', fetchedFor: 'org-a' })).toBe(false);
  });

  it('clears after a branch change once the new list lacks the manager', () => {
    expect(shouldClearManager({ ...base, homeOrgId: 'org-b', fetchedFor: 'org-b' })).toBe(true);
  });

  it('keeps the value after a branch change when the new branch lists them', () => {
    expect(shouldClearManager({
      ...base, homeOrgId: 'org-b', fetchedFor: 'org-b', candidates: [cand('mgr')],
    })).toBe(false);
  });

  it('never clears an empty value', () => {
    expect(shouldClearManager({ ...base, value: '', homeOrgId: 'org-b', fetchedFor: 'org-b' })).toBe(false);
  });
});
