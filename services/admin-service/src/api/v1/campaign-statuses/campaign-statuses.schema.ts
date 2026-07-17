import { z } from 'zod';

export const createCampaignStatusSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateCampaignStatusSchema = createCampaignStatusSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateCampaignStatusInput = z.infer<typeof createCampaignStatusSchema>;
export type UpdateCampaignStatusInput = z.infer<typeof updateCampaignStatusSchema>;
