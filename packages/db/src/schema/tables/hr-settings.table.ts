import { uuid, smallint, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';

// Leave-cycle configuration. org_id NULL = tenant-wide default; org row overrides.
export const hrSettingsTable = hrSchema.table('hr_settings', {
  id:                   uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:             uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:                uuid('org_id').references(() => organizationsTable.id, { onDelete: 'cascade' }),
  // 4 = April–March financial year (India FY default)
  leaveCycleStartMonth: smallint('leave_cycle_start_month').notNull().default(4),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
