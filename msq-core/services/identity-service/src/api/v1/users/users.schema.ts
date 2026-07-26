import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(500).default(100),
  org_id:    z.string().uuid().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const getAssignableQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  // 'delegation' (default): candidates strictly below the actor's rank — the
  // CRM semantics for handing a lead down the hierarchy.
  // 'collaboration': candidates at or below the actor's rank, including the
  // actor themselves — used by Tasks so a member can assign to same-rank peers
  // and to themselves.
  scope: z.enum(['delegation', 'collaboration']).default('delegation'),
});

export type GetAssignableQuery = z.infer<typeof getAssignableQuerySchema>;

// Profile-photo upload. `photo` is a base64 payload (optionally a data: URI);
// the byte cap is re-checked after decode. `consent` is the user's DPDP
// attestation that this image may be stored and used for face attendance — the
// service rejects a false/absent consent with 422.
// ~2.9M base64 chars ≈ 2.1 MiB decoded, a hair above the 2 MiB byte cap so the
// decoded-size check (not this one) is what rejects an oversize image.
const PHOTO_MAX_B64_CHARS = 2_900_000;

export const uploadPhotoSchema = z.object({
  photo: z.string().min(1).max(PHOTO_MAX_B64_CHARS),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  consent: z.boolean(),
});

export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>;
