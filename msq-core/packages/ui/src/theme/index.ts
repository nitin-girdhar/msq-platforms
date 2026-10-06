// @platform/ui-kit/theme — design tokens runtime. See skills/react-typescript §6.
//
// Server-safe barrel (no 'use client' module re-exported here), so root
// layouts can import ThemeStyle / themeHtmlProps directly.
export {
  THEME_PRESETS,
  BRAND_FONTS,
  THEME_MODES,
  DEFAULT_THEME,
  DEFAULT_PRESET_ID,
  DEFAULT_FONT_ID,
  HEX_COLOR_RE,
  presetById,
  fontById,
  resolveTheme,
} from './presets';
export type { ThemePresetId, BrandFontId, ThemeMode, ThemeChoice, EffectiveTheme } from './presets';
export { buildFullScheme, buildScheme, contrastRatio, derivedRoleColors, findUnreadablePairs } from './scheme';
export type { UnreadablePair } from './scheme';
export {
  COLOR_CONTRAST_PAIRS,
  COLOR_ROLE_GROUPS,
  COLOR_ROLE_IDS,
  CONTRAST_BLOCK,
  CONTRAST_WARN,
  countOverrides,
  cssVarFor,
  mergeColorOverrides,
  sanitizeColorOverrides,
} from './roles';
export type { ColorOverrides, ColorRoleGroup, ColorRoleId, ColorRoleSpec, RoleOverrides } from './roles';
export type { SchemeVars } from './scheme';
export { default as ThemeStyle, themeHtmlProps } from './ThemeStyle';
export type { ThemeStyleProps } from './ThemeStyle';
