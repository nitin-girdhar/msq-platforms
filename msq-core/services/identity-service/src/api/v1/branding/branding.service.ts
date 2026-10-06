// ─────────────────────────────────────────────────────────────────────────────
// Branding & appearance service (schema 1.57.0). Business rules + audit; DB via
// branding.repository, bytes via @platform/blob-storage.
//
// Who may do what (user decisions, 2026-10-02/03):
//   Super Admin — everything: logos/icons (13 image slots), product names, login link,
//     renamed words, menu labels/icons, regional formats, theme + theme lock.
//   Tenant admin (admin.branding.manage) — colour, font and default light/dark mode only,
//     and only while the theme is unlocked (2026-10-06: images, words, menu and regional
//     settings moved to Super Admin).
//   Everyone (platform.appearance) — a personal theme; while the tenant's theme
//     is locked only their light/dark/system choice and text size are honoured.
// The DB enforces the same split (column grants + lock trigger + RLS), so a bug
// here degrades to an error, never to a write that should not have happened.
// ─────────────────────────────────────────────────────────────────────────────
import type { RoleTxContext } from '@platform/db';
import { hasCapability, hasCapabilityFresh } from '@platform/db';
import { CAPABILITY, type CapabilityKey } from '@platform/rbac';
import { logActivity } from '@platform/audit-log';
import { blobKeys } from '@platform/blob-storage';
import {
  findUnreadablePairs,
  mergeOverrides,
  seedFor,
  type ColorOverrides,
  type ColorOverridesInput,
} from '@platform/validation';
import type {
  BrandAssetSlot,
  SaBrandingUpdateInput,
  TenantBrandingUpdateInput,
  UserThemeUpdateInput,
} from '@platform/validation';
import { AppError, ForbiddenError, HttpStatus, NotFoundError, ValidationError } from '../../../lib/errors.js';
import { BrandAssetError, EXT_FOR_TYPE, decodeAsset, validateBrandAsset } from '../../../lib/brand-assets.js';
import { blobStore, assertOwnKey } from '../../../lib/blob.js';
import { config } from '../../../config/index.js';
import type { EmailBrand } from '../users/user-emails.js';
import * as repo from './branding.repository.js';
import type { BrandingRow } from './branding.repository.js';

export interface Actor {
  ctx: RoleTxContext;
  tenant_id: string;
  role_name: string | null;
  org_id: string;
  user_id: string;
}

class BrandingLockedError extends AppError {
  constructor() {
    super('Colours and font are locked by your platform administrator', HttpStatus.FORBIDDEN, { code: 'BRANDING_THEME_LOCKED' });
  }
}

async function requireCap(a: Actor, key: CapabilityKey, fresh: boolean, message: string): Promise<void> {
  const ok = fresh
    ? await hasCapabilityFresh(a.tenant_id, a.role_name, key)
    : await hasCapability(a.tenant_id, a.role_name, key);
  if (!ok) throw new ForbiddenError(message);
}

/** Gateway-relative URL for a stored asset; the app prefixes its own /api base. */
function assetUrls(b: BrandingRow | null): Record<string, string> {
  if (!b) return {};
  const out: Record<string, string> = {};
  for (const [slot, meta] of Object.entries(b.assets)) {
    const v = encodeURIComponent(String(meta.updated_at ?? b.updated_at));
    out[slot] = `/public/branding/${b.public_key}/assets/${slot}?v=${v}`;
  }
  return out;
}

const THEME_KEYS = ['preset', 'seed_hex', 'font'] as const;

function tenantThemeLayer(b: BrandingRow | null) {
  return b
    ? { preset: b.preset, seed_hex: b.seed_hex, font: b.font, mode: b.default_mode, color_overrides: b.color_overrides }
    : null;
}

/**
 * The readability floor for hand-tuned colours (schema 1.75.0): text must keep 3:1 against its
 * background (WCAG AA is 4.5; the editor warns below that, the server refuses below 3). Checked
 * against the shades the seed really derives for every role the admin did not touch, so it needs
 * the effective seed, not just the overrides. Applies to every writer (tenant admin, Super Admin,
 * a user's own preference).
 */
