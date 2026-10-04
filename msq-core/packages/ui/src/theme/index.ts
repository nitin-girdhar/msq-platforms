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
export { buildScheme, contrastRatio } from './scheme';
export type { SchemeVars } from './scheme';
export { default as ThemeStyle, themeHtmlProps } from './ThemeStyle';
export type { ThemeStyleProps } from './ThemeStyle';
