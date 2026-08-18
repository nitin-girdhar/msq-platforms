'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leadStageCapiEvents, type LeadStageCapiEventRow } from '@/src/lib/api/client';
import { Button } from '@platform/ui-kit';

interface EventTypeOption {
  id: number;
  code: string;
  label: string;
}

interface Props {
  tenantId: string;
  initialRows: LeadStageCapiEventRow[];
  eventTypes: EventTypeOption[];
}

export default function LeadStageCapiEventsClient({ tenantId, initialRows, eventTypes }: Props) {
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

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/lookups/lead-stage" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to Lead Stages
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">CAPI Event Mapping</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Which Meta Conversion API event fires when a lead moves into each stage. Leave a stage unmapped and no event fires for it.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-left text-xs font-semibold text-[#64748B]">
            <tr>
              <th className="px-4 py-2.5">Stage</th>
              <th className="px-4 py-2.5">CAPI Event</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((r) => (
              <tr key={r.stage_id} className="border-b border-[#E2E8F0] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[#0F172A]">{r.stage_label}</td>
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
                    className="w-full max-w-xs rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
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
                <td colSpan={2} className="px-4 py-6 text-center text-xs text-[#94A3B8]">
                  No active lead stages for this tenant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} disabled={pending || !isDirty} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
