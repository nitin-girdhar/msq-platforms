import { uuid, text, boolean, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';

/**
 * Every ad account the SHARED Meta integration's token can see
 * (`GET /me/adaccounts`), and whether "Fetch campaigns" walks it (1.51.0).
 *
 * Platform-level — no `tenantId` — because one ad account routinely carries
 * campaigns for several tenants' pages; a tenant owns a campaign (through its
 * promoted pages), never an account. RLS is on with NO app-role policy, so only
 * `root_service` (`withServiceTx`) reaches it, from super_admin routes only.
 */
export const metaAdAccountsTable = extSchema.table('meta_ad_accounts', {
  id:            uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  /** `act_<digits>` */
  adAccountId:   text('ad_account_id').notNull(),
  name:          text('name'),
  businessName:  text('business_name'),
  /** Meta's numeric account status (1 = active). */
  accountStatus: integer('account_status'),
  isEnabled:     boolean('is_enabled').notNull().default(false),
  lastSyncedAt:  timestamp('last_synced_at', { withTimezone: true }),
  lastSeenAt:    timestamp('last_seen_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaAdAccountsAccount: unique('uq_meta_ad_accounts_account').on(t.adAccountId),
}));
