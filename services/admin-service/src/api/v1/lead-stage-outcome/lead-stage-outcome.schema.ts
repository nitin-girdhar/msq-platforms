import { z } from 'zod';

export const createLeadStageOutcomeSchema = z.object({
  stage_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
  requires_comment: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export const updateLeadStageOutcomeSchema = createLeadStageOutcomeSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateLeadStageOutcomeInput = z.infer<typeof createLeadStageOutcomeSchema>;
export type UpdateLeadStageOutcomeInput = z.infer<typeof updateLeadStageOutcomeSchema>;
