import { z } from 'zod';

export const createLeadSourceSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
});

export const updateLeadSourceSchema = createLeadSourceSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateLeadSourceInput = z.infer<typeof createLeadSourceSchema>;
export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;
