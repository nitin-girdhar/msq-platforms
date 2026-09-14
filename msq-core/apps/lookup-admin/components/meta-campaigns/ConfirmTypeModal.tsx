'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, SearchableSelect, type SearchableOption } from '@platform/ui-kit';
import {
  metaCampaigns,
  type MetaCampaignRow,
  type ConfirmCampaignResult,
} from '@/src/lib/api/client';

const FORM_ID = 'confirm-campaign-type-form';

export interface ConfirmTarget {
  // Single-campaign confirm/edit: exactly one entry, whose type is editable in
  // this dialog. Bulk "Confirm all": one entry per row already carrying the
  // type currently chosen in that row's grid dropdown — fixed here; change it
  // in the grid and re-open instead.
  campaigns: Array<{ row: MetaCampaignRow; campaignTypeId: string }>;
  editable: boolean;
}

interface Props {
  target: ConfirmTarget | null;
  tenantId: string;
  campaignTypeOptions: SearchableOption[];
  onClose: () => void;
  onConfirmed: () => void;
}

interface BranchImpact {
  org_id: string;
  org_name: string;
  leads_relabelled: number;
  leads_reassigned: number;
  leads_left_unassigned: number;
}

interface Aggregate {
  leads_relabelled: number;
  leads_reassigned: number;
  leads_left_unassigned: number;
  by_branch: BranchImpact[];
}

// "Confirm all" previews every campaign, and each dry run makes
// meta-conversion-api call leads-service's reclassify fan-out across every
// branch that ran it. Firing them all at once (the old Promise.all) put N
// concurrent fan-outs on leads-service for one click; this caps it.
const PREVIEW_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function aggregatePreviews(previews: Record<string, ConfirmCampaignResult>): Aggregate {
  const byBranch = new Map<string, BranchImpact>();
  let leadsRelabelled = 0;
  let leadsReassigned = 0;
  let leadsLeftUnassigned = 0;

  for (const p of Object.values(previews)) {
    // Always present on a dry run; null only on a real confirm whose fan-out
    // failed, which never reaches this preview aggregation.
    const r = p.reclassification;
    if (!r) continue;
    leadsRelabelled += r.leads_relabelled;
    leadsReassigned += r.leads_reassigned;
    leadsLeftUnassigned += r.leads_left_unassigned;
    for (const b of r.by_branch) {
      const existing = byBranch.get(b.org_id) ?? {
        org_id: b.org_id,
        org_name: b.org_name,
        leads_relabelled: 0,
        leads_reassigned: 0,
        leads_left_unassigned: 0,
      };
      existing.leads_relabelled += b.leads_relabelled;
      existing.leads_reassigned += b.leads_reassigned;
      existing.leads_left_unassigned += b.leads_left_unassigned;
      byBranch.set(b.org_id, existing);
    }
  }

  return {
    leads_relabelled: leadsRelabelled,
    leads_reassigned: leadsReassigned,
    leads_left_unassigned: leadsLeftUnassigned,
    by_branch: [...byBranch.values()].sort((a, b) => a.org_name.localeCompare(b.org_name)),
  };
}

