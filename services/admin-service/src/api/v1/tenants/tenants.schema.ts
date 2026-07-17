import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  domain_id: z.string().uuid(),
  plan_type_id: z.string().uuid(),
});

export const updateTenantSchema = createTenantSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
