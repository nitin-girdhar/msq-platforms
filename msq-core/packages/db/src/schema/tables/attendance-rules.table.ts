import { uuid, text, boolean, integer, numeric, smallint, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { tenantsTable } from './tenants.table';

// Attendance capture rules. Scoped like hr.hr_settings: org_id NULL = the
// tenant-wide default, an org row overrides it, at most one row per scope.
// Face-verification columns are dormant until the face-verification increment.
export const attendanceRulesTable = hrSchema.table('attendance_rules', {
  id:                    uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:              uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  // NULL = the tenant-wide default, applying to every org without its own row.
  orgId:                 uuid('org_id').references(() => organizationsTable.id, { onDelete: 'restrict' }),
  geofenceEnabled:       boolean('geofence_enabled').notNull().default(true),
  geofenceRadiusMeters:  integer('geofence_radius_meters').notNull().default(200),
  requirePhoto:          boolean('require_photo').notNull().default(true),
  requireGeo:            boolean('require_geo').notNull().default(true),
  allowWfhCheckin:       boolean('allow_wfh_checkin').notNull().default(false),
  requireFaceMatch:      boolean('require_face_match').notNull().default(false),
  faceMatchThreshold:    numeric('face_match_threshold', { precision: 5, scale: 2 }).notNull().default('85'),
  faceMatchAction:       text('face_match_action').notNull().default('flag'),
  // Min days before a member may self-change their reference photo (admins bypass).
  photoChangeCooldownDays: integer('photo_change_cooldown_days').notNull().default(30),
  // Days daily check-in/out selfies are retained before the cleanup job deletes
  // them; does NOT apply to the enrolled reference photo (avatar).
  imageRetentionDays:    integer('image_retention_days').notNull().default(90),
  // Org-level day-classification fallback. Precedence: the employee's assigned
  // shift wins, then these, then the service's DEFAULT_THRESHOLDS constant.
  minHalfDayMinutes:     smallint('min_half_day_minutes').notNull().default(240),
  minFullDayMinutes:     smallint('min_full_day_minutes').notNull().default(480),
  // Levels of the iam.reporting_lines chain that must approve a regularization —
  // the counterpart of hr.leave_policies.approval_levels. 1 = direct manager.
  regularizationApprovalLevels:   smallint('regularization_approval_levels').notNull().default(1),
  // How many days back a regularization may be filed, in the ORG's timezone.
  // 0 = today only. Future work_dates are always rejected (service-side rule).
  regularizationMaxBackdateDays:  smallint('regularization_max_backdate_days').notNull().default(30),
  isActive:              boolean('is_active').notNull().default(true),
  isDeleted:             boolean('is_deleted').notNull().default(false),
  deletedAt:             timestamp('deleted_at', { withTimezone: true }),
  deletedBy:             uuid('deleted_by'),
  createdBy:             uuid('created_by'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
