interface Choice {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  departments: Choice[];
  departmentId: string;
  onDepartment: (id: string) => void;
  roles: Choice[];
  roleId: string;
  onRole: (id: string) => void;
  /** Granted / total operations and scopes this role would hold once saved. */
  effective: { granted: number; total: number } | null;
}

function Chips({ items, value, onPick, label }: { items: Choice[]; value: string; onPick: (id: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={value === c.id}
          title={c.hint}
          onClick={() => onPick(c.id)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === c.id
              ? 'border-primary bg-primary-fixed text-primary'
              : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
          }`}
        >
          {c.label}
          {c.hint && <span className="ml-1.5 font-normal opacity-70">{c.hint}</span>}
        </button>
      ))}
    </div>
  );
}

// Department -> role selector, then the role's effective footprint. Tenant comes
// from the top-bar switcher (the same scope every Super Admin screen uses).
export default function RoleContextBar({ departments, departmentId, onDepartment, roles, roleId, onRole, effective }: Props) {
  const pct = effective && effective.total > 0 ? Math.round((effective.granted / effective.total) * 100) : 0;
  return (
    <section className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3" aria-label="Role context">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-24 shrink-0 text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">Department</span>
        <Chips items={departments} value={departmentId} onPick={onDepartment} label="Department" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-24 shrink-0 text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">Role</span>
        {roles.length > 0 ? (
          <Chips items={roles} value={roleId} onPick={onRole} label="Role" />
        ) : (
          <span className="text-xs text-on-surface-variant">No active roles in this department.</span>
        )}
      </div>
      {effective && roleId && (
        <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant pt-2.5 text-xs text-on-surface-variant">
          <span>
            Effective access:{' '}
            <span className="font-mono font-semibold text-on-surface">{effective.granted} / {effective.total}</span>{' '}
            operations &amp; scopes ({pct}%)
          </span>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-container" aria-hidden="true">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}
    </section>
  );
}
