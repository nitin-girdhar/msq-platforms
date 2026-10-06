// ─────────────────────────────────────────────────────────────────────────────
// Branding & appearance persistence (schema 1.57.0).
//
// Two transaction kinds, deliberately:
//   withRoleTx  — tenant-admin edits, the effective-branding read, and personal
//                 preferences. RLS pins the session to its own tenant / own user
//                 row; column GRANTs keep it to theme + terms + menu; the DB
//                 trigger enforces the theme lock.
//   withServiceTx — SYSTEM operations only, each one documented where it is used:
//                 Super Admin editing a CHOSEN tenant (cross-tenant by design,
//                 rank-gated in the controller, same pattern as admin-service's
//                 tenant-modules), and the pre-login public lookup by public_key
//                 (no session exists; returns display data only).
// ─────────────────────────────────────────────────────────────────────────────
import { sql } from 'drizzle-orm';
import { withRoleTx, withServiceTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';

export interface BrandingRow {
  tenant_id: string;
  public_key: string;
  preset: string | null;
  seed_hex: string | null;
  font: string | null;
  default_mode: string;
  theme_locked: boolean;
  assets: Record<string, { key: string; content_type: string; bytes: number; updated_at: string }>;
  product_names: Record<string, unknown>;
  terms: Record<string, string>;
  nav_overrides: Record<string, { label?: string; icon?: string }>;
  locale_config: Record<string, unknown>;
  branding_version: number;
  updated_at: string;
}

type Row = Record<string, unknown>;

function toBranding(r: Row | undefined): BrandingRow | null {
  if (!r) return null;
  return {
    tenant_id: String(r['tenant_id']),
    public_key: String(r['public_key']),
    preset: (r['preset'] as string | null) ?? null,
    seed_hex: (r['seed_hex'] as string | null) ?? null,
    font: (r['font'] as string | null) ?? null,
    default_mode: String(r['default_mode'] ?? 'light'),
    theme_locked: Boolean(r['theme_locked']),
    assets: (r['assets'] as BrandingRow['assets']) ?? {},
    product_names: (r['product_names'] as Record<string, unknown>) ?? {},
    terms: (r['terms'] as Record<string, string>) ?? {},
    nav_overrides: (r['nav_overrides'] as BrandingRow['nav_overrides']) ?? {},
    locale_config: (r['locale_config'] as Record<string, unknown>) ?? {},
    branding_version: Number(r['branding_version'] ?? 1),
    updated_at: String(r['updated_at']),
  };
}

const COLS = sql`tenant_id, public_key, preset, seed_hex, font, default_mode, theme_locked,
  assets, product_names, terms, nav_overrides, locale_config, branding_version, updated_at`;

// ── Session-scoped (RLS) ──────────────────────────────────────────────────────

/** The caller's own tenant's branding row (RLS returns only that one), or null. */
export async function getOwnBranding(ctx: RoleTxContext): Promise<BrandingRow | null> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`SELECT ${COLS} FROM entity.tenant_branding LIMIT 1`)) as Row[];
    return toBranding(rows[0]);
  });
}

/** The tenant admin's columns: theme only (the DB column GRANTs allow exactly these). */
export interface TenantBrandingWrite {
  preset?: string | null | undefined;
  seed_hex?: string | null | undefined;
  font?: string | null | undefined;
  default_mode?: string | undefined;
}

/**
 * Tenant-admin upsert of the tenant-owned columns only. `tenantId` comes from
 * the verified session (request.auth), never the body; RLS WITH CHECK refuses
 * any other tenant regardless. Only the provided fields change.
 */
