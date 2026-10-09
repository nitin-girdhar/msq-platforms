'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, InfoTip, LocalDateTime, Modal, PageBody, PageHeader, SearchableSelect, type SearchableOption } from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import {
  metaDatasets,
  metaPortfolios,
  orgs as orgsApi,
  type DatasetStatus,
  type MetaDatasetRow,
  type MetaOrgDatasetRow,
  type MetaPortfolioRow,
  type OrgOption,
} from '@/src/lib/api/client';
import PortfolioModal from './PortfolioModal';
import DatasetModal from './DatasetModal';
import AdAccountLinkModal from './AdAccountLinkModal';

interface Props {
  tenants: Array<{ id: string; name: string }>;
  /** The session's tenant, offered as the starting filter. */
  initialTenantId: string | undefined;
}

const STATUS_TONE: Record<DatasetStatus, string> = {
  ACTIVE: 'bg-status-success-container text-on-status-success-container',
  PENDING: 'bg-surface-container text-on-surface-variant',
  NO_ACCESS: 'bg-error-container text-on-error-container',
  DISABLED: 'bg-surface-container text-on-surface-variant',
};
const PARTNER_TONE: Record<string, string> = {
  ACTIVE: 'bg-status-success-container text-on-status-success-container',
  PENDING: 'bg-status-due-container text-on-status-due-container',
  REVOKED: 'bg-error-container text-on-error-container',
};

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

type Confirm =
  | { kind: 'portfolio'; row: MetaPortfolioRow }
  | { kind: 'dataset'; row: MetaDatasetRow }
  | null;

