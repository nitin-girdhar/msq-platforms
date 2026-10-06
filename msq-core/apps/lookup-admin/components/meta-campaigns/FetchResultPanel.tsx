import Link from 'next/link';
import type { CampaignSyncResult } from '@/src/lib/api/client';
import { Alert } from '@platform/ui-kit';

interface Props {
  result: CampaignSyncResult | null;
  error: string | null;
}

// What the last "Fetch campaigns" run found, including the things that need a
// human: pages no tenant maps, campaigns split across tenants, per-account errors.
export default function FetchResultPanel({ result, error }: Props) {
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!result) return null;

  const unattributedPages = [...new Set(result.unattributed.flatMap((c) => c.page_ids))];
  const warnings = result.unattributed.length + result.conflicts.length + result.errors.length;

  return (
    <section aria-label="Last fetch result" className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-xs">
      <p className="text-on-surface-variant">
        <span className="font-semibold text-on-surface">Fetch complete:</span>{' '}
        {result.ad_accounts} ad account{result.ad_accounts === 1 ? '' : 's'} walked · {result.fetched} campaigns fetched ·{' '}
        {result.inserted} new for this tenant · {result.suggested} need confirmation · {result.unmapped} need mapping ·{' '}
        {result.confirmed_untouched} already confirmed and left alone
        {result.other_tenant ? ` · ${result.other_tenant} belong to other tenants` : ''}
      </p>
      {warnings > 0 && (
        <div role="alert" className="space-y-1.5 rounded-lg border border-status-due/30 bg-status-due-container px-3 py-2 text-on-status-due-container">
          <p className="font-semibold">{warnings} warning{warnings === 1 ? '' : 's'} during the fetch</p>
          {result.unattributed.length > 0 && (
            <p>
              {result.unattributed.length} campaign{result.unattributed.length === 1 ? '' : 's'} promote pages no tenant maps
              {unattributedPages.length > 0 ? <> (page IDs: <span className="font-mono">{unattributedPages.slice(0, 10).join(', ')}</span>)</> : null}.{' '}
              <Link href="/dashboard/meta-mappings" className="font-semibold underline">Resolve in Page Mapping</Link>, then fetch again.
            </p>
          )}
          {result.conflicts.length > 0 && (
            <p>
              {result.conflicts.length} campaign{result.conflicts.length === 1 ? '' : 's'} promote pages of more than one tenant and were
              skipped: {result.conflicts.slice(0, 5).map((c) => c.name ?? c.meta_campaign_id).join(', ')}
            </p>
          )}
          {/* Not "N accounts": the sync records per-ACCOUNT failures (a token that
              lost access) and per-CAMPAIGN ones (a row that would not upsert) in
              the same list. */}
          {result.errors.map((e, i) => (
            <p key={i}>
              <span className="font-mono">{e.ad_account_id ?? 'Unknown account'}</span>: {e.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