export async function upsertTenantBranding(
  ctx: RoleTxContext,
  tenantId: string,
  w: TenantBrandingWrite,
): Promise<BrandingRow | null> {
  const has = (k: keyof TenantBrandingWrite) => Object.prototype.hasOwnProperty.call(w, k);
  return withRoleTx(ctx, async (tx) => {
    const sets = [
      has('preset') ? sql`preset = EXCLUDED.preset` : null,
      has('seed_hex') ? sql`seed_hex = EXCLUDED.seed_hex` : null,
      has('font') ? sql`font = EXCLUDED.font` : null,
      has('default_mode') ? sql`default_mode = EXCLUDED.default_mode` : null,
      sql`updated_by = EXCLUDED.updated_by`,
    ].filter((x): x is ReturnType<typeof sql> => x !== null);
    const rows = (await tx.execute(sql`
      INSERT INTO entity.tenant_branding
        (tenant_id, preset, seed_hex, font, default_mode, updated_by)
      VALUES (
        ${tenantId}::uuid,
        ${w.preset ?? null}, ${w.seed_hex ?? null}, ${w.font ?? null},
        ${w.default_mode ?? 'light'},
        ${ctx.user_id}::uuid
      )
      ON CONFLICT (tenant_id) DO UPDATE SET ${sql.join(sets, sql`, `)}
      RETURNING ${COLS}
    `)) as Row[];
    return toBranding(rows[0]);
  });
}

/** The caller's own appearance override (theme jsonb), or null. */
export async function getOwnPreferences(ctx: RoleTxContext): Promise<Record<string, unknown> | null> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT theme FROM iam.user_preferences
      WHERE user_id = ${ctx.user_id}::uuid
    `)) as Row[];
    return (rows[0]?.['theme'] as Record<string, unknown> | null | undefined) ?? null;
  });
}

/** Set (or clear, with null) the caller's own override. RLS pins user_id. */
export async function setOwnTheme(
  ctx: RoleTxContext,
  tenantId: string,
  theme: Record<string, unknown> | null,
): Promise<void> {
  await withRoleTx(ctx, async (tx) => {
    await tx.execute(sql`
      INSERT INTO iam.user_preferences (user_id, tenant_id, theme)
      VALUES (${ctx.user_id}::uuid, ${tenantId}::uuid, ${theme === null ? null : JSON.stringify(theme)}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET theme = EXCLUDED.theme
    `);
  });
}

// ── System operations (root_service) ──────────────────────────────────────────

/**
 * SYSTEM: Super Admin reading a CHOSEN tenant (cross-tenant by design; the
 * controller has already required rank >= SUPER_ADMIN). Same pattern as
 * admin-service tenant-modules.
 */
export async function getBrandingAsService(tenantId: string): Promise<BrandingRow | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${COLS} FROM entity.tenant_branding WHERE tenant_id = ${tenantId}::uuid
    `)) as Row[];
    return toBranding(rows[0]);
  });
}

