import { uuid, text, boolean, timestamp, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketingSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { marketingPlatformsTable } from './marketing-platforms.table';
import { campaignStatusesTable } from './campaign-statuses.table';
import { campaignTypesTable } from './campaign-types.table';

export const adCampaignsTable = marketingSchema.table('ad_campaigns', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  name:       text('name').notNull(),
  platformId: uuid('platform_id').notNull().references(() => marketingPlatformsTable.id, { onDelete: 'restrict' }),
  statusId:   uuid('status_id').notNull().references(() => campaignStatusesTable.id, { onDelete: 'restrict' }),
  budget:     numeric('budget', { precision: 12, scale: 2 }),
  startedAt:  timestamp('started_at', { withTimezone: true }),
  endedAt:    timestamp('ended_at', { withTimezone: true }),
  // The per-branch projection of the type ext.meta_campaigns holds for this
  // Meta campaign. The provisional/confirm workflow columns stay on
  // ext.meta_campaigns; this stays a plain CRM record.
  campaignTypeId: uuid('campaign_type_id')
    .references(() => campaignTypesTable.id, { onDelete: 'restrict' }),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
