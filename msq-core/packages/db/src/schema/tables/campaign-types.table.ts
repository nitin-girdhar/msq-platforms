import { uuid, text, boolean, integer, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketingSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { departmentsTable } from './departments.table';

/**
 * What KIND of campaign this is — sales, hiring, whatever a tenant adds next —
 * and therefore which team its leads route to.
 *
 * `departmentId` NULL means "visible to everyone". A type WITH a department is
 * visible only to users whose role sits in that department, plus anyone holding
 * `lms.leads.view.all_types`. That decision is enforced in the database, by
 * `lms.fn_user_sees_campaign_type()` inside `lms.marketing_leads`' RLS policy —
 * not here, and not in any service. Do not re-implement it in a repository.
 *
 * `tenantId` is NOT NULL, unlike the other tenant-scoped marketing catalogs:
 * there are no `tenant_id IS NULL` template rows to clone, because a template
 * could not carry a department id. `entity.seed_tenant_rbac()` writes the two
 * starter types (`sales`, `hiring`) per tenant instead.
 *
 * `matchKeywords` are matched case-insensitively ON WORD BOUNDARIES against the
 * Meta campaign name by `marketing.fn_match_campaign_type()`. That matcher lives
 * in SQL so the TypeScript and Python intake paths cannot drift — call it, do
 * not port it.
 *
 * At most one `isDefault` row per tenant (partial unique index
 * `uix_campaign_types_one_default`).
 */
export const campaignTypesTable = marketingSchema.table('campaign_types', {
  id:            uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:      uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  label:         text('label').notNull(),
  description:   text('description'),
  departmentId:  uuid('department_id').references(() => departmentsTable.id, { onDelete: 'restrict' }),
  matchKeywords: text('match_keywords').array().notNull().default(sql`'{}'`),
  isDefault:     boolean('is_default').notNull().default(false),
  /** Lower wins when two types match the same campaign name. */
  matchPriority: integer('match_priority').notNull().default(100),
  sortOrder:     integer('sort_order').notNull().default(0),
  isActive:      boolean('is_active').notNull().default(true),
  isDeleted:     boolean('is_deleted').notNull().default(false),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
  deletedBy:     uuid('deleted_by'),
  createdBy:     uuid('created_by'),
  metadata:      jsonb('metadata').notNull().default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqCampaignTypesTenantName: unique('uq_campaign_types_tenant_name').on(t.tenantId, t.name),
}));
