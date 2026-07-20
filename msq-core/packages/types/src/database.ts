export interface DatabaseUser {
  id: string;
  org_id: string;
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
  is_active: boolean;
  force_password_change: boolean;
  password_changed_at: Date | null;
  org_name: string;
  tenant_name: string;
  tenant_id: string;
  created_at: Date;
  updated_at: Date;
  is_deleted: boolean;
}
