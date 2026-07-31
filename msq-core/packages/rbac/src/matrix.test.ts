import { describe, it, expect } from 'vitest';
import {
  ownGrantsByKey,
  resolveCapabilityMatrix,
  type CapabilityKind,
  type CapabilityNode,
} from './matrix.js';
import { isPlatformAdminCapability } from './capabilities.js';

// A miniature of the real seed's shape (db_scripts/07_seed_lookup_data.sql):
// two tools, pages beneath them, a tab under a page, and operations/scopes at
// the bottom. Small enough to reason about, structurally identical to the tree
// the resolver actually walks.
const N = (key: string, kind: CapabilityKind, parent_key: string | null): CapabilityNode => ({
  id: `id:${key}`,
  key,
  kind,
  parent_key,
});

const TREE: CapabilityNode[] = [
  N('lms', 'tool', null),
  N('lms.leads', 'page', 'lms'),
  N('lms.leads.view', 'operation', 'lms.leads'),
  N('lms.leads.view.own', 'scope', 'lms.leads.view'),
  N('lms.users', 'page', 'lms'),
  N('lms.users.manage', 'operation', 'lms.users'),
  N('hr.attendance', 'tool', null),
  N('hr.attendance.admin', 'page', 'hr.attendance'),
  N('hr.attendance.admin.rules', 'tab', 'hr.attendance.admin'),
  N('hr.attendance.admin.rules.view', 'operation', 'hr.attendance.admin.rules'),
];

const resolve = (grants: Record<string, boolean>) =>
  resolveCapabilityMatrix(TREE, new Map(Object.entries(grants)));

describe('resolveCapabilityMatrix', () => {
  // The org_admin bug, pinned. Neither org_admin nor tenant_admin holds a single
  // page/tab row in the seed — every CRM page they see is on by inheritance, so
  // deleting a grant row to hide one is a no-op.
  it('treats a rowless page under a granted tool as INHERITED-ON', () => {
    const r = resolve({ lms: true, 'lms.users.manage': true });
    expect(r.get('lms.users')).toMatchObject({
      granted: true,
      source: 'inherited-grant',
      ownGrant: null,
    });
  });

  it('honours an explicit deny on a page', () => {
    const r = resolve({ lms: true, 'lms.users': false });
    expect(r.get('lms.users')).toMatchObject({ granted: false, source: 'explicit-deny' });
  });

  // Denying the page prunes everything under it, which is what makes a single
  // deny row enough — the service gates on lms.users.manage start refusing too.
  it('prunes a subtree under a denied page even where the child has its own grant', () => {
    const r = resolve({ lms: true, 'lms.users': false, 'lms.users.manage': true });
    expect(r.get('lms.users.manage')).toMatchObject({
      granted: false,
      source: 'ancestor-denied',
      deniedBy: 'lms.users',
      ownGrant: true,
    });
  });

  it('names the NEAREST denied ancestor, not the immediate parent', () => {
    const r = resolve({ lms: true, 'lms.leads': false, 'lms.leads.view': true });
    expect(r.get('lms.leads.view')?.deniedBy).toBe('lms.leads');
    // Two levels down the culprit is still the page, not the operation above it.
    expect(r.get('lms.leads.view.own')?.deniedBy).toBe('lms.leads');
  });

  // Tools are roots: there is nothing above them to inherit from.
  it('fails a tool closed when it has no row, taking its whole tree with it', () => {
    const r = resolve({ 'lms.users': true, 'lms.users.manage': true });
    expect(r.get('lms')).toMatchObject({ granted: false, source: 'no-grant' });
    expect(r.get('lms.users')).toMatchObject({ granted: false, source: 'ancestor-denied' });
    expect(r.get('lms.users.manage')).toMatchObject({ granted: false, source: 'ancestor-denied' });
  });

  // The asymmetry that makes the whole model work: nav cascades, authority does not.
  it('does NOT inherit for an operation under an inherited-on page', () => {
    const r = resolve({ lms: true, 'lms.leads.view': true });
    expect(r.get('lms.leads')).toMatchObject({ granted: true, source: 'inherited-grant' });
    expect(r.get('lms.users.manage')).toMatchObject({ granted: false, source: 'no-grant' });
    expect(r.get('lms.leads.view.own')).toMatchObject({ granted: false, source: 'no-grant' });
  });

  it('inherits a tab through its page, but not the operation under the tab', () => {
    const r = resolve({ 'hr.attendance': true });
    expect(r.get('hr.attendance.admin')?.source).toBe('inherited-grant');
    expect(r.get('hr.attendance.admin.rules')?.source).toBe('inherited-grant');
    expect(r.get('hr.attendance.admin.rules.view')).toMatchObject({
      granted: false,
      source: 'no-grant',
    });
  });

  // super_admin is seeded ARRAY['*'], which materialises a row per capability —
  // it is omnipotent through DATA, never through a branch in the resolver.
  it('grants everything explicitly for a super_admin-shaped grant set', () => {
    const r = resolve(Object.fromEntries(TREE.map((n) => [n.key, true])));
    for (const node of TREE) {
      expect(r.get(node.key)).toMatchObject({ granted: true, source: 'explicit-grant' });
    }
  });

  it('reports tree depth from parent_key, not the dot count', () => {
    const r = resolve({ lms: true });
    expect(r.get('lms')?.depth).toBe(0);
    expect(r.get('lms.leads')?.depth).toBe(1);
    // Three dots, two levels: a direct child of lms.leads.view.
    expect(r.get('lms.leads.view.own')?.depth).toBe(3);
  });

  it('omits a node whose parent is not in the tree', () => {
    const orphaned = [...TREE, N('ghost.page', 'page', 'ghost')];
    const r = resolveCapabilityMatrix(orphaned, new Map([['ghost.page', true]]));
    expect(r.has('ghost.page')).toBe(false);
  });

  // The admin UI writes `!granted`. On an inherited-on node that must produce a
  // deny row — the previous UI rendered such a node unchecked and so wrote TRUE,
  // which is the entire "I removed it but it still shows" report.
  it('yields false when a UI negates an inherited-on node', () => {
    const r = resolve({ lms: true, 'lms.users.manage': true });
    expect(!r.get('lms.users')!.granted).toBe(false);
  });
});

