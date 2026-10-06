'use client';

import Link from 'next/link';
import type { PullRunStatus, PullVerdict } from '@/src/lib/api/client';

const VERDICT_ORDER: PullVerdict[] = [
  'new',
  'phone_duplicate',
  'email_duplicate',
  'already_synced',
  'test_lead',
  'unmapped_form',
  'missing_contact',
];

const VERDICT_LABELS: Record<PullVerdict, string> = {
  new: 'New',
  phone_duplicate: 'Phone duplicate',
  email_duplicate: 'Email duplicate',
  already_synced: 'Already in LMS',
  test_lead: 'Test leads',
  unmapped_form: 'Unmapped form',
  missing_contact: 'Missing contact',
};

interface Props {
  run: PullRunStatus;
  onOpenVerdict: (verdict: PullVerdict | undefined, label: string) => void;
  unmappedPageIds: string[];
  pageNames: Record<string, string>;
  // 1.51.0: map an unmapped page right here, then remap the run's rows.
  onMapPage?: ((pageId: string) => void) | undefined;
}

// The card the whole screen exists to produce: what genuinely needs pulling in
// versus what LMS already has, with every number opening the rows behind it —
// a count the admin cannot drill into is one they have to trust blindly.
export default function DeltaSummary({ run, onOpenVerdict, unmappedPageIds, pageNames, onMapPage }: Props) {
  const summary = run.verdict_summary;
  const fetched = Object.values(summary).reduce((sum, n) => sum + (n ?? 0), 0);
  // Every staged row starts `applied_status = 'pending'` the moment the pull
  // completes, so `apply_summary` always has a `pending` key well before Apply
  // is ever pressed. An apply has run once ANY row carries a real outcome —
  // which also covers an Apply that was interrupted and returned the run to
  // `completed` part-way, whose outcomes so far must stay visible.
  const hasApplyRun = Object.entries(run.apply_summary)
    .some(([outcome, n]) => outcome !== 'pending' && (n ?? 0) > 0);

  return (
    <div className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-on-surface">Delta summary</h2>
        <button
          type="button"
          onClick={() => onOpenVerdict(undefined, 'All staged leads')}
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low"
        >
          {fetched.toLocaleString()} fetched
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {VERDICT_ORDER.map((v) => {
          const count = summary[v] ?? 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onOpenVerdict(v, VERDICT_LABELS[v])}
              disabled={count === 0}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:border-primary hover:bg-surface-container-lowest disabled:cursor-default disabled:opacity-40 disabled:hover:border-outline-variant disabled:hover:bg-surface-container-low"
            >
              <span className="font-semibold text-on-surface">{count.toLocaleString()}</span> {VERDICT_LABELS[v]}
            </button>
          );
        })}
      </div>

      {(summary.unmapped_form ?? 0) > 0 && (
        <div className="rounded-xl border border-status-due/30 bg-status-due-container px-3 py-2.5 text-xs text-on-status-due-container">
          <p>
            {summary.unmapped_form} lead{summary.unmapped_form === 1 ? '' : 's'} came from a form with no active page
            mapping — the live webhook parks these in the Meta Lead Inbox too. Map the page below, and this run&apos;s
            rows become importable without pulling again.
          </p>
          {unmappedPageIds.length > 0 && (
            <p className="mt-1.5">
              Fix in Meta Page Mapping — affected page{unmappedPageIds.length === 1 ? '' : 's'}:{' '}
              {/* One link per page, each opening the mapping screen filtered to
                  that page, so the admin lands on the rows that need a mapping
                  instead of hunting through every page the tenant has. */}
              {unmappedPageIds.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ', ' : ''}
                  <Link
                    href={`/dashboard/meta-mappings?page_id=${encodeURIComponent(id)}`}
                    className="font-mono font-semibold underline hover:no-underline"
                  >
                    {pageNames[id] ?? id}
                  </Link>
                  {onMapPage && (
                    <button
                      type="button"
                      onClick={() => onMapPage(id)}
                      className="ml-1 rounded border border-status-due/30 bg-surface-container-lowest px-1.5 py-0.5 text-[0.6875rem] font-semibold text-on-status-due-container hover:bg-status-due-container"
                    >
                      Map here
                    </button>
                  )}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {hasApplyRun && (
        <div className="border-t border-outline-variant pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Apply results</h3>
          <div className="flex flex-wrap gap-2">
            {(['applied', 'skipped', 'failed'] as const).map((k) => {
              const count = run.apply_summary[k] ?? 0;
              const cls = k === 'failed' && count > 0
                ? 'border-error/30 bg-error-container text-on-error-container'
                : k === 'applied' && count > 0
                  ? 'border-status-success/30 bg-status-success-container text-on-status-success-container'
                  : 'border-outline-variant bg-surface-container-low text-on-surface-variant';
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onOpenVerdict(undefined, 'All staged leads')}
                  disabled={count === 0}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80 disabled:cursor-default disabled:opacity-40 ${cls}`}
                >
                  <span className="font-semibold">{count.toLocaleString()}</span> {k}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-on-surface-variant">
            Opens the full staged-row grid — filter its &quot;Applied status&quot; column to isolate one outcome, and see the reason on any failed row.
          </p>
        </div>
      )}
    </div>
  );
}
