import { uuid, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { usersTable } from './users.table';

// Effective-dated HR reporting hierarchy — the source of truth for the leave /
// attendance approval chain. One row = "user reports to manager, in org, for
// [effective_from, effective_to)"; effective_to NULL = the currently-open line.
// A no-overlap exclusion constraint (see db_scripts/21) guarantees at most one
// active line per user per org. Backfilled from iam.users.manager_id, which
// degrades to an optional default and is no longer walked on the approval path.
export const reportingLinesTable = hrSchema.table('reporting_lines', {
  id:            uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:      uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:         uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'cascade' }),
  userId:        uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  managerId:     uuid('manager_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  effectiveFrom: date('effective_from').notNull().defaultNow(),
  effectiveTo:   date('effective_to'),
  isActive:      boolean('is_active').notNull().default(true),
  isDeleted:     boolean('is_deleted').notNull().default(false),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
  deletedBy:     uuid('deleted_by'),
  createdBy:     uuid('created_by'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
