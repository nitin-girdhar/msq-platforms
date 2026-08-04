import { uuid, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { usersTable } from './users.table';

// THE reporting hierarchy for the whole platform. One row = "user reports to
// manager, in org, for [effective_from, effective_to)"; effective_to NULL = the
// currently-open line. A no-overlap exclusion constraint guarantees at most one
// active line per user per org.
//
// Lives in iam, not hr: LMS lead assignment, HR leave/attendance approval and
// Tasks team scope all resolve authority from this one table, and 07_grants.sql
// walls the product schemas off from each other. Query it through
// iam.fn_is_in_subtree / fn_subtree_members / fn_manager_chain, each of which
// takes an as-of date — acting is checked as of today, historical reads pass the
// record's own date.
//
// Cross-org managers exist only via iam.user_org_mapping: a DB trigger requires
// both parties to hold an active mapping in org_id, so a manager shared across
// branches has one mapping and one line per branch. iam.users.manager_id is a
// trigger-maintained display mirror of this table, never an authority source.
export const reportingLinesTable = iamSchema.table('reporting_lines', {
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
