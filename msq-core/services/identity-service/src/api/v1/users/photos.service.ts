// ─────────────────────────────────────────────────────────────────────────────
// Profile-photo service. Owns authorization + DPDP consent + decode; delegates
// bytes/metadata to photos.repository.
//
//   • Self-upload  — any authenticated user, for their own row.
//   • Admin-upload — actor rank ≥ USER_MGMT_MIN_RANK AND may manage the target
//                    (rank ceiling), e.g. HR changing a report's photo from the
//                    Team screen. No cooldown here — that rule is HR-attendance's
//                    and is enforced in hr-service's face/enroll.
//
// Consent is mandatory (422 on false/absent). Storing the avatar is also storing
// the biometric reference once hr-service enrolls it, so the attestation is
// captured here at the point of upload rather than implied downstream.
// ─────────────────────────────────────────────────────────────────────────────

import type { RoleTxContext } from '@platform/db';
import { canManageUser } from '@platform/authz';
import { logActivity } from '@platform/audit-log';
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from '../../../lib/errors.js';
import { config } from '../../../config/index.js';
import * as repo from './photos.repository.js';
import * as usersRepo from './users.repository.js';
import type { UploadPhotoInput } from './users.schema.js';

const USER_MGMT_MIN_RANK = 40; // matches users.controller.ts

/** Strip an optional data: URI prefix and decode base64, enforcing the byte cap. */
function decodePhoto(photo: string): Buffer {
  const comma = photo.indexOf(',');
  const b64 = photo.startsWith('data:') && comma !== -1 ? photo.slice(comma + 1) : photo;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) throw new BadRequestError('Photo is empty or not valid base64');
  if (buf.length > config.photoMaxBytes) {
    throw new ValidationError('Photo exceeds the maximum allowed size', {
      code: 'PHOTO_TOO_LARGE',
      max_bytes: config.photoMaxBytes,
    });
  }
  return buf;
}

/** Confirm the actor may change another user's photo (rank ceiling). */
async function assertCanManageTarget(actorRank: number, targetUserId: string): Promise<void> {
  if (actorRank < USER_MGMT_MIN_RANK) {
    throw new ForbiddenError('Insufficient permissions to change another user’s photo');
  }
  const target = await usersRepo.getUserByIdAsService(targetUserId);
  if (!target) throw new NotFoundError('User not found');
  const targetRank = Number((target as Record<string, unknown>)['rank'] ?? 0);
  if (!canManageUser(actorRank, targetRank)) {
    throw new ForbiddenError('You cannot manage a user with a higher role');
  }
}

export async function uploadPhoto(
  ctx: RoleTxContext,
  actorRank: number,
  targetUserId: string,
  data: UploadPhotoInput,
): Promise<repo.StoredPhoto> {
  if (!data.consent) {
    throw new ValidationError('Photo-storage consent is required', { code: 'PHOTO_CONSENT_REQUIRED' });
  }
  const isSelf = targetUserId === ctx.user_id;
  if (!isSelf) await assertCanManageTarget(actorRank, targetUserId);

  const buf = decodePhoto(data.photo);
  const stored = await repo.putPhoto(ctx, targetUserId, buf);
  if (!stored) throw new NotFoundError('User not found');

  void logActivity({
    action_type: 'user_photo_uploaded',
    performed_by: ctx.user_id,
    subject_user_id: targetUserId,
    org_id: ctx.org_id,
    new_value: { photo_key: stored.photo_key, self: isSelf },
  });
  return stored;
}

export async function getPhoto(
  ctx: RoleTxContext,
  targetUserId: string,
): Promise<{ key: string; content_type: string | null; bytes: Buffer } | null> {
  const ref = await repo.loadPhotoKey(ctx, targetUserId);
  if (!ref) return null;
  const bytes = await repo.readPhotoBytes(ref.key);
  if (!bytes) return null;
  return { key: ref.key, content_type: ref.content_type, bytes };
}
