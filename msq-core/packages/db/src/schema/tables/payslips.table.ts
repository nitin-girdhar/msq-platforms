import { uuid, text, boolean, timestamp, date, numeric, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Payslips (schema 1.62.0). Salary data: NO org-wide policy. An employee reads only their own
// payslip and only once published (self policy with published_at IS NOT NULL); HR drafts,
// publishes and reads others' through the service transaction. Totals are computed by the
// service from the lines, never taken from the client.
export const payslipsTable = hrSchema.table('payslips', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  userId:      uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  period:      date('period').notNull(),
  workingDays: numeric('working_days', { precision: 4, scale: 1 }),
  lopDays:     numeric('lop_days', { precision: 4, scale: 1 }),
  gross:       numeric('gross', { precision: 12, scale: 2 }).notNull().default('0'),
  deductions:  numeric('deductions', { precision: 12, scale: 2 }).notNull().default('0'),
  net:         numeric('net', { precision: 12, scale: 2 }).notNull().default('0'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => usersTable.id, { onDelete: 'set null' }),
  isActive:    boolean('is_active').notNull().default(true),
  isDeleted:   boolean('is_deleted').notNull().default(false),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   uuid('deleted_by'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Earning / deduction rows of a payslip. Readable exactly when the payslip is.
export const payslipLinesTable = hrSchema.table('payslip_lines', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  payslipId: uuid('payslip_id').notNull().references(() => payslipsTable.id, { onDelete: 'cascade' }),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  // earning | deduction
  kind:      text('kind').notNull(),
  label:     text('label').notNull(),
  amount:    numeric('amount', { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
