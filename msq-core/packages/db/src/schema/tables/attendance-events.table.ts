import { uuid, text, boolean, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Append-only raw punches. INSERT own rows only via app_user; no update/delete
// for non-service roles. Corrections go through regularization, never row edits.
// Face-result columns are dormant until the face-verification increment.
export const attendanceEventsTable = hrSchema.table('attendance_events', {
  id:                 uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:             uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:              uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  eventType:          text('event_type').notNull(),
  occurredAt:         timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  source:             text('source').notNull(),
  geoLat:             numeric('geo_lat', { precision: 9, scale: 6 }),
  geoLng:             numeric('geo_lng', { precision: 9, scale: 6 }),
  distanceFromOrgM:   numeric('distance_from_org_m', { precision: 10, scale: 2 }),
  isWithinGeofence:   boolean('is_within_geofence'),
  isWfh:              boolean('is_wfh').notNull().default(false),
  photoUrl:           text('photo_url'),
  faceMatchScore:     numeric('face_match_score', { precision: 5, scale: 2 }),
  faceMatchPassed:    boolean('face_match_passed'),
  faceReviewStatus:   text('face_review_status'),
  ip:                 text('ip'),
  deviceInfo:         jsonb('device_info'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
