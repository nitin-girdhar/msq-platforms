// Server component: renders the resolved theme as CSS custom-property
// overrides. Put it inside <head> of every root layout, after globals.css.
//
// The output is UNLAYERED, so it beats Tailwind's `@layer theme` defaults from
// theme.css regardless of source order — components never branch on theme.
//
// Safe to inline: every value is either a #rrggbb produced by buildScheme()
// from a regex-validated seed, or a CSS variable NAME from the fixed
// BRAND_FONTS list — never free text from a row.
import { brandFontVariables } from './fonts';
import { fontById, type EffectiveTheme } from './presets';
import { buildScheme, type SchemeVars } from './scheme';

function block(selector: string, vars: SchemeVars, extra = ''): string {
  const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  if (!body && !extra) return '';
  return `${selector}{${body}${body && extra ? ';' : ''}${extra}}`;
}

export interface ThemeStyleProps {
  theme: EffectiveTheme;
  /**
   * The app renders correctly in dark mode (every screen on theme tokens).
   * False forces light whatever the tenant/user chose — see skills §6.
   */
  supportsDark?: boolean;
}

export default function ThemeStyle({ theme, supportsDark = false }: ThemeStyleProps) {
  const font = fontById(theme.font) ?? fontById('inter');
  const fontDecl = `--font-brand:var(${font?.cssVar ?? '--font-inter'});--font-brand-mono:var(--font-jetbrains-mono)`;

  const css: string[] = [block(':root', buildScheme(theme.seed_hex, false), fontDecl)];
  if (supportsDark && theme.mode !== 'light') {
    const dark = buildScheme(theme.seed_hex, true);
    css.push(block('html[data-mode="dark"]', dark));
    css.push(`@media (prefers-color-scheme: dark){${block('html[data-mode="system"]', dark)}}`);
  }
  return <style id="platform-theme" dangerouslySetInnerHTML={{ __html: css.join('') }} />;
}

/**
 * Attributes for <html>: the font-variable classes and the effective mode.
 * Spread onto <html> in the root layout so the first paint is already themed.
 */
export function themeHtmlProps(theme: EffectiveTheme, supportsDark = false) {
  return {
    className: brandFontVariables,
    'data-mode': supportsDark ? theme.mode : 'light',
  } as const;
}
