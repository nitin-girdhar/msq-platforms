import { buildScheme, contrastRatio } from '../../theme/scheme';
import { DEFAULT_THEME, fontById, type EffectiveTheme } from '../../theme/presets';

const SAVED_ID = 'platform-theme'; // ThemeStyle's element
const PREVIEW_ID = 'platform-theme-preview';

/**
 * Live preview of an unsaved theme. The server-rendered #platform-theme is
 * switched off (media="not all") and a preview <style> takes its place, so
 * previewing the platform default really shows theme.css's palette rather
 * than the tenant's saved colours. Pass null to restore the saved theme.
 * Light scheme only, like the apps themselves while dark mode is off.
 */
export function applyThemePreview(theme: EffectiveTheme | null): void {
  if (typeof document === 'undefined') return;
  document.getElementById(PREVIEW_ID)?.remove();
  const saved = document.getElementById(SAVED_ID) as HTMLStyleElement | null;
  if (!theme) {
    if (saved) saved.media = '';
    return;
  }
  if (saved) saved.media = 'not all';
  const font = fontById(theme.font) ?? fontById(DEFAULT_THEME.font);
  const body = [
    // Empty for the default seed: theme.css already carries that palette.
    ...Object.entries(buildScheme(theme.seed_hex, false)).map(([k, v]) => `${k}:${v}`),
    `--font-brand:var(${font?.cssVar ?? '--font-inter'})`,
    '--font-brand-mono:var(--font-jetbrains-mono)',
  ].join(';');
  const el = document.createElement('style');
  el.id = PREVIEW_ID;
  el.textContent = `:root{${body}}`;
  document.head.appendChild(el);
}

/** WCAG ratio of on-primary text over the primary role a seed produces. */
export function seedContrast(seedHex: string): number {
  const vars = buildScheme(seedHex, false);
  const primary = vars['--color-primary'];
  const onPrimary = vars['--color-on-primary'];
  if (!primary || !onPrimary) return 21; // platform default — known good
  return contrastRatio(primary, onPrimary);
}
