import { uuid, smallint, timestamp } from 'drizzle-orm/pg-core';
import { lmsSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { userOrgMappingTable } from './user-org-mapping.table';

/**
 * % share of new leads a user auto-receives within one branch.
 *
 * Was `iam.user_org_mapping.lead_assignment_weight` through schema 1.43.0.
 * Moved into the LMS schema because only LMS ever read it, and keeping it on
 * the shared access-control table meant every product wanting a per-branch,
 * per-user setting would add its own column there.
 *
 * No row means weight 0 — the auto-assignment picker filters `weight > 0`, so
 * absence and an explicit zero are the same thing. Read that way everywhere:
 * `COALESCE(weight, 0)`, never a null check.
 *
 * Written by identity-service (user create/edit carries weights in the same
 * payload as the branch/role assignments); read by leads-service.
 */
export const leadAssignmentWeightsTable = lmsSchema.table('lead_assignment_weights', {
  userOrgMappingId: uuid('user_org_mapping_id')
    .primaryKey()
    .references(() => userOrgMappingTable.id, { onDelete: 'cascade' }),
  weight:    smallint('weight').notNull().default(0),
  updatedBy: uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
