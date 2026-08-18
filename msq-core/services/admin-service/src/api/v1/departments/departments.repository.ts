import { asc, eq, and } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { departmentsTable, organizationsTable } from '@platform/db/schema';

type DepartmentInsert = typeof departmentsTable.$inferInsert;
type DepartmentUpdate = Partial<DepartmentInsert>;

// iam.departments is the parent of iam.user_roles: the User Roles form requires
// a department_id, so with no writable surface here a freshly provisioned tenant
// had an empty dropdown and no role could be created at all. Writes therefore
// live here alongside the read, under the super_admin gate the controller
// applies (hr_svc also holds INSERT/UPDATE grants per db_scripts/07_grants.sql,
// but never shipped a UI for it).
//
// is_deleted is filtered on read: the column exists on this table and a
// soft-deleted department must not reappear in a Department dropdown.
export async function list(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        id: departmentsTable.id,
        tenant_id: departmentsTable.tenantId,
        org_id: departmentsTable.orgId,
        // The admin grid renders an fk column from "<relation>_label"/"_name",
        // falling back to the raw id — without this join the Org column would
        // read as a bare UUID. NULL org_id (tenant-wide) leaves both NULL.
        org_label: organizationsTable.brandName,
        org_name: organizationsTable.name,
        name: departmentsTable.name,
        label: departmentsTable.label,
        description: departmentsTable.description,
        is_active: departmentsTable.isActive,
      })
      .from(departmentsTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, departmentsTable.orgId))
      .where(and(eq(departmentsTable.tenantId, tenantId), eq(departmentsTable.isDeleted, false)))
      .orderBy(asc(departmentsTable.label)),
  );
}

// withServiceTx bypasses RLS, so nothing in the transaction stops an org_id
// from another tenant being stored — the service checks it explicitly before
// every write that supplies one.
export async function orgBelongsToTenant(orgId: string, tenantId: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(and(eq(organizationsTable.id, orgId), eq(organizationsTable.tenantId, tenantId)));
    return row !== undefined;
  });
}

export async function findById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(departmentsTable).where(eq(departmentsTable.id, id));
    return row ?? null;
  });
}

export async function create(fields: DepartmentInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(departmentsTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: DepartmentUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx
      .update(departmentsTable)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(departmentsTable.id, id))
      .returning();
    return row ?? null;
  });
}
