'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leadStageCapiEvents, type LeadStageCapiEventRow } from '@/src/lib/api/client';
import { Button, PageBody, PageHeader } from '@platform/ui-kit';

interface EventTypeOption {
  id: number;
  code: string;
  label: string;
  funnel_rank: number | null;
  is_negative: boolean;
  retired: boolean;
}

interface Props {
  tenantId: string;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
  initialRows: LeadStageCapiEventRow[];
  eventTypes: EventTypeOption[];
}

export default function LeadStageCapiEventsClient({ tenantId, tenantName, initialRows, eventTypes }: Props) {
  const router = useRouter();
  // Keyed by stage_id -> selected capi_event_type_id (null = unmapped).
  const [selections, setSelections] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(initialRows.map((r) => [r.stage_id, r.capi_event_type_id])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = initialRows.some((r) => selections[r.stage_id] !== r.capi_event_type_id);

  const handleSave = async () => {
    setPending(true);
    setError(null);
    try {
      await leadStageCapiEvents.put(
        tenantId,
        initialRows.map((r) => ({ stage_id: r.stage_id, capi_event_type_id: selections[r.stage_id] ?? null })),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const mappedCount = initialRows.filter((r) => selections[r.stage_id] != null).length;
  const unmapped = initialRows.filter((r) => selections[r.stage_id] == null);

  const typeById = useMemo(() => new Map(eventTypes.map((t) => [t.id, t])), [eventTypes]);

  // Meta's Conversion Leads wants a lead's stages in order. Walking the stages in pipeline order, a stage whose event
  // sits EARLIER in the funnel than one already seen is almost certainly a mis-pick (e.g. "Qualified" -> "Lead"); and
  // two stages on one event send it only once per lead. Both are warnings, not blocks -- a tenant may mean it.
  const warnings = useMemo(() => {
    const out: Record<string, string> = {};
    let highest = -Infinity;
    const seen = new Map<number, string>();
    for (const r of initialRows) {
      const t = selections[r.stage_id] != null ? typeById.get(selections[r.stage_id]!) : undefined;
      if (!t) continue;
      if (seen.has(t.id)) out[r.stage_id] = `Same event as "${seen.get(t.id)}" — Meta receives it once per lead.`;
      else seen.set(t.id, r.stage_label);
      if (!t.is_negative && t.funnel_rank !== null) {
        if (t.funnel_rank < highest) out[r.stage_id] = out[r.stage_id] ?? 'Earlier in the funnel than a previous stage — check the order.';
        highest = Math.max(highest, t.funnel_rank);
      }
    }
    return out;
  }, [initialRows, selections, typeById]);

  return (
    <>
      <PageHeader
        title="CAPI Event Mapping"
        scope={tenantName}
        subtitle="Which Conversion API event fires for each stage"
        info={
          <>
            <p>Which Meta Conversion API event fires when a lead moves into each stage.</p>
            <p>
              Leave a stage unmapped and no event fires for it. Each event is a <strong>step in the funnel</strong>: when a lead jumps
              ahead (say New to Converted) Meta needs the steps in between too, so they are sent first, in order. Pick the funnel
              event closest to what the stage means; use <em>Unqualified</em> as the negative signal.
            </p>
          </>
        }
        actions={
          <>
            <Link href="/dashboard/lookups/lead-stage" className="inline-flex min-h-[2.75rem] items-center px-1 text-xs font-semibold text-primary hover:underline sm:min-h-0">
              ← Back to Lead Stages
            </Link>
            <Button variant="primary" className="min-h-[2.75rem] sm:min-h-0" onClick={handleSave} disabled={pending || !isDirty} aria-busy={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      />
      <PageBody dense>
        <p className="text-xs text-on-surface-variant">
          <span className="font-semibold text-on-surface">Mapped stages</span>{' '}
          <span className="font-mono font-bold text-on-surface">{mappedCount} / {initialRows.length}</span> configured
        </p>

        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
            {error}
          </div>
        )}

      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
        <table className="w-full text-sm">
          <thead className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold text-on-surface-variant">
            <tr>
              <th className="px-4 py-2.5">Stage</th>
              <th className="px-4 py-2.5">CAPI Event</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((r) => (
              <tr key={r.stage_id} className="border-b border-outline-variant last:border-0">
                <td className="px-4 py-2.5 font-medium text-on-surface">{r.stage_label}</td>
                <td className="px-4 py-2.5">
                  <select
                    value={selections[r.stage_id] ?? ''}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [r.stage_id]: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    disabled={pending}
                    aria-label={`CAPI event for ${r.stage_label}`}
                    className="min-h-[2.75rem] w-full max-w-xs rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface sm:min-h-0 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  >
                    <option value="">— No event —</option>
                    {eventTypes
                      .filter((et) => !et.retired || selections[r.stage_id] === et.id)
                      .map((et) => (
                        <option key={et.id} value={et.id}>
                          {et.label}{et.is_negative ? ' (negative signal)' : et.funnel_rank !== null ? ` · step ${et.funnel_rank}` : ''}
                        </option>
                      ))}
                  </select>
                  {selections[r.stage_id] != null && typeById.get(selections[r.stage_id]!)?.retired && (
                    <p className="mt-1 text-xs text-on-status-due-container">Retired event — pick a funnel event so Meta can learn from this stage.</p>
                  )}
                  {warnings[r.stage_id] && <p className="mt-1 text-xs text-on-status-due-container">{warnings[r.stage_id]}</p>}
                </td>
              </tr>
            ))}
            {initialRows.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-xs text-outline">
                  No active lead stages for this tenant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

        {unmapped.length > 0 && initialRows.length > 0 && (
          <p className="text-xs text-on-surface-variant">
            {unmapped.length} unmapped stage{unmapped.length === 1 ? '' : 's'}: {unmapped.map((r) => r.stage_label).join(', ')}
          </p>
        )}
      </PageBody>
    </>
  );
}
