'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@platform/ui-kit';
import {
  campaignTypes as campaignTypesApi,
  leadAssignmentRerun,
  orgs as orgsApi,
  type CampaignTypeRow,
  type RerunAssignmentResult,
  type RerunSkipReason,
} from '@/src/lib/api/client';

interface Props {
  tenantId: string;
}

const REASON_LABELS: Record<RerunSkipReason, string> = {
  no_weighted_users: 'nobody weighted in this pool',
  no_department_match: 'weighted users are in another department',
  no_capable_users: 'weighted roles lack LMS access',
};

// Re-routes leads that arrived unassigned once an admin has fixed their pool.
// Always previews first: the Run button acts on exactly the batch the preview
// described (same filters, same cursor), and a new filter change discards the
// preview so a stale one can never be committed.
export default function RerunAssignmentClient({ tenantId }: Props) {
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [types, setTypes] = useState<CampaignTypeRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [orgIds, setOrgIds] = useState<Set<string>>(new Set());
  const [typeIds, setTypeIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const [preview, setPreview] = useState<RerunAssignmentResult | null>(null);
  const [lastRun, setLastRun] = useState<RerunAssignmentResult | null>(null);
  const [pending, setPending] = useState<'preview' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgsApi.listAll()
      .then((res) => {
        if (!cancelled) setOrgs(res.data.filter((o) => o.tenant_id === tenantId).map((o) => ({ id: o.id, name: o.name })));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load branches.');
      });
    campaignTypesApi.list(tenantId)
      .then((res) => {
        if (!cancelled) setTypes(res.data);
      })
      .catch(() => {
        if (!cancelled) setTypes([]);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const body = useMemo(() => ({
    org_ids: [...orgIds],
    campaign_type_ids: [...typeIds],
    ...(cursor ? { cursor } : {}),
  }), [orgIds, typeIds, cursor]);

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    apply(next);
    // A filter change invalidates both the preview and any batch position.
    setPreview(null);
    setCursor(undefined);
  };

  const runPreview = () => {
    setPending('preview');
    setError(null);
    leadAssignmentRerun.run(tenantId, body, true)
      .then((res) => setPreview(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Preview failed.'))
      .finally(() => setPending(null));
  };

  const runForReal = () => {
    setPending('run');
    setError(null);
    leadAssignmentRerun.run(tenantId, body, false)
      .then((res) => {
        setLastRun(res.data);
        setPreview(null);
        // Continue after this batch next time; null when there is nothing more.
        setCursor(res.data.next_cursor ?? undefined);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Run failed.'))
      .finally(() => setPending(null));
  };

  const resetBatches = () => {
    setCursor(undefined);
    setPreview(null);
    setLastRun(null);
  };

  const shown = preview ?? lastRun;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Re-run Auto-Assignment</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Assigns leads that arrived unassigned because their pool had nobody eligible — run it after fixing
          lead weights or a role&apos;s department. Only fills gaps: leads that have an owner or have been worked are
          never touched.
        </p>
      </div>

      {(loadError || error) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {loadError ?? error}
        </div>
      )}

      <div className="grid gap-4 rounded-xl border border-[#E2E8F0] bg-white p-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-[#334155]">Branches (none selected = all)</legend>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {orgs.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-xs text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={orgIds.has(o.id)}
                  disabled={pending !== null}
                  onChange={() => toggle(orgIds, o.id, setOrgIds)}
                  className="h-3.5 w-3.5"
                />
                {o.name}
              </label>
            ))}
            {orgs.length === 0 && !loadError && <p className="text-xs text-[#94A3B8]">Loading branches…</p>}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-[#334155]">Campaign types (none selected = all)</legend>
          <div className="space-y-1">
            {types.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={typeIds.has(t.id)}
                  disabled={pending !== null}
                  onChange={() => toggle(typeIds, t.id, setTypeIds)}
                  className="h-3.5 w-3.5"
                />
                {t.label}
              </label>
            ))}
            {types.length === 0 && <p className="text-xs text-[#94A3B8]">No campaign types loaded.</p>}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending !== null} aria-busy={pending === 'preview'}>
          {pending === 'preview' ? 'Previewing…' : cursor ? 'Preview next batch' : 'Preview'}
        </Button>
        <Button
          variant="primary"
          onClick={runForReal}
          disabled={pending !== null || !preview || preview.assigned === 0}
          aria-busy={pending === 'run'}
        >
          {pending === 'run' ? 'Assigning…' : preview ? `Assign ${preview.assigned} lead${preview.assigned === 1 ? '' : 's'}` : 'Assign'}
        </Button>
        {cursor && (
          <Button variant="secondary" onClick={resetBatches} disabled={pending !== null}>
            Start over
          </Button>
        )}
      </div>

      {shown && (
        <div className="space-y-3 rounded-xl border border-[#E2E8F0] bg-white p-4">
          <p className="text-sm text-[#0F172A]">
            {shown.dry_run ? 'Preview: ' : 'Done: '}
            <strong>{shown.candidates}</strong> unassigned lead{shown.candidates === 1 ? '' : 's'} examined ·{' '}
            <strong>{shown.assigned}</strong> {shown.dry_run ? 'would be' : ''} assigned ·{' '}
            <strong>{shown.left_unassigned}</strong> {shown.dry_run ? 'would stay' : 'still'} unassigned
            {shown.remaining > 0 ? ` · ${shown.remaining} more beyond this batch` : ''}
          </p>
          {shown.by_branch.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[#64748B]">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Branch</th>
                    <th className="py-1 pr-3 font-semibold">Campaign type</th>
                    <th className="py-1 pr-3 font-semibold">Assigned</th>
                    <th className="py-1 pr-3 font-semibold">Unassigned</th>
                    <th className="py-1 font-semibold">Why unassigned</th>
                  </tr>
                </thead>
                <tbody className="text-[#0F172A]">
                  {shown.by_branch.map((b) => (
                    <tr key={`${b.org_id}:${b.campaign_type_id}`} className="border-t border-[#F1F5F9]">
                      <td className="py-1 pr-3">{b.org_name}</td>
                      <td className="py-1 pr-3">{b.campaign_type_label}</td>
                      <td className="py-1 pr-3 tabular-nums">{b.assigned}</td>
                      <td className="py-1 pr-3 tabular-nums">{b.left_unassigned}</td>
                      <td className="py-1 text-[#92400E]">
                        {(Object.keys(b.reasons) as RerunSkipReason[])
                          .filter((r) => b.reasons[r] > 0)
                          .map((r) => `${b.reasons[r]} — ${REASON_LABELS[r]}`)
                          .join('; ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
