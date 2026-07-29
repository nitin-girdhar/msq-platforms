import { z } from 'zod';

export const tenantQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

export type TenantQuery = z.infer<typeof tenantQuerySchema>;
