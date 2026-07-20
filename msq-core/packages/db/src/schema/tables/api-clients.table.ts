import { uuid, text, integer, boolean, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Scoped credentials for the public/partner API. Tenant-bound; branch scoping
// is via iam.api_client_orgs (see api-client-orgs.table.ts) — zero rows there
// plus scopeAllOrgs = true means tenant-wide. Only the HMAC hash of the raw
// key is stored. Lives in iam, not ext (N-4) — it's a platform/gateway auth
// primitive, not LMS/Meta-integration data.
export const apiClientsTable = iamSchema.table('api_clients', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:        uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:            varchar('name', { length: 120 }).notNull(),
  keyPrefix:       text('key_prefix').notNull(),
  keyHash:         text('key_hash').notNull().unique(),
  scopes:          text('scopes').array().notNull().default(sql`'{}'`),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(60),
  scopeAllOrgs:    boolean('scope_all_orgs').notNull().default(false),
  isActive:        boolean('is_active').notNull().default(true),
  expiresAt:       timestamp('expires_at', { withTimezone: true }),
  lastUsedAt:      timestamp('last_used_at', { withTimezone: true }),
  revokedAt:       timestamp('revoked_at', { withTimezone: true }),
  createdBy:       uuid('created_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
