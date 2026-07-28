import { uuid, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { commsSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';

// Cross-product outbound message catalog (db_scripts/02_schema.sql).
//
// Shared tier, not a product schema: every product sends messages, and
// 04_roles_and_grants.sql revokes each product schema from the other products'
// logins — so a catalog living in `lms` would be unreadable to hr_svc/task_svc.
//
// Resolve by (module, channel, name), narrowed by audience, most specific wins:
// org row > tenant row > global row (tenant_id and org_id both NULL).
//
// The two channels are different shapes, enforced by CHECK constraints in the DDL:
//   whatsapp -> providerTemplateName set; subject/bodyTemplate NULL (body lives at Meta)
//   email    -> subject + bodyTemplate set; providerTemplateName NULL (copy lives here)
export const messageTemplatesTable = commsSchema.table('message_templates', {
  id:                   uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:             uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:                uuid('org_id').references(() => organizationsTable.id, { onDelete: 'cascade' }),
  module:               text('module').notNull(),
  channel:              text('channel').notNull(),
  name:                 text('name').notNull(),
  label:                text('label').notNull(),
  description:          text('description'),
  providerTemplateName: text('provider_template_name'),
  languageCode:         text('language_code').notNull().default('en'),
  subject:              text('subject'),
  bodyTemplate:         text('body_template'),
  previewText:          text('preview_text'),
  headerFields:         text('header_fields').array().notNull().default(sql`'{}'`),
  bodyFields:           text('body_fields').array().notNull().default(sql`'{}'`),
  sortOrder:            integer('sort_order').notNull().default(0),
  isActive:             boolean('is_active').notNull().default(true),
  isDeleted:            boolean('is_deleted').notNull().default(false),
  deletedAt:            timestamp('deleted_at', { withTimezone: true }),
  deletedBy:            uuid('deleted_by'),
  createdBy:            uuid('created_by'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
