// Server-side colour engine (schema 1.75.0): derives the default shade of every editable
// role from a seed and checks a set of hand-made overrides for readability.
//
// The identical construction to @platform/ui-kit/theme buildScheme(): primary roles and the
// neutral-variant palette come from the seed via Material 3 "fidelity"; surfaces, secondary
// and tertiary are FIXED slate palettes, so only the accent changes between companies.
// ui-kit's theme test asserts both engines produce the same shades — change them together.
//
// Why it exists: the contrast floor must hold on the server, not just in the editor. A pair
// is checked against the shade it will really render with, which for a role the admin did
// not touch is the derived one.
import {
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeFidelity,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';
import {
  BRAND_PRESET_SEEDS,
  COLOR_CONTRAST_BLOCK,
  COLOR_CONTRAST_PAIRS,
  COLOR_ROLE_IDS,
  DEFAULT_BRAND_SEED,
  type ColorRoleId,
} from './color-roles.js';

interface FidelityScheme {
  variant: DynamicScheme['variant'];
  primaryPalette: TonalPalette;
  neutralVariantPalette: TonalPalette;
  errorPalette: TonalPalette;
}

const FIXED_NEUTRAL_KEY = '#213145';
const FIXED_SECONDARY_KEY = '#565e74';
const FIXED_TERTIARY_KEY = '#006693';

export type RoleColors = Record<ColorRoleId, string>;
export type RoleOverrides = Partial<Record<ColorRoleId, string>>;
export interface ColorOverrides { light?: RoleOverrides | undefined; dark?: RoleOverrides | undefined }

const cache = new Map<string, RoleColors>();

/** Default shade of every editable role for a seed in one mode (no overrides applied). */
export function deriveColorRoles(seedHex: string, isDark: boolean): RoleColors {
  const seed = seedHex.toLowerCase();
  const key = `${seed}|${isDark ? 'd' : 'l'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const source = Hct.fromInt(argbFromHex(seed));
  // This package resolves the library's .d.ts under NodeNext, where the subclass's inherited
  // members are not visible; the runtime object is a full DynamicScheme, so name what we read.
  const fidelity = new SchemeFidelity(source, isDark, 0) as unknown as FidelityScheme;
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

  const out = {} as RoleColors;
  for (const role of COLOR_ROLE_IDS) out[role] = hexFromArgb(MaterialDynamicColors[role].getArgb(scheme));
  cache.set(key, out);
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

/** The seed a (preset, seed_hex) choice stands for; an unset choice is the platform default. */
export function seedFor(choice: { preset?: string | null | undefined; seed_hex?: string | null | undefined }): string {
  if (choice.seed_hex) return choice.seed_hex.toLowerCase();
  if (choice.preset && BRAND_PRESET_SEEDS[choice.preset]) return BRAND_PRESET_SEEDS[choice.preset]!;
  return DEFAULT_BRAND_SEED;
}

export interface UnreadablePair {
  mode: 'light' | 'dark';
  foreground: ColorRoleId;
  background: ColorRoleId;
  label: string;
  ratio: number;
}

/**
 * Pairs that fall below the blocking floor once `overrides` are applied over the shades the
 * seed derives. Only a mode that carries at least one override is checked: the default
 * derivation is the platform's own and always passes, and a save that touched only light
 * must not be refused for a dark pair nobody changed.
 */
export function findUnreadablePairs(seedHex: string, overrides: ColorOverrides | null | undefined): UnreadablePair[] {
  const bad: UnreadablePair[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const o = overrides?.[mode];
    if (!o || Object.keys(o).length === 0) continue;
    const eff: RoleColors = { ...deriveColorRoles(seedHex, mode === 'dark'), ...o } as RoleColors;
    for (const [fg, bg, label] of COLOR_CONTRAST_PAIRS) {
      const ratio = contrastRatio(eff[fg], eff[bg]);
      if (ratio < COLOR_CONTRAST_BLOCK) bad.push({ mode, foreground: fg, background: bg, label, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return bad;
}

/**
 * Overrides after layering `top` over `base` (per mode, per role). A seed change between the
 * two layers is the caller's decision (it drops `base` first) — this only merges.
 */
export function mergeOverrides(base: ColorOverrides | null | undefined, top: ColorOverrides | null | undefined): ColorOverrides {
  const out: ColorOverrides = {};
  for (const mode of ['light', 'dark'] as const) {
    const merged = { ...(base?.[mode] ?? {}), ...(top?.[mode] ?? {}) };
    if (Object.keys(merged).length) out[mode] = merged;
  }
  return out;
}
