import { sql } from 'drizzle-orm';
import { withServiceTx } from '@crm/db';
import type { DatabaseUser } from '@crm/types';

export async function getUserByEmail(
  email: string,
  org_id?: string,
): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    if (org_id) {
      const rows = (await tx.execute(sql`
        SELECT
          u.id,
          ${org_id}::uuid                           AS org_id,
          u.first_name, u.middle_name, u.last_name, u.full_name,
          u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
          u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
          u.is_deleted,
          u.platform_role,
          COALESCE(uom_r.name,  ur.name)  AS role_name,
          COALESCE(uom_r.label, ur.label) AS role_label,
          COALESCE(uom_r.rank,  ur.rank)  AS rank,
          COALESCE(uom_r.id,    ur.id)    AS role_id,
          m.full_name   AS manager_name,
          tgt.name      AS org_name,
          tgt.tenant_id AS tenant_id,
          t.name        AS tenant_name
        FROM iam.users u
        JOIN iam.user_roles    ur     ON ur.id  = u.role_id
        JOIN entity.organizations home   ON home.id = u.org_id
        JOIN entity.organizations tgt    ON tgt.id  = ${org_id}::uuid AND NOT tgt.is_deleted
        JOIN entity.tenants       t      ON t.id    = home.tenant_id
        LEFT JOIN iam.users    m      ON m.id    = u.manager_id
        LEFT JOIN iam.user_org_mapping uom   ON uom.user_id = u.id
                                        AND uom.org_id  = ${org_id}::uuid
                                        AND uom.is_active
        LEFT JOIN iam.user_roles       uom_r ON uom_r.id = uom.role_id
        WHERE u.email = ${email} AND NOT u.is_deleted
          AND (u.org_id = ${org_id}::uuid OR uom.user_id IS NOT NULL)
        LIMIT 1
      `)) as Array<Record<string, unknown>>;
      return (rows[0] as DatabaseUser | undefined) ?? null;
    }
    const rows = (await tx.execute(sql`
      SELECT
        u.id, u.org_id, u.first_name, u.middle_name, u.last_name, u.full_name,
        u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
        u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
        u.is_deleted,
        u.platform_role,
        ur.name   AS role_name,
        ur.label  AS role_label,
        ur.rank   AS rank,
        u.role_id AS role_id,
        m.full_name AS manager_name,
        o.name      AS org_name,
        o.tenant_id AS tenant_id,
        t.name      AS tenant_name
      FROM iam.users u
      JOIN iam.user_roles    ur ON ur.id = u.role_id
      JOIN entity.organizations o  ON o.id  = u.org_id
      JOIN entity.tenants       t  ON t.id  = o.tenant_id
      LEFT JOIN iam.users    m  ON m.id  = u.manager_id
      WHERE u.email = ${email} AND NOT u.is_deleted
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    return (rows[0] as DatabaseUser | undefined) ?? null;
  });
}

// When org_id is provided, resolves the user IN THE CONTEXT OF that org:
// org_id/org_name reflect the target org and the role comes from the active
// iam.user_org_mapping row (falling back to the user's default role for their
// home org). Returns null when the user has no access to the target org —
// callers treat that as a denied branch switch / stale session.
export async function getUserById(id: string, org_id?: string): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    if (org_id) {
      const rows = (await tx.execute(sql`
        SELECT
          u.id,
          ${org_id}::uuid                           AS org_id,
          u.first_name, u.middle_name, u.last_name, u.full_name,
          u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
          u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
          u.is_deleted,
          u.platform_role,
          COALESCE(uom_r.name,  ur.name)  AS role_name,
          COALESCE(uom_r.label, ur.label) AS role_label,
          COALESCE(uom_r.rank,  ur.rank)  AS rank,
          COALESCE(uom_r.id,    ur.id)    AS role_id,
          m.full_name   AS manager_name,
          tgt.name      AS org_name,
          tgt.tenant_id AS tenant_id,
          t.name        AS tenant_name
        FROM iam.users u
        JOIN iam.user_roles    ur     ON ur.id  = u.role_id
        JOIN entity.organizations home   ON home.id = u.org_id
        JOIN entity.organizations tgt    ON tgt.id  = ${org_id}::uuid AND NOT tgt.is_deleted
        JOIN entity.tenants       t      ON t.id    = home.tenant_id
        LEFT JOIN iam.users    m      ON m.id    = u.manager_id
        LEFT JOIN iam.user_org_mapping uom   ON uom.user_id = u.id
                                        AND uom.org_id  = ${org_id}::uuid
                                        AND uom.is_active
        LEFT JOIN iam.user_roles       uom_r ON uom_r.id = uom.role_id
        WHERE u.id = ${id}::uuid AND NOT u.is_deleted
          AND (u.org_id = ${org_id}::uuid OR uom.user_id IS NOT NULL)
        LIMIT 1
      `)) as Array<Record<string, unknown>>;
      return (rows[0] as DatabaseUser | undefined) ?? null;
    }
    const rows = (await tx.execute(sql`
      SELECT
        u.id, u.org_id, u.first_name, u.middle_name, u.last_name, u.full_name,
        u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
        u.password_changed_at, u.last_login_at, u.manager_id, u.created_at, u.updated_at,
        u.is_deleted,
        u.platform_role,
        ur.name   AS role_name,
        ur.label  AS role_label,
        ur.rank   AS rank,
        u.role_id AS role_id,
        m.full_name AS manager_name,
        o.name      AS org_name,
        o.tenant_id AS tenant_id,
        t.name      AS tenant_name
      FROM iam.users u
      JOIN iam.user_roles    ur ON ur.id = u.role_id
      JOIN entity.organizations o  ON o.id  = u.org_id
      JOIN entity.tenants       t  ON t.id  = o.tenant_id
      LEFT JOIN iam.users    m  ON m.id  = u.manager_id
      WHERE u.id = ${id}::uuid AND NOT u.is_deleted
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    return (rows[0] as DatabaseUser | undefined) ?? null;
  });
}

