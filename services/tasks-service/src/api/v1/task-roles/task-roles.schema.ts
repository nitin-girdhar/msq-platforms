import { z } from 'zod';

export const createTaskRoleSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  rank: z.number().int().min(0).max(100),
  sort_order: z.number().int().default(0),
});

export const updateTaskRoleSchema = createTaskRoleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// tenant_id is routing/scoping context (which tenant's catalog a super_admin is
// editing), not a stored field on the entity — carried as a query param on
// every route (GET/POST/PATCH) rather than in the body schema.
export const tenantScopedQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export type CreateTaskRoleInput = z.infer<typeof createTaskRoleSchema>;
export type UpdateTaskRoleInput = z.infer<typeof updateTaskRoleSchema>;
export type TenantScopedQuery = z.infer<typeof tenantScopedQuerySchema>;
