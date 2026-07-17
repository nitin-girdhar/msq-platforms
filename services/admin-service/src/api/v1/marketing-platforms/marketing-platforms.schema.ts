import { z } from 'zod';

export const createMarketingPlatformSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateMarketingPlatformSchema = createMarketingPlatformSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateMarketingPlatformInput = z.infer<typeof createMarketingPlatformSchema>;
export type UpdateMarketingPlatformInput = z.infer<typeof updateMarketingPlatformSchema>;
