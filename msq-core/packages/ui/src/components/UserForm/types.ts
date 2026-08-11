// Shared vocabulary for the Create/Edit user form. Kept in one place because
// admin-web and lms-web both build the same payload and drifted apart last time
// each app owned its own copy of this screen.

export interface RoleOption {
  id: string;
  name: string;
  label: string;
  rank: number;
  department_id: string | null;
  department_label: string | null;
}

export interface DepartmentOption {
  id: string;
  label: string;
}

export interface BranchOption {
  id: string;
  name: string;
}

export interface ManagerCandidate {
  id: string;
  full_name: string;
  email: string;
  role_name: string;
  role_label: string;
  rank: number;
  in_branch: boolean;
}

/** One row of the per-branch table — mirrors iam.user_org_mapping. */
export interface OrgAssignment {
  org_id: string;
  role_id: string;
  lead_assignment_weight: number;
}

/**
 * A branch's current auto-assignment health, shown under its own row.
 *
 * `ok` is reported explicitly rather than left implicit: if only problems spoke,
 * a silent row would be ambiguous between "fine" and "not loaded yet".
 */
export interface WeightStatus {
  status: 'ok' | 'zero' | 'off' | 'loading';
  total: number;
  userCount: number;
}

/** Sentinel for roles a tenant has not filed under any department. */
export const NO_DEPARTMENT = '__none__';
export const ALL_DEPARTMENTS = '__all__';
