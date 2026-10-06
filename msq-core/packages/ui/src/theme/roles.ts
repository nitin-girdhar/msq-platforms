// Colour roles a tenant or user may fine-tune by hand (schema 1.75.0). Pure data + small
// pure helpers, safe for client and server.
//
// MIRRORS @platform/validation `color-roles.ts` (the server's whitelist and contrast floor).
// theme.test.ts asserts the role list, the contrast pairs and the preset seeds are identical,
// and that the server's derivation (theme-colors.ts) yields the same shades as buildScheme().
//
// What is NOT here, on purpose: error roles and the status / categorical colours. They stay
// fixed so an alert or an overdue badge reads the same for every company.

export const COLOR_ROLE_IDS = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'background', 'surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest',
  'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant',
] as const;
export type ColorRoleId = (typeof COLOR_ROLE_IDS)[number];

export type RoleOverrides = Partial<Record<ColorRoleId, string>>;
/** Sparse per-mode overrides as stored: only the roles somebody changed. */
export interface ColorOverrides {
  light?: RoleOverrides;
  dark?: RoleOverrides;
}

export interface ColorRoleSpec {
  id: ColorRoleId;
  label: string;
  /** Where the colour shows up, for the editor row. */
  hint: string;
}
export interface ColorRoleGroup {
  id: 'brand' | 'secondary' | 'tertiary' | 'surfaces' | 'text';
  title: string;
  roles: ReadonlyArray<ColorRoleSpec>;
}

export const COLOR_ROLE_GROUPS: ReadonlyArray<ColorRoleGroup> = [
  {
    id: 'brand', title: 'Brand', roles: [
      { id: 'primary', label: 'Primary', hint: 'Buttons, links' },
      { id: 'onPrimary', label: 'On primary', hint: 'Text on primary' },
      { id: 'primaryContainer', label: 'Primary container', hint: 'Selected menu item, chips' },
      { id: 'onPrimaryContainer', label: 'On primary container', hint: 'Text on the container' },
    ],
  },
  {
    id: 'secondary', title: 'Secondary', roles: [
      { id: 'secondary', label: 'Secondary', hint: 'Secondary actions' },
      { id: 'onSecondary', label: 'On secondary', hint: 'Text on secondary' },
      { id: 'secondaryContainer', label: 'Secondary container', hint: 'Chips' },
      { id: 'onSecondaryContainer', label: 'On secondary container', hint: 'Text on the container' },
    ],
  },
  {
    id: 'tertiary', title: 'Tertiary', roles: [
      { id: 'tertiary', label: 'Tertiary', hint: 'Accents' },
      { id: 'onTertiary', label: 'On tertiary', hint: 'Text on tertiary' },
      { id: 'tertiaryContainer', label: 'Tertiary container', hint: 'Chips' },
      { id: 'onTertiaryContainer', label: 'On tertiary container', hint: 'Text on the container' },
    ],
  },
  {
    id: 'surfaces', title: 'Surfaces', roles: [
      { id: 'background', label: 'Page background', hint: 'Behind everything' },
      { id: 'surface', label: 'Surface', hint: 'Top bar, inputs' },
      { id: 'surfaceContainerLowest', label: 'Card', hint: 'Cards, panels' },
      { id: 'surfaceContainerLow', label: 'Sidebar / zebra', hint: 'Alternate rows' },
      { id: 'surfaceContainer', label: 'Container', hint: 'Soft fills' },
      { id: 'surfaceContainerHigh', label: 'Container high', hint: 'Table header' },
      { id: 'surfaceContainerHighest', label: 'Container highest', hint: 'Strongest fill' },
    ],
  },
  {
    id: 'text', title: 'Text & lines', roles: [
      { id: 'onSurface', label: 'Body text', hint: 'Main text' },
      { id: 'onSurfaceVariant', label: 'Secondary text', hint: 'Labels, hints' },
      { id: 'outline', label: 'Strong border', hint: 'Inputs' },
      { id: 'outlineVariant', label: 'Default border', hint: 'Cards, dividers' },
    ],
  },
];

/** [foreground, background, label]. Below CONTRAST_BLOCK a save is refused; below CONTRAST_WARN the editor warns. */
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
export const CONTRAST_BLOCK = 3;
export const CONTRAST_WARN = 4.5;

/**
 * Roles that follow another role's override: the page text colour is also `on-background`,
 * which the components use for text directly on the page.
 */
export const ROLE_ALIASES: Partial<Record<ColorRoleId, ReadonlyArray<string>>> = {
  onSurface: ['onBackground'],
};

const ROLE_SET: ReadonlySet<string> = new Set(COLOR_ROLE_IDS);
const HEX_RE = /^#[0-9a-f]{6}$/;

export const isColorRole = (v: string): v is ColorRoleId => ROLE_SET.has(v);

/** camelCase role → the CSS variable theme.css declares (`--color-on-primary`). */
export function cssVarFor(role: string): string {
  return `--color-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Keep only known roles with a well-formed #rrggbb: a stale or hand-edited row degrades to "no override". */
export function sanitizeRoleOverrides(v: unknown): RoleOverrides {
  const out: RoleOverrides = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!isColorRole(k) || typeof val !== 'string') continue;
    const hex = val.trim().toLowerCase();
    if (HEX_RE.test(hex)) out[k] = hex;
  }
  return out;
}

export function sanitizeColorOverrides(v: unknown): ColorOverrides {
  const out: ColorOverrides = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  for (const mode of ['light', 'dark'] as const) {
    const r = sanitizeRoleOverrides(o[mode]);
    if (Object.keys(r).length) out[mode] = r;
  }
  return out;
}

/** `top` over `base`, per mode and role. */
export function mergeColorOverrides(base: ColorOverrides | null | undefined, top: ColorOverrides | null | undefined): ColorOverrides {
  const out: ColorOverrides = {};
  for (const mode of ['light', 'dark'] as const) {
    const merged = { ...(base?.[mode] ?? {}), ...(top?.[mode] ?? {}) };
    if (Object.keys(merged).length) out[mode] = merged;
  }
  return out;
}

export const countOverrides = (o: ColorOverrides | null | undefined): number =>
  Object.keys(o?.light ?? {}).length + Object.keys(o?.dark ?? {}).length;
