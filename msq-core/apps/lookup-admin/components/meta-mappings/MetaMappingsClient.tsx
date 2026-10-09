"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, PageBody, PageHeader, buildFilename, exportRows, type SearchableOption } from "@platform/ui-kit";
import {
  orgs,
  campaignTypes,
  metaMappings,
  metaLeadInbox,
  metaPageHealth,
  type MetaPageHealthRow,
  type MetaPageOption,
  type MetaPageOrgMapRow,
  type OrgOption,
} from "@/src/lib/api/client";
import MetaMappingsGrid from "./MetaMappingsGrid";
import MappingFormModal from "./MappingFormModal";
import MetaTabs from "@/components/meta-nav/MetaTabs";
import KpiTile from "@/components/meta-shared/KpiTile";

type KindFilter = "all" | "page" | "form";

interface Props {
  tenantId: string;
  /** Named in the header so a login-time tenant reset is visible here, not
   *  mistaken for an edit that did not save. See getSelectedTenantName(). */
  tenantName: string | undefined;
  // From the navbar org switcher. undefined is the normal "all branches in this
  // tenant" case and only narrows the grid — it never blocks it.
  selectedOrgId?: string | undefined;
  // From ?page_id= — set when arriving from the lead-pull summary's
  // unmapped_form link. Narrows the grid to that one page.
  pageIdFilter?: string | undefined;
  rows: MetaPageOrgMapRow[];
}

