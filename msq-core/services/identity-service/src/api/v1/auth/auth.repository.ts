import { sql, type SQL } from 'drizzle-orm';
import { withServiceTx } from '@platform/db';
import type { DatabaseUser } from '@platform/types';

/**
 * Resolves one live user by an arbitrary predicate, in one of two shapes.
 *
 * Built once and shared because the column list, joins and org-scoping rules
 * are identical for every lookup (by email, by mobile, by id) and only the
 * WHERE predicate differs -- four hand-maintained copies had already started
 * drifting. `predicate` is a parameterised drizzle SQL fragment, never a
 * string, so callers cannot inject.
 *
 * With `org_id`, the user is resolved IN THE CONTEXT OF that org: org_id /
 * org_name reflect the target org and the role comes from the active
 * iam.user_org_mapping row, falling back to the user's default role for their
 * home org. Returns null when the user has no access to the target org --
 * callers treat that as a denied branch switch / stale session.
 */
async function findUser(predicate: SQL, org_id?: string): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    if (org_id) {
      const rows = (await tx.execute(sql`
        SELECT
          u.id,
          ${org_id}::uuid                           AS org_id,
          u.first_name, u.middle_name, u.last_name, u.full_name,
          u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
          u.password_changed_at, u.last_login_at, u.locked_until, u.manager_id, u.created_at, u.updated_at,
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
        WHERE ${predicate} AND NOT u.is_deleted
          AND (u.org_id = ${org_id}::uuid OR uom.user_id IS NOT NULL)
        LIMIT 1
      `)) as Array<Record<string, unknown>>;
      return (rows[0] as DatabaseUser | undefined) ?? null;
    }
    const rows = (await tx.execute(sql`
      SELECT
        u.id, u.org_id, u.first_name, u.middle_name, u.last_name, u.full_name,
        u.email, u.mobile, u.password_hash, u.is_active, u.force_password_change,
        u.password_changed_at, u.last_login_at, u.locked_until, u.manager_id, u.created_at, u.updated_at,
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
      WHERE ${predicate} AND NOT u.is_deleted
      LIMIT 1
    `)) as Array<Record<string, unknown>>;
    return (rows[0] as DatabaseUser | undefined) ?? null;
  });
}

export async function getUserByEmail(
  email: string,
  org_id?: string,
): Promise<DatabaseUser | null> {
  return findUser(sql`u.email = ${email}`, org_id);
}

/**
 * `mobile` must already be normalized to E.164 by normalizeMobile() -- the
 * column stores only that form and the unique index is built on it, so an
 * un-normalized argument silently matches nothing.
 */
export async function getUserByMobile(
  mobile: string,
  org_id?: string,
): Promise<DatabaseUser | null> {
  return findUser(sql`u.mobile = ${mobile}`, org_id);
}

export async function getUserById(id: string, org_id?: string): Promise<DatabaseUser | null> {
  return findUser(sql`u.id = ${id}::uuid`, org_id);
}

export async function updateLastLogin(user_id: string): Promise<void> {
  await withServiceTx(async (tx) => {
    await tx.execute(sql`
      UPDATE iam.users
      SET last_login_at         = CLOCK_TIMESTAMP(),
          failed_login_attempts = 0,
          locked_until          = NULL,
          last_failed_login_at  = NULL
      WHERE id = ${user_id}::uuid
    `);
  });
}

/**
 * Increments the consecutive-failure counter and, on crossing the threshold,
 * stamps locked_until. Done in a single statement so concurrent login attempts
 * cannot interleave a read-modify-write and undercount (the row lock taken by
 * UPDATE serialises them).
 *
 * Returns the post-increment state so the caller can log the lockout event.
 */
export async function recordFailedLogin(
  user_id: string,
  maxAttempts: number,
  lockoutMinutes: number,
  attemptWindowMinutes: number,
): Promise<{ failed_login_attempts: number; locked_until: Date | null }> {
  return withServiceTx(async (tx) => {
    // The post-increment count, with decay: if the previous failure is older
    // than the attempt window, the streak is stale and restarts at 1 rather
    // than continuing to accumulate. Built once and interpolated twice below --
    // Postgres evaluates every SET expression against the OLD row, so both
    // copies see identical inputs and yield the same value.
    const nextAttempts = sql`CASE
      WHEN last_failed_login_at IS NULL
        OR last_failed_login_at < CLOCK_TIMESTAMP() - make_interval(mins => ${attemptWindowMinutes}::int)
      THEN 1
      ELSE failed_login_attempts + 1
    END`;

    // Kept as ONE statement: the row lock UPDATE takes serialises concurrent
    // login attempts, so parallel failures cannot interleave a read-modify-write
    // and undercount. A read-then-write (CTE or separate SELECT) would race.
    const rows = (await tx.execute(sql`
      UPDATE iam.users
      SET failed_login_attempts = ${nextAttempts},
          last_failed_login_at  = CLOCK_TIMESTAMP(),
          locked_until = CASE
            WHEN ${nextAttempts} >= ${maxAttempts}::int
            THEN CLOCK_TIMESTAMP() + make_interval(mins => ${lockoutMinutes}::int)
            ELSE NULL
          END
      WHERE id = ${user_id}::uuid
      RETURNING failed_login_attempts, locked_until
    `)) as Array<Record<string, unknown>>;

    const row = rows[0] as { failed_login_attempts: number; locked_until: Date | null } | undefined;
    return row ?? { failed_login_attempts: 0, locked_until: null };
  });
}

/**
 * Clears lockout state. Called after a password change so a user who resets
 * their password is not left locked out by the attempts that preceded it.
 */
export async function clearLockout(user_id: string): Promise<void> {
  await withServiceTx(async (tx) => {
    await tx.execute(sql`
      UPDATE iam.users
      SET failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL
      WHERE id = ${user_id}::uuid
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
