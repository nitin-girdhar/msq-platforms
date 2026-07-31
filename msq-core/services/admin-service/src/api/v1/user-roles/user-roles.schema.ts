import { z } from 'zod';
import { RANK_CEILING } from '@platform/rbac';

// Rank is accepted across the FULL table range here and narrowed in the service
// (assertRank), not clamped to the dynamic band at the edge. The reserved roles
// read_only (0), org_admin (980) and tenant_admin (990) all sit outside
// DYNAMIC_RANK_MIN..DYNAMIC_RANK_MAX, so a band check at this layer would reject
// a legitimate save of their own fixed value before the service ever saw it.
//
// It was previously capped at 100, which could not express the 1..979 tenant
// band at all — most valid roles were uncreatable through the API.
const rankSchema = z.number().int().min(0).max(RANK_CEILING);

// The owning tenant arrives as the `tenant_id` QUERY param, like every other
// tenant-scoped lookup route, not in the body — so it is absent here and on
// update it is not editable at all: moving a role between tenants would orphan
// every user and capability grant pointing at it.
export const createUserRoleSchema = z.object({
  department_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  rank: rankSchema,
});

export const updateUserRoleSchema = createUserRoleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateUserRoleInput = z.infer<typeof createUserRoleSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