export default function ConfirmTypeModal({ target, tenantId, campaignTypeOptions, onClose, onConfirmed }: Props) {
  const isSingleEditable = !!target && target.editable && target.campaigns.length === 1;

  const [singleTypeId, setSingleTypeId] = useState('');
  const [learnKeyword, setLearnKeyword] = useState(false);
  const [previews, setPreviews] = useState<Record<string, ConfirmCampaignResult> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setSingleTypeId(isSingleEditable ? target.campaigns[0]!.campaignTypeId : '');
    setLearnKeyword(false);
    setPreviews(null);
    setPreviewError(null);
    setCommitError(null);
    // isSingleEditable is derived from target itself; re-running this whenever
    // target changes identity is what's wanted, not a separate dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const effectiveEntries = useMemo(() => {
    if (!target) return [];
    if (isSingleEditable) {
      return [{ row: target.campaigns[0]!.row, campaignTypeId: singleTypeId }];
    }
    return target.campaigns;
  }, [target, isSingleEditable, singleTypeId]);

  const entryKey = effectiveEntries.map((e) => `${e.row.meta_campaign_id}:${e.campaignTypeId}`).join(',');

  // Preview runs with learn_keyword ALWAYS true — a dry run writes nothing
  // regardless, so this is the only way to show the admin what token WOULD be
  // learned before they decide, via the checkbox below, whether the real
  // commit should actually learn it.
  useEffect(() => {
    if (!target || effectiveEntries.length === 0 || effectiveEntries.some((e) => !e.campaignTypeId)) {
      setPreviews(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    mapWithConcurrency(effectiveEntries, PREVIEW_CONCURRENCY, (e) =>
      metaCampaigns
        .confirm(tenantId, e.row.meta_campaign_id, { campaign_type_id: e.campaignTypeId, learn_keyword: true }, true)
        .then((res) => [e.row.meta_campaign_id, res.data] as const),
    )
      .then((entries) => {
        if (cancelled) return;
        setPreviews(Object.fromEntries(entries));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : 'Could not preview the impact of this change.');
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, entryKey]);

  if (!target) return null;

  const aggregate = previews ? aggregatePreviews(previews) : null;
  const learnable = previews ? Object.values(previews).filter((p) => p.learned_keyword) : [];
  const missingType = effectiveEntries.some((e) => !e.campaignTypeId);

  const handleClose = () => {
    if (committing) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previews || missingType) return;

    setCommitting(true);
    setCommitError(null);
    // Two different outcomes, reported differently. `failures`: the mapping was
    // NOT saved. `rerouteFailures`: the mapping WAS saved (the campaign is now in
    // Confirmed and new leads route correctly) but moving its EXISTING leads
    // failed — pressing Confirm on it again retries just that, safely.
    const failures: string[] = [];
    const rerouteFailures: string[] = [];
    for (const entry of effectiveEntries) {
      const name = entry.row.name ?? entry.row.meta_campaign_id;
      try {
        const res = await metaCampaigns.confirm(
          tenantId,
          entry.row.meta_campaign_id,
          { campaign_type_id: entry.campaignTypeId, learn_keyword: learnKeyword },
          false,
        );
        if (res.data.reclassification_error) {
          rerouteFailures.push(`${name}: ${res.data.reclassification_error}`);
        }
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    setCommitting(false);
    onConfirmed();
    const messages: string[] = [];
    if (failures.length > 0) {
      messages.push(`${failures.length} of ${effectiveEntries.length} did not confirm — ${failures.join('; ')}`);
    }
    if (rerouteFailures.length > 0) {
      messages.push(
        `${rerouteFailures.length} mapping${rerouteFailures.length === 1 ? ' was' : 's were'} saved, but re-routing `
        + `existing leads failed — ${rerouteFailures.join('; ')}. New leads already route by the new type; open `
        + 'the campaign from Confirmed and confirm it again to retry the re-route.',
      );
    }
    if (messages.length > 0) {
      setCommitError(messages.join(' '));
      return;
    }
    onClose();
  };

  const disableCommit = committing || previewing || !previews || missingType;
  const isBulk = effectiveEntries.length > 1;

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={handleClose} disabled={committing}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" form={FORM_ID} disabled={disableCommit} aria-busy={committing}>
        {committing ? 'Confirming…' : isBulk ? `Confirm ${effectiveEntries.length} campaigns` : 'Confirm'}
      </Button>
    </div>
  );

  return (
    <Modal
      open
      onClose={handleClose}
      title={isBulk ? `Confirm ${effectiveEntries.length} campaign types` : 'Confirm campaign type'}
      locked={committing}
      footer={footer}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {commitError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {commitError}
          </div>
        )}
        {previewError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {previewError}
          </div>
        )}

        {isSingleEditable ? (
          <div>
            <span className="block text-xs font-semibold text-[#334155]">Campaign type</span>
            <p className="mt-1 text-xs text-[#64748B]">
              {target.campaigns[0]!.row.name ?? target.campaigns[0]!.row.meta_campaign_id}
            </p>
            <div className="mt-1">
              <SearchableSelect
                value={singleTypeId}
                onChange={setSingleTypeId}
                options={campaignTypeOptions}
                ariaLabel="Campaign type"
                placeholder="Select a type…"
                disabled={committing}
                className="w-full"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <p className="text-xs font-semibold text-[#334155]">{effectiveEntries.length} campaigns</p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-[#64748B]">
              {effectiveEntries.map((e) => (
                <li key={e.row.meta_campaign_id}>
                  {e.row.name ?? e.row.meta_campaign_id} → {campaignTypeOptions.find((o) => o.id === e.campaignTypeId)?.label ?? '—'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-xs text-[#334155]">
          {previewing || !previews || !aggregate ? (
            <p className="text-[#64748B]">{missingType ? 'Pick a campaign type to see its impact.' : 'Calculating impact…'}</p>
          ) : (
            <div className="space-y-1">
              <p>
                Relabels <strong>{aggregate.leads_relabelled}</strong> lead{aggregate.leads_relabelled === 1 ? '' : 's'} across{' '}
                <strong>{aggregate.by_branch.length}</strong> branch{aggregate.by_branch.length === 1 ? '' : 'es'} · reassigns{' '}
                <strong>{aggregate.leads_reassigned}</strong> · <strong>{aggregate.leads_left_unassigned}</strong> would be left unassigned.
              </p>
              {aggregate.by_branch.some((b) => b.leads_left_unassigned > 0) && (
                <ul className="space-y-0.5 text-amber-700">
                  {aggregate.by_branch
                    .filter((b) => b.leads_left_unassigned > 0)
                    .map((b) => (
                      <li key={b.org_id}>
                        {b.leads_left_unassigned} would be left unassigned in {b.org_name} — no weighted user in the target pool
                        there yet.
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {learnable.length > 0 && (
          <label className="flex items-start gap-2 text-xs font-semibold text-[#334155]">
            <input
              type="checkbox"
              checked={learnKeyword}
              onChange={(e) => setLearnKeyword(e.target.checked)}
              disabled={committing}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              Also add matched keyword{learnable.length === 1 ? '' : 's'} to the target type
              {learnable.length === 1 ? '' : 's'}
              <span className="mt-0.5 block font-normal text-[11px] text-[#64748B]">
                {learnable.map((p) => `"${p.learned_keyword}"`).join(', ')} — makes the next fetch match similarly-named
                campaigns automatically.
              </span>
            </span>
          </label>
        )}
      </form>
    </Modal>
  );
}
