import { uuid, text, boolean, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// PAN, Aadhaar, UAN, bank account and tax regime (schema 1.64.0). STORED AS PLAIN TEXT for now by
// product decision -- encryption comes later (where the key lives, who may reveal, rotation are open).
// Until then access control is the only defence: self policy + tenant_admin policy, NO org-wide
// policy; the API masks values for everyone except the owner and hr.employees.statutory.manage,
// and each access by someone else is audited. Format CHECKs are in 03_tables_product.sql.
export const employeeStatutoryTable = hrSchema.table('employee_statutory', {
  userId:        uuid('user_id').primaryKey().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:         uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  pan:           text('pan'),
  aadhaar:       text('aadhaar'),
  uan:           text('uan'),
  bankName:      text('bank_name'),
  bankBranch:    text('bank_branch'),
  accountNumber: text('account_number'),
  ifsc:          text('ifsc'),
  // savings | current
  accountType:   text('account_type'),
  // old | new
  taxRegime:     text('tax_regime'),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// An employee's request to change their statutory/bank details; HR approves (the payload is
// applied in the same transaction) or rejects. One open request per person.
export const profileChangeRequestsTable = hrSchema.table('profile_change_requests', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:          uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:           uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  section:         text('section').notNull().default('statutory'),
  payload:         jsonb('payload').notNull(),
  reason:          text('reason'),
  // pending | approved | rejected | cancelled
  status:          text('status').notNull().default('pending'),
  reviewerId:      uuid('reviewer_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actedAt:         timestamp('acted_at', { withTimezone: true }),
  reviewerComment: text('reviewer_comment'),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
