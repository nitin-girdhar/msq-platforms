import { describe, it, expect } from 'vitest';
// The server's copy of the colour engine + whitelist (same relative-import convention as the
// locale test): this file is the drift guard between the two.
import * as v from '../../../../platform-validation/src/color-roles';
import * as vc from '../../../../platform-validation/src/theme-colors';
import { colorOverridesSchema, themeChoiceSchema, tenantBrandingUpdateSchema } from '../../../../platform-validation/src/branding';
import { buildFullScheme, buildScheme, derivedRoleColors, findUnreadablePairs } from '../scheme';
import { resolveTheme, THEME_PRESETS } from '../presets';
import {
  COLOR_CONTRAST_PAIRS,
  COLOR_ROLE_GROUPS,
  COLOR_ROLE_IDS,
  CONTRAST_BLOCK,
  CONTRAST_WARN,
  mergeColorOverrides,
  sanitizeColorOverrides,
} from '../roles';

const SEEDS = ['#0d4668', '#ee6c30', '#0d9488', '#7c3aed', '#0f172a', '#4f46e6'];

describe('UI and server stay in step', () => {
  it('role list, contrast pairs, floors and preset seeds are identical', () => {
    expect([...COLOR_ROLE_IDS]).toEqual([...v.COLOR_ROLE_IDS]);
    expect(COLOR_CONTRAST_PAIRS).toEqual(v.COLOR_CONTRAST_PAIRS);
    expect(CONTRAST_BLOCK).toBe(v.COLOR_CONTRAST_BLOCK);
    expect(CONTRAST_WARN).toBe(v.COLOR_CONTRAST_WARN);
    for (const p of THEME_PRESETS) expect(v.BRAND_PRESET_SEEDS[p.id]).toBe(p.seed);
    expect(Object.keys(v.BRAND_PRESET_SEEDS).sort()).toEqual(THEME_PRESETS.map((p) => p.id).sort());
  });

  it('every editable role appears exactly once in the editor groups', () => {
    const listed = COLOR_ROLE_GROUPS.flatMap((g) => g.roles.map((r) => r.id));
    expect([...listed].sort()).toEqual([...COLOR_ROLE_IDS].sort());
  });

  it('the server derives the same shade as buildScheme for every role, seed and mode', () => {
    for (const seed of SEEDS) {
      for (const dark of [false, true]) {
        expect(vc.deriveColorRoles(seed, dark)).toEqual(derivedRoleColors(seed, dark));
      }
    }
  });

  it('the server finds the same unreadable pairs as the editor', () => {
    const cases = [
      { light: { onPrimary: '#0d4668' } },
      { light: { onSurface: '#f8f9ff' }, dark: { surface: '#ffffff' } },
      { dark: { primary: '#031427' } },
    ];
    for (const seed of SEEDS) {
      for (const o of cases) expect(vc.findUnreadablePairs(seed, o)).toEqual(findUnreadablePairs(seed, o));
    }
  });
});

