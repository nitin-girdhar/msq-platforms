'use client';

import { Button } from '@platform/ui-kit';
import type { PullRunStatus } from '@/src/lib/api/client';

interface Props {
  run: PullRunStatus;
  onStartAnother: () => void;
}

function formatCount(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

// Reads a mid-deploy pull as "this run died, start another" rather than as a
// crash: a heartbeat that stops updating is reaped server-side into `failed`,
// so by the time this renders that state, `error_text` already names it as a
// stalled/reaped run rather than a stack trace.
export default function RunProgress({ run, onStartAnother }: Props) {
  const counts = run.counts;
  const inFlight = run.status === 'queued' || run.status === 'running';

  return (
    <div className="space-y-3">
      {(run.status === 'running' || run.status === 'queued') && (
        <div className="flex items-center gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#0b6cbf]">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
          <span>
            {run.status === 'queued'
              ? 'Queued — waiting for the pull to start…'
              : `Pulling… ${formatCount(counts.pages_walked)}/${formatCount(counts.pages_in_scope)} pages walked, `
                + `${formatCount(counts.leads_staged)} leads staged so far.`}
          </span>
        </div>
      )}

      {(run.status === 'apply_queued' || run.status === 'applying') && (
        <div className="flex items-center gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#0b6cbf]">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
          <span>
            {run.status === 'apply_queued'
              ? 'Apply queued — waiting for the worker to start…'
              : 'Applying importable leads… this runs in the background, so it is safe to leave this page.'}
          </span>
        </div>
      )}

      {/* An Apply that was interrupted returns the run to `completed` with the
          reason here — not a failure: pressing Apply again continues. */}
      {run.status === 'completed' && run.error_text && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {run.error_text}
        </div>
      )}

      {run.status === 'failed' && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">This run failed.</p>
          <p className="text-xs leading-relaxed">
            {run.error_text ?? 'No further detail was recorded — this can happen when the service restarted mid-run and the reaper timed the run out.'}
          </p>
          <Button variant="secondary" onClick={onStartAnother}>
            Start another pull
          </Button>
        </div>
      )}

      {(run.status === 'completed' || run.status === 'applied') && !inFlight && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Pull complete — {formatCount(counts.pages_walked)} pages walked, {formatCount(counts.leads_staged)} leads
          staged for review.
          {(counts.out_of_scope ?? 0) > 0 && (
            <>
              {' '}{formatCount(counts.out_of_scope)} lead{counts.out_of_scope === 1 ? '' : 's'} on the same pages
              belong to branches you did not select and were left out.
            </>
          )}
        </div>
      )}

      {/* Prominent, not a footnote: an admin who misses this believes the pull
          is complete when the page cap cut it off mid-form. */}
      {counts.truncated && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">⚠ Incomplete pull — the page cap was hit.</p>
          <p className="mt-1 text-xs leading-relaxed">
            {(counts.truncated_forms?.length ?? 0)} form{(counts.truncated_forms?.length ?? 0) === 1 ? '' : 's'} hit
            the per-form page limit before pagination ended — older leads on those forms were NOT pulled. Narrow the
            date range or re-run later to fill the gap; this run's data is genuinely partial.
          </p>
        </div>
      )}

      {(counts.page_errors?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <p className="font-semibold">{counts.page_errors!.length} page{counts.page_errors!.length === 1 ? '' : 's'} could not be reached:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {counts.page_errors!.map((e) => (
              <li key={e.page_id}><span className="font-mono">{e.page_id}</span> — {e.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
