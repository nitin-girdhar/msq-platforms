import { uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

/**
 * A Meta business portfolio we are a partner of (1.79.0). Owned by exactly ONE tenant -- the brand is a
 * tenant like any other. Platform-level: RLS on, no app-role policy (root_service only).
 */
export const metaBusinessPortfoliosTable = extSchema.table('meta_business_portfolios', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:       uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  metaBusinessId: text('meta_business_id').notNull(),
  name:           text('name'),
  /** 'BRAND' | 'FRANCHISE' */
  kind:           text('kind').notNull().default('FRANCHISE'),
  /** 'PENDING' | 'ACTIVE' | 'REVOKED' */
  partnerStatus:  text('partner_status').notNull().default('PENDING'),
  verifiedAt:     timestamp('verified_at', { withTimezone: true }),
  lastError:      text('last_error'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaId:    unique('uq_meta_business_portfolios_meta_id').on(t.metaBusinessId),
  uqTenantRow: unique('uq_meta_business_portfolios_tenant_id').on(t.tenantId, t.id),
}));
