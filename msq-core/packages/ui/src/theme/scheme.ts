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
import {
  COLOR_CONTRAST_PAIRS,
  COLOR_ROLE_IDS,
  CONTRAST_BLOCK,
  ROLE_ALIASES,
  cssVarFor,
  type ColorOverrides,
  type ColorRoleId,
  type RoleOverrides,
} from './roles';

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

/** CSS custom-property map for one scheme, e.g. { '--color-primary': '#3525cd', … }. */
export type SchemeVars = Record<string, string>;

const cache = new Map<string, SchemeVars>();

function generate(seed: string, isDark: boolean): SchemeVars {
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

/**
 * Colour roles for a seed in one mode, with the hand-tuned `overrides` (schema 1.75.0)
 * laid over the derived shades. Returns an EMPTY map for the platform default in light
 * mode with no overrides — theme.css already carries that exact palette, so the default
 * tenant ships no inline style at all. With overrides on the default seed only the
 * overridden roles are emitted; everything else keeps coming from theme.css.
 */
export function buildScheme(seedHex: string, isDark: boolean, overrides?: RoleOverrides | null): SchemeVars {
  const seed = seedHex.toLowerCase();
  const hasOverrides = overrides ? Object.keys(overrides).length > 0 : false;
  const defaultLight = !isDark && seed === DEFAULT_THEME.seed_hex;
  const base: SchemeVars = defaultLight ? {} : generate(seed, isDark);
  if (!hasOverrides) return base;
  const out: SchemeVars = { ...base };
  for (const [role, hex] of Object.entries(overrides!)) {
    out[cssVarFor(role)] = hex;
    for (const alias of ROLE_ALIASES[role as ColorRoleId] ?? []) out[cssVarFor(alias)] = hex;
  }
  return out;
}

/**
 * The shade each editable role has for a seed with NO overrides — what the editor shows as
 * "auto". For the default seed in light mode the live page uses the hand-tuned theme.css
 * palette, which the generator reproduces to within one hex step on three roles.
 */
export function derivedRoleColors(seedHex: string, isDark: boolean): Record<ColorRoleId, string> {
  const vars = generate(seedHex.toLowerCase(), isDark);
  const out = {} as Record<ColorRoleId, string>;
  for (const role of COLOR_ROLE_IDS) out[role] = vars[cssVarFor(role)] ?? '#000000';
  return out;
}

/**
 * The COMPLETE variable set for a seed + overrides, even for the platform default in light
 * mode (where buildScheme() stays empty because theme.css carries it). For a scoped preview
 * that must not inherit whatever the surrounding page is showing.
 */
export function buildFullScheme(seedHex: string, isDark: boolean, overrides?: RoleOverrides | null): SchemeVars {
  const out: SchemeVars = { ...generate(seedHex.toLowerCase(), isDark) };
  for (const [role, hex] of Object.entries(overrides ?? {})) {
    out[cssVarFor(role)] = hex;
    for (const alias of ROLE_ALIASES[role as ColorRoleId] ?? []) out[cssVarFor(alias)] = hex;
  }
  return out;
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

export interface UnreadablePair {
  mode: 'light' | 'dark';
  foreground: ColorRoleId;
  background: ColorRoleId;
  label: string;
  ratio: number;
}

/**
 * Pairs below the blocking floor once `overrides` are laid over the seed's derived shades.
 * Only a mode that carries at least one override is checked (the platform derivation always
 * passes, and a change to light must not be refused for a dark pair nobody touched). The
 * server runs the same check (@platform/validation findUnreadablePairs) and is the gate;
 * this lets the editor say so before the request.
 */
export function findUnreadablePairs(seedHex: string, overrides: ColorOverrides | null | undefined): UnreadablePair[] {
  const bad: UnreadablePair[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const o = overrides?.[mode];
    if (!o || Object.keys(o).length === 0) continue;
    const eff = { ...derivedRoleColors(seedHex, mode === 'dark'), ...o };
    for (const [fg, bg, label] of COLOR_CONTRAST_PAIRS) {
      const ratio = contrastRatio(eff[fg], eff[bg]);
      if (ratio < CONTRAST_BLOCK) bad.push({ mode, foreground: fg, background: bg, label, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return bad;
}