export async function updateLastLogin(user_id: string): Promise<void> {
  await withServiceTx(async (tx) => {
    await tx.execute(sql`
      UPDATE iam.users SET last_login_at = CLOCK_TIMESTAMP() WHERE id = ${user_id}::uuid
    `);
  });
}

export async function changePassword(
  user_id: string,
  new_hash: string,
): Promise<{ password_changed_at: Date } | null> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE iam.users
      SET password_hash = ${new_hash},
          password_changed_at = CLOCK_TIMESTAMP(),
          force_password_change = FALSE
      WHERE id = ${user_id}::uuid
      RETURNING password_changed_at
    `)) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return { password_changed_at: row['password_changed_at'] as Date };
  });
}

export interface UserOrgRow {
  org_id: string;
  org_name: string;
  role_name: string;
  role_label: string;
  rank: number;
  is_home: boolean;
}

// Every branch the user can act in: one row per active iam.user_org_mapping
// entry, plus the home org (iam.users.org_id) even if it has no mapping row
// (legacy users created before mappings were seeded).
export async function getUserOrgs(user_id: string): Promise<UserOrgRow[]> {
  return withServiceTx(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        o.id             AS org_id,
        o.name           AS org_name,
        r.name           AS role_name,
        r.label          AS role_label,
        r.rank           AS rank,
        (o.id = u.org_id) AS is_home
      FROM iam.users u
      JOIN iam.user_org_mapping uom ON uom.user_id = u.id AND uom.is_active
      JOIN entity.organizations o   ON o.id = uom.org_id AND NOT o.is_deleted
      JOIN iam.user_roles r         ON r.id = uom.role_id
      WHERE u.id = ${user_id}::uuid AND NOT u.is_deleted

      UNION

      SELECT o.id, o.name, r.name, r.label, r.rank, TRUE
      FROM iam.users u
      JOIN entity.organizations o ON o.id = u.org_id AND NOT o.is_deleted
      JOIN iam.user_roles r       ON r.id = u.role_id
      WHERE u.id = ${user_id}::uuid AND NOT u.is_deleted
        AND NOT EXISTS (
          SELECT 1 FROM iam.user_org_mapping uom
          WHERE uom.user_id = u.id AND uom.org_id = u.org_id AND uom.is_active
        )
      ORDER BY org_name
    `)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      org_id: String(r['org_id']),
      org_name: String(r['org_name']),
      role_name: String(r['role_name']),
      role_label: String(r['role_label']),
      rank: Number(r['rank']),
      is_home: Boolean(r['is_home']),
    }));
  });
}
