import { uuid, text, numeric, smallint, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { leaveTypesTable } from './leave-types.table';

// org_id NULL = tenant-wide default; an org row overrides it. Effective-dated
// by applicable_from (new row per revision, never mutate history).
export const leavePoliciesTable = hrSchema.table('leave_policies', {
  id:                        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:                  uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:                     uuid('org_id').references(() => organizationsTable.id, { onDelete: 'cascade' }),
  leaveTypeId:               uuid('leave_type_id').notNull().references(() => leaveTypesTable.id, { onDelete: 'restrict' }),
  accrualFrequency:          text('accrual_frequency').notNull().default('none'),
  accrualAmount:             numeric('accrual_amount', { precision: 5, scale: 2 }).notNull().default('0'),
  maxBalance:                numeric('max_balance', { precision: 5, scale: 2 }),
  carryForward:              boolean('carry_forward').notNull().default(false),
  maxCarryForward:           numeric('max_carry_forward', { precision: 5, scale: 2 }),
  maxConsecutiveDays:        smallint('max_consecutive_days'),
  minNoticeDays:             smallint('min_notice_days').notNull().default(0),
  allowHalfDay:              boolean('allow_half_day').notNull().default(true),
  requiresDocumentAfterDays: smallint('requires_document_after_days'),
  approvalLevels:            smallint('approval_levels').notNull().default(1),
  applicableFrom:            date('applicable_from').notNull(),
  isActive:                  boolean('is_active').notNull().default(true),
  isDeleted:                 boolean('is_deleted').notNull().default(false),
  deletedAt:                 timestamp('deleted_at', { withTimezone: true }),
  deletedBy:                 uuid('deleted_by'),
  createdBy:                 uuid('created_by'),
  createdAt:                 timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                 timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
