import { uuid, text, boolean, integer, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';

// Org-level attendance capture rules (one active row per org). Face-verification
// columns are dormant until the face-verification increment.
export const attendanceRulesTable = hrSchema.table('attendance_rules', {
  id:                    uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:                 uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  geofenceEnabled:       boolean('geofence_enabled').notNull().default(true),
  geofenceRadiusMeters:  integer('geofence_radius_meters').notNull().default(200),
  requirePhoto:          boolean('require_photo').notNull().default(true),
  requireGeo:            boolean('require_geo').notNull().default(true),
  allowWfhCheckin:       boolean('allow_wfh_checkin').notNull().default(false),
  requireFaceMatch:      boolean('require_face_match').notNull().default(false),
  faceMatchThreshold:    numeric('face_match_threshold', { precision: 5, scale: 2 }).notNull().default('85'),
  faceMatchAction:       text('face_match_action').notNull().default('flag'),
  isActive:              boolean('is_active').notNull().default(true),
  isDeleted:             boolean('is_deleted').notNull().default(false),
  deletedAt:             timestamp('deleted_at', { withTimezone: true }),
  deletedBy:             uuid('deleted_by'),
  createdBy:             uuid('created_by'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
