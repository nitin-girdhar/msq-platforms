import { uuid, text, boolean, timestamp, date, jsonb, smallint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { tenantsTable } from './tenants.table';
import { employmentTypesTable } from './employment-types.table';
import { departmentsTable } from './departments.table';
import { designationsTable } from './designations.table';

export const employeeProfilesTable = hrSchema.table('employee_profiles', {
  userId:            uuid('user_id').primaryKey().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:             uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  // Denormalized from entity.organizations.tenant_id via BEFORE trigger; used
  // to enforce employee_code uniqueness per tenant.
  tenantId:          uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'restrict' }),
  employeeCode:      text('employee_code'),
  dateOfJoining:     date('date_of_joining').notNull(),
  dateOfExit:        date('date_of_exit'),
  employmentTypeId:  uuid('employment_type_id').references(() => employmentTypesTable.id, { onDelete: 'restrict' }),
  departmentId:      uuid('department_id').references(() => departmentsTable.id, { onDelete: 'restrict' }),
  designationId:     uuid('designation_id').references(() => designationsTable.id, { onDelete: 'restrict' }),
  probationEndDate:  date('probation_end_date'),
  // 0=Sunday .. 6=Saturday
  weeklyOffPattern:  smallint('weekly_off_pattern').array().notNull().default(sql`'{0,6}'`),
  metadata:          jsonb('metadata').notNull().default({}),
  // Face-verification enrollment (dormant until Prompt 11)
  referencePhotoUrl: text('reference_photo_url'),
  faceSubjectId:     text('face_subject_id'),
  faceEnrolledAt:    timestamp('face_enrolled_at', { withTimezone: true }),
  faceConsentAt:     timestamp('face_consent_at', { withTimezone: true }),
  isActive:          boolean('is_active').notNull().default(true),
  isDeleted:         boolean('is_deleted').notNull().default(false),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
  deletedBy:         uuid('deleted_by'),
  createdBy:         uuid('created_by'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