describe('buildScheme with overrides', () => {
  it('lays an override over the derived shade and leaves the rest alone', () => {
    const base = buildScheme('#0d4668', false);
    const out = buildScheme('#0d4668', false, { primary: '#123456' });
    expect(out['--color-primary']).toBe('#123456');
    expect(out['--color-on-primary']).toBe(base['--color-on-primary']);
    expect(out['--color-surface']).toBe(base['--color-surface']);
  });

  it('on-surface also drives on-background', () => {
    const out = buildScheme('#0d4668', false, { onSurface: '#101010' });
    expect(out['--color-on-surface']).toBe('#101010');
    expect(out['--color-on-background']).toBe('#101010');
  });

  it('on the platform default in light mode only the overridden roles are emitted', () => {
    expect(buildScheme('#4f46e5', false, {})).toEqual({});
    expect(buildScheme('#4f46e5', false, { primary: '#123456' })).toEqual({ '--color-primary': '#123456' });
  });

  it('buildFullScheme is complete even for the platform default', () => {
    const full = buildFullScheme('#4f46e5', false, { primary: '#123456' });
    expect(full['--color-primary']).toBe('#123456');
    expect(full['--color-surface']).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('does not mutate the cached scheme', () => {
    buildScheme('#0d4668', false, { primary: '#123456' });
    expect(buildScheme('#0d4668', false)['--color-primary']).not.toBe('#123456');
  });
});

describe('resolveTheme colour overrides', () => {
  const tenant = { seed_hex: '#0d4668', color_overrides: { light: { primary: '#111111' }, dark: { primary: '#eeeeee' } } };

  it('a tenant layer carries its own overrides', () => {
    expect(resolveTheme(tenant).color_overrides).toEqual(tenant.color_overrides);
  });

  it('a user who only changes the mode keeps the company shades', () => {
    expect(resolveTheme(tenant, { mode: 'dark' }).color_overrides).toEqual(tenant.color_overrides);
  });

  it('a user who keeps the company colour layers their shades on top, role by role', () => {
    const t = resolveTheme(tenant, { color_overrides: { light: { primary: '#222222', secondary: '#333333' } } });
    expect(t.color_overrides).toEqual({ light: { primary: '#222222', secondary: '#333333' }, dark: { primary: '#eeeeee' } });
  });

  it('a user who picks their own colour drops the company shades and uses their own', () => {
    const t = resolveTheme(tenant, { seed_hex: '#ee6c30', color_overrides: { light: { secondary: '#333333' } } });
    expect(t.seed_hex).toBe('#ee6c30');
    expect(t.color_overrides).toEqual({ light: { secondary: '#333333' } });
    expect(resolveTheme(tenant, { preset: 'teal-horizon' }).color_overrides).toEqual({});
  });

  it('null / empty overrides change nothing', () => {
    expect(resolveTheme(tenant, { color_overrides: null }).color_overrides).toEqual(tenant.color_overrides);
    expect(resolveTheme(tenant, { color_overrides: {} }).color_overrides).toEqual(tenant.color_overrides);
  });

  it('ignores unknown roles and malformed hex from a stale row', () => {
    const t = resolveTheme({ color_overrides: { light: { primary: 'red', error: '#ff0000', onPrimary: '#ABCDEF' } } as never });
    expect(t.color_overrides).toEqual({ light: { onPrimary: '#abcdef' } });
    expect(sanitizeColorOverrides('nope')).toEqual({});
  });

  it('mergeColorOverrides is per mode and per role', () => {
    expect(mergeColorOverrides({ light: { primary: '#111111' } }, { dark: { primary: '#222222' } })).toEqual({
      light: { primary: '#111111' },
      dark: { primary: '#222222' },
    });
  });
});

describe('findUnreadablePairs', () => {
  it('passes the platform derivation and a clean override', () => {
    expect(findUnreadablePairs('#0d4668', null)).toEqual([]);
    expect(findUnreadablePairs('#0d4668', { light: { primary: '#0a3a58' } })).toEqual([]);
  });

  it('flags text that matches its background', () => {
    const bad = findUnreadablePairs('#0d4668', { light: { onPrimary: '#002f4a' } });
    expect(bad.map((b) => b.label)).toContain('Primary button');
    expect(bad[0]!.mode).toBe('light');
    expect(bad[0]!.ratio).toBeLessThan(CONTRAST_BLOCK);
  });

  it('checks the pair against the derived shade of the role nobody touched', () => {
    // onPrimaryContainer set to the exact container colour: only readable if the container is derived.
    const eff = derivedRoleColors('#0d4668', false);
    const bad = findUnreadablePairs('#0d4668', { light: { onPrimaryContainer: eff.primaryContainer } });
    expect(bad.map((b) => b.label)).toContain('Selected menu item');
  });

  it('only checks a mode that carries overrides', () => {
    const bad = findUnreadablePairs('#0d4668', { dark: { onPrimary: '#031427', primary: '#031427' } });
    expect(bad.every((b) => b.mode === 'dark')).toBe(true);
  });
});

describe('server schemas', () => {
  it('accepts a sparse, well-formed map and lower-cases hex', () => {
    const r = colorOverridesSchema.parse({ light: { primary: '#0D4668' }, dark: {} });
    expect(r).toEqual({ light: { primary: '#0d4668' }, dark: {} });
  });

  it('refuses error / status roles, unknown roles, bad hex and extra keys', () => {
    expect(colorOverridesSchema.safeParse({ light: { error: '#ff0000' } }).success).toBe(false);
    expect(colorOverridesSchema.safeParse({ light: { statusOverdue: '#ff0000' } }).success).toBe(false);
    expect(colorOverridesSchema.safeParse({ light: { primary: 'blue' } }).success).toBe(false);
    expect(colorOverridesSchema.safeParse({ light: { primary: '#fff' } }).success).toBe(false);
    expect(colorOverridesSchema.safeParse({ sepia: { primary: '#ffffff' } }).success).toBe(false);
  });

  it('is part of the tenant and user theme bodies, which stay strict', () => {
    expect(tenantBrandingUpdateSchema.safeParse({ color_overrides: { light: { primary: '#0d4668' } } }).success).toBe(true);
    expect(themeChoiceSchema.safeParse({ color_overrides: null }).success).toBe(true);
    expect(tenantBrandingUpdateSchema.safeParse({ color_overrides: {}, theme_locked: true }).success).toBe(false);
  });
});
