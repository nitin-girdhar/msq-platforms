// Colour-role generator. Server-safe and client-safe (pure functions) — runs
// in root layouts to emit <ThemeStyle>, and in the appearance/branding
// editors for the live preview.
//
// How the palette is built (matched against the Stitch design system,
// 2026-10-02):
//  - PRIMARY roles and the neutral-VARIANT palette (outlines, secondary text)
//    come from the brand seed via Material 3 "fidelity", which keeps
//    primary-container at the seed's hue and as close to its tone as
//    legibility allows (exactly the seed for #4f46e5; e.g. teal #0d9488 is
//    nudged to #008378 so white text on it still passes).
//  - NEUTRAL (surfaces, body text), SECONDARY and TERTIARY are FIXED cool
//    slate palettes taken from the Stitch palette, so every brand still reads
//    as the same enterprise product and only its accent changes.
// With seed #4f46e5 this reproduces 17 of the 20 Stitch light roles exactly and
// the other 3 within one hex step; the default light scheme is nevertheless
// served from theme.css verbatim (see buildScheme).
//
// Material 3 tone pairs guarantee legible on-colours by construction
// (primary T40 vs on-primary T100 etc.), so a "bad seed" cannot produce
// unreadable buttons; contrastRatio() exists for the editor's info badge.
import {
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeFidelity,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';
import { DEFAULT_THEME } from './presets';

const FIXED_NEUTRAL_KEY = '#213145';
const FIXED_SECONDARY_KEY = '#565e74';
const FIXED_TERTIARY_KEY = '#006693';

type RoleName =
  | 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'
  | 'primaryFixed' | 'primaryFixedDim' | 'onPrimaryFixed' | 'onPrimaryFixedVariant'
  | 'inversePrimary' | 'surfaceTint'
  | 'secondary' | 'onSecondary' | 'secondaryContainer' | 'onSecondaryContainer'
  | 'tertiary' | 'onTertiary' | 'tertiaryContainer' | 'onTertiaryContainer' | 'tertiaryFixed'
  | 'background' | 'onBackground' | 'surface' | 'surfaceDim' | 'surfaceBright'
  | 'surfaceContainerLowest' | 'surfaceContainerLow' | 'surfaceContainer'
  | 'surfaceContainerHigh' | 'surfaceContainerHighest' | 'surfaceVariant'
  | 'onSurface' | 'onSurfaceVariant' | 'outline' | 'outlineVariant'
  | 'inverseSurface' | 'inverseOnSurface'
  | 'error' | 'onError' | 'errorContainer' | 'onErrorContainer';

const ROLES: RoleName[] = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'primaryFixed', 'primaryFixedDim', 'onPrimaryFixed', 'onPrimaryFixedVariant',
  'inversePrimary', 'surfaceTint',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer', 'tertiaryFixed',
  'background', 'onBackground', 'surface', 'surfaceDim', 'surfaceBright',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest', 'surfaceVariant',
  'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant',
  'inverseSurface', 'inverseOnSurface',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
];

/** camelCase role → the CSS variable theme.css declares (`--color-on-primary`). */
function cssVarFor(role: RoleName): string {
  return `--color-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** CSS custom-property map for one scheme, e.g. { '--color-primary': '#3525cd', … }. */
export type SchemeVars = Record<string, string>;

const cache = new Map<string, SchemeVars>();

/**
 * Colour roles for a seed in one mode. Returns an EMPTY map for the platform
 * default in light mode — theme.css already carries that exact palette, so
 * the default tenant ships no inline style at all.
 */
export function buildScheme(seedHex: string, isDark: boolean): SchemeVars {
  const seed = seedHex.toLowerCase();
  if (!isDark && seed === DEFAULT_THEME.seed_hex) return {};
  const key = `${seed}|${isDark ? 'd' : 'l'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const source = Hct.fromInt(argbFromHex(seed));
  const fidelity = new SchemeFidelity(source, isDark, 0);
  const neutral = Hct.fromInt(argbFromHex(FIXED_NEUTRAL_KEY));
  const scheme = new DynamicScheme({
    sourceColorHct: source,
    variant: fidelity.variant,
    contrastLevel: 0,
    isDark,
    primaryPalette: fidelity.primaryPalette,
    neutralVariantPalette: fidelity.neutralVariantPalette,
    errorPalette: fidelity.errorPalette,
    neutralPalette: TonalPalette.fromHueAndChroma(neutral.hue, neutral.chroma),
    secondaryPalette: TonalPalette.fromInt(argbFromHex(FIXED_SECONDARY_KEY)),
    tertiaryPalette: TonalPalette.fromInt(argbFromHex(FIXED_TERTIARY_KEY)),
  });

  const vars: SchemeVars = {};
  for (const role of ROLES) {
    vars[cssVarFor(role)] = hexFromArgb(MaterialDynamicColors[role].getArgb(scheme));
  }
  cache.set(key, vars);
  return vars;
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
