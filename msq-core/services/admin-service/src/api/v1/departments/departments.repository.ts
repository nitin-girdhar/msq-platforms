import { asc, eq } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import { departmentsTable } from '@platform/db/schema';

// Read-only: iam.departments is written by HR (hr_svc) per db_scripts/06_rls.sql
// GRANT INSERT, UPDATE ... TO app_user, hr_svc — a role-creation form here only
// needs the list to populate its Department dropdown.
export async function list(tenantId: string) {
  return withServiceTx((tx) =>
    tx
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.tenantId, tenantId))
      .orderBy(asc(departmentsTable.label)),
  );
}
