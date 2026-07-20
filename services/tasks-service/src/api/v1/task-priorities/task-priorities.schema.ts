import { z } from 'zod';

export const createTaskPrioritySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  sort_order: z.number().int().default(0),
});

export const updateTaskPrioritySchema = createTaskPrioritySchema.partial().extend({
  is_active: z.boolean().optional(),
});

// tenant_id is routing/scoping context (which tenant's catalog a super_admin is
// editing), not a stored field on the entity — carried as a query param on
// every route (GET/POST/PATCH) rather than in the body schema.
export const tenantScopedQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export type CreateTaskPriorityInput = z.infer<typeof createTaskPrioritySchema>;
export type UpdateTaskPriorityInput = z.infer<typeof updateTaskPrioritySchema>;
export type TenantScopedQuery = z.infer<typeof tenantScopedQuerySchema>;