export default function MetaMappingsClient({
  tenantId,
  tenantName,
  selectedOrgId,
  pageIdFilter,
  rows,
}: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MetaPageOrgMapRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, MetaPageHealthRow>>({});
  const [validating, setValidating] = useState(false);
  const [unmappedInbound, setUnmappedInbound] = useState<number | null>(null);
  // Live Graph page list: loaded once per tenant here (not in the server component,
  // which re-runs on every save). pagesUnavailable = no integration / Graph failure.
  const [pages, setPages] = useState<MetaPageOption[]>([]);
  const [pagesUnavailable, setPagesUnavailable] = useState(false);
  const [kind, setKind] = useState<KindFilter>("all");
  const [branchFilter, setBranchFilter] = useState("");
  const [search, setSearch] = useState("");
  const [orgList, setOrgList] = useState<OrgOption[]>([]);

  // Branches for the picker and for resolving org_id -> name on the grid. The
  // mapping rows carry only org_id: entity.organizations is not readable inside
  // the service's RLS transaction (its app_user policy keys on the actor's own
  // memberships, and a platform super_admin holds none in an administered
  // tenant), so the join has to happen here against the cross-tenant
  // /lookups/organizations route.
  useEffect(() => {
    let cancelled = false;
    orgs
      .listAll(true)
      .then((res) => {
        if (!cancelled) setOrgList(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Could not load branches.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The tenant's live campaign types, for the page/form default type (1.51.0).
  // Best-effort: without them the default-type picker only offers "no default".
  const [typeOptions, setTypeOptions] = useState<SearchableOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    campaignTypes
      .list(tenantId)
      .then((res) => {
        if (!cancelled)
          setTypeOptions(res.data.filter((t) => t.is_active).map((t) => ({ id: t.id, label: t.label })));
      })
      .catch(() => {
        if (!cancelled) setTypeOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    setPages([]);
    setPagesUnavailable(false);
    metaMappings
      .pages(tenantId)
      .then((res) => { if (!cancelled) setPages(res.data); })
      .catch(() => { if (!cancelled) setPagesUnavailable(true); });
    return () => { cancelled = true; };
  }, [tenantId]);

  // 1.70.0: stored token health per page, and how many open inbox leads are stuck on an
  // unmapped page — this tenant's, plus the tenant-less ones (a page mapped to nobody yet).
  useEffect(() => {
    let cancelled = false;
    metaPageHealth
      .list(tenantId)
      .then((res) => { if (!cancelled) setHealth(Object.fromEntries(res.data.map((h) => [h.page_id, h]))); })
      .catch(() => { if (!cancelled) setHealth({}); });
    // `total` is the server-side count of the whole match, not the (capped) row list.
    Promise.all([
      metaLeadInbox.list(tenantId, "open", "unmapped"),
      metaLeadInbox.list(null, "open", "unmapped"),
    ])
      .then(([mine, orphan]) => { if (!cancelled) setUnmappedInbound(mine.total + orphan.total); })
      .catch(() => { if (!cancelled) setUnmappedInbound(null); });
    return () => { cancelled = true; };
    // `rows` changes identity after each save (router.refresh), so mapping a page
    // refreshes the unmapped-inbound figure instead of leaving it stale.
  }, [tenantId, rows]);

  // 1.79.0: subscribe the app to ONE page's leadgen webhook, then re-check it (the service returns the fresh health).
  const [subscribingPageId, setSubscribingPageId] = useState<string | null>(null);
  const subscribePage = async (pageId: string) => {
    setSubscribingPageId(pageId);
    setError(null);
    try {
      const res = await metaPageHealth.subscribe(tenantId, pageId);
      setHealth(Object.fromEntries(res.data.map((h) => [h.page_id, h])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not subscribe the app to that page.");
    } finally {
      setSubscribingPageId(null);
    }
  };

  const validateTokens = async () => {
    setValidating(true);
    setError(null);
    try {
      const res = await metaPageHealth.validate(tenantId);
      setHealth(Object.fromEntries(res.data.map((h) => [h.page_id, h])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate the page tokens.");
    } finally {
      setValidating(false);
    }
  };

  const tenantOrgs = useMemo(
    () => orgList.filter((o) => o.tenant_id === tenantId),
    [orgList, tenantId],
  );

  // Offer active branches, plus a deactivated one only while an existing mapping
  // still points at it -- otherwise editing that mapping shows a blank picker.
  const orgOptions: SearchableOption[] = useMemo(() => {
    const mapped = new Set(rows.map((r) => r.org_id));
    return tenantOrgs
      .filter((o) => o.is_active || mapped.has(o.id))
      .map((o) => ({ id: o.id, label: o.is_active ? o.name : `${o.name} (inactive)` }));
  }, [tenantOrgs, rows]);

  const orgNames = useMemo(
    () => Object.fromEntries(orgList.map((o) => [o.id, o.is_active ? o.name : `${o.name} (inactive)`])),
    [orgList],
  );

  const pageNames = useMemo(
    () =>
      Object.fromEntries(
        pages.filter((p) => p.name).map((p) => [p.page_id, p.name as string]),
      ),
    [pages],
  );

  // The list route validates its query with tenantScopedQuerySchema (tenant_id
  // only), so an &org_id= would be parsed away server-side and silently ignored
  // — which looks exactly like a filter that does not work. The navbar org
  // narrows the rows here instead, where the behaviour is visible and honest.
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedOrgId || r.org_id === selectedOrgId) &&
          (!pageIdFilter || r.page_id === pageIdFilter),
      ),
    [rows, selectedOrgId, pageIdFilter],
  );

  const stats = useMemo(() => {
    const pageLevel = visibleRows.filter((r) => r.form_id === null).length;
    return {
      total: visibleRows.length,
      pageLevel,
      form: visibleRows.length - pageLevel,
      inactive: visibleRows.filter((r) => !r.is_active).length,
      branches: new Set(visibleRows.map((r) => r.org_id)).size,
    };
  }, [visibleRows]);

  const branchChoices = useMemo(
    () => [...new Set(visibleRows.map((r) => r.org_id))]
      .map((id) => ({ id, name: orgNames[id] ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleRows, orgNames],
  );

  const shownRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleRows.filter((r) => {
      if (kind === "page" && r.form_id !== null) return false;
      if (kind === "form" && r.form_id === null) return false;
      if (branchFilter && r.org_id !== branchFilter) return false;
      if (!q) return true;
      return [pageNames[r.page_id], r.page_id, r.form_id, orgNames[r.org_id], r.default_campaign_type_label]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [visibleRows, kind, branchFilter, search, pageNames, orgNames]);

  const handleExport = () => {
    exportRows(
      shownRows,
      [
        { header: "Page", value: (r: MetaPageOrgMapRow) => pageNames[r.page_id] ?? "" },
        { header: "Page ID", value: (r) => r.page_id },
        { header: "Form", value: (r) => r.form_id ?? "All forms (page-level)" },
        { header: "Branch", value: (r) => orgNames[r.org_id] ?? r.org_id },
        { header: "Default type", value: (r) => r.default_campaign_type_label ?? "" },
        { header: "Platform", value: (r) => r.platform },
        { header: "Status", value: (r) => (r.is_active ? "Active" : "Inactive") },
        { header: "Last lead", value: (r) => r.last_synced_at ?? "" },
      ],
      buildFilename(["meta-page-mappings"]),
      "csv",
    );
  };

  const handleSaved = () => {
    setError(null);
    // Re-runs the server component, which refetches the mappings under the
    // current tenant/org cookies.
    router.refresh();
  };

  const openCreate = () => {
    setEditTarget(null);
    setModalOpen(true);
  };

  const openEdit = (row: MetaPageOrgMapRow) => {
    setEditTarget(row);
    setModalOpen(true);
  };

  const KINDS: ReadonlyArray<{ id: KindFilter; label: string; count: number }> = [
    { id: "all", label: "All Mappings", count: stats.total },
    { id: "page", label: "Page-Level Only", count: stats.pageLevel },
    { id: "form", label: "Form-Level", count: stats.form },
  ];

  return (
    <>
      <PageHeader
        title="Meta Page & Branch Mapping"
        scope={tenantName}
        subtitle={`${stats.total} mapping${stats.total === 1 ? "" : "s"}${selectedOrgId ? " · branch from top bar" : ""}`}
        info="Which branch every inbound Meta lead lands in. When a branch is picked in the top bar, the list is narrowed to it."
        tabs={<MetaTabs />}
        actions={
          <>
            <Button onClick={validateTokens} disabled={validating || rows.length === 0} aria-busy={validating}>
              {validating ? "Validating…" : "Validate Page Tokens"}
            </Button>
            <Button onClick={handleExport} disabled={shownRows.length === 0}>Export CSV</Button>
            <Button variant="primary" onClick={openCreate}>Map New Page</Button>
          </>
        }
      />
      <PageBody dense>
        {pageIdFilter ? (
          <p className="text-xs text-on-surface-variant">
            Filtered to page <span className="font-mono">{pageNames[pageIdFilter] ?? pageIdFilter}</span>
            {" · "}
            <Link href="/dashboard/meta-mappings" className="font-semibold text-primary hover:underline">clear</Link>
          </p>
        ) : null}

        {error && <Alert tone="error">{error}</Alert>}

        {pagesUnavailable && (
          <div role="status" className="rounded-lg border border-status-due/30 bg-status-due-container px-3 py-2 text-xs text-on-status-due-container">
            Meta pages could not be listed for this tenant — it may have no active Meta integration configured.
            Existing mappings are unaffected; new ones need the numeric Page ID typed in.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Total Mappings", value: stats.total, note: `Across ${stats.branches} branch${stats.branches === 1 ? "" : "es"}` },
            { label: "Page-Level Rules", value: stats.pageLevel, note: "Cover every form on the page" },
            { label: "Form Overrides", value: stats.form, note: "Win over the page-level rule" },
            { label: "Inactive", value: stats.inactive, note: "Not routing any lead" },
            {
              label: "Unmapped inbound",
              value: unmappedInbound ?? "—",
              note: unmappedInbound === 0 ? "No lead is waiting on a mapping" : "Open leads in the Lead Review Inbox",
            },
          ].map((c) => <KpiTile key={c.label} label={c.label} value={c.value} note={c.note} />)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search page, page ID, form or branch…"
            aria-label="Search mappings"
            className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:max-w-sm"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mapping type">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  kind === k.id ? "border-primary bg-primary-fixed text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {k.label} ({k.count})
              </button>
            ))}
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Filter by branch"
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="">All branches ({stats.branches})</option>
            {branchChoices.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
          <strong className="text-on-surface">Routing precedence.</strong> An incoming lead is checked against a{" "}
          <strong className="text-on-surface">form-level</strong> mapping first. With no form override it falls back to the{" "}
          <strong className="text-on-surface">page-level</strong> mapping. A lead with neither lands in the{" "}
          <Link href="/dashboard/meta-lead-inbox" className="font-semibold text-primary hover:underline">Lead Review Inbox</Link>.
        </div>

      <MetaMappingsGrid
        rows={shownRows}
        pageNames={pageNames}
        orgNames={orgNames}
        onEdit={openEdit}
        health={health}
        onSubscribe={subscribePage}
        subscribingPageId={subscribingPageId}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
        <Link href="/dashboard/meta-ad-accounts" className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container">
          ← Previous: Meta Ad Accounts
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/meta-lead-inbox" className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container">
            View Unmapped Leads Review
          </Link>
          <Link href="/dashboard/meta-campaigns" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary hover:bg-primary/90">
            Next: Campaign Mapping &amp; Rules →
          </Link>
        </div>
      </div>
      </PageBody>

      {/* Create and edit share one modal. Deactivating is the Active
          checkbox on the edit form — a PATCH { is_active: false } — matching
          the no-delete convention every other lookup screen follows: removing a
          mapping silently re-routes every future lead on that page, and the row
          is the only record of where they used to go. The DELETE route exists
          on the service but is deliberately not wired into the UI. */}
      <MappingFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tenantId={tenantId}
        row={editTarget}
        pages={pages}
        pagesUnavailable={pagesUnavailable}
        orgOptions={orgOptions}
        campaignTypeOptions={typeOptions}
        onSaved={handleSaved}
      />
    </>
  );
}
