import { z } from 'zod';

// Matches the DB CHECK on entity.tenant_modules.module (db_scripts/03_tables_product.sql).
export const MODULE_KEYS = ['lms', 'leave', 'attendance', 'tasks'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const tenantIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const putTenantModulesSchema = z.object({
  // The full active set — anything not listed is disabled. Matches the
  // checkbox panel this backs: all four are always rendered, checked or not.
  modules: z.array(z.enum(MODULE_KEYS)),
});

export type PutTenantModulesInput = z.infer<typeof putTenantModulesSchema>;
