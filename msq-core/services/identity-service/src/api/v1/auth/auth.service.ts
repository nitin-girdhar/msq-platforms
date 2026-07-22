import { UnauthorizedError, BadRequestError, ForbiddenError } from '../../../lib/errors.js';
import type { JwtPayload, UserOrgOption, PlatformRole, ProductKey } from '@platform/types';
import { getActiveTenantModulesByTenantId } from '@platform/db';
import { modulesToProducts } from '@platform/authz';
import { normalizeMobile, isMobileLike } from '@platform/validation';
import { comparePassword, hashPassword } from '../../../lib/password.js';
import { signJwt, verifyJwt, revokeJti, isJtiRevoked, revokeAllUserSessions, decodeJwtUnchecked } from '../../../lib/jwt.js';
import { logActivity } from '@platform/audit-log';
import { AUTH_COOKIE_NAME } from '../../../lib/cookies.js';
import * as repo from './auth.repository.js';
import { toSessionUser, sessionUserWithCapabilities } from './auth.types.js';
import type { DatabaseUser } from './auth.types.js';
import type { LoginInput } from './auth.schema.js';
import { config } from '../../../config/index.js';

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

/**
 * Resolves a login identifier that may be an email or a mobile number.
 *
 * An identifier that is neither returns null, which the caller reports as the
 * same generic failure as a wrong password -- a distinct "that is not a valid
 * number" response would confirm which identifiers are even well-formed.
 */
async function resolveLoginUser(
  identifier: string,
  org_id?: string,
): Promise<{ user: DatabaseUser | null; identifier_type: 'email' | 'mobile' }> {
  if (isMobileLike(identifier)) {
    const mobile = normalizeMobile(identifier);
    return {
      user: mobile ? await repo.getUserByMobile(mobile, org_id) : null,
      identifier_type: 'mobile',
    };
  }
  return { user: await repo.getUserByEmail(identifier, org_id), identifier_type: 'email' };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const { identifier, org_id } = input;
  const { user: db_user, identifier_type } = await resolveLoginUser(identifier, org_id);

  // Logged instead of `email`, since the identifier may now be a mobile number.
  // audit.fn_detect_password_spray reads this key (COALESCEd with the legacy
  // `email` for pre-upgrade rows) -- keep the two in sync.
  const audit_target = { identifier, identifier_type };

  if (!db_user) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: null,
      ...(org_id ? { org_id } : {}),
      new_value: { ...audit_target, reason: 'user_not_found' },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  if (!db_user.is_active) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: db_user.id,
      org_id: db_user.org_id,
      new_value: { ...audit_target, reason: 'account_inactive' },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  const lockoutEnabled = config.loginMaxFailedAttempts > 0;

  // Checked BEFORE the bcrypt compare: a locked account must cost an attacker
  // nothing to verify and give them no signal, and skipping the ~100ms hash
  // keeps a lockout from being turned into a CPU-exhaustion lever.
  if (lockoutEnabled && db_user.locked_until && new Date(db_user.locked_until).getTime() > Date.now()) {
    void logActivity({
      action_type: 'login_failure',
      performed_by: db_user.id,
      org_id: db_user.org_id,
      new_value: { ...audit_target, reason: 'account_locked' },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  const password_valid = db_user.password_hash
    ? await comparePassword(input.password, db_user.password_hash)
    : false;

  if (!password_valid) {
    let locked = false;
    if (lockoutEnabled) {
      const state = await repo.recordFailedLogin(
        db_user.id,
        config.loginMaxFailedAttempts,
        config.loginLockoutMinutes,
        config.loginAttemptWindowMinutes,
      );
      locked = state.failed_login_attempts >= config.loginMaxFailedAttempts;
    }
    void logActivity({
      action_type: locked ? 'account_locked' : 'login_failure',
      performed_by: db_user.id,
      org_id: db_user.org_id,
      new_value: {
        ...audit_target,
        reason: locked ? 'lockout_threshold_reached' : 'invalid_password',
      },
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Clear the lockout state FIRST. The password has been verified at this
  // point, so the failure streak is over regardless of what happens next --
  // previously this ran after getLicensedProducts, so a hiccup in that
  // unrelated query left the user's failed-attempt count standing.
  await repo.updateLastLogin(db_user.id);

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

  await logActivity({ action_type: 'login_success', performed_by: db_user.id, org_id: db_user.org_id });

  return {
    token,
    user: await sessionUserWithCapabilities({ ...db_user, last_login_at: new Date() } as DatabaseUser),
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
  return sessionUserWithCapabilities(db_user);
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

  return { token: new_token, user: await sessionUserWithCapabilities(db_user) };
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

  // A user who just proved knowledge of their current password and rotated it
  // should not stay locked out by failures that preceded the change.
  await repo.clearLockout(user_id);

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
