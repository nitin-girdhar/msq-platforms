import { z } from 'zod';

export const tenantQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export const roleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const putGrantsSchema = z.object({
  tenant_id: z.string().uuid(),
  grants: z
    .array(
      z.object({
        capability_id: z.string().uuid(),
        is_granted: z.boolean(),
      }),
    )
    .min(1),
});

export type TenantQuery = z.infer<typeof tenantQuerySchema>;
export type RoleIdParams = z.infer<typeof roleIdParamsSchema>;
export type PutGrantsInput = z.infer<typeof putGrantsSchema>;
