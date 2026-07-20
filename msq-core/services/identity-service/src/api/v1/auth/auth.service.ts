import { UnauthorizedError, BadRequestError, ForbiddenError } from '../../../lib/errors.js';
import type { JwtPayload, UserOrgOption, PlatformRole, ProductKey } from '@platform/types';
import { getActiveTenantModulesByTenantId } from '@platform/db';
import { modulesToProducts } from '@platform/authz';
import { comparePassword, hashPassword } from '../../../lib/password.js';
import { signJwt, verifyJwt, revokeJti, isJtiRevoked, revokeAllUserSessions, decodeJwtUnchecked } from '../../../lib/jwt.js';
import { logActivity } from '@platform/audit-log';
import { AUTH_COOKIE_NAME } from '../../../lib/cookies.js';
import * as repo from './auth.repository.js';
import { toSessionUser } from './auth.types.js';
import type { DatabaseUser } from './auth.types.js';
import type { LoginInput } from './auth.schema.js';

export interface LoginResult {
  token: string;
  user: ReturnType<typeof toSessionUser>;
}

// The tenant's licensed products, for the shrunk JWT's licensed_products claim
// (P1.3). A UX convenience for the frontend product switcher; the gateway's
// entitlement gate remains the authoritative DB-backed check.
async function getLicensedProducts(tenantId: string): Promise<ProductKey[]> {
  const modules = await getActiveTenantModulesByTenantId(tenantId);
  return [...modulesToProducts(modules)];
}

// platform_role is backfilled by db_scripts/18; fall back to the least-privileged
// 'member' if a row predates the backfill so a token is never minted without one.
function platformRoleOf(dbUser: { platform_role: string | null }): PlatformRole {
  return (dbUser.platform_role ?? 'member') as PlatformRole;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const db_user = await repo.getUserByEmail(input.email, input.org_id);

  if (!db_user) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: null,
      ...(input.org_id ? { org_id: input.org_id } : {}),
      new_value: { email: input.email, reason: 'user_not_found' },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!db_user.is_active) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: db_user.id,
      org_id: db_user.org_id,
      new_value: { email: input.email, reason: 'account_inactive' },
    });
    throw new UnauthorizedError('Account is deactivated. Please contact your administrator.');
  }

  const password_valid = db_user.password_hash
    ? await comparePassword(input.password, db_user.password_hash)
    : false;

  if (!password_valid) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: db_user.id,
      org_id: db_user.org_id,
      new_value: { email: input.email, reason: 'invalid_password' },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  const pwd_iat = db_user.password_changed_at
    ? Math.floor(new Date(db_user.password_changed_at as unknown as string).getTime() / 1000)
    : 0;

  const token = signJwt({
    sub: db_user.id,
    email: db_user.email,
    platform_role: platformRoleOf(db_user),
    org_id: db_user.org_id,
    tenant_id: db_user.tenant_id,
    licensed_products: await getLicensedProducts(db_user.tenant_id),
    pwd_iat,
    force_password_change: db_user.force_password_change,
  });

  await repo.updateLastLogin(db_user.id);
  await logActivity({ action_type: 'login_success', performed_by: db_user.id, org_id: db_user.org_id });

  return {
    token,
    user: toSessionUser({ ...db_user, last_login_at: new Date() } as DatabaseUser),
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const result = verifyJwt(token);
  if (result.ok && result.payload.jti && result.payload.exp) {
    await revokeJti(result.payload.jti, result.payload.exp, {
      user_id: result.payload.sub,
      org_id: result.payload.org_id,
      tenant_id: result.payload.tenant_id,
    });
    void logActivity({ action_type: 'logout', performed_by: result.payload.sub, org_id: result.payload.org_id });
  }
}

export { AUTH_COOKIE_NAME };

// Verifies the token (signature, revocation, password epoch) and loads the
// user scoped to the org the token was minted for, so role/rank/org_name in
// the session reflect the ACTIVE branch (iam.user_org_mapping), not the
// user's home-org defaults.
async function resolveSession(
  token: string | undefined,
): Promise<{ payload: JwtPayload; db_user: DatabaseUser }> {
  if (!token) throw new UnauthorizedError('Not authenticated');

  const result = verifyJwt(token);
  if (!result.ok) throw new UnauthorizedError('Session expired');

  if (result.payload.jti && await isJtiRevoked(result.payload.jti, {
    user_id: result.payload.sub,
    org_id: result.payload.org_id,
    tenant_id: result.payload.tenant_id,
    ...(result.payload.iat !== undefined ? { issued_at: result.payload.iat } : {}),
  })) {
    throw new UnauthorizedError('Session has been revoked. Please log in again.');
  }

  const db_user = await repo.getUserById(result.payload.sub, result.payload.org_id);
  if (!db_user || !db_user.is_active) {
    throw new UnauthorizedError('User not found or inactive');
  }

  const pwd_iat = db_user.password_changed_at
    ? Math.floor(new Date(db_user.password_changed_at as unknown as string).getTime() / 1000)
    : 0;

  if (result.payload.pwd_iat < pwd_iat) {
    throw new UnauthorizedError('Session invalidated. Please log in again.');
  }

  return { payload: result.payload, db_user };
}

