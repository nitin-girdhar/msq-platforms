import { uuid, text, bigint, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';

/**
 * The last "Validate page tokens" result per mapped page (1.70.0). A check is a live
 * Graph call per page, so the outcome is stored and the mapping screen reads it
 * instead of calling Meta on every load. Holds no credential.
 */
export const metaPageHealthTable = extSchema.table('meta_page_health', {
  id:           uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:     uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  pageId:       bigint('page_id', { mode: 'bigint' }).notNull(),
  /** 'ok' | 'missing' | 'expired' | 'error' */
  tokenStatus:  text('token_status').notNull(),
  /** NULL = could not be determined. */
  isSubscribed: boolean('is_subscribed'),
  errorText:    text('error_text'),
  checkedAt:    timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  checkedBy:    uuid('checked_by').references(() => usersTable.id, { onDelete: 'set null' }),
}, (t) => ({
  uqMetaPageHealthTenantPage: unique('uq_meta_page_health_tenant_page').on(t.tenantId, t.pageId),
}));
