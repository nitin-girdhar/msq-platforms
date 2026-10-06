'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, PageBody, PageHeader, type ApiRequestError, type SearchableOption } from '@platform/ui-kit';
import {
  leadPull,
  orgs as orgsApi,
  campaignTypes as campaignTypesApi,
  type CreatePullRunInput,
  type MetaPageOption,
  type PullApplyResult,
  type PullRunConflictDetails,
  type PullRunStatus,
  type PullVerdict,
} from '@/src/lib/api/client';
import PullFilterForm from './PullFilterForm';
import RunProgress from './RunProgress';
import DeltaSummary from './DeltaSummary';
import StagedLeadsGrid from './StagedLeadsGrid';
import PullHistoryModal from './PullHistoryModal';
import MappingFormModal from '@/components/meta-mappings/MappingFormModal';
import MetaTabs from '@/components/meta-nav/MetaTabs';

interface Props {
  tenantId: string;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
  pages: MetaPageOption[];
  pagesUnavailable: boolean;
  /** The tenant's current run, fetched server-side, so the screen reopens it. */
  initialRunId: string | null;
}

// Statuses the poller stops on. `apply_queued` and `applying` keep polling:
// Apply runs on the server's worker, and the run status is the only way this
// screen learns when it finishes.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'applied', 'discarded']);