function assertReadable(seed: string, overrides: ColorOverrides | null | undefined): void {
  const bad = findUnreadablePairs(seed, overrides);
  if (bad.length > 0) {
    throw new ValidationError('Some text would be unreadable with these colours', { code: 'COLOR_CONTRAST', pairs: bad });
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** The seed a write will leave in force: the input's choice where given, else the stored one. */
function effectiveSeed(
  input: { preset?: string | null | undefined; seed_hex?: string | null | undefined },
  current: { preset: string | null; seed_hex: string | null } | null,
): string {
  const touched = 'preset' in input || 'seed_hex' in input;
  return seedFor(touched ? input : { preset: current?.preset ?? null, seed_hex: current?.seed_hex ?? null });
}

// ── /me ──────────────────────────────────────────────────────────────────────

/**
 * Everything a page needs to render the caller's brand + theme. Theme is
 * returned as LAYERS (tenant, then user) for the client's resolveTheme(); the
 * lock is applied HERE: while locked the user layer carries only `mode`.
 */
export async function getMyBranding(a: Actor) {
  const [b, prefs] = await Promise.all([repo.getOwnBranding(a.ctx), repo.getOwnPreferences(a.ctx)]);
  const userLayer = prefs
    ? b?.theme_locked
      // Mode and text size are personal needs, not brand: they survive the lock.
      ? {
          mode: (prefs['mode'] as string | null | undefined) ?? null,
          font_size: (prefs['font_size'] as string | null | undefined) ?? null,
        }
      : prefs
    : null;
  return {
    theme: { tenant: tenantThemeLayer(b), user: userLayer, locked: Boolean(b?.theme_locked) },
    personal: prefs,
    product_names: b?.product_names ?? {},
    terms: b?.terms ?? {},
    nav_overrides: b?.nav_overrides ?? {},
    // Regional formats: tenant-wide, display only ({} = platform default).
    locale: b?.locale_config ?? {},
    branding_version: b?.branding_version ?? 0,
    assets: assetUrls(b),
    public_key: b?.public_key ?? null,
  };
}

export async function updateMyTheme(a: Actor, input: UserThemeUpdateInput) {
  await requireCap(a, CAPABILITY.PLATFORM_APPEARANCE, false, 'Appearance settings are not enabled for your role');
  const b = await repo.getOwnBranding(a.ctx);
  let toStore: UserThemeUpdateInput = input;
  if (b?.theme_locked) {
    // Locked: the user's colours cannot change, so hand-tuned shades are kept exactly as
    // stored whatever the body says (a forged body cannot sneak them in while locked).
    const prev = await repo.getOwnPreferences(a.ctx);
    toStore = { ...input, color_overrides: (prev?.['color_overrides'] as ColorOverridesInput | null | undefined) ?? null };
  } else {
    // Unlocked: the user may fine-tune. On their own colour the company's shades drop away;
    // on the company's colour their shades sit on top of the company's. Either way the
    // result must stay readable.
    const ownSeed = Boolean(input.seed_hex || input.preset);
    const seed = seedFor(ownSeed ? input : { preset: b?.preset ?? null, seed_hex: b?.seed_hex ?? null });
    const effective = ownSeed
      ? (input.color_overrides ?? {})
      : mergeOverrides(b?.color_overrides, input.color_overrides);
    assertReadable(seed, effective);
  }
  // Stored as chosen even while locked — the lock is applied when the theme is
  // RESOLVED (getMyBranding), so unlocking later restores the user's choice.
  await repo.setOwnTheme(a.ctx, a.tenant_id, toStore as Record<string, unknown>);
  return getMyBranding(a);
}

export async function clearMyTheme(a: Actor) {
  await requireCap(a, CAPABILITY.PLATFORM_APPEARANCE, false, 'Appearance settings are not enabled for your role');
  await repo.setOwnTheme(a.ctx, a.tenant_id, null);
  return getMyBranding(a);
}

// ── Tenant admin ─────────────────────────────────────────────────────────────

// Display facts about each uploaded asset — never the blob storage key.
function assetMeta(b: BrandingRow | null): Record<string, { content_type: string; bytes: number; updated_at: string }> {
  const out: Record<string, { content_type: string; bytes: number; updated_at: string }> = {};
  for (const [slot, m] of Object.entries(b?.assets ?? {})) {
    out[slot] = { content_type: m.content_type, bytes: m.bytes, updated_at: m.updated_at };
  }
  return out;
}

function tenantView(b: BrandingRow | null) {
  return {
    theme: tenantThemeLayer(b),
    theme_locked: Boolean(b?.theme_locked),
    // Read-only for the tenant admin (Super Admin owns all of these):
    terms: b?.terms ?? {},
    nav_overrides: b?.nav_overrides ?? {},
    locale_config: b?.locale_config ?? {},
    // Read-only for the tenant admin (Super Admin owns all of these):
    product_names: b?.product_names ?? {},
    assets: assetUrls(b),
    asset_meta: assetMeta(b),
    public_key: b?.public_key ?? null,
    updated_at: b?.updated_at ?? null,
  };
}

export async function getTenantBranding(a: Actor) {
  await requireCap(a, CAPABILITY.ADMIN_BRANDING_VIEW, false, 'Branding is not enabled for your role');
  return tenantView(await repo.getOwnBranding(a.ctx));
}

export async function updateTenantBranding(a: Actor, input: TenantBrandingUpdateInput) {
  await requireCap(a, CAPABILITY.ADMIN_BRANDING_MANAGE, true, 'You cannot change branding');
  const current = await repo.getOwnBranding(a.ctx);
  if (current?.theme_locked) {
    const changesTheme =
      THEME_KEYS.some((k) => k in input && (input[k] ?? null) !== (current[k] ?? null))
      || ('default_mode' in input && input.default_mode !== current.default_mode)
      || ('color_overrides' in input && !sameJson(input.color_overrides, current.color_overrides));
    if (changesTheme) throw new BrandingLockedError();
  }
  // Saved shades are checked against the seed that will be in force: a seed change alone can
  // make a kept override unreadable, so the stored overrides count when none were sent.
  assertReadable(effectiveSeed(input, current), 'color_overrides' in input ? input.color_overrides : current?.color_overrides);
  let updated: BrandingRow | null;
  try {
    updated = await repo.upsertTenantBranding(a.ctx, a.tenant_id, input);
  } catch (err) {
    // The DB trigger is the backstop for a lock set between our read and write.
    if (err instanceof Error && /BRANDING_THEME_LOCKED|locked by the platform administrator/i.test(`${err.message} ${(err as { hint?: string }).hint ?? ''}`)) {
      throw new BrandingLockedError();
    }
    throw err;
  }
  await logActivity({ action_type: 'branding_updated', performed_by: a.user_id, org_id: a.org_id });
  return tenantView(updated);
}

// ── Super Admin (rank-gated in the controller) ───────────────────────────────

async function requireTenant(tenantId: string) {
  const t = await repo.tenantExistsAsService(tenantId);
  if (!t) throw new NotFoundError('Tenant not found');
  return t;
}

function saView(b: BrandingRow | null, tenantName: string) {
  return { ...tenantView(b), tenant_name: tenantName };
}

export async function saGetBranding(tenantId: string) {
  const t = await requireTenant(tenantId);
  return saView(await repo.getBrandingAsService(tenantId), t.name);
}

export async function saUpdateBranding(tenantId: string, a: Actor, input: SaBrandingUpdateInput) {
  const t = await requireTenant(tenantId);
  const current = await repo.getBrandingAsService(tenantId);
  assertReadable(effectiveSeed(input, current), 'color_overrides' in input ? input.color_overrides : current?.color_overrides);
  const updated = await repo.upsertBrandingAsService(tenantId, a.user_id, input);
  await logActivity({ action_type: 'branding_updated_sa', performed_by: a.user_id, org_id: a.org_id });
  return saView(updated, t.name);
}

// Validate + store one brand image and repoint the tenant's row at it. Super Admin
// only (the controller's rank gate): the tenant admin has no image upload. The
// `assets` column is not grantable to application roles, so the row write is a
// documented service-tx system operation (setAssetAsService).
async function storeAsset(tenantId: string, a: Actor, slot: BrandAssetSlot, data: string): Promise<BrandingRow | null> {
  let type;
  let bytes: Buffer;
  try {
    bytes = decodeAsset(data);
    type = validateBrandAsset(slot, bytes);
  } catch (err) {
    if (err instanceof BrandAssetError) throw new ValidationError(err.message, { code: err.code });
    throw err;
  }
  // Immutable, time-stamped key (same convention as avatars): replacing an asset
  // writes a new file and repoints the row, so cached URLs never show stale bytes.
  // `<tenant>/branding/<slot>/<ts>.<ext>` — the tenant id is the route's tenant,
  // which the controller already restricted to the Super Admin's chosen tenant.
  const key = blobKeys.brand(tenantId, slot, EXT_FOR_TYPE[type]);
  await blobStore().putAt(key, bytes);
  const updated = await repo.setAssetAsService(tenantId, a.user_id, slot, { key, content_type: type, bytes: bytes.length });
  await logActivity({ action_type: 'branding_asset_uploaded', performed_by: a.user_id, org_id: a.org_id });
  return updated;
}

async function clearAsset(tenantId: string, a: Actor, slot: BrandAssetSlot): Promise<BrandingRow | null> {
  const updated = await repo.setAssetAsService(tenantId, a.user_id, slot, null);
  await logActivity({ action_type: 'branding_asset_removed', performed_by: a.user_id, org_id: a.org_id });
  return updated ?? (await repo.getBrandingAsService(tenantId));
}

export async function saUploadAsset(tenantId: string, a: Actor, slot: BrandAssetSlot, data: string) {
  const t = await requireTenant(tenantId);
  return saView(await storeAsset(tenantId, a, slot, data), t.name);
}

export async function saDeleteAsset(tenantId: string, a: Actor, slot: BrandAssetSlot) {
  const t = await requireTenant(tenantId);
  return saView(await clearAsset(tenantId, a, slot), t.name);
}

export async function saRotateKey(tenantId: string, a: Actor) {
  const t = await requireTenant(tenantId);
  const updated = await repo.rotatePublicKeyAsService(tenantId, a.user_id);
  await logActivity({ action_type: 'branding_login_link_rotated', performed_by: a.user_id, org_id: a.org_id });
  return saView(updated, t.name);
}

// ── Email identity ───────────────────────────────────────────────────────────

/**
 * The tenant's brand name + email_logo for a notification email. Display only and
 * fail-open: any error (or an unbranded tenant) yields {} and the email uses the
 * platform fallback. System read (no user context — also used by the pre-session
 * "forgot password" mail), keyed by a tenant id the CALLER resolved server-side.
 * The logo URL is absolute and public (the same rate-limited gateway route the login
 * page uses), because a mail client cannot send a session cookie.
 */
export async function loadEmailBrand(tenantId: string): Promise<EmailBrand> {
  try {
    const b = await repo.getBrandingAsService(tenantId);
    if (!b) return {};
    const names = b.product_names as Record<string, { name?: string } | undefined>;
    const name = names['brand']?.name;
    const logo = b.assets['email_logo'];
    const base = config.authWebUrl.replace(/\/+$/, '');
    return {
      ...(name ? { name } : {}),
      ...(logo ? { logoUrl: `${base}/api/public/branding/${b.public_key}/assets/email_logo?v=${encodeURIComponent(String(logo.updated_at))}` } : {}),
    };
  } catch {
    return {};
  }
}

// ── Public (pre-login) ───────────────────────────────────────────────────────

/**
 * Display branding for the login page, by login-link key. Only what the page
 * renders: theme, brand name, product names for the hero chips, asset URLs.
 * No tenant id, no terms/menu, no user data. Unknown key → null (the route
 * answers with the platform default, same shape — a probe learns nothing).
 */
export async function getPublicBranding(publicKey: string) {
  const b = await repo.getBrandingByPublicKey(publicKey);
  if (!b) return null;
  const names = b.product_names as Record<string, { switcher?: string; title?: string } | { name?: string }>;
  const brandName = (names['brand'] as { name?: string } | undefined)?.name ?? b.tenant_name;
  return {
    theme: tenantThemeLayer(b),
    brand_name: brandName,
    product_labels: ['lms', 'hr', 'task', 'admin']
      .map((p) => (names[p] as { switcher?: string } | undefined)?.switcher)
      .filter((x): x is string => Boolean(x)),
    assets: assetUrls(b),
  };
}

/** Asset bytes by login-link key + slot, or null. */
export async function getPublicAsset(publicKey: string, slot: string) {
  const b = await repo.getBrandingByPublicKey(publicKey);
  const meta = b?.assets[slot];
  if (!meta || !b) return null;
  // The pointer must live inside the row's own tenant folder (defence in depth
  // against a tampered/stale `assets` JSON naming another tenant's file).
  assertOwnKey(b.tenant_id, meta.key);
  const bytes = await blobStore().get(meta.key);
  if (!bytes) return null;
  return { bytes, content_type: meta.content_type, key: meta.key };
}
