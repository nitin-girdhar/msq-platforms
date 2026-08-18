import { z } from 'zod';

export const tenantQuerySchema = z.object({
  tenant_id: z.string().uuid(),
});

// The owning tenant arrives as the `tenant_id` QUERY param, like every other
// tenant-scoped lookup route, and is not editable afterwards: moving a
// department between tenants would orphan every role pointing at it.
//
// org_id is OPTIONAL by design — NULL means a tenant-wide department shared by
// all the tenant's orgs (iam.departments, db_scripts/02_tables_core.sql:342).
// It is nullable on update so a department can be widened back to tenant-wide.
export const createDepartmentSchema = z.object({
  org_id: z.string().uuid().nullish(),
  name: z.string().min(1).max(200).trim(),
  label: z.string().min(1).max(200).trim(),
  description: z.string().trim().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type TenantQuery = z.infer<typeof tenantQuerySchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
