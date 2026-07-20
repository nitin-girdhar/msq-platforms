import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Resolver for hr.member_roles — role -> name/label/rank, org_name, user.
// security_invoker: member_roles RLS applies through the view. See db_scripts/17.
export const vwHrMemberRoles = hrSchema.view('vw_member_roles', {
  userId:    uuid('user_id').notNull(),
  userName:  text('user_name'),
  userEmail: text('user_email'),
  orgId:     uuid('org_id').notNull(),
  orgName:   text('org_name'),
  tenantId:  uuid('tenant_id').notNull(),
  roleId:    uuid('role_id').notNull(),
  role:      text('role').notNull(),
  roleLabel: text('role_label').notNull(),
  rank:      integer('rank').notNull(),
  isActive:  boolean('is_active').notNull(),
  grantedBy: uuid('granted_by'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
