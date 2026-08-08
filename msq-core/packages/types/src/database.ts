export interface DatabaseUser {
  id: string;
  org_id: string;
  /** The user's persisted home org (iam.users.org_id), independent of which
   *  org the current session/request is scoped to. `org_id` above tracks the
   *  active context and gets overwritten by findUser() when resolving a user
   *  inside a switched-to org, so callers that need the true home branch
   *  (e.g. computing which branch is "home" in the switcher) must use this
   *  field instead. */
  home_org_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  full_name: string;
  email: string;
  mobile: string | null;
  password_hash: string | null;
  role_id: string;
  role_name: string;
  role_label: string;
  rank: number;
  /** Coarse cross-product role (P1.3) — drives the shrunk JWT's platform_role
   *  claim and PG-role selection. Nullable until the backfill (script 18) runs. */
  platform_role: string | null;
  manager_id: string | null;
  manager_name: string | null;
  last_login_at: Date | null;
  /** Account-level brute-force lockout: when set and in the future, login is
   *  refused before the password compare. Cleared on successful login or
   *  password change. */
  locked_until: Date | null;
  /** Timestamp of the most recent failed login, used to expire a stale
   *  failed-attempt streak (LOGIN_ATTEMPT_WINDOW_MINUTES). */
  last_failed_login_at: Date | null;
  is_active: boolean;
  force_password_change: boolean;
  /** True when iam.users.photo_key is set (a profile photo is stored). */
  has_photo: boolean;
  password_changed_at: Date | null;
  org_name: string;
  tenant_name: string;
  tenant_id: string;
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
}
