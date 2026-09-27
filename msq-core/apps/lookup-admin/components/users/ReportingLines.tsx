'use client';

import { useEffect, useMemo, useState } from 'react';
import { users as usersApi } from '@platform/ui-kit';

interface Props {
  tenantId: string;
  orgId?: string | undefined;
  branchName: string;
}

// One row of GET /users/org-chart — iam.vw_user_org_chart, projected by
// identity-service's getOrgChart (camelCase: it returns the Drizzle select).
interface ChartRow {
  userId: string;
  fullName: string | null;
  email: string;
  managerId: string | null;
  managerFullName: string | null;
  roleName: string | null;
  hierarchyLevel: number | null;
}

// Who reports to whom in ONE branch of the selected tenant. Reporting lines are
// per branch (iam.reporting_lines never crosses an org), so this needs a branch
// picked in the navbar — identity-service refuses the read without one when a
// super admin is working another tenant. Read-only: a manager is changed on the
// user's Edit form (People tab), which validates it against the branch.
export default function ReportingLines({ tenantId, orgId, branchName }: Props) {
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    usersApi.orgChart({ tenant_id: tenantId, org_id: orgId })
      .then((res) => { if (!cancelled) setRows(res.data as ChartRow[]); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load reporting lines.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, orgId]);

  // manager id -> direct reports; roots are people with no manager in this branch
  // (or whose manager is not a member of it, which the view can still name).
  const { roots, reportsOf } = useMemo(() => {
    const ids = new Set(rows.map((r) => r.userId));
    const byManager = new Map<string, ChartRow[]>();
    const top: ChartRow[] = [];
    for (const r of rows) {
      if (r.managerId && ids.has(r.managerId)) {
        const list = byManager.get(r.managerId) ?? [];
        list.push(r);
        byManager.set(r.managerId, list);
      } else {
        top.push(r);
      }
    }
    const byName = (a: ChartRow, b: ChartRow) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email);
    top.sort(byName);
    for (const list of byManager.values()) list.sort(byName);
    return { roots: top, reportsOf: byManager };
  }, [rows]);

  if (!orgId) {
    return (
      <div className="p-4 sm:p-6">
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Reporting lines are per branch. Pick an org in the top bar to see who reports to whom there.
        </p>
      </div>
    );
  }

  const renderNode = (r: ChartRow, depth: number, seen: Set<string>) => {
    // A cycle is impossible by constraint, but a render must never loop on bad data.
    if (seen.has(r.userId)) return null;
    const nextSeen = new Set(seen).add(r.userId);
    const children = reportsOf.get(r.userId) ?? [];
    return (
      <li key={r.userId}>
        <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-[#F8FAFC]" style={{ marginLeft: depth * 20 }}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[#0F172A]">{r.fullName || r.email}</span>
            <span className="block truncate text-xs text-[#64748B]">
              {r.roleName ?? '—'}
              {depth === 0 && r.managerFullName ? ` · reports to ${r.managerFullName} (outside this branch)` : ''}
            </span>
          </span>
          {children.length > 0 && (
            <span className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
              {children.length} direct
            </span>
          )}
        </div>
        {children.length > 0 && <ul>{children.map((c) => renderNode(c, depth + 1, nextSeen))}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Reporting lines</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          {branchName} · change someone&apos;s manager from their Edit form on the People tab.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {loading ? (
        <p className="text-sm text-[#64748B]">Loading…</p>
      ) : !error && rows.length === 0 ? (
        <p className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
          No one in this branch yet.
        </p>
      ) : (
        <ul className="rounded-xl border border-[#E2E8F0] bg-white p-2">
          {roots.map((r) => renderNode(r, 0, new Set()))}
        </ul>
      )}
    </div>
  );
}
