'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leadStageCapiEvents, type LeadStageCapiEventRow } from '@/src/lib/api/client';
import { Button, PageBody, PageHeader } from '@platform/ui-kit';

interface EventTypeOption {
  id: number;
  code: string;
  label: string;
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

  return (
    <>
      <PageHeader
        title="CAPI Event Mapping"
        scope={tenantName}
        subtitle="Which Meta Conversion API event fires when a lead moves into each stage"
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
      <PageBody>
        <p className="max-w-3xl text-xs text-on-surface-variant">
          Leave a stage unmapped and no event fires for it.
        </p>

        <div className="max-w-xs rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">Mapped stages</p>
          <p className="mt-1 font-mono text-headline-md font-bold text-on-surface">{mappedCount} / {initialRows.length}</p>
          <p className="text-xs text-on-surface-variant">stages configured</p>
        </div>

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
                    className="min-h-[2.75rem] w-full max-w-xs rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface sm:min-h-0 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  >
                    <option value="">— No event —</option>
                    {eventTypes.map((et) => (
                      <option key={et.id} value={et.id}>{et.label}</option>
                    ))}
                  </select>
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
