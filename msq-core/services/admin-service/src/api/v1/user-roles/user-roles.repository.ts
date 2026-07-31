import { asc, eq, and, ne } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { userRolesTable, departmentsTable } from '@platform/db/schema';
import { GLOBAL_ONLY_ROLE } from '@platform/rbac';

type UserRoleInsert = typeof userRolesTable.$inferInsert;
type UserRoleUpdate = Partial<UserRoleInsert>;

// Roles owned by ONE tenant. This ran unfiltered until now — and because
// withServiceTx bypasses RLS, the admin console received every tenant's rows
// flattened into a single list, which read as duplicate roles (the same name
// legitimately exists once per tenant).
//
// super_admin is excluded by name as well as by the tenant filter. The filter
// alone is already enough post-_migrations/23 (it is the only global row left),
// but naming it makes the intent explicit and keeps a stray global row from ever
// reaching a list the console assigns roles from.
export async function list(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select({
        id: userRolesTable.id,
        tenant_id: userRolesTable.tenantId,
        department_id: userRolesTable.departmentId,
        // The admin grid renders an fk column from "<relation>_label"/"_name",
        // falling back to the raw id — so without this join the Department
        // column would read as a bare UUID.
        department_label: departmentsTable.label,
        department_name: departmentsTable.name,
        name: userRolesTable.name,
        label: userRolesTable.label,
        description: userRolesTable.description,
        rank: userRolesTable.rank,
        is_active: userRolesTable.isActive,
      })
      .from(userRolesTable)
      .leftJoin(departmentsTable, eq(departmentsTable.id, userRolesTable.departmentId))
      .where(and(eq(userRolesTable.tenantId, tenantId), ne(userRolesTable.name, GLOBAL_ONLY_ROLE)))
      .orderBy(asc(userRolesTable.rank), asc(userRolesTable.label)),
  );
}

export async function findById(id: string) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.select().from(userRolesTable).where(eq(userRolesTable.id, id));
    return row ?? null;
  });
}

export async function create(fields: UserRoleInsert) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.insert(userRolesTable).values(fields).returning();
    return row;
  });
}

export async function update(id: string, fields: UserRoleUpdate) {
  return withServiceTx(async (tx) => {
    const [row] = await tx.update(userRolesTable).set(fields).where(eq(userRolesTable.id, id)).returning();
    return row ?? null;
  });
}
