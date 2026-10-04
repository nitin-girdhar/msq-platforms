import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Employee 360 personal details (schema 1.60.0). One row per user. Privacy shape: a SELF
// policy for app_user and a tenant_admin policy, and deliberately NO org-wide policy --
// a colleague's date of birth and address are not the org's to read. HR reads/writes
// another person's row through the service transaction after a capability check.
// gender / marital_status / blood_group are CHECK-constrained TEXT (see 03_tables_product.sql).
export const employeePersonalTable = hrSchema.table('employee_personal', {
  userId:           uuid('user_id').primaryKey().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:            uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  preferredName:    text('preferred_name'),
  dateOfBirth:      date('date_of_birth'),
  gender:           text('gender'),
  maritalStatus:    text('marital_status'),
  bloodGroup:       text('blood_group'),
  nationality:      text('nationality'),
  personalEmail:    text('personal_email'),
  currentAddress:   text('current_address'),
  permanentAddress: text('permanent_address'),
  isActive:         boolean('is_active').notNull().default(true),
  isDeleted:        boolean('is_deleted').notNull().default(false),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),
  deletedBy:        uuid('deleted_by'),
  createdBy:        uuid('created_by'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
