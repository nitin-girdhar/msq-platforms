import { z } from 'zod';

export const createTenantDomainSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateTenantDomainSchema = createTenantDomainSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateTenantDomainInput = z.infer<typeof createTenantDomainSchema>;
export type UpdateTenantDomainInput = z.infer<typeof updateTenantDomainSchema>;
