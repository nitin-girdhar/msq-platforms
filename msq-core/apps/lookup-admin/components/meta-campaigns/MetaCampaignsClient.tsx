'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, type SearchableOption } from '@platform/ui-kit';
import { type MetaCampaignRow, type CampaignTypeRow } from '@/src/lib/api/client';
import FetchCampaignsButton from './FetchCampaignsButton';
import CampaignMappingGrid from './CampaignMappingGrid';
import ConfirmTypeModal, { type ConfirmTarget } from './ConfirmTypeModal';

interface Props {
  tenantId: string;
  rows: MetaCampaignRow[];
  campaignTypes: CampaignTypeRow[];
  campaignTypesUnavailable: boolean;
}

export default function MetaCampaignsClient({ tenantId, rows, campaignTypes, campaignTypesUnavailable }: Props) {
  const router = useRouter();
  // Keyed by meta_campaign_id -> chosen campaign_type_id. Seeded per row below
  // and otherwise left alone across re-renders so an admin's in-progress picks
  // in the grid survive unrelated state changes.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // Seed a default for every row not already represented: a suggested row
  // starts on its own matched type, an unmapped row starts EMPTY. Rows already
  // in `selections` (including ones the admin has since edited) are left as-is
  // rather than reset by a router.refresh().
  //
  // An unmapped row DOES carry a campaign_type_id — the form/tenant FALLBACK the
  // live path routed it on — but that is not a suggestion. Pre-filling it made
  // "Confirm all" on Needs mapping confirm every unmatched campaign to the
  // default pool (usually sales) in one click, the exact decision this grid
  // exists to make a human take.
  useEffect(() => {
    setSelections((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        if (!(row.meta_campaign_id in next)) {
          next[row.meta_campaign_id] = row.mapping_status === 'unmapped' ? '' : (row.campaign_type_id ?? '');
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const campaignTypeOptions: SearchableOption[] = useMemo(
    () => campaignTypes.map((t) => ({ id: t.id, label: t.label })),
    [campaignTypes],
  );

  const suggested = useMemo(() => rows.filter((r) => r.mapping_status === 'suggested'), [rows]);
  const unmapped = useMemo(() => rows.filter((r) => r.mapping_status === 'unmapped'), [rows]);
  const confirmed = useMemo(() => rows.filter((r) => r.mapping_status === 'confirmed'), [rows]);

  // Confirm-all on Needs mapping requires an explicit pick on EVERY row. A
  // partial batch would silently confirm some and leave the rest, which reads as
  // "done" when it is not.
  const unmappedAllPicked = unmapped.every((r) => Boolean(selections[r.meta_campaign_id]));

  const handleSelectionChange = (metaCampaignId: string, campaignTypeId: string) => {
    setSelections((prev) => ({ ...prev, [metaCampaignId]: campaignTypeId }));
  };

  const openConfirmOne = (row: MetaCampaignRow) => {
    const typeId = selections[row.meta_campaign_id];
    if (!typeId) return;
    setConfirmTarget({ campaigns: [{ row, campaignTypeId: typeId }], editable: true });
  };

  const openEdit = (row: MetaCampaignRow) => {
    setConfirmTarget({ campaigns: [{ row, campaignTypeId: row.campaign_type_id ?? '' }], editable: true });
  };

  const openConfirmAll = (candidateRows: MetaCampaignRow[]) => {
    const withTypes = candidateRows
      .map((row) => ({ row, campaignTypeId: selections[row.meta_campaign_id] ?? '' }))
      .filter((c) => c.campaignTypeId);
    if (withTypes.length === 0) return;
    setConfirmTarget({ campaigns: withTypes, editable: false });
  };

  // Re-runs the server component, which refetches the campaigns (and campaign
  // types) under the current tenant cookie.
  const handleRefresh = () => router.refresh();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
            ← Back to LMS
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Meta Campaign Mapping</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Which type — sales, hiring, or otherwise — each Meta campaign is, and therefore which pool of
            people its leads route to.
          </p>
        </div>
        <FetchCampaignsButton tenantId={tenantId} onSynced={handleRefresh} />
      </div>

      {campaignTypesUnavailable && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Campaign types could not be loaded, so nothing can be confirmed right now. The campaigns below are
          otherwise up to date.
        </div>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Needs confirmation <span className="font-normal text-[#64748B]">({suggested.length})</span>
          </h2>
          {suggested.length > 0 && (
            <Button variant="secondary" onClick={() => openConfirmAll(suggested)}>
              Confirm all
            </Button>
          )}
        </div>
        <CampaignMappingGrid
          mode="suggested"
          rows={suggested}
          campaignTypeOptions={campaignTypeOptions}
          selections={selections}
          onSelectionChange={handleSelectionChange}
          onConfirmOne={openConfirmOne}
        />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Needs mapping <span className="font-normal text-[#64748B]">({unmapped.length})</span>
          </h2>
          {unmapped.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => openConfirmAll(unmapped)}
              disabled={!unmappedAllPicked}
              title={unmappedAllPicked ? undefined : 'Pick a type for every campaign first'}
            >
              Confirm all
            </Button>
          )}
        </div>
        <CampaignMappingGrid
          mode="unmapped"
          rows={unmapped}
          campaignTypeOptions={campaignTypeOptions}
          selections={selections}
          onSelectionChange={handleSelectionChange}
          onConfirmOne={openConfirmOne}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#0F172A]">
          Confirmed <span className="font-normal text-[#64748B]">({confirmed.length})</span>
        </h2>
        <CampaignMappingGrid
          mode="confirmed"
          rows={confirmed}
          campaignTypeOptions={campaignTypeOptions}
          selections={selections}
          onSelectionChange={handleSelectionChange}
          onConfirmOne={openConfirmOne}
          onEdit={openEdit}
        />
      </section>

      <ConfirmTypeModal
        target={confirmTarget}
        tenantId={tenantId}
        campaignTypeOptions={campaignTypeOptions}
        onClose={() => setConfirmTarget(null)}
        onConfirmed={handleRefresh}
      />
    </div>
  );
}