export async function getSession(
  token: string | undefined,
): Promise<ReturnType<typeof toSessionUser>> {
  const { db_user } = await resolveSession(token);
  return toSessionUser(db_user);
}

export async function getMyOrgs(token: string | undefined): Promise<UserOrgOption[]> {
  const { payload } = await resolveSession(token);
  const rows = await repo.getUserOrgs(payload.sub);
  return rows.map((r) => ({
    org_id: r.org_id,
    org_name: r.org_name,
    role: r.role_name as UserOrgOption['role'],
    role_label: r.role_label,
    rank: r.rank,
    is_home: r.is_home,
  }));
}

// Re-mints the session for another branch the user is mapped to. The acting
// user always comes from the verified token; the client only picks WHICH of
// their own branches to act in — access is validated against
// iam.user_org_mapping server-side (via getUserById's org-scoped branch).
export async function switchOrg(
  token: string | undefined,
  org_id: string,
): Promise<LoginResult> {
  const { payload } = await resolveSession(token);

  const db_user = await repo.getUserById(payload.sub, org_id);
  if (!db_user) {
    void logActivity({
      action_type: 'org_switch_denied',
      performed_by: payload.sub,
      org_id,
      new_value: { requested_org_id: org_id },
    });
    throw new ForbiddenError('You do not have access to the selected branch');
  }

  const pwd_iat = db_user.password_changed_at
    ? Math.floor(new Date(db_user.password_changed_at as unknown as string).getTime() / 1000)
    : 0;

  const new_token = signJwt({
    sub: db_user.id,
    email: db_user.email,
    platform_role: platformRoleOf(db_user),
    org_id: db_user.org_id,
    tenant_id: db_user.tenant_id,
    licensed_products: await getLicensedProducts(db_user.tenant_id),
    pwd_iat,
    force_password_change: db_user.force_password_change,
  });

  // Retire the old single-org token so only one active branch exists per session.
  if (payload.jti && payload.exp) {
    await revokeJti(payload.jti, payload.exp, {
      user_id: payload.sub,
      org_id: payload.org_id,
      tenant_id: payload.tenant_id,
    });
  }

  await logActivity({ action_type: 'org_switch', performed_by: db_user.id, org_id: db_user.org_id });

  return { token: new_token, user: toSessionUser(db_user) };
}

export async function changePassword(
  user_id: string,
  current_password: string,
  new_password: string,
): Promise<string> {
  const db_user = await repo.getUserById(user_id);
  if (!db_user) throw new UnauthorizedError('User not found');

  const valid = db_user.password_hash
    ? await comparePassword(current_password, db_user.password_hash)
    : false;

  if (!valid) throw new BadRequestError('Current password is incorrect');

  const new_hash = await hashPassword(new_password);
  const updated = await repo.changePassword(user_id, new_hash);

  const pca = updated?.password_changed_at;
  const pwd_iat = pca ? Math.floor(pca.getTime() / 1000) : Math.floor(Date.now() / 1000);

  const new_token = signJwt({
    sub: db_user.id,
    email: db_user.email,
    platform_role: platformRoleOf(db_user),
    org_id: db_user.org_id,
    tenant_id: db_user.tenant_id,
    licensed_products: await getLicensedProducts(db_user.tenant_id),
    pwd_iat,
    force_password_change: false,
  });

  // Invalidate every previously issued session for this user (other devices,
  // stolen tokens) so the password change takes effect immediately across all
  // services — not just at /auth/me. Scope the revocation to the freshly issued
  // token's iat so the replacement session survives its own revocation.
  const newIat = decodeJwtUnchecked(new_token)?.iat ?? Math.floor(Date.now() / 1000);
  await revokeAllUserSessions(user_id, {
    revokedBy: user_id,
    reason: 'password_changed_self',
    revokedAt: new Date(newIat * 1000),
  });

  await logActivity({ action_type: 'password_changed_self', performed_by: user_id, org_id: db_user.org_id });

  return new_token;
}
