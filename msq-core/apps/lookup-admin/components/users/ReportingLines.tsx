'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageBody, PageHeader, users as usersApi } from '@platform/ui-kit';

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
      <>
        <PageHeader title="Reporting lines" />
        <PageBody>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Reporting lines are per branch. Pick an org in the top bar to see who reports to whom there.
          </p>
        </PageBody>
      </>
    );
  }

  const renderNode = (r: ChartRow, depth: number, seen: Set<string>) => {
    // A cycle is impossible by constraint, but a render must never loop on bad data.
    if (seen.has(r.userId)) return null;
    const nextSeen = new Set(seen).add(r.userId);
    const children = reportsOf.get(r.userId) ?? [];
    return (
      <li key={r.userId}>
        <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-surface-container-low" style={{ marginLeft: depth * 20 }}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-on-surface">{r.fullName || r.email}</span>
            <span className="block truncate text-xs text-on-surface-variant">
              {r.roleName ?? '—'}
              {depth === 0 && r.managerFullName ? ` · reports to ${r.managerFullName} (outside this branch)` : ''}
            </span>
          </span>
          {children.length > 0 && (
            <span className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-[0.6875rem] font-semibold text-on-surface-variant">
              {children.length} direct
            </span>
          )}
        </div>
        {children.length > 0 && <ul>{children.map((c) => renderNode(c, depth + 1, nextSeen))}</ul>}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Reporting lines"
        subtitle={`${branchName} · ${rows.length} ${rows.length === 1 ? 'person' : 'people'} · change someone's manager from their Edit form on the People tab`}
      />
      <PageBody>
      {error && (
        <p role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-4 py-3 text-sm text-on-status-overdue-container">{error}</p>
      )}
      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : !error && rows.length === 0 ? (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
          No one in this branch yet.
        </p>
      ) : (
        <ul className="rounded-xl border border-outline-variant bg-surface-container-lowest p-2">
          {roots.map((r) => renderNode(r, 0, new Set()))}
        </ul>
      )}
      </PageBody>
    </>
  );
}
