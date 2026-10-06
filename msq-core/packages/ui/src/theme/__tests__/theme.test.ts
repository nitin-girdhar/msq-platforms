import { describe, it, expect } from 'vitest';
import { Hct, argbFromHex } from '@material/material-color-utilities';
import { buildScheme, contrastRatio } from '../scheme';
import { DEFAULT_THEME, FONT_SIZES, fontSizeById, resolveTheme, THEME_PRESETS } from '../presets';

describe('FONT_SIZES', () => {
  it('has four steps, ascending, with Default at 100%', () => {
    expect(FONT_SIZES.map((s) => s.id)).toEqual(['sm', 'md', 'lg', 'xl']);
    const pcts = FONT_SIZES.map((s) => s.pct);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(fontSizeById('md').pct).toBe(100);
    expect(fontSizeById('nope').id).toBe('md');
  });
});

describe('buildScheme', () => {
  it('emits nothing for the platform default in light mode (theme.css carries it)', () => {
    expect(buildScheme('#4f46e5', false)).toEqual({});
    expect(buildScheme('#4F46E5', false)).toEqual({});
  });

  it('keeps primary-container on the brand seed hue (fidelity)', () => {
    const hue = (hex: string) => Hct.fromInt(argbFromHex(hex)).hue;
    for (const p of THEME_PRESETS.filter((x) => x.id !== 'indigo-kinetic' && x.id !== 'slate-modern')) {
      const container = buildScheme(p.seed, false)['--color-primary-container']!;
      const delta = Math.abs(hue(container) - hue(p.seed));
      expect(Math.min(delta, 360 - delta)).toBeLessThan(8);
    }
  });

  it('generates the Stitch brand roles for a seed next to the default', () => {
    // #4f46e5 itself short-circuits to theme.css; one step off forces the
    // generator, which must keep the seed as the container and land primary
    // within a hex step of Stitch's #3525cd.
    const s = buildScheme('#4f46e6', false);
    expect(s['--color-primary-container']).toBe('#4f46e6');
    expect(s['--color-primary']).toMatch(/^#3525c[d-e]$/);
  });

  it('keeps the fixed slate neutrals across brands (only the accent changes)', () => {
    const teal = buildScheme('#0d9488', false);
    const amber = buildScheme('#ea580c', false);
    expect(teal['--color-surface']).toBe(amber['--color-surface']);
    expect(teal['--color-on-surface']).toBe(amber['--color-on-surface']);
  });

  it('generates a dark scheme for the default seed', () => {
    const dark = buildScheme('#4f46e5', true);
    expect(dark['--color-surface']).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(dark['--color-on-surface']!, dark['--color-surface']!)).toBeGreaterThan(7);
  });

  it('never yields unreadable on-primary text, even for extreme seeds', () => {
    for (const seed of ['#ffff00', '#00ff00', '#000000', '#ffffff', '#0f172a']) {
      for (const dark of [false, true]) {
        const s = buildScheme(seed, dark);
        if (!s['--color-primary']) continue; // default-light short-circuit
        expect(contrastRatio(s['--color-on-primary']!, s['--color-primary']!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('resolveTheme', () => {
  it('falls back to the platform default', () => {
    expect(resolveTheme()).toEqual(DEFAULT_THEME);
    expect(resolveTheme(null, undefined)).toEqual(DEFAULT_THEME);
  });

  it('applies later layers over earlier ones', () => {
    const t = resolveTheme({ preset: 'teal-horizon', font: 'manrope' }, { mode: 'dark' });
    expect(t).toEqual({ preset: 'teal-horizon', seed_hex: '#0d9488', font: 'manrope', mode: 'dark', font_size: 'md' });
  });

  it('takes the text size from the user layer and ignores unknown steps', () => {
    expect(resolveTheme({ preset: 'teal-horizon' }, { font_size: 'xl' }).font_size).toBe('xl');
    expect(resolveTheme({ font_size: 'huge' as never }).font_size).toBe('md');
  });

  it('prefers a custom seed over a preset and lowercases it', () => {
    const t = resolveTheme({ preset: 'teal-horizon', seed_hex: '#AB12CD' });
    expect(t.seed_hex).toBe('#ab12cd');
    expect(t.preset).toBeNull();
  });

  it('ignores unknown ids and malformed hex instead of trusting a stale row', () => {
    const t = resolveTheme({ preset: 'neon' as never, seed_hex: 'red', font: 'comic-sans' as never, mode: 'sepia' as never });
    expect(t).toEqual(DEFAULT_THEME);
  });
});