/** SYSTEM: does this tenant exist (and is it live)? Super Admin target check. */
export async function tenantExistsAsService(tenantId: string): Promise<{ name: string } | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT name FROM entity.tenants WHERE id = ${tenantId}::uuid AND NOT is_deleted
    `)) as Row[];
    return rows[0] ? { name: String(rows[0]['name']) } : null;
  });
}

export interface SaBrandingWrite extends TenantBrandingWrite {
  theme_locked?: boolean | undefined;
  product_names?: Record<string, unknown> | undefined;
  terms?: Record<string, string> | undefined;
  nav_overrides?: Record<string, unknown> | undefined;
  locale_config?: Record<string, unknown> | undefined;
}

/** SYSTEM: Super Admin upsert (theme, lock, names, words, menu labels, regional formats) for a chosen tenant. */
export async function upsertBrandingAsService(
  tenantId: string,
  actorUserId: string,
  w: SaBrandingWrite,
): Promise<BrandingRow | null> {
  const has = (k: keyof SaBrandingWrite) => Object.prototype.hasOwnProperty.call(w, k);
  return withServiceTx(async (tx) => {
    const sets = [
      has('preset') ? sql`preset = EXCLUDED.preset` : null,
      has('seed_hex') ? sql`seed_hex = EXCLUDED.seed_hex` : null,
      has('font') ? sql`font = EXCLUDED.font` : null,
      has('default_mode') ? sql`default_mode = EXCLUDED.default_mode` : null,
      has('theme_locked') ? sql`theme_locked = EXCLUDED.theme_locked` : null,
      has('product_names') ? sql`product_names = EXCLUDED.product_names` : null,
      has('terms') ? sql`terms = EXCLUDED.terms` : null,
      has('nav_overrides') ? sql`nav_overrides = EXCLUDED.nav_overrides` : null,
      has('locale_config') ? sql`locale_config = EXCLUDED.locale_config` : null,
      sql`updated_by = EXCLUDED.updated_by`,
    ].filter((x): x is ReturnType<typeof sql> => x !== null);
    const rows = (await tx.execute(sql`
      INSERT INTO entity.tenant_branding
        (tenant_id, preset, seed_hex, font, default_mode, theme_locked, product_names,
         terms, nav_overrides, locale_config, updated_by)
      VALUES (
        ${tenantId}::uuid,
        ${w.preset ?? null}, ${w.seed_hex ?? null}, ${w.font ?? null},
        ${w.default_mode ?? 'light'}, ${w.theme_locked ?? false},
        ${JSON.stringify(w.product_names ?? {})}::jsonb,
        ${JSON.stringify(w.terms ?? {})}::jsonb,
        ${JSON.stringify(w.nav_overrides ?? {})}::jsonb,
        ${JSON.stringify(w.locale_config ?? {})}::jsonb,
        ${actorUserId}::uuid
      )
      ON CONFLICT (tenant_id) DO UPDATE SET ${sql.join(sets, sql`, `)}
      RETURNING ${COLS}
    `)) as Row[];
    return toBranding(rows[0]);
  });
}

/** SYSTEM: point a slot at a newly stored blob (or remove it with meta = null). */
export async function setAssetAsService(
  tenantId: string,
  actorUserId: string,
  slot: string,
  meta: { key: string; content_type: string; bytes: number } | null,
): Promise<BrandingRow | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(
      meta
        ? sql`
          INSERT INTO entity.tenant_branding (tenant_id, assets, updated_by)
          VALUES (${tenantId}::uuid,
                  jsonb_build_object(${slot}::text, jsonb_build_object(
                    'key', ${meta.key}::text, 'content_type', ${meta.content_type}::text,
                    'bytes', ${meta.bytes}::int, 'updated_at', CLOCK_TIMESTAMP())),
                  ${actorUserId}::uuid)
          ON CONFLICT (tenant_id) DO UPDATE SET
            assets = entity.tenant_branding.assets || EXCLUDED.assets,
            updated_by = EXCLUDED.updated_by
          RETURNING ${COLS}`
        : sql`
          UPDATE entity.tenant_branding
          SET assets = assets - ${slot}::text, updated_by = ${actorUserId}::uuid
          WHERE tenant_id = ${tenantId}::uuid
          RETURNING ${COLS}`,
    )) as Row[];
    return toBranding(rows[0]);
  });
}

/** SYSTEM: issue a new login-link key; the old link stops resolving at once. */
export async function rotatePublicKeyAsService(tenantId: string, actorUserId: string): Promise<BrandingRow | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      INSERT INTO entity.tenant_branding (tenant_id, updated_by) VALUES (${tenantId}::uuid, ${actorUserId}::uuid)
      ON CONFLICT (tenant_id) DO UPDATE SET public_key = gen_random_uuid(), updated_by = EXCLUDED.updated_by
      RETURNING ${COLS}
    `)) as Row[];
    return toBranding(rows[0]);
  });
}

/**
 * SYSTEM (pre-login): resolve a login-link key to its branding. No session
 * exists yet, so this cannot run under RLS; it returns display data only and
 * the caller (service) further narrows it. An unknown key returns null — the
 * route answers that with the platform default, not a 404, so a probe learns
 * nothing.
 */
export async function getBrandingByPublicKey(publicKey: string): Promise<(BrandingRow & { tenant_name: string }) | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT b.tenant_id, b.public_key, b.preset, b.seed_hex, b.font, b.default_mode, b.theme_locked,
             b.assets, b.product_names, b.terms, b.nav_overrides, b.updated_at, t.name AS tenant_name
      FROM entity.tenant_branding b
      JOIN entity.tenants t ON t.id = b.tenant_id AND t.is_active AND NOT t.is_deleted
      WHERE b.public_key = ${publicKey}::uuid
    `)) as Row[];
    const b = toBranding(rows[0]);
    return b ? { ...b, tenant_name: String(rows[0]!['tenant_name']) } : null;
  });
}