describe('ownGrantsByKey', () => {
  const rows = (...r: Array<[string, string | null, boolean]>) =>
    r.map(([key, tenant_id, is_granted]) => ({
      capability_id: `id:${key}`,
      tenant_id,
      is_granted,
    }));

  it('lets a tenant override beat the platform default', () => {
    const own = ownGrantsByKey(TREE, rows(['lms.users', null, true], ['lms.users', 't1', false]), 't1');
    expect(own.get('lms.users')).toBe(false);
  });

  it('ignores another tenant’s override', () => {
    const own = ownGrantsByKey(TREE, rows(['lms.users', null, true], ['lms.users', 't2', false]), 't1');
    expect(own.get('lms.users')).toBe(true);
  });

  it('leaves a capability with no row absent, not false', () => {
    const own = ownGrantsByKey(TREE, rows(['lms', null, true]), 't1');
    expect(own.has('lms.users')).toBe(false);
  });
});

// Guards the rule admin-service enforces on write and the Capability Matrix
// screen renders as a locked row. Both call this one function, so a divergence
// here is a screen that offers a save the server refuses.
describe('isPlatformAdminCapability', () => {
  it('claims the admin tool and its whole subtree', () => {
    for (const key of ['admin', 'admin.lookups', 'admin.lookups.manage', 'admin.roles.manage']) {
      expect(isPlatformAdminCapability(key)).toBe(true);
    }
  });

  // The reason this is a named predicate and not an inline `startsWith('admin')`
  // at each call site. HR and Tasks both have "admin" surfaces that are ordinary
  // tenant capabilities — sweeping them in would lock a tenant out of assigning
  // its own leave policies and shift rules.
  it('does not claim the HR or Tasks admin surfaces', () => {
    for (const key of [
      'hr.attendance.admin',
      'hr.attendance.admin.shifts.manage',
      'hr.leave.admin',
      'hr.leave.admin.policies.manage',
      'tasks.lists',
      'tasks.lists.manage',
      'lms',
      'lms.apiclients.manage',
    ]) {
      expect(isPlatformAdminCapability(key)).toBe(false);
    }
  });

  // The dot guard: a sibling tool whose name merely starts with the same letters
  // is a different root, not a descendant.
  it('requires a dot boundary, not a bare string prefix', () => {
    expect(isPlatformAdminCapability('administration')).toBe(false);
    expect(isPlatformAdminCapability('admin_console')).toBe(false);
  });
});
