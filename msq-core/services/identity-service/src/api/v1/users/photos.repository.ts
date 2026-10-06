// ─────────────────────────────────────────────────────────────────────────────
// Profile-photo persistence. Bytes live in @platform/blob-storage (one volume
// shared with hr-service); iam.users holds only the opaque key + consent
// metadata. Keys are immutable and time-stamped —
// `<tenant>/<branch>/<employee>/avatar/<epochMs>.ext` (blobKeys.avatar; branch is
// the user's home org at upload time) — so the newest key is the active photo and
// a replaced photo's bytes are left on disk (audit trail), while the DB always
// points at exactly one current file. The stored key is authoritative: it is
// never re-derived, so a later branch transfer cannot orphan the file.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { withRoleTx } from '@platform/db';
import type { RoleTxContext } from '@platform/db';
import { blobKeys, detectImageExt } from '@platform/blob-storage';
import { blobStore } from '../../../lib/blob.js';

export interface StoredPhoto {
  user_id: string;
  photo_key: string;
  photo_content_type: string | null;
  photo_uploaded_at: string;
}

/**
 * Store bytes under the target user and repoint iam.users at the new key.
 * The UPDATE is RLS-scoped by `ctx`: an actor who can't see/modify the target
 * row (cross-org, or beyond their rank per the app-layer guard) affects zero
 * rows and gets a null back, which the service turns into a 404/403.
 */
export async function putPhoto(
  ctx: RoleTxContext,
  targetUserId: string,
  photo: Buffer,
): Promise<StoredPhoto | null> {
  const ext = detectImageExt(photo);
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  return withRoleTx(ctx, async (tx) => {
    // The target's home branch, read under RLS: an actor who cannot see the user
    // gets null here before any bytes are written. The tenant is the caller's own
    // (verified session), never taken from the request.
    const homes = (await tx.execute(sql`
      SELECT org_id::text AS org_id FROM iam.users WHERE id = ${targetUserId} AND NOT is_deleted
    `)) as unknown as Array<{ org_id: string }>;
    const branchId = homes[0]?.org_id;
    if (!branchId) return null;

    const key = blobKeys.avatar(ctx.tenant_id, branchId, targetUserId, ext);
    await blobStore().putAt(key, photo);

    const rows = (await tx.execute(sql`
      UPDATE iam.users
      SET photo_key = ${key}, photo_content_type = ${contentType},
          photo_uploaded_at = CLOCK_TIMESTAMP(), photo_uploaded_by = ${ctx.user_id},
          photo_consent_at = CLOCK_TIMESTAMP(), updated_at = CLOCK_TIMESTAMP()
      WHERE id = ${targetUserId} AND NOT is_deleted
      RETURNING id::text AS user_id, photo_key, photo_content_type, photo_uploaded_at::text
    `)) as unknown as StoredPhoto[];
    return rows[0] ?? null;
  });
}

/** Current photo key + content-type for a user the caller may see (RLS-scoped). */
export async function loadPhotoKey(
  ctx: RoleTxContext,
  targetUserId: string,
): Promise<{ key: string; content_type: string | null } | null> {
  return withRoleTx(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT photo_key, photo_content_type FROM iam.users
      WHERE id = ${targetUserId} AND NOT is_deleted
    `)) as unknown as Array<{ photo_key: string | null; photo_content_type: string | null }>;
    const row = rows[0];
    if (!row || !row.photo_key) return null;
    return { key: row.photo_key, content_type: row.photo_content_type };
  });
}

/** Fetch bytes from blob storage by key. */
export async function readPhotoBytes(key: string): Promise<Buffer | null> {
  return blobStore().get(key);
}
