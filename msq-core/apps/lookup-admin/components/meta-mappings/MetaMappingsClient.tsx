"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, type SearchableOption } from "@platform/ui-kit";
import {
  orgs,
  type MetaPageOption,
  type MetaPageOrgMapRow,
} from "@/src/lib/api/client";
import MetaMappingsGrid from "./MetaMappingsGrid";
import MappingFormModal from "./MappingFormModal";

interface Props {
  tenantId: string;
  // From the navbar org switcher. undefined is the normal "all branches in this
  // tenant" case and only narrows the grid — it never blocks it.
  selectedOrgId?: string | undefined;
  // From ?page_id= — set when arriving from the lead-pull summary's
  // unmapped_form link. Narrows the grid to that one page.
  pageIdFilter?: string | undefined;
  rows: MetaPageOrgMapRow[];
  pages: MetaPageOption[];
  pagesUnavailable: boolean;
}

export default function MetaMappingsClient({
  tenantId,
  selectedOrgId,
  pageIdFilter,
  rows,
  pages,
  pagesUnavailable,
}: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MetaPageOrgMapRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgList, setOrgList] = useState<
    Array<{ id: string; name: string; tenant_id: string }>
  >([]);

  // Branches for the picker and for resolving org_id -> name on the grid. The
  // mapping rows carry only org_id: entity.organizations is not readable inside
  // the service's RLS transaction (its app_user policy keys on the actor's own
  // memberships, and a platform super_admin holds none in an administered
  // tenant), so the join has to happen here against the cross-tenant
  // /lookups/organizations route.
  useEffect(() => {
    let cancelled = false;
    orgs
      .listAll()
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

  const tenantOrgs = useMemo(
    () => orgList.filter((o) => o.tenant_id === tenantId),
    [orgList, tenantId],
  );

  const orgOptions: SearchableOption[] = useMemo(
    () => tenantOrgs.map((o) => ({ id: o.id, label: o.name })),
    [tenantOrgs],
  );

  const orgNames = useMemo(
    () => Object.fromEntries(orgList.map((o) => [o.id, o.name])),
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

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard/m/lms"
            className="text-xs font-semibold text-[#0b6cbf] hover:underline"
          >
            ← Back to LMS
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">
            Meta Page Mapping
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">
            {visibleRows.length} mapping{visibleRows.length === 1 ? "" : "s"} ·
            Which branch every inbound Meta lead lands in.
            {selectedOrgId
              ? " Narrowed to the branch selected in the top bar."
              : ""}
            {pageIdFilter ? (
              <>
                {" "}Filtered to page{" "}
                <span className="font-mono">
                  {pageNames[pageIdFilter] ?? pageIdFilter}
                </span>
                {" · "}
                <Link
                  href="/dashboard/meta-mappings"
                  className="font-semibold text-[#0b6cbf] hover:underline"
                >
                  clear
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          New
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {pagesUnavailable && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          Meta pages could not be listed for this tenant — it may have no active
          Meta integration configured. Existing mappings are unaffected; new
          ones need the numeric Page ID typed in.
        </div>
      )}

      <MetaMappingsGrid
        rows={visibleRows}
        pageNames={pageNames}
        orgNames={orgNames}
        onEdit={openEdit}
      />

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
        onSaved={handleSaved}
      />
    </div>
  );
}
