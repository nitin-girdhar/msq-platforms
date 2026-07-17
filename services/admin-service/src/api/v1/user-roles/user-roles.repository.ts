import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import { userRolesTable } from '@crm/db/schema';

type UserRoleInsert = typeof userRolesTable.$inferInsert;
type UserRoleUpdate = Partial<UserRoleInsert>;

export async function list() {
  return withServiceTx((tx) => tx.select().from(userRolesTable).orderBy(asc(userRolesTable.label)));
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
