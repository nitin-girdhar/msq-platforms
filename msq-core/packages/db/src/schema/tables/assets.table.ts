import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// HR's equipment inventory (schema 1.63.0). No app_user policy: inventory is HR data and an
// employee sees what they hold through the service transaction (own rows, capability-checked).
// category: laptop | monitor | phone | access_card | other. status: in_stock | assigned | retired.
export const assetsTable = hrSchema.table('assets', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  assetTag:  text('asset_tag').notNull(),
  name:      text('name').notNull(),
  category:  text('category').notNull().default('other'),
  serialNo:  text('serial_no'),
  status:    text('status').notNull().default('in_stock'),
  notes:     text('notes'),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Who holds an asset, from when to when. At most one open assignment per asset.
export const assetAssignmentsTable = hrSchema.table('asset_assignments', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  assetId:    uuid('asset_id').notNull().references(() => assetsTable.id, { onDelete: 'restrict' }),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  assignedOn: date('assigned_on').notNull().defaultNow(),
  returnedOn: date('returned_on'),
  note:       text('note'),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
