'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, MultiSelect, type SelectOption } from '@platform/ui-kit';
import {
  leadPull,
  orgs,
  type CreatePullRunInput,
  type MetaPageOption,
  type PullCampaignOption,
} from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  pages: MetaPageOption[];
  pagesUnavailable: boolean;
  // A run is already live for this tenant — the form stays visible (so the
  // scope is still readable) but cannot be submitted again.
  disabled: boolean;
  pending: boolean;
  onSubmit: (input: CreatePullRunInput) => void;
}

export default function PullFilterForm({ tenantId, pages, pagesUnavailable, disabled, pending, onSubmit }: Props) {
  const [orgOptions, setOrgOptions] = useState<SelectOption[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [selectedOrgs, setSelectedOrgs] = useState<SelectOption[]>([]);

  // Whether the page picker can offer a real list. Falls back to a typed
  // comma-separated id field — same fallback MappingFormModal uses — when
  // /meta/pages could not be listed (no active integration) or came back empty.
  const canPickPages = !pagesUnavailable && pages.length > 0;
  const pageOptions: SelectOption[] = useMemo(
    () => pages.map((p) => ({ id: p.page_id, label: p.name ?? p.page_id })),
    [pages],
  );
  const [selectedPages, setSelectedPages] = useState<SelectOption[]>([]);
  const [manualPageIds, setManualPageIds] = useState('');

  const [campaignOptions, setCampaignOptions] = useState<PullCampaignOption[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaigns, setSelectedCampaigns] = useState<SelectOption[]>([]);

  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    orgs.listAll()
      .then((res) => {
        if (cancelled) return;
        setOrgOptions(
          res.data
            .filter((o) => o.tenant_id === tenantId)
            .map((o) => ({ id: o.id, label: o.name })),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setOrgsError(err instanceof Error ? err.message : 'Could not load branches.');
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const resolvedPageIds = useMemo(() => {
    if (canPickPages) return selectedPages.map((o) => String(o.id));
    return manualPageIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  }, [canPickPages, selectedPages, manualPageIds]);

  // Cascades on the resolved page selection. Empty pages = no page filter at
  // all, which the campaigns route treats as "every campaign" rather than
  // "none" — see listPullCampaigns's `observed` handling.
  useEffect(() => {
    let cancelled = false;
    setCampaignsLoading(true);
    leadPull.campaigns(tenantId, resolvedPageIds)
      .then((res) => {
        if (cancelled) return;
        setCampaignOptions(res.data);
        // Drop any selected campaign that fell out of scope when the page
        // selection narrowed.
        setSelectedCampaigns((prev) => prev.filter((c) => res.data.some((o) => o.meta_campaign_id === c.id)));
      })
      .catch(() => {
        if (!cancelled) setCampaignOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCampaignsLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, resolvedPageIds.join(',')]);

  const campaignSelectOptions: SelectOption[] = useMemo(
    () => campaignOptions.map((c) => ({
      id: c.meta_campaign_id,
      label: c.name ? `${c.name}${c.campaign_type_label ? ` (${c.campaign_type_label})` : ''}` : c.meta_campaign_id,
    })),
    [campaignOptions],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!since) {
      setFormError('A "Since" date is required — an unbounded pull across every page is exactly what triggers Meta throttling.');
      return;
    }
    // Strictly after, matching the server schema: a date-only Until means 00:00
    // UTC, so Until == Since is an empty window the API refuses with a 422.
    if (until && until <= since) {
      setFormError('"Until" must be after "Since" — a same-day range is empty, since Until starts at midnight.');
      return;
    }

    const input: CreatePullRunInput = {
      org_ids: selectedOrgs.map((o) => String(o.id)),
      page_ids: resolvedPageIds,
      campaign_ids: selectedCampaigns.map((c) => String(c.id)),
      since,
      ...(until ? { until } : {}),
    };
    onSubmit(input);
  };

  const fieldsDisabled = disabled || pending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-4">
      {orgsError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {orgsError}
        </div>
      )}
      {formError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MultiSelect
          label="Branches"
          placeholder="All branches"
          options={orgOptions}
          selected={selectedOrgs}
          onChange={setSelectedOrgs}
          disabled={fieldsDisabled}
          allLabel="All branches"
          selectAllLabel="Select all"
        />

        {canPickPages ? (
          <MultiSelect
            label="Pages"
            placeholder="All pages"
            options={pageOptions}
            selected={selectedPages}
            onChange={setSelectedPages}
            disabled={fieldsDisabled}
            allLabel="All pages"
            selectAllLabel="Select all"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Pages</span>
            <input
              value={manualPageIds}
              onChange={(e) => setManualPageIds(e.target.value)}
              disabled={fieldsDisabled}
              placeholder="All pages, or numeric ids (comma-separated)"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
            />
            <p className="text-[11px] text-[#94A3B8]">
              Pages could not be listed for this tenant — paste numeric Page IDs instead, or leave blank for all.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <MultiSelect
            label="Campaigns"
            placeholder="All campaigns"
            options={campaignSelectOptions}
            selected={selectedCampaigns}
            onChange={setSelectedCampaigns}
            disabled={fieldsDisabled}
            loading={campaignsLoading}
            allLabel="All campaigns"
            selectAllLabel="Select all"
          />
          <p className="text-[11px] leading-snug text-[#94A3B8]">
            Meta has no campaign-scoped lead feed — every lead on the selected pages is fetched regardless. Narrowing
            campaigns focuses the REVIEW, not the pull; it will not run faster or cheaper.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="lp-since" className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
            Since <span className="text-red-500">*</span>
          </label>
          <input
            id="lp-since"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            disabled={fieldsDisabled}
            required
            className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
          />
          <p className="text-[11px] text-[#94A3B8]">
            Required — an unbounded pull across every page is exactly the operation that triggers Meta throttling.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lp-until" className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
            Until
          </label>
          <input
            id="lp-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            disabled={fieldsDisabled}
            className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:opacity-60"
          />
          <p className="text-[11px] text-[#94A3B8]">Optional — omit for up to now.</p>
        </div>

        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={fieldsDisabled} aria-busy={pending}>
            {pending ? 'Starting…' : 'Pull'}
          </Button>
        </div>
      </div>
    </form>
  );
}
