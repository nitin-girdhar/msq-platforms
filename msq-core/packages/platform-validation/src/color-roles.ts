// Colour roles a tenant (or a user) may fine-tune by hand (schema 1.75.0).
//
// Dependency-free on purpose: branding.ts (the Zod schemas) imports this, and the
// browser bundle must not drag the colour engine in with it. The engine that DERIVES
// the default value of each role from a seed lives in theme-colors.ts.
//
// Mirrors @platform/ui-kit/theme `roles.ts` (the UI's copy). The ui-kit theme test
// asserts the two lists, the contrast pairs and the preset seeds are identical, and that
// theme-colors.ts derives the same shades as the UI's buildScheme().
//
// NOT editable, by design: error roles and the status / categorical colours. Alerts and
// urgency must read the same for every company, so a body naming them is a 422.

/** camelCase role names, as stored. The CSS variable is `--color-<kebab-case>`. */
export const COLOR_ROLE_IDS = [
  // Brand
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  // Secondary
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  // Tertiary
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  // Surfaces
  'background', 'surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest',
  // Text and lines
  'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant',
] as const;
export type ColorRoleId = (typeof COLOR_ROLE_IDS)[number];

/**
 * Text-on-background pairs that must stay readable: [foreground role, background role, label].
 * Below COLOR_CONTRAST_BLOCK:1 a save is refused; below COLOR_CONTRAST_WARN:1 the editor warns.
 */
export const COLOR_CONTRAST_PAIRS: ReadonlyArray<readonly [ColorRoleId, ColorRoleId, string]> = [
  ['onPrimary', 'primary', 'Primary button'],
  ['onPrimaryContainer', 'primaryContainer', 'Selected menu item'],
  ['onSecondary', 'secondary', 'Secondary button'],
  ['onSecondaryContainer', 'secondaryContainer', 'Secondary chip'],
  ['onTertiary', 'tertiary', 'Tertiary'],
  ['onTertiaryContainer', 'tertiaryContainer', 'Tertiary chip'],
  ['onSurface', 'background', 'Body on page'],
  ['onSurface', 'surfaceContainerLowest', 'Body on card'],
  ['onSurfaceVariant', 'surface', 'Secondary text'],
  ['onSurfaceVariant', 'surfaceContainerHigh', 'Table header'],
  ['primary', 'surface', 'Link on surface'],
];

/** WCAG 2.x contrast ratio under which a save is refused. */
export const COLOR_CONTRAST_BLOCK = 3;
/** WCAG AA for normal text: under this the editor warns (a save is still allowed). */
export const COLOR_CONTRAST_WARN = 4.5;

/** The seed each preset stands for (mirrors THEME_PRESETS in @platform/ui-kit/theme). */
export const BRAND_PRESET_SEEDS: Readonly<Record<string, string>> = {
  'indigo-kinetic': '#4f46e5',
  'pacific-ocean': '#2563eb',
  'teal-horizon': '#0d9488',
  'sky-velocity': '#0284c7',
  'emerald-fit': '#059669',
  'royal-violet': '#7c3aed',
  'electric-amber': '#ea580c',
  'slate-modern': '#0f172a',
};
export const DEFAULT_BRAND_SEED = '#4f46e5';
