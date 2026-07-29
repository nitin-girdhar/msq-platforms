import { describe, it, expect } from 'vitest';
import { filterNav, filterNavGroups, isNavGroups, type NavItem, type NavGroup } from '../nav';

const actor = (capabilities: string[]) => ({ capabilities });

const ITEM = (id: string, capability: string): NavItem => ({
  id,
  label: id,
  href: `/${id}`,
  capability: capability as NavItem['capability'],
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
