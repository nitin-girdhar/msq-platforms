import { uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

export const metaTenantConfigTable = extSchema.table('meta_tenant_config', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:          uuid('tenant_id').notNull().references(() => tenantsTable.id).unique(),
  appSecret:         text('app_secret').notNull(),
  verifyToken:       text('verify_token').notNull(),
  pixelId:           text('pixel_id').notNull(),
  accessToken:       text('access_token').notNull(),
  graphApiVersion:   text('graph_api_version').notNull().default('v21.0'),
  isActive:          boolean('is_active').notNull().default(true),
  capiTriggerStages: uuid('capi_trigger_stages').array().notNull().default(sql`'{}'`),
  // Nullable; when absent the service falls back to DEFAULT_FIELD_MAPPINGS in meta.config.ts
  fieldMappings:     jsonb('field_mappings'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
