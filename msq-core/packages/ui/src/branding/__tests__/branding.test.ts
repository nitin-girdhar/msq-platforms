import { describe, expect, it } from 'vitest';
import { brandingFromApi, publicBrandingFromApi, DEFAULT_BRANDING, isBrandKey } from '../types';
import { brandNav, type NavItem } from '../../shell/nav';

const KEY = 'd9314809-de08-43e2-a8b0-c5bb582cdeae';

describe('brandingFromApi', () => {
  it('falls back to the default for junk', () => {
    expect(brandingFromApi(null)).toEqual(DEFAULT_BRANDING);
    expect(brandingFromApi('x')).toEqual(DEFAULT_BRANDING);
  });

  it('resolves tenant then user layers and keeps the lock flag', () => {
    const b = brandingFromApi({
      theme: { tenant: { preset: 'teal-horizon', font: 'manrope', mode: 'light' }, user: { mode: 'dark' }, locked: true },
      personal: { preset: 'royal-violet', mode: 'dark' },
    });
    expect(b.theme.preset).toBe('teal-horizon');
    expect(b.theme.font).toBe('manrope');
    expect(b.theme.mode).toBe('dark');
    expect(b.locked).toBe(true);
    expect(b.personal?.preset).toBe('royal-violet');
  });

  it('maps only gateway branding asset paths to /api URLs', () => {
    const b = brandingFromApi({
      assets: { mark: `/public/branding/${KEY}/assets/mark?v=1`, logo: 'https://evil.example/x.svg' },
    });
    expect(b.assets.mark).toBe(`/api/public/branding/${KEY}/assets/mark?v=1`);
    expect(b.assets.logo).toBeUndefined();
  });

  it('reads names, terms and menu overrides, dropping empties', () => {
    const b = brandingFromApi({
      product_names: { brand: { name: 'Fitclass' }, lms: { title: 'Enquiries', short: '' }, bogus: { title: 'x' } },
      terms: { lead: 'Prospect', leads: '' },
      nav_overrides: { 'bulk-assign': { label: 'Allocations' }, empty: {} },
    });
    expect(b.brandName).toBe('Fitclass');
    expect(b.productNames).toEqual({ lms: { title: 'Enquiries' } });
    expect(b.terms).toEqual({ lead: 'Prospect' });
    expect(b.navOverrides).toEqual({ 'bulk-assign': { label: 'Allocations' } });
  });
});

describe('publicBrandingFromApi / isBrandKey', () => {
  it('parses the login-link shape', () => {
    const p = publicBrandingFromApi({ theme: { preset: 'emerald-fit' }, brand_name: 'Acme', product_labels: ['Leads', 3] });
    expect(p.theme.preset).toBe('emerald-fit');
    expect(p.brandName).toBe('Acme');
    expect(p.productLabels).toEqual(['Leads']);
  });
  it('accepts only UUID keys', () => {
    expect(isBrandKey(KEY)).toBe(true);
    expect(isBrandKey('../etc')).toBe(false);
    expect(isBrandKey(undefined)).toBe(false);
  });
});

describe('brandNav', () => {
  const items: NavItem[] = [
    { id: 'leads', label: 'Leads', href: '/l', icon: 'target', capability: 'lms.leads' as NavItem['capability'] },
    { id: 'bulk-assign', label: 'Bulk Assign', href: '/b', capability: 'lms.leads' as NavItem['capability'] },
  ];
  it('changes labels/icons only, never ids, hrefs or capabilities', () => {
    const out = brandNav(items, { leads: { label: 'Enquiries', icon: 'globe' }, 'bulk-assign': { icon: 'not-an-icon' } });
    expect(out[0]).toEqual({ ...items[0], label: 'Enquiries', icon: 'globe' });
    expect(out[1]).toEqual(items[1]);
  });
  it('returns the same array when there are no overrides', () => {
    expect(brandNav(items, {})).toBe(items);
  });
});
