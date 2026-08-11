'use client';

import { useMemo } from 'react';
import { FIELD_BASE, FIELD_LABEL } from './styles';
import { ALL_DEPARTMENTS, NO_DEPARTMENT, type DepartmentOption, type RoleOption } from './types';

interface Props {
  departmentId: string;
  onDepartmentChange: (id: string) => void;
  roles: RoleOption[];
  departments: DepartmentOption[];
  loading?: boolean;
  disabled?: boolean;
}

/** Roles matching a department filter. Exported — the per-branch rows apply the
 *  same filter to their own selects, and the two must never disagree. */
export function rolesForDepartment(roles: RoleOption[], departmentId: string): RoleOption[] {
  if (departmentId === ALL_DEPARTMENTS) return roles;
  if (departmentId === NO_DEPARTMENT) return roles.filter((r) => !r.department_id);
  return roles.filter((r) => r.department_id === departmentId);
}

/**
 * Filters the role options offered by each branch row below. Stores nothing
 * itself — a user has no department of their own, it reaches them through the
 * role they hold, via iam.user_roles.department_id.
 *
 * "All departments" is the default rather than a first real department because
 * entity.seed_tenant_rbac() clones tenant roles with department_id = NULL: on a
 * freshly provisioned tenant every role is unfiled, and defaulting to a real
 * department would show an empty role list on a form that has to work today.
 */
export default function DepartmentSelect({
  departmentId, onDepartmentChange, roles, departments, loading, disabled,
}: Props) {
  const hasUnfiled = useMemo(() => roles.some((r) => !r.department_id), [roles]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="uf-department" className={FIELD_LABEL}>Department</label>
      <select
        id="uf-department"
        value={departmentId}
        disabled={disabled || loading}
        onChange={(e) => onDepartmentChange(e.target.value)}
        className={FIELD_BASE}
      >
        <option value={ALL_DEPARTMENTS}>All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        {hasUnfiled && <option value={NO_DEPARTMENT}>Unassigned</option>}
      </select>
    </div>
  );
}
