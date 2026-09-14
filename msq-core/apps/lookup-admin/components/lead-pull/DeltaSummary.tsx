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
}

// The card the whole screen exists to produce: what genuinely needs pulling in
// versus what LMS already has, with every number opening the rows behind it —
// a count the admin cannot drill into is one they have to trust blindly.
export default function DeltaSummary({ run, onOpenVerdict, unmappedPageIds, pageNames }: Props) {
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
    <div className="space-y-3 rounded-xl border border-[#E2E8F0] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#0F172A]">Delta summary</h2>
        <button
          type="button"
          onClick={() => onOpenVerdict(undefined, 'All staged leads')}
          className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
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
              className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs font-medium text-[#334155] hover:border-[#0b6cbf] hover:bg-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-[#E2E8F0] disabled:hover:bg-[#F8FAFC]"
            >
              <span className="font-semibold text-[#0F172A]">{count.toLocaleString()}</span> {VERDICT_LABELS[v]}
            </button>
          );
        })}
      </div>

      {(summary.unmapped_form ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <p>
            {summary.unmapped_form} lead{summary.unmapped_form === 1 ? '' : 's'} came from a form with no active page
            mapping — these are being dropped by the live webhook RIGHT NOW too. Fixing the mapping is the actual
            remedy, not re-running this pull.
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
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {hasApplyRun && (
        <div className="border-t border-[#F1F5F9] pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Apply results</h3>
          <div className="flex flex-wrap gap-2">
            {(['applied', 'skipped', 'failed'] as const).map((k) => {
              const count = run.apply_summary[k] ?? 0;
              const cls = k === 'failed' && count > 0
                ? 'border-red-200 bg-red-50 text-red-700'
                : k === 'applied' && count > 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#334155]';
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
          <p className="mt-1.5 text-[11px] text-[#94A3B8]">
            Opens the full staged-row grid — filter its &quot;Applied status&quot; column to isolate one outcome, and see the reason on any failed row.
          </p>
        </div>
      )}
    </div>
  );
}