// Business portfolios and their datasets (pixels), which ad accounts feed each, and the per-branch fallback
// (1.79.0). Platform-level data OWNED by tenants: a portfolio belongs to exactly one tenant, a dataset inherits
// it, and the database refuses a dataset filed under another tenant's portfolio. Events for a lead go only to a
// dataset of the lead's own tenant, found from its campaign's ad account.
export default function MetaDatasetsClient({ tenants, initialTenantId }: Props) {
  const [tenantFilter, setTenantFilter] = useState(initialTenantId ?? '');
  const [portfolios, setPortfolios] = useState<MetaPortfolioRow[]>([]);
  const [datasets, setDatasets] = useState<MetaDatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [portfolioModal, setPortfolioModal] = useState<{ row: MetaPortfolioRow | null } | null>(null);
  const [datasetModal, setDatasetModal] = useState<{ row: MetaDatasetRow | null; portfolio: MetaPortfolioRow | null } | null>(null);
  const [linkFor, setLinkFor] = useState<MetaDatasetRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirming, setConfirming] = useState(false);

  const tenantOptions: SearchableOption[] = useMemo(() => tenants.map((t) => ({ id: t.id, label: t.name })), [tenants]);

  // Newest request wins: changing the tenant filter quickly must not let a slow earlier answer overwrite the list.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        metaPortfolios.list(tenantFilter || undefined),
        metaDatasets.list(tenantFilter || undefined),
      ]);
      if (seq !== loadSeq.current) return;
      setPortfolios(p.data);
      setDatasets(d.data);
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : 'Could not load portfolios and datasets.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [tenantFilter]);

  useEffect(() => { void load(); }, [load]);

  const verify = async (d: MetaDatasetRow) => {
    setBusyId(d.id);
    setError(null);
    setNotice(null);
    try {
      const res = await metaDatasets.verify(d.id);
      setNotice(res.data.status === 'ACTIVE' ? `Dataset ${res.data.name ?? res.data.dataset_id} is reachable.` : `Dataset ${d.dataset_id}: ${res.data.last_error ?? 'not reachable'}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the dataset.');
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (d: MetaDatasetRow, status: DatasetStatus) => {
    setBusyId(d.id);
    setError(null);
    try {
      await metaDatasets.update(d.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the dataset.');
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setConfirming(true);
    setError(null);
    try {
      if (confirm.kind === 'portfolio') await metaPortfolios.remove(confirm.row.id);
      else await metaDatasets.remove(confirm.row.id);
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setConfirming(false);
    }
  };

  const datasetsByPortfolio = useMemo(() => {
    const m = new Map<string, MetaDatasetRow[]>();
    for (const d of datasets) m.set(d.portfolio_id, [...(m.get(d.portfolio_id) ?? []), d]);
    return m;
  }, [datasets]);

  return (
    <>
      <PageHeader
        title="Meta Datasets"
        subtitle="Portfolios, datasets (pixels) and the ad accounts feeding each"
        info={
          <p>
            A lead&apos;s conversion events go to the dataset linked to <strong>its campaign&apos;s ad account</strong>, and only to a dataset
            owned by the lead&apos;s own tenant. Register each client&apos;s portfolio under the tenant that owns it, add its datasets, link
            their ad accounts, then <strong>Verify</strong>. That confirms the events system user can reach the dataset.
          </p>
        }
        tabs={<MetaTabs />}
        actions={<Button variant="primary" onClick={() => setPortfolioModal({ row: null })}>Add portfolio</Button>}
      />
      <PageBody dense>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72 max-w-full">
            <SearchableSelect
              value={tenantFilter}
              onChange={setTenantFilter}
              options={tenantOptions}
              emptyLabel="All tenants"
              ariaLabel="Filter by tenant"
              className="w-full"
            />
          </div>
          <Button onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {loading && portfolios.length === 0 && <p className="text-xs text-on-surface-variant">Loading…</p>}
        {!loading && portfolios.length === 0 && (
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-6 text-center text-sm text-on-surface-variant">
            No portfolios yet{tenantFilter ? ' for this tenant' : ''}. Add the first one.
          </p>
        )}

        {portfolios.map((p) => {
          const ds = datasetsByPortfolio.get(p.id) ?? [];
          return (
            <section key={p.id} className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest" aria-label={p.name ?? p.meta_business_id}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-on-surface">{p.name ?? `Portfolio ${p.meta_business_id}`}</h2>
                  <p className="text-xs text-on-surface-variant">
                    <span className="font-semibold text-on-surface">{p.tenant_name}</span> · <span className="font-mono">{p.meta_business_id}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill cls="bg-surface-container text-on-surface-variant">{p.kind === 'BRAND' ? 'Brand' : 'Franchise'}</Pill>
                  <Pill cls={PARTNER_TONE[p.partner_status] ?? PARTNER_TONE['PENDING']!}>Partner: {p.partner_status.toLowerCase()}</Pill>
                  <Button size="sm" onClick={() => setDatasetModal({ row: null, portfolio: p })}>Add dataset</Button>
                  <Button size="sm" onClick={() => setPortfolioModal({ row: p })}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'portfolio', row: p })}>Delete</Button>
                </div>
              </div>

              {ds.length === 0 ? (
                <p className="px-4 pb-3 text-xs text-on-surface-variant">No datasets under this portfolio yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-on-surface-variant">
                      <tr>
                        <th className="px-4 py-2">Dataset</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Ad accounts</th>
                        <th className="px-3 py-2">Last verified</th>
                        <th className="px-3 py-2 text-right" />
                      </tr>
                    </thead>
                    <tbody>
                      {ds.map((d) => (
                        <tr key={d.id} className="border-t border-outline-variant align-top">
                          <td className="px-4 py-2">
                            <span className="block font-semibold text-on-surface">{d.name ?? 'Unnamed dataset'}</span>
                            <span className="block font-mono text-on-surface-variant">{d.dataset_id}</span>
                            {d.test_event_code && <Pill cls="mt-1 bg-status-due-container text-on-status-due-container">Test mode · {d.test_event_code}</Pill>}
                          </td>
                          <td className="px-3 py-2">
                            <Pill cls={STATUS_TONE[d.status]}>{d.status.replace('_', ' ').toLowerCase()}</Pill>
                            {d.last_error && <span className="mt-1 block max-w-xs text-on-error-container">{d.last_error}</span>}
                          </td>
                          <td className="px-3 py-2">
                            {d.ad_account_ids.length === 0
                              ? <span className="text-on-status-due-container">None linked — its leads fall back to the branch dataset</span>
                              : <span className="flex flex-wrap gap-1">{d.ad_account_ids.map((a) => <Pill key={a} cls="bg-surface-container font-mono text-on-surface-variant">{a}</Pill>)}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">{d.last_verified_at ? <LocalDateTime value={d.last_verified_at} /> : 'Never'}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex flex-wrap justify-end gap-1">
                              <Button size="sm" onClick={() => void verify(d)} disabled={busyId === d.id} aria-busy={busyId === d.id}>{busyId === d.id ? 'Checking…' : 'Verify'}</Button>
                              <Button size="sm" onClick={() => setLinkFor(d)}>Ad accounts</Button>
                              <Button size="sm" onClick={() => setDatasetModal({ row: d, portfolio: p })}>Edit</Button>
                              <Button size="sm" onClick={() => void setStatus(d, d.status === 'DISABLED' ? 'PENDING' : 'DISABLED')} disabled={busyId === d.id}>
                                {d.status === 'DISABLED' ? 'Enable' : 'Disable'}
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'dataset', row: d })}>Delete</Button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

        <BranchFallback tenantId={tenantFilter} datasets={datasets} />
      </PageBody>

      <PortfolioModal
        open={portfolioModal !== null}
        onClose={() => setPortfolioModal(null)}
        onSaved={() => void load()}
        row={portfolioModal?.row ?? null}
        tenantOptions={tenantOptions}
        defaultTenantId={tenantFilter || undefined}
      />
      <DatasetModal
        open={datasetModal !== null}
        onClose={() => setDatasetModal(null)}
        onSaved={() => void load()}
        row={datasetModal?.row ?? null}
        portfolio={datasetModal?.portfolio ?? null}
      />
      <AdAccountLinkModal open={linkFor !== null} onClose={() => setLinkFor(null)} onSaved={() => void load()} dataset={linkFor} />

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'portfolio' ? 'Delete this portfolio?' : 'Delete this dataset?'}
        locked={confirming}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={confirming}>Cancel</Button>
            <Button variant="danger" onClick={() => void doDelete()} disabled={confirming} aria-busy={confirming}>{confirming ? 'Deleting…' : 'Delete'}</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface">
          {confirm?.kind === 'portfolio'
            ? 'Its datasets and their ad-account links are removed too. A portfolio whose datasets have already sent events cannot be deleted — disable the datasets instead.'
            : 'Its ad-account links are removed; leads that reported to it will park until another dataset is linked. A dataset that has already sent events cannot be deleted — disable it instead.'}
        </p>
      </Modal>
    </>
  );
}

// ── Per-branch fallback ─────────────────────────────────────────────────────
// Used only when a lead's ad account is unknown or not linked. Needs a tenant: the branch list and the dataset
// list are both that tenant's, and the database rejects a branch or dataset from another one.
function BranchFallback({ tenantId, datasets }: { tenantId: string; datasets: MetaDatasetRow[] }) {
  const [rows, setRows] = useState<MetaOrgDatasetRow[]>([]);
  const [branches, setBranches] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) { setRows([]); return; }
    try {
      const res = await metaDatasets.orgMap(tenantId);
      setRows(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the branch fallback.');
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    orgsApi.listAll().then((res) => { if (!cancelled) setBranches(res.data); }).catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, []);

  const branchOptions: SearchableOption[] = useMemo(
    () => branches.filter((b) => b.tenant_id === tenantId).map((b) => ({ id: b.id, label: b.name })),
    [branches, tenantId],
  );
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const datasetOptions: SearchableOption[] = useMemo(
    () => datasets.filter((d) => d.tenant_id === tenantId && d.status !== 'DISABLED').map((d) => ({ id: d.id, label: d.name ?? d.dataset_id, hint: d.dataset_id })),
    [datasets, tenantId],
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await metaDatasets.setOrg(tenantId, orgId, datasetId);
      setOrgId('');
      setDatasetId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the branch dataset.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (org: string) => {
    setBusy(true);
    setError(null);
    try {
      await metaDatasets.clearOrg(tenantId, org);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the branch dataset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3" aria-labelledby="fallback-heading">
      <div>
        <h2 id="fallback-heading" className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
          Branch fallback
          <InfoTip label="About branch fallback">
            When a lead&apos;s ad account is unknown or not linked to a dataset, its events go to its <strong>origin branch&apos;s</strong> dataset
            below, never to whichever branch holds the lead later. Leave a branch unset to park its events until an ad account is linked.
          </InfoTip>
        </h2>
      </div>

      {!tenantId ? (
        <p className="text-xs text-on-surface-variant">Pick a tenant above to manage its branches.</p>
      ) : (
        <>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64 max-w-full">
              <SearchableSelect value={orgId} onChange={setOrgId} options={branchOptions} placeholder="Branch…" ariaLabel="Branch" className="w-full" />
            </div>
            <div className="w-64 max-w-full">
              <SearchableSelect value={datasetId} onChange={setDatasetId} options={datasetOptions} placeholder="Dataset…" ariaLabel="Dataset" className="w-full" />
            </div>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !orgId || !datasetId} aria-busy={busy}>Set fallback</Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-on-surface-variant">No branch fallbacks set.</p>
          ) : (
            <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant text-xs">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span><strong className="text-on-surface">{branchName(r.org_id)}</strong> → {r.dataset_label}</span>
                  <Button size="sm" variant="danger" onClick={() => void clear(r.org_id)} disabled={busy}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