export default function LeadPullClient({ tenantId, tenantName, pages, pagesUnavailable, initialRunId }: Props) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [run, setRun] = useState<PullRunStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PullRunConflictDetails | null>(null);

  // True only while the POST that QUEUES an Apply is in flight. The Apply itself
  // runs on the server's worker and is followed through the polled run status.
  const [queueingApply, setQueueingApply] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Bumped to restart polling: a `completed` run has stopped the poller, and
  // pressing Apply must start it again to follow apply_queued → applying → applied.
  const [pollNonce, setPollNonce] = useState(0);

  const [grid, setGrid] = useState<{ verdict: PullVerdict | undefined; title: string } | null>(null);

  // ── 1.51.0: inline "map this page", then remap the run's unmapped rows ──
  const [orgList, setOrgList] = useState<Array<{ id: string; name: string; tenant_id: string }>>([]);
  const [typeOptions, setTypeOptions] = useState<SearchableOption[]>([]);
  const [mapPageId, setMapPageId] = useState<string | null>(null);
  const [remapNotice, setRemapNotice] = useState<string | null>(null);
  const [scheduledError, setScheduledError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgsApi.listAll()
      .then((res) => { if (!cancelled) setOrgList(res.data.filter((o) => o.tenant_id === tenantId)); })
      .catch(() => { if (!cancelled) setOrgList([]); });
    campaignTypesApi.list(tenantId)
      .then((res) => {
        if (!cancelled) setTypeOptions(res.data.filter((t) => t.is_active).map((t) => ({ id: t.id, label: t.label })));
      })
      .catch(() => { if (!cancelled) setTypeOptions([]); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const orgOptions: SearchableOption[] = useMemo(() => orgList.map((o) => ({ id: o.id, label: o.name })), [orgList]);
  const orgNames: Record<string, string> = useMemo(
    () => Object.fromEntries(orgList.map((o) => [o.id, o.name])),
    [orgList],
  );

  const pageNames: Record<string, string> = Object.fromEntries(
    pages.filter((p) => p.name).map((p) => [p.page_id, p.name as string]),
  );

  // ── Polling ─────────────────────────────────────────────────────────────
  // Backs off when the tab is hidden and stops entirely once the run reaches
  // a terminal state — see TERMINAL_STATUSES above.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await leadPull.getRun(tenantId, runId);
        if (cancelled) return;
        setRun(res.data);
        setPollError(null);
        if (!TERMINAL_STATUSES.has(res.data.status)) {
          const delay = typeof document !== 'undefined' && document.hidden ? 15000 : 3000;
          timeoutId = setTimeout(poll, delay);
        }
      } catch (err) {
        if (cancelled) return;
        // 404: the run is gone — a newer Pull (here or in another tab) deleted
        // it. Retrying every 5s forever would never succeed; stop and say so.
        if ((err as Partial<ApiRequestError>).status === 404) {
          setPollError('This run no longer exists — a newer pull replaced it. Start a new pull to continue.');
          setRun(null);
          setRunId(null);
          return;
        }
        setPollError(err instanceof Error ? err.message : 'Could not check run status.');
        timeoutId = setTimeout(poll, 5000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [tenantId, runId, pollNonce]);

  // Which pages the unmapped_form rows came from arrives on the run itself
  // (run.unmapped_page_ids, aggregated server-side over every staged row). It
  // used to be derived here from the first 500 rows, which dropped pages on a
  // large pull.

  const startRun = useCallback((input: CreatePullRunInput) => {
    setCreating(true);
    setCreateError(null);
    setConflict(null);
    leadPull.createRun(tenantId, input)
      .then((res) => {
        setRunId(res.data.run_id);
        setRun(null);
        setApplyError(null);
      })
      .catch((err: unknown) => {
        const apiErr = err as Partial<ApiRequestError>;
        if (apiErr.status === 409) {
          const details = (apiErr.body as { details?: PullRunConflictDetails } | undefined)?.details;
          if (details?.run_id) {
            setConflict(details);
            return;
          }
        }
        setCreateError(err instanceof Error ? err.message : 'Could not start the pull.');
      })
      .finally(() => setCreating(false));
  }, [tenantId]);

  const jumpToLiveRun = useCallback(() => {
    if (!conflict) return;
    setRunId(conflict.run_id);
    setRun(null);
    setConflict(null);
    setCreateError(null);
  }, [conflict]);

  const startAnother = useCallback(() => {
    setRunId(null);
    setRun(null);
    setApplyError(null);
  }, []);

  // Queues the Apply and restarts polling. Nothing is awaited beyond the fast
  // queueing call — which is the whole fix: an inline Apply outlived the
  // gateway's 30s timeout, answered 504 while still writing, and re-enabled
  // this button over a run the server was busy with.
  const handleApply = useCallback(() => {
    if (!runId) return;
    setQueueingApply(true);
    setApplyError(null);
    leadPull.apply(tenantId, runId)
      .then(() => setPollNonce((n) => n + 1))
      .catch((err: unknown) => {
        setApplyError(err instanceof Error ? err.message : 'Could not start Apply.');
        // A 409 usually means the run already moved on (queued, applying or
        // applied elsewhere) — re-poll so the screen shows where it actually is.
        setPollNonce((n) => n + 1);
      })
      .finally(() => setQueueingApply(false));
  }, [tenantId, runId]);

  const openVerdictGrid = useCallback((verdict: PullVerdict | undefined, title: string) => {
    setGrid({ verdict, title });
  }, []);

  // An applied run can be applied AGAIN when rows became importable after an
  // inline mapping + remap (1.51.0).
  const canApply = run?.status === 'completed' || (run?.status === 'applied' && run.importable > 0);

  const handleMappingSaved = useCallback(() => {
    if (!runId) return;
    setRemapNotice(null);
    leadPull.remap(tenantId, runId)
      .then((res) => {
        setRemapNotice(
          `${res.data.remapped} row${res.data.remapped === 1 ? '' : 's'} now resolve to a branch`
          + (res.data.still_unmapped ? ` · ${res.data.still_unmapped} still unmapped` : '')
          + '. Review the summary, then Apply.',
        );
        setPollNonce((n) => n + 1);
      })
      .catch((err: unknown) => setRemapNotice(err instanceof Error ? err.message : 'Could not remap the run.'));
  }, [tenantId, runId]);

  const openScheduledRun = useCallback(() => {
    setScheduledError(null);
    leadPull.latestRun(tenantId, 'scheduled')
      .then((res) => {
        if (!res.data) {
          setScheduledError('No scheduled catch-up run yet for this tenant.');
          return;
        }
        setRunId(res.data.run_id);
        setRun(null);
        setApplyError(null);
      })
      .catch((err: unknown) => setScheduledError(err instanceof Error ? err.message : 'Could not load the scheduled run.'));
  }, [tenantId]);
  const handleDiscard = useCallback(() => {
    if (!runId) return;
    setDiscarding(true);
    setDiscardError(null);
    leadPull.discard(tenantId, runId)
      .then(() => {
        setDiscardOpen(false);
        setGrid(null);
        setPollNonce((n) => n + 1);
      })
      .catch((err: unknown) => setDiscardError(err instanceof Error ? err.message : 'Could not discard the batch.'))
      .finally(() => setDiscarding(false));
  }, [tenantId, runId]);

  const canReview = run?.status === 'completed' || (run?.status === 'applied' && run.importable_total > 0);
  const canDiscard = run?.status === 'completed' || run?.status === 'failed';
  const applyInFlight = queueingApply || run?.status === 'apply_queued' || run?.status === 'applying';
  const runIsLive = run ? !TERMINAL_STATUSES.has(run.status) : creating;
  // The last Apply pass's tallies, written onto the run by the server's worker.
  const applyResult: PullApplyResult | null = run?.status === 'applied' ? (run.counts.apply ?? null) : null;

  return (
    <>
      <PageHeader
        title="Meta Lead Ingestion & Pull Engine"
        scope={tenantName}
        subtitle="Backfill leads the live webhook missed, review what is genuinely missing from LMS and where each lead will go, then apply only that."
        tabs={<MetaTabs />}
        actions={
          <>
            <Button onClick={() => setHistoryOpen(true)}>Pull History Logs</Button>
            <Button onClick={openScheduledRun}>Open latest scheduled catch-up</Button>
          </>
        }
      />
      <PageBody>
      <p className="max-w-3xl text-xs text-on-surface-variant">
        A scheduled catch-up run also stages the last few days automatically; it is never applied without you.
        {scheduledError && <span className="ml-2 font-medium text-on-surface">{scheduledError}</span>}
      </p>

      {run?.trigger_kind === 'scheduled' && (
        <div role="status" className="rounded-xl border border-status-info/30 bg-status-info-container px-3 py-2 text-xs text-primary">
          You are looking at a <strong>scheduled catch-up</strong> run (last few days, every mapped page). Review it and
          press Apply to import what the webhook missed.
        </div>
      )}

      {createError && <Alert tone="error">{createError}</Alert>}

      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-due/30 bg-status-due-container px-4 py-3 text-sm text-on-status-due-container">
          <span>
            A pull is already <strong>{conflict.status}</strong> for this tenant. Wait for it to finish, or jump to it below.
          </span>
          <Button variant="secondary" onClick={jumpToLiveRun}>
            Jump to live run
          </Button>
        </div>
      )}

      {/* A new Pull deletes this tenant's previous run, staged rows and all. Say
          so before an admin discards importable leads they meant to apply. */}
      {run?.status === 'completed' && run.importable > 0 && (
        <div role="status" className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
          This run has {run.importable.toLocaleString()} importable row{run.importable === 1 ? '' : 's'} not yet
          applied. Starting a new pull discards them — apply first if you want them.
        </div>
      )}

      <PullFilterForm
        tenantId={tenantId}
        pages={pages}
        pagesUnavailable={pagesUnavailable}
        disabled={runIsLive}
        pending={creating}
        onSubmit={startRun}
      />

      {pollError && <Alert tone="error">{pollError}</Alert>}

      {run && <RunProgress run={run} onStartAnother={startAnother} />}

      {run && Object.keys(run.verdict_summary).length > 0 && (
        <DeltaSummary
          run={run}
          onOpenVerdict={openVerdictGrid}
          unmappedPageIds={run.unmapped_page_ids}
          pageNames={pageNames}
          onMapPage={run.status === 'completed' || run.status === 'applied' ? setMapPageId : undefined}
        />
      )}

      {remapNotice && (
        <div role="status" className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
          {remapNotice}
        </div>
      )}

      {run?.status === 'discarded' && (
        <div role="status" className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
          This batch was discarded. Nothing was imported and the staged leads were deleted. Start a new pull to continue.
        </div>
      )}

      {run && run.status !== 'discarded' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <Button variant="primary" onClick={handleApply} disabled={!canApply || applyInFlight || run.importable === 0} aria-busy={applyInFlight}>
            {applyInFlight
              ? 'Applying…'
              : run.status === 'applied' && run.importable_total === 0
                ? 'Applied'
                : `Apply Selected Leads (${run.importable.toLocaleString()})`}
          </Button>
          {canReview && (
            <Button onClick={() => openVerdictGrid(undefined, 'Staged Leads Review')}>Review staged leads</Button>
          )}
          {canDiscard && (
            <Button variant="danger" onClick={() => { setDiscardError(null); setDiscardOpen(true); }}>Discard Batch</Button>
          )}
          <p className="min-w-0 flex-1 text-xs text-on-surface-variant">
            {run.importable.toLocaleString()} of {run.importable_total.toLocaleString()} importable row
            {run.importable_total === 1 ? '' : 's'} ticked — new leads plus phone/email duplicates. Duplicates ARE imported on
            purpose: the canonical write path supersedes on a phone match or returns the existing lead on an email match, and
            either way it writes the tracking row that stops this same lead being re-fetched forever. Unticked rows stay staged
            for a later Apply. Runs in the background — you can leave this page while it applies.
          </p>
        </div>
      )}

      {applyError && <Alert tone="error">{applyError}</Alert>}

      {applyResult && (
        <div className="rounded-xl border border-status-success/30 bg-status-success-container px-4 py-3 text-sm text-on-status-success-container">
          Apply finished — {applyResult.applied} applied, {applyResult.already_synced} already synced,{' '}
          {applyResult.skipped} skipped, {applyResult.failed} failed (of {applyResult.attempted} attempted).
        </div>
      )}

      {grid && runId && (
        <StagedLeadsGrid
          tenantId={tenantId}
          runId={runId}
          verdict={grid.verdict}
          title={grid.title}
          pageNames={pageNames}
          orgNames={orgNames}
          canSelect={canReview}
          onSelectionChanged={() => setPollNonce((n) => n + 1)}
          onClose={() => setGrid(null)}
        />
      )}

      {historyOpen && <PullHistoryModal tenantId={tenantId} onClose={() => setHistoryOpen(false)} />}

      <Modal open={discardOpen} onClose={() => setDiscardOpen(false)} title="Discard this batch?" locked={discarding}>
        <p className="text-sm text-on-surface-variant">
          The staged leads are deleted and nothing is imported. This cannot be undone — a new pull is needed to stage them again.
        </p>
        {discardError && <Alert tone="error">{discardError}</Alert>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setDiscardOpen(false)} disabled={discarding}>Keep batch</Button>
          <Button variant="primary" onClick={handleDiscard} disabled={discarding} aria-busy={discarding}>
            {discarding ? 'Discarding…' : 'Discard Batch'}
          </Button>
        </div>
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link href="/dashboard/meta-campaigns" className="rounded-lg border border-outline-variant px-3 py-1.5 font-medium text-on-surface-variant hover:bg-surface-container">
          ← Campaign Mapping &amp; Rules
        </Link>
        <Link href="/dashboard/meta-lead-inbox" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-on-primary hover:bg-primary/90">
          Open Leads Inbox (unmapped / errors) →
        </Link>
      </div>
      </PageBody>

      <MappingFormModal
        open={mapPageId !== null}
        onClose={() => setMapPageId(null)}
        tenantId={tenantId}
        row={null}
        pages={pages}
        pagesUnavailable={pagesUnavailable}
        orgOptions={orgOptions}
        campaignTypeOptions={typeOptions}
        initialPageId={mapPageId ?? undefined}
        onSaved={handleMappingSaved}
      />
    </>
  );
}
