'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, InfoTip, LocalDateTime, PageBody, PageHeader, type SearchableOption } from '@platform/ui-kit';
import { metaCampaigns, type CampaignSyncResult, type MetaCampaignRow, type CampaignTypeRow } from '@/src/lib/api/client';
import FetchCampaignsButton from './FetchCampaignsButton';
import FetchResultPanel from './FetchResultPanel';
import RuleEngineDrawer from './RuleEngineDrawer';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import KpiTile from '@/components/meta-shared/KpiTile';

import CampaignMappingGrid from './CampaignMappingGrid';
import ConfirmTypeModal, { type ConfirmTarget } from './ConfirmTypeModal';

type Tab = 'suggested' | 'unmapped' | 'confirmed' | 'archived';

interface Props {
  tenantId: string;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
  /** The server-rendered first page of campaigns; later refreshes are client-side. */
  rows: MetaCampaignRow[];
  campaignTypes: CampaignTypeRow[];
  campaignTypesUnavailable: boolean;
}

export default function MetaCampaignsClient({ tenantId, tenantName, rows: initialRows, campaignTypes, campaignTypesUnavailable }: Props) {
  // Row state lives here. A confirm / archive / fetch used to call router.refresh(),
  // which re-ran the whole server render (session, campaign types, the full campaign
  // list and its lead-count aggregate) for a change to a handful of rows. Now an
  // action patches the affected rows in place and, where the server decides the
  // result (confirm, fetch), re-reads only the campaign list.
  const [rows, setRows] = useState<MetaCampaignRow[]>(initialRows);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const reloadSeq = useRef(0);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  // Keyed by meta_campaign_id -> chosen campaign_type_id. Seeded per row below
  // and otherwise left alone across re-renders so an admin's in-progress picks
  // in the grid survive unrelated state changes.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [tab, setTab] = useState<Tab>('suggested');
  const [fetchResult, setFetchResult] = useState<CampaignSyncResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Seed a default for every row not already represented: a suggested row
  // starts on the RULE ENGINE's suggestion, an unmapped row starts EMPTY. Rows
  // already in `selections` (including ones the admin has since edited) are
  // left as-is rather than reset by a router.refresh().
  //
  // 1.51.0: campaign_type_id is written ONLY by a confirm, so an unconfirmed
  // row's guess lives in suggested_campaign_type_id. An unmapped row starts
  // empty on purpose: "Confirm all" on Needs mapping must never confirm every
  // unmatched campaign to one pool in a click — the decision this grid exists
  // to make a human take.
  // What each row was last seeded with, so a later fetch that CHANGES the suggestion
  // re-seeds the dropdown -- but only if the admin has not already picked something
  // else (their pick equals the old seed). Otherwise Confirm would commit a stale guess.
  const seededRef = useRef<Record<string, string>>({});
  useEffect(() => {
    setSelections((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        const seed = row.mapping_status === 'unmapped' ? '' : (row.campaign_type_id ?? row.suggested_campaign_type_id ?? '');
        const id = row.meta_campaign_id;
        if (!(id in next)) {
          next[id] = seed;
          seededRef.current[id] = seed;
          changed = true;
        } else if (seededRef.current[id] !== seed && next[id] === seededRef.current[id]) {
          next[id] = seed;
          seededRef.current[id] = seed;
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

  // 1.51.0: narrow every grid to the campaigns promoting one page. Built from
  // the rows' own page_ids (the fetch records the pages each campaign's ad
  // sets promote), so it lists only pages that actually carry a campaign.
  const [pageFilter, setPageFilter] = useState('');
  const pageOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => r.page_ids ?? []))].sort(),
    [rows],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (pageFilter && !(r.page_ids ?? []).includes(pageFilter)) return false;
      if (!q) return true;
      return [r.name, r.meta_campaign_id, r.ad_account_id, r.objective, r.matched_keyword]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, pageFilter, search]);

  const adAccountCount = useMemo(() => new Set(rows.map((r) => r.ad_account_id).filter(Boolean)).size, [rows]);
  const lastSynced = useMemo(() => {
    const times = rows.map((r) => (r.last_synced_at ? new Date(r.last_synced_at).getTime() : 0));
    const latest = Math.max(0, ...times);
    return latest || null;
  }, [rows]);
  const conflicted = useMemo(() => rows.filter((r) => r.conflict_reason), [rows]);

  // Archived campaigns leave the three working lists (they keep routing; only the view changes).
  const live = useMemo(() => visible.filter((r) => !r.is_archived), [visible]);
  const suggested = useMemo(() => live.filter((r) => r.mapping_status === 'suggested'), [live]);
  const unmapped = useMemo(() => live.filter((r) => r.mapping_status === 'unmapped'), [live]);
  const confirmed = useMemo(() => live.filter((r) => r.mapping_status === 'confirmed'), [live]);
  const archived = useMemo(() => visible.filter((r) => r.is_archived), [visible]);

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

  // Re-reads the campaign list (client-side, newest request wins).
  const handleRefresh = useCallback(async () => {
    const seq = ++reloadSeq.current;
    setReloadError(null);
    try {
      const res = await metaCampaigns.list(tenantId);
      if (seq === reloadSeq.current) setRows(res.data);
    } catch (err) {
      if (seq === reloadSeq.current) setReloadError(err instanceof Error ? err.message : 'Could not refresh the campaigns.');
    }
  }, [tenantId]);

  const archive = async (ids: string[], value: boolean) => {
    if (ids.length === 0) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await metaCampaigns.archive(tenantId, ids, value);
      setTicked([]);
      // Visibility only -- patch the rows in place, no refetch needed.
      const hit = new Set(ids);
      setRows((prev) => prev.map((r) => (hit.has(r.meta_campaign_id) ? { ...r, is_archived: value } : r)));
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Could not change the hidden state.');
    } finally {
      setArchiveBusy(false);
    }
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    setTicked([]);
  };

  const tickedRows = useMemo(() => rows.filter((r) => ticked.includes(r.meta_campaign_id)), [rows, ticked]);

  const TABS: ReadonlyArray<{ id: Tab; label: string; count: number }> = [
    { id: 'suggested', label: 'Needs Confirmation', count: suggested.length },
    { id: 'unmapped', label: 'Needs Mapping', count: unmapped.length },
    { id: 'confirmed', label: 'Confirmed & Routed', count: confirmed.length },
    { id: 'archived', label: 'Archived', count: archived.length },
  ];

  return (
    <>
      <PageHeader
        title="Meta Campaign Mapping & Classification"
        scope={tenantName}
        subtitle="Classify campaigns into departmental pipelines"
        info="Unconfirmed campaigns route on ordered keyword rules until you confirm them."
        tabs={<MetaTabs />}
        actions={
          <>
            <Button onClick={() => setRulesOpen(true)}>Rule Engine Settings</Button>
            <FetchCampaignsButton
              tenantId={tenantId}
              onSynced={() => void handleRefresh()}
              onResult={(result, error) => { setFetchResult(result); setFetchError(error); }}
            />
          </>
        }
      />
      <PageBody dense>
        {reloadError && <Alert tone="error">{reloadError}</Alert>}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            { label: 'Ad accounts', value: adAccountCount, note: 'With campaigns here' },
            { label: 'Campaigns', value: rows.length, note: 'Known to this tenant' },
            { label: 'Need confirmation', value: rows.filter((r) => r.mapping_status === 'suggested' && !r.is_archived).length, note: 'Rule engine has a guess' },
            { label: 'Need mapping', value: rows.filter((r) => r.mapping_status === 'unmapped' && !r.is_archived).length, note: 'No rule matched' },
            { label: 'Confirmed', value: rows.filter((r) => r.mapping_status === 'confirmed' && !r.is_archived).length, note: 'Routed by your choice' },
          ].map((c) => <KpiTile key={c.label} label={c.label} value={c.value} note={c.note} />)}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          Last campaign sync: <LocalDateTime value={lastSynced} fallback="Never" />
          <InfoTip label="About campaign sync">
            Campaigns are fetched from the{' '}
            <Link href="/dashboard/meta-ad-accounts" className="font-semibold underline">enabled ad accounts</Link>{' '}
            and land in the tenant their pages are mapped to.
          </InfoTip>
        </p>

        <FetchResultPanel result={fetchResult} error={fetchError} />
        {archiveError && <Alert tone="error">{archiveError}</Alert>}

        {conflicted.length > 0 && (
          <div role="alert" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
            <p className="font-semibold">
              {conflicted.length} campaign{conflicted.length === 1 ? '' : 's'} promote pages mapped to more than one tenant.
            </p>
            <p className="mt-0.5">
              A campaign must belong to one tenant. Their confirmed type is not applied to another tenant&apos;s leads until
              the page mappings are fixed: {conflicted.slice(0, 5).map((r) => r.name ?? r.meta_campaign_id).join(', ')}
              {conflicted.length > 5 ? '…' : ''}.{' '}
              <Link href="/dashboard/meta-mappings" className="font-semibold underline">Resolve in Page Mapping</Link>
            </p>
          </div>
        )}

        {campaignTypesUnavailable && (
          <Alert tone="error">
            Campaign types could not be loaded, so nothing can be confirmed right now. The campaigns below are otherwise up to date.
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Campaign status">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => changeTab(t.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tab === t.id ? 'border-primary bg-primary-fixed text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaign, ID or ad account…"
            aria-label="Search campaigns"
            className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:max-w-xs"
          />
          {pageOptions.length > 0 && (
            <select
              id="campaign-page-filter"
              aria-label="Filter by promoted page"
              value={pageFilter}
              onChange={(e) => setPageFilter(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none"
            >
              <option value="">All pages ({pageOptions.length} promoted)</option>
              {pageOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        {tab === 'suggested' && (
          <section className="space-y-2" aria-label="Needs confirmation">
            <CampaignMappingGrid
              key="suggested"
              mode="suggested"
              rows={suggested}
              campaignTypeOptions={campaignTypeOptions}
              selections={selections}
              onSelectionChange={handleSelectionChange}
              onConfirmOne={openConfirmOne}
              onToggleArchive={(row) => void archive([row.meta_campaign_id], true)}
              onSelectionChanged={setTicked}
            />
          </section>
        )}
        {tab === 'unmapped' && (
          <section className="space-y-2" aria-label="Needs mapping">
            <CampaignMappingGrid
              key="unmapped"
              mode="unmapped"
              rows={unmapped}
              campaignTypeOptions={campaignTypeOptions}
              selections={selections}
              onSelectionChange={handleSelectionChange}
              onConfirmOne={openConfirmOne}
              onToggleArchive={(row) => void archive([row.meta_campaign_id], true)}
              onSelectionChanged={setTicked}
            />
          </section>
        )}
        {tab === 'confirmed' && (
          <section className="space-y-2" aria-label="Confirmed and routed">
            <CampaignMappingGrid
              key="confirmed"
              mode="confirmed"
              rows={confirmed}
              campaignTypeOptions={campaignTypeOptions}
              selections={selections}
              onSelectionChange={handleSelectionChange}
              onConfirmOne={openConfirmOne}
              onEdit={openEdit}
              onToggleArchive={(row) => void archive([row.meta_campaign_id], true)}
              onSelectionChanged={setTicked}
            />
          </section>
        )}
        {tab === 'archived' && (
          <section className="space-y-2" aria-label="Archived campaigns">
            <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              Archived campaigns
              <InfoTip label="About archived campaigns">Hidden from the working lists. They keep routing leads by the type they hold; restoring only changes the view.</InfoTip>
            </p>
            <CampaignMappingGrid
              key="archived"
              mode="archived"
              rows={archived}
              campaignTypeOptions={campaignTypeOptions}
              selections={selections}
              onSelectionChange={handleSelectionChange}
              onConfirmOne={openConfirmOne}
              onToggleArchive={(row) => void archive([row.meta_campaign_id], false)}
              onSelectionChanged={setTicked}
            />
          </section>
        )}

        {/* Ticked-rows bar (1.70.0). */}
        {ticked.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-fixed px-3 py-2 text-xs">
            <span className="font-semibold text-primary">{ticked.length} campaign{ticked.length === 1 ? '' : 's'} selected</span>
            {tab !== 'confirmed' && tab !== 'archived' && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => openConfirmAll(tickedRows)}
                disabled={tickedRows.some((r) => !selections[r.meta_campaign_id])}
                title={tickedRows.some((r) => !selections[r.meta_campaign_id]) ? 'Pick a type for every selected campaign first' : undefined}
              >
                Confirm Selected
              </Button>
            )}
            {tab === 'archived' ? (
              <Button size="sm" disabled={archiveBusy} onClick={() => void archive(ticked, false)}>Restore Selected</Button>
            ) : (
              <Button size="sm" disabled={archiveBusy} onClick={() => void archive(ticked, true)}>Hide Selected</Button>
            )}
          </div>
        )}

        {/* Bulk bar. "Confirm all" keeps its guard: Needs mapping needs an explicit
            pick on EVERY row, so one click can never put every unmatched campaign
            into a single pool. */}
        {(tab === 'suggested' || tab === 'unmapped') && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
            <p className="text-xs text-on-surface-variant">
              {tab === 'suggested'
                ? `${suggested.length} campaign${suggested.length === 1 ? '' : 's'} waiting on the rule engine's suggestion.`
                : `${unmapped.length} campaign${unmapped.length === 1 ? '' : 's'} with no matching rule — pick a type for each.`}
              {' '}Batch changes apply to the tenant's lead stream.
            </p>
            <div className="flex flex-wrap gap-2">
              {tab === 'suggested' ? (
                <Button variant="primary" onClick={() => openConfirmAll(suggested)} disabled={suggested.length === 0}>
                  Confirm All Filtered ({suggested.length})
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => openConfirmAll(unmapped)}
                  disabled={unmapped.length === 0 || !unmappedAllPicked}
                  title={unmappedAllPicked ? undefined : 'Pick a type for every campaign first'}
                >
                  Confirm All Filtered ({unmapped.length})
                </Button>
              )}
              <Link href="/dashboard/lead-pull" className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container">
                Jump to Lead Pull →
              </Link>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <Link href="/dashboard/meta-mappings" className="rounded-lg border border-outline-variant px-3 py-1.5 font-medium text-on-surface-variant hover:bg-surface-container">
            ← Previous: Page Mapping
          </Link>
          <Link href="/dashboard/lead-pull" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-on-primary hover:bg-primary/90">
            Next: Meta Lead Pull →
          </Link>
        </div>
      </PageBody>

      {rulesOpen && <RuleEngineDrawer tenantId={tenantId} onClose={() => setRulesOpen(false)} />}

      <ConfirmTypeModal
        target={confirmTarget}
        tenantId={tenantId}
        campaignTypeOptions={campaignTypeOptions}
        onClose={() => setConfirmTarget(null)}
        onConfirmed={() => void handleRefresh()}
      />
    </>
  );
}
