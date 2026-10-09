import { uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';

/**
 * The platform's two Meta system users (1.79.0): LEADS_READ (pages / leads) and CAPI_WRITE (datasets). One
 * ACTIVE row per purpose; rotating a token inserts a new row and flips the old one to ROTATED. The token is
 * AES-256-GCM at rest (`enc:v1:...`) and never leaves the meta-conversion-api service.
 *
 * Platform-level, RLS on with NO app-role policy: only `root_service` (withServiceTx) reaches it.
 */
export const metaPlatformCredentialsTable = extSchema.table('meta_platform_credentials', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  /** 'LEADS_READ' | 'CAPI_WRITE' */
  purpose:         text('purpose').notNull(),
  systemUserId:    text('system_user_id'),
  label:           text('label'),
  accessToken:     text('access_token').notNull(),
  graphApiVersion: text('graph_api_version').notNull().default('v21.0'),
  scopes:          text('scopes').array().notNull().default(sql`'{}'`),
  /** NULL = non-expiring. */
  expiresAt:       timestamp('expires_at', { withTimezone: true }),
  /** 'ACTIVE' | 'ROTATED' | 'REVOKED' */
  status:          text('status').notNull().default('ACTIVE'),
  lastVerifiedAt:  timestamp('last_verified_at', { withTimezone: true }),
  lastError:       text('last_error'),
  createdBy:       uuid('created_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uixActive: uniqueIndex('uix_meta_platform_credentials_active').on(t.purpose).where(sql`status = 'ACTIVE'`),
}));
