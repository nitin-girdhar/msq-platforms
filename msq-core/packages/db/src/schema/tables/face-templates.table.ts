import { uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Encrypted face embeddings for attendance face match (schema 1.81.0). One row per
// (org, user); employee_profiles.face_subject_id points at the active row.
// BIOMETRIC: embedding_enc is AES-256-GCM ciphertext (hr-service FACE_TEMPLATE_KEY;
// CHECK chk_face_templates_encrypted), rows are HARD-deleted on unenrol (no
// is_deleted), there is no audit trigger, and only root_service can reach it
// (RLS forced with no policy). Read and written by hr-service's service tx only.
export const faceTemplatesTable = hrSchema.table(
  'face_templates',
  {
    id:           uuid('id').primaryKey().default(sql`gen_uuidv7()`),
    orgId:        uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
    userId:       uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
    modelVersion: text('model_version').notNull(),
    embeddingEnc: text('embedding_enc').notNull(),
    quality:      jsonb('quality').notNull().default({}),
    createdBy:    uuid('created_by'),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqFaceTemplatesOrgUser: unique('uq_face_templates_org_user').on(t.orgId, t.userId),
  }),
);
