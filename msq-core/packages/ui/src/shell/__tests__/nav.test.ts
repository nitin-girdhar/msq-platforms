import { describe, it, expect } from 'vitest';
import {
  filterNav,
  filterNavGroups,
  holdsUsableNode,
  isNavGroups,
  type NavItem,
  type NavGroup,
} from '../nav';

const actor = (capabilities: string[]) => ({ capabilities });

const ITEM = (id: string, capability: string): NavItem => ({
  id,
  label: id,
  href: `/${id}`,
  capability: capability as NavItem['capability'],
});

// holdsUsableNode now lives in @platform/rbac and is re-exported from ../nav so
// the LMS page guards can ask the sidebar's exact question. These cover the
// re-export path directly — the rule itself must not have shifted in the move.
describe('holdsUsableNode (re-exported from @platform/rbac)', () => {
  const KEY = 'admin.lookups' as NavItem['capability'];

  it('needs the node AND something granted beneath it', () => {
    expect(holdsUsableNode(actor(['admin.lookups', 'admin.lookups.manage']), KEY)).toBe(true);
  });

  it('rejects a node held with nothing usable under it', () => {
    expect(holdsUsableNode(actor(['admin.lookups']), KEY)).toBe(false);
  });

  it('rejects a descendant held without the node itself', () => {
    expect(holdsUsableNode(actor(['admin.lookups.manage']), KEY)).toBe(false);
  });

  it('fails closed on a null actor', () => {
    expect(holdsUsableNode(null, KEY)).toBe(false);
  });

  it('accepts a Set as well as an array', () => {
    expect(holdsUsableNode({ capabilities: new Set(['admin.lookups', 'admin.lookups.manage']) }, KEY)).toBe(true);
  });
});

describe('filterNav (flat)', () => {
  it('keeps an item whose capability is usable', () => {
    const items = [ITEM('a', 'admin.lookups'), ITEM('b', 'admin.roles')];
    const held = ['admin.lookups', 'admin.lookups.manage'];
    expect(filterNav(items, actor(held)).map((i) => i.id)).toEqual(['a']);
  });

  it('fails closed on a null actor', () => {
    expect(filterNav([ITEM('a', 'admin.lookups')], null)).toEqual([]);
  });

  it('hides an operation-gated item without `exact` — nothing is ever beneath a leaf', () => {
    const items = [ITEM('a', 'admin.roles.manage')];
    expect(filterNav(items, actor(['admin', 'admin.roles.manage']))).toEqual([]);
  });

  it('keeps an `exact` item on a plain grant of its operation', () => {
    const items = [{ ...ITEM('a', 'admin.roles.manage'), exact: true }];
    expect(filterNav(items, actor(['admin.roles.manage'])).map((i) => i.id)).toEqual(['a']);
  });

  it('still fails closed on an `exact` item the actor does not hold', () => {
    const items = [{ ...ITEM('a', 'admin.roles.manage'), exact: true }];
    expect(filterNav(items, actor(['admin.lookups.manage']))).toEqual([]);
  });
});

describe('filterNavGroups', () => {
  const groups: NavGroup[] = [
    { id: 'platform', label: 'Platform', items: [ITEM('tenants', 'admin.lookups')] },
    { id: 'capabilities', label: 'Capabilities', items: [ITEM('roles', 'admin.roles')] },
  ];

  it('drops items the actor cannot open, per group', () => {
    const held = ['admin.lookups', 'admin.lookups.manage'];
    const visible = filterNavGroups(groups, actor(held));
    expect(visible.map((g) => g.id)).toEqual(['platform']);
    expect(visible[0]?.items.map((i) => i.id)).toEqual(['tenants']);
  });

  it('drops a group entirely once it has no visible items', () => {
    const visible = filterNavGroups(groups, actor([]));
    expect(visible).toEqual([]);
  });

  it('fails closed on a null actor', () => {
    expect(filterNavGroups(groups, null)).toEqual([]);
  });

  it('keeps every group when everything is granted', () => {
    const held = [
      'admin.lookups', 'admin.lookups.manage',
      'admin.roles', 'admin.roles.manage',
    ];
    const visible = filterNavGroups(groups, actor(held));
    expect(visible.map((g) => g.id)).toEqual(['platform', 'capabilities']);
  });
});

describe('isNavGroups', () => {
  it('distinguishes NavItem[] from NavGroup[]', () => {
    const items = [ITEM('a', 'admin.lookups')];
    const groups: NavGroup[] = [{ id: 'g', label: 'G', items }];
    expect(isNavGroups(items)).toBe(false);
    expect(isNavGroups(groups)).toBe(true);
  });

  it('treats an empty list as flat', () => {
    expect(isNavGroups([])).toBe(false);
  });
});
