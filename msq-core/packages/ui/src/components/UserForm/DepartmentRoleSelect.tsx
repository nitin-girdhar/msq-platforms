'use client';

import { useMemo } from 'react';
import { FIELD_BASE, FIELD_LABEL, HINT } from './styles';
import { ALL_DEPARTMENTS, NO_DEPARTMENT, type DepartmentOption, type RoleOption } from './types';

interface Props {
  departmentId: string;
  onDepartmentChange: (id: string) => void;
  roleId: string;
  onRoleChange: (id: string) => void;
  roles: RoleOption[];
  departments: DepartmentOption[];
  loading?: boolean;
  disabled?: boolean;
  roleLabel?: string;
  roleHint?: string;
}

/** Roles matching a department filter. Exported — the per-branch rows apply the
 *  same filter to their own selects, and the two must never disagree. */
export function rolesForDepartment(roles: RoleOption[], departmentId: string): RoleOption[] {
  if (departmentId === ALL_DEPARTMENTS) return roles;
  if (departmentId === NO_DEPARTMENT) return roles.filter((r) => !r.department_id);
  return roles.filter((r) => r.department_id === departmentId);
}

/**
 * Department filters the role list; only the role is ever stored. A user has no
 * department of their own — it reaches them through the role they hold, via
 * iam.user_roles.department_id.
 *
 * "All departments" is the default rather than a first real department because
 * entity.seed_tenant_rbac() clones tenant roles with department_id = NULL: on a
 * freshly provisioned tenant every role is unfiled, and defaulting to a real
 * department would show an empty role list on a form that has to work today.
 */
export default function DepartmentRoleSelect({
  departmentId, onDepartmentChange, roleId, onRoleChange,
  roles, departments, loading, disabled,
  roleLabel = 'Role', roleHint,
}: Props) {
  const visibleRoles = useMemo(
    () => rolesForDepartment(roles, departmentId),
    [roles, departmentId],
  );

  const hasUnfiled = useMemo(() => roles.some((r) => !r.department_id), [roles]);
  const selectedRole = roles.find((r) => r.id === roleId);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="uf-department" className={FIELD_LABEL}>Department</label>
        <select
          id="uf-department"
          value={departmentId}
          disabled={disabled || loading}
          onChange={(e) => {
            const next = e.target.value;
            onDepartmentChange(next);
            // A role outside the new department would sit invisibly selected,
            // so drop it and let the user re-pick within what they can see.
            if (roleId && !rolesForDepartment(roles, next).some((r) => r.id === roleId)) {
              onRoleChange('');
            }
          }}
          className={FIELD_BASE}
        >
          <option value={ALL_DEPARTMENTS}>All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          {hasUnfiled && <option value={NO_DEPARTMENT}>Unassigned</option>}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="uf-role" className={FIELD_LABEL}>{roleLabel}</label>
        <select
          id="uf-role"
          value={roleId}
          disabled={disabled || loading || visibleRoles.length === 0}
          onChange={(e) => onRoleChange(e.target.value)}
          className={FIELD_BASE}
        >
          <option value="">{loading ? 'Loading roles…' : 'Select a role…'}</option>
          {visibleRoles.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        {roleHint
          ? <p className={HINT}>{roleHint}</p>
          : selectedRole && <p className={HINT}>Rank {selectedRole.rank} · roles above your own are not listed</p>}
        {!loading && visibleRoles.length === 0 && (
          <p className="text-[11px] text-[#B45309]">No roles in this department yet.</p>
        )}
      </div>
    </div>
  );
}
