import { z } from 'zod';

export const createTenantPlanTypeSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateTenantPlanTypeSchema = createTenantPlanTypeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateTenantPlanTypeInput = z.infer<typeof createTenantPlanTypeSchema>;
export type UpdateTenantPlanTypeInput = z.infer<typeof updateTenantPlanTypeSchema>;
