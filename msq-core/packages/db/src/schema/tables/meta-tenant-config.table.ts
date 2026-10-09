import { uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

export const metaTenantConfigTable = extSchema.table('meta_tenant_config', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  // NULL = the ONE shared row (the single Meta app): its webhook URL omits the integration id and the tenant
  // is resolved from ext.meta_page_form_org_map instead.
  tenantId:          uuid('tenant_id').references(() => tenantsTable.id).unique(),
  appSecret:         text('app_secret').notNull(),
  verifyToken:       text('verify_token').notNull(),
  // DEPRECATED (1.79.0): the dataset is per ad account (ext.meta_datasets) and the token is the platform
  // system user's (ext.meta_platform_credentials). Read only as a fallback until those are entered.
  pixelId:           text('pixel_id'),
  accessToken:       text('access_token'),
  graphApiVersion:   text('graph_api_version').notNull().default('v21.0'),
  isActive:          boolean('is_active').notNull().default(true),
  // Nullable; when absent the service falls back to DEFAULT_FIELD_MAPPINGS in meta.config.ts
  fieldMappings:     jsonb('field_mappings'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
