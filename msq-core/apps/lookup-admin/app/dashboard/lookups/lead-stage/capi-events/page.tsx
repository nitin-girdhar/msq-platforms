import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import LeadStageCapiEventsClient from '@/components/lookups/LeadStageCapiEventsClient';
import type { LeadStageCapiEventRow } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

interface EventTypeOption {
  id: number;
  code: string;
  label: string;
}

// Bespoke tab off the Lead Stages page — see lookupTableConfig.ts's note on
// 'lead-stage' and the Phase 3 plan: ext.lead_stage_capi_event_map has no
// name/label/description/is_active columns, so it does not fit the shared
// [table] grid (no synthetic name column, no Deactivate — an unmapped stage is
// a deleted row, not an inactive one). One page per stage's mapping instead,
// same "bespoke route off the generic screen" shape as /capabilities/matrix.
export default async function LeadStageCapiEventsPage() {
  const result = await getServerSession();
  if (!result) return null;
  const { cookieHeader } = result;

  const selectedTenantId = await getSelectedTenantId();

  if (!selectedTenantId) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/lookups/lead-stage" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to Lead Stages
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to manage CAPI event mapping.
        </p>
      </div>
    );
  }

  const [mappingsRes, eventTypesRes] = await Promise.all([
    fetch(`${GATEWAY_URL}/lookups/lead-stage-capi-events?tenant_id=${selectedTenantId}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${GATEWAY_URL}/lookups/capi-event-types`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    }),
  ]);

  if (!mappingsRes.ok) return <LookupLoadError title="CAPI Event Mapping" status={mappingsRes.status} />;
  if (!eventTypesRes.ok) return <LookupLoadError title="CAPI Event Mapping" status={eventTypesRes.status} />;

  const mappingsBody = await mappingsRes.json() as { data: LeadStageCapiEventRow[] };
  const eventTypesBody = await eventTypesRes.json() as { data: Array<Record<string, unknown>> };

  const eventTypes: EventTypeOption[] = eventTypesBody.data
    .filter((r) => r['is_active'] !== false)
    .map((r) => ({ id: Number(r['id']), code: String(r['code']), label: String(r['label']) }));

  return (
    <LeadStageCapiEventsClient
      tenantId={selectedTenantId}
      initialRows={mappingsBody.data}
      eventTypes={eventTypes}
    />
  );
}
