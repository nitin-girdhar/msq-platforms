'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, SearchableSelect, type SearchableOption } from '@platform/ui-kit';
import {
  metaCampaigns,
  type MetaCampaignRow,
  type ConfirmCampaignResult,
  type RuleMatchField,
} from '@/src/lib/api/client';

const RULE_FIELD_OPTIONS: Array<{ value: RuleMatchField; label: string }> = [
  { value: 'campaign_name', label: 'Campaign name' },
  { value: 'form_name', label: 'Lead form name' },
  { value: 'adset_name', label: 'Ad set name' },
  { value: 'ad_name', label: 'Ad name' },
];

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
// Each campaign in a bulk confirm costs one dry-run (a reclassify fan-out across the
// tenant's branches) and one commit. A server-side bulk endpoint would collapse that;
// until then the dialog refuses a batch it cannot finish in reasonable time.
const MAX_BULK_CONFIRM = 200;

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
  // 1.51.0: an optional ordered rule added with the confirm — typed by the
  // admin, never guessed from the name (the retired "learn keyword" offered
  // 'gurugram' for 'HIR_Gurugram_Trainer_Sep26').
  const [addRule, setAddRule] = useState(false);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleField, setRuleField] = useState<RuleMatchField>('campaign_name');
  const [previews, setPreviews] = useState<Record<string, ConfirmCampaignResult> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  // Progress for a bulk run (preview and commit are one request per campaign), the ids
  // already confirmed (so Confirm again after a partial failure retries only the rest),
  // and a cancel flag the commit loop checks between campaigns.
  const [previewProgress, setPreviewProgress] = useState(0);
  const [commitProgress, setCommitProgress] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const cancelCommit = useRef(false);

  useEffect(() => {
    if (!target) return;
    setSingleTypeId(isSingleEditable ? target.campaigns[0]!.campaignTypeId : '');
    setAddRule(false);
    setRulePattern('');
    setRuleField('campaign_name');
    setPreviews(null);
    setPreviewError(null);
    setCommitError(null);
    setPreviewProgress(0);
    setCommitProgress(0);
    setConfirmedIds(new Set());
    cancelCommit.current = false;
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

  // The preview never carries add_rule: a rule changes future suggestions, not
  // the leads this confirm moves, so it has no bearing on the impact shown.
  useEffect(() => {
    if (!target || effectiveEntries.length === 0 || effectiveEntries.some((e) => !e.campaignTypeId)) {
      setPreviews(null);
      return;
    }
    if (effectiveEntries.length > MAX_BULK_CONFIRM) {
      setPreviews(null);
      setPreviewError(`Too many campaigns for one confirmation (${effectiveEntries.length}; the limit is ${MAX_BULK_CONFIRM}). Narrow the list with the search or page filter and confirm in batches.`);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewProgress(0);
    setPreviewError(null);
    mapWithConcurrency(effectiveEntries, PREVIEW_CONCURRENCY, (e) =>
      metaCampaigns
        .confirm(tenantId, e.row.meta_campaign_id, { campaign_type_id: e.campaignTypeId }, true)
        .then((res) => {
          if (!cancelled) setPreviewProgress((n) => n + 1);
          return [e.row.meta_campaign_id, res.data] as const;
        }),
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
  const missingType = effectiveEntries.some((e) => !e.campaignTypeId);
  const rulePatternValid = !addRule || rulePattern.trim().length >= 2;

  const handleClose = () => {
    if (committing) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previews || missingType || !rulePatternValid) return;

    setCommitting(true);
    setCommitError(null);
    setCommitProgress(0);
    cancelCommit.current = false;
    const alreadyDone = new Set(confirmedIds);
    // Two different outcomes, reported differently. `failures`: the mapping was
    // NOT saved. `rerouteFailures`: the mapping WAS saved (the campaign is now in
    // Confirmed and new leads route correctly) but moving its EXISTING leads
    // failed — pressing Confirm on it again retries just that, safely.
    const failures: string[] = [];
    const rerouteFailures: string[] = [];
    let cancelled = 0;
    for (const entry of effectiveEntries) {
      const name = entry.row.name ?? entry.row.meta_campaign_id;
      // Confirmed in an earlier pass of this dialog -- do not repeat it (it re-routes leads).
      if (alreadyDone.has(entry.row.meta_campaign_id)) { setCommitProgress((n) => n + 1); continue; }
      if (cancelCommit.current) { cancelled += 1; continue; }
      try {
        const res = await metaCampaigns.confirm(
          tenantId,
          entry.row.meta_campaign_id,
          {
            campaign_type_id: entry.campaignTypeId,
            ...(addRule && isSingleEditable ? { add_rule: { pattern: rulePattern.trim(), match_field: ruleField } } : {}),
          },
          false,
        );
        alreadyDone.add(entry.row.meta_campaign_id);
        if (res.data.reclassification_error) {
          rerouteFailures.push(`${name}: ${res.data.reclassification_error}`);
        }
      } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
      setCommitProgress((n) => n + 1);
    }
    setConfirmedIds(alreadyDone);
    setCommitting(false);
    onConfirmed();
    const messages: string[] = [];
    if (cancelled > 0) {
      messages.push(`Stopped: ${cancelled} campaign${cancelled === 1 ? ' was' : 's were'} not confirmed. Press Confirm to continue with the rest.`);
    }
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

  const disableCommit = committing || previewing || !previews || missingType || !rulePatternValid;
  const isBulk = effectiveEntries.length > 1;

  const footer = (
    <div className="flex justify-end gap-2">
      {committing && isBulk ? (
        <Button variant="secondary" onClick={() => { cancelCommit.current = true; }}>
          Stop after current
        </Button>
      ) : (
        <Button variant="secondary" onClick={handleClose} disabled={committing}>
          Cancel
        </Button>
      )}
      <Button variant="primary" type="submit" form={FORM_ID} disabled={disableCommit} aria-busy={committing}>
        {committing
          ? (isBulk ? `Confirming ${commitProgress}/${effectiveEntries.length}…` : 'Confirming…')
          : isBulk
            ? `Confirm ${effectiveEntries.length - confirmedIds.size} campaigns`
            : 'Confirm'}
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
          <div role="alert" className="rounded-xl border border-error/30 bg-error-container px-3 py-2 text-xs text-on-error-container">
            {commitError}
          </div>
        )}
        {previewError && (
          <div role="alert" className="rounded-xl border border-error/30 bg-error-container px-3 py-2 text-xs text-on-error-container">
            {previewError}
          </div>
        )}

        {isSingleEditable ? (
          <div>
            <span className="block text-xs font-semibold text-on-surface-variant">Campaign type</span>
            <p className="mt-1 text-xs text-on-surface-variant">
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
          <div className="space-y-1 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2">
            <p className="text-xs font-semibold text-on-surface-variant">{effectiveEntries.length} campaigns</p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-on-surface-variant">
              {effectiveEntries.map((e) => (
                <li key={e.row.meta_campaign_id}>
                  {e.row.name ?? e.row.meta_campaign_id} → {campaignTypeOptions.find((o) => o.id === e.campaignTypeId)?.label ?? '—'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-xs text-on-surface-variant">
          {previewing || !previews || !aggregate ? (
            <p className="text-on-surface-variant">{missingType ? 'Pick a campaign type to see its impact.' : `Calculating impact…${effectiveEntries.length > 1 ? ` ${previewProgress}/${effectiveEntries.length}` : ''}`}</p>
          ) : (
            <div className="space-y-1">
              <p>
                Relabels <strong>{aggregate.leads_relabelled}</strong> lead{aggregate.leads_relabelled === 1 ? '' : 's'} across{' '}
                <strong>{aggregate.by_branch.length}</strong> branch{aggregate.by_branch.length === 1 ? '' : 'es'} · moves{' '}
                <strong>{aggregate.leads_reassigned}</strong> open lead{aggregate.leads_reassigned === 1 ? '' : 's'} to the new
                team&apos;s pool · <strong>{aggregate.leads_left_unassigned}</strong> would be left unassigned.
              </p>
              <p className="text-[0.6875rem] text-on-surface-variant">
                Every OPEN lead of this campaign moves to the new type&apos;s pool in its branch, including leads someone has
                already worked — unless its owner already works that pool.
              </p>
              {aggregate.by_branch.some((b) => b.leads_left_unassigned > 0) && (
                <ul className="space-y-0.5 text-on-status-due-container">
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

        {isSingleEditable && (
          <div className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5">
            <label className="flex items-start gap-2 text-xs font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={addRule}
                onChange={(e) => setAddRule(e.target.checked)}
                disabled={committing}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                Also add a rule for this type
                <span className="mt-0.5 block font-normal text-[0.6875rem] text-on-surface-variant">
                  So the next similarly-named campaign is suggested correctly. Added at the END of the rule list —
                  reorder it on Campaign Types &amp; Rules.
                </span>
              </span>
            </label>
            {addRule && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  placeholder="Word or phrase, e.g. HIR or recruitment"
                  aria-label="Rule pattern"
                  disabled={committing}
                  className="rounded-lg border border-outline px-2.5 py-1.5 text-xs"
                />
                <select
                  value={ruleField}
                  onChange={(e) => setRuleField(e.target.value as RuleMatchField)}
                  aria-label="Rule matches on"
                  disabled={committing}
                  className="rounded-lg border border-outline px-2 py-1.5 text-xs"
                >
                  {RULE_FIELD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {!rulePatternValid && (
                  <p className="text-[0.6875rem] text-error sm:col-span-2">Enter at least 2 characters.</p>
                )}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
