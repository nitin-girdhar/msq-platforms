'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, PageBody, PageHeader } from '@platform/ui-kit';
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
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
}

const REASON_LABELS: Record<RerunSkipReason, string> = {
  no_campaign_type: 'the tenant has no default campaign type',
  no_weighted_users: 'nobody weighted in this pool',
  no_department_match: 'weighted users are in another department',
  no_capable_users: 'weighted roles lack LMS access',
};

// Re-routes leads that arrived unassigned once an admin has fixed their pool.
// Always previews first: the Run button acts on exactly the batch the preview
// described (same filters, same cursor), and a new filter change discards the
// preview so a stale one can never be committed.
export default function RerunAssignmentClient({ tenantId, tenantName }: Props) {
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

  const card = 'rounded-xl border border-outline-variant bg-surface-container-lowest';
  const optionRow = 'flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-on-surface hover:bg-surface-container-low sm:min-h-8 sm:text-xs';
  const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-on-primary';

  return (
    <>
      <PageHeader
        title="Re-run Auto-Assignment"
        scope={tenantName}
        subtitle="Assign leads that arrived unassigned"
        info={
          <p>
            Assigns leads that arrived unassigned because their pool had nobody eligible. Run it after fixing lead weights or a role&apos;s
            department. <strong>Only fills gaps:</strong> leads that have an owner or have been worked are never touched.
          </p>
        }
      />
      <PageBody dense>
        <div>
          <Link href="/dashboard/m/lms" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">
            ← Back to LMS
          </Link>
        </div>

        {(loadError || error) && <Alert tone="error">{loadError ?? error}</Alert>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* 1 — Scope */}
          <section className={`${card} p-4 lg:col-start-1`} aria-label="Scope and filters">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-on-surface">
              <span className={stepBadge}>1</span> Scope &amp; Filters
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold text-on-surface-variant">Branches (none selected = all)</legend>
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {orgs.map((o) => (
                    <label key={o.id} className={optionRow}>
                      <input
                        type="checkbox"
                        checked={orgIds.has(o.id)}
                        disabled={pending !== null}
                        onChange={() => toggle(orgIds, o.id, setOrgIds)}
                        className="h-4 w-4 accent-primary"
                      />
                      {o.name}
                    </label>
                  ))}
                  {orgs.length === 0 && !loadError && <p className="text-xs text-outline">Loading branches…</p>}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold text-on-surface-variant">Campaign types (none selected = all)</legend>
                <div className="space-y-0.5">
                  {types.map((t) => (
                    <label key={t.id} className={optionRow}>
                      <input
                        type="checkbox"
                        checked={typeIds.has(t.id)}
                        disabled={pending !== null}
                        onChange={() => toggle(typeIds, t.id, setTypeIds)}
                        className="h-4 w-4 accent-primary"
                      />
                      {t.label}
                    </label>
                  ))}
                  {types.length === 0 && <p className="text-xs text-outline">No campaign types loaded.</p>}
                </div>
              </fieldset>
            </div>
          </section>

          {/* 3 — Confirm. Sits right of the scope on desktop, between scope and results on a phone. */}
          <section
            className={`${card} space-y-3 p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start`}
            aria-label="Confirmation and execution"
          >
            <h2 className="flex items-center gap-2 text-sm font-bold text-on-surface">
              <span className={stepBadge}>3</span> Confirm &amp; Execute
            </h2>
            <ul className="list-disc space-y-1 pl-4 text-xs text-on-surface-variant">
              <li>Preview first: Assign acts on exactly the batch the preview described.</li>
              <li>Leads that have an owner or have been worked are never touched.</li>
              <li>Changing a filter discards the preview.</li>
            </ul>
            {preview && (
              <p className="rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface">
                Target batch: <strong>{preview.candidates}</strong> unassigned lead{preview.candidates === 1 ? '' : 's'}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Button
                variant="secondary"
                size="md"
                className="min-h-11 flex-1"
                onClick={runPreview}
                disabled={pending !== null}
                aria-busy={pending === 'preview'}
              >
                {pending === 'preview' ? 'Previewing…' : cursor ? 'Preview next batch' : 'Preview'}
              </Button>
              <Button
                variant="primary"
                size="md"
                className="min-h-11 flex-1"
                onClick={runForReal}
                disabled={pending !== null || !preview || preview.assigned === 0}
                aria-busy={pending === 'run'}
              >
                {pending === 'run' ? 'Assigning…' : preview ? `Assign ${preview.assigned} lead${preview.assigned === 1 ? '' : 's'}` : 'Assign'}
              </Button>
              {cursor && (
                <Button variant="secondary" size="md" className="min-h-11" onClick={resetBatches} disabled={pending !== null}>
                  Start over
                </Button>
              )}
            </div>
          </section>

          {/* 2 — Impact */}
          {shown && (
            <section className={`${card} space-y-3 p-4 lg:col-start-1`} aria-label="Impact analysis">
              <h2 className="flex items-center gap-2 text-sm font-bold text-on-surface">
                <span className={stepBadge}>2</span> {shown.dry_run ? 'Impact Preview' : 'Result'}
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Unassigned examined', shown.candidates],
                  [shown.dry_run ? 'Would be assigned' : 'Assigned', shown.assigned],
                  [shown.dry_run ? 'Would stay unassigned' : 'Still unassigned', shown.left_unassigned],
                  ['More beyond this batch', shown.remaining],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-surface-container-low px-3 py-2">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-on-surface">{value}</p>
                  </div>
                ))}
              </div>
              {shown.by_branch.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-on-surface-variant">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Branch</th>
                        <th className="py-1 pr-3 font-semibold">Campaign type</th>
                        <th className="py-1 pr-3 font-semibold">Assigned</th>
                        <th className="py-1 pr-3 font-semibold">Unassigned</th>
                        <th className="py-1 font-semibold">Why unassigned</th>
                      </tr>
                    </thead>
                    <tbody className="text-on-surface">
                      {shown.by_branch.map((b) => (
                        <tr key={`${b.org_id}:${b.campaign_type_id}`} className="border-t border-outline-variant">
                          <td className="py-1.5 pr-3">{b.org_name}</td>
                          <td className="py-1.5 pr-3">{b.campaign_type_label}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{b.assigned}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{b.left_unassigned}</td>
                          <td className="py-1.5 text-on-status-due-container">
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
            </section>
          )}
        </div>
      </PageBody>
    </>
  );
}
