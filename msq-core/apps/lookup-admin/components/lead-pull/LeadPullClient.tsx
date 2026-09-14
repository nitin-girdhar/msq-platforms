'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, type ApiRequestError } from '@platform/ui-kit';
import {
  leadPull,
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

interface Props {
  tenantId: string;
  pages: MetaPageOption[];
  pagesUnavailable: boolean;
  /** The tenant's current run, fetched server-side, so the screen reopens it. */
  initialRunId: string | null;
}

// Statuses the poller stops on. `apply_queued` and `applying` keep polling:
// Apply runs on the server's worker, and the run status is the only way this
// screen learns when it finishes.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'applied']);

export default function LeadPullClient({ tenantId, pages, pagesUnavailable, initialRunId }: Props) {
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

  const canApply = run?.status === 'completed';
  const applyInFlight = queueingApply || run?.status === 'apply_queued' || run?.status === 'applying';
  const runIsLive = run ? !TERMINAL_STATUSES.has(run.status) : creating;
  // The last Apply pass's tallies, written onto the run by the server's worker.
  const applyResult: PullApplyResult | null = run?.status === 'applied' ? (run.counts.apply ?? null) : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Meta Lead Pull</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          Backfill leads the live webhook missed. Choose what to pull and from when, review what is genuinely missing
          from LMS, and apply only that.
        </p>
      </div>

      {createError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {createError}
        </div>
      )}

      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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

      {pollError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {pollError}
        </div>
      )}

      {run && <RunProgress run={run} onStartAnother={startAnother} />}

      {run && Object.keys(run.verdict_summary).length > 0 && (
        <DeltaSummary
          run={run}
          onOpenVerdict={openVerdictGrid}
          unmappedPageIds={run.unmapped_page_ids}
          pageNames={pageNames}
        />
      )}

      {run && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4">
          <Button variant="primary" onClick={handleApply} disabled={!canApply || applyInFlight} aria-busy={applyInFlight}>
            {applyInFlight ? 'Applying…' : run.status === 'applied' ? 'Applied' : 'Apply'}
          </Button>
          <p className="text-xs text-[#64748B]">
            Enabled only once the pull has completed, and runs in the background — you can leave this page while it
            applies. Imports {run.importable.toLocaleString()} row
            {run.importable === 1 ? '' : 's'} — new leads plus phone/email duplicates. Duplicates ARE imported on
            purpose: the canonical write path supersedes on a phone match or returns the existing lead on an email
            match, and either way it writes the tracking row that stops this same lead being re-fetched forever.
          </p>
        </div>
      )}

      {applyError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {applyError}
        </div>
      )}

      {applyResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
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
          onClose={() => setGrid(null)}
        />
      )}
    </div>
  );
}
