'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_SCOPES, type ApiScope } from '@platform/auth-constants';
import { Sheet, Button } from '@platform/ui-kit';
import { apiTokens } from '@/src/lib/api/client';
import type { ApiTokenRow } from '@/src/lib/api/client';

const FORM_ID = 'edit-api-token-form';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  token: ApiTokenRow;
  orgs: OrgOption[];
  isOrgAdmin: boolean;
}

export default function EditApiTokenModal({ open, onClose, token, orgs, isOrgAdmin }: Props) {
  const router = useRouter();
  const [name, setName] = useState(token.name);
  const [scopes, setScopes] = useState<ApiScope[]>(token.scopes);
  const [orgIds, setOrgIds] = useState<string[]>(token.org_ids);
  const [scopeAllOrgs, setScopeAllOrgs] = useState(token.scope_all_orgs);
  const [rateLimit, setRateLimit] = useState(String(token.rate_limit_per_min ?? 60));
  const [expiresAt, setExpiresAt] = useState(token.expires_at ? token.expires_at.slice(0, 10) : '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (pending) return;
    onClose();
  };

  const toggleScope = (scope: ApiScope) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const toggleOrg = (id: string) => {
    setOrgIds((prev) => (prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (scopes.length === 0) {
      setError('Select at least one scope.');
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError('Expiry must be in the future.');
      return;
    }

    setPending(true);
    try {
      await apiTokens.update(token.id, {
        name: name.trim(),
        scopes,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        ...(rateLimit ? { rate_limit_per_min: Number(rateLimit) } : {}),
        ...(!isOrgAdmin ? { scope_all_orgs: scopeAllOrgs, ...(scopeAllOrgs ? {} : { org_ids: orgIds }) } : {}),
      });
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="secondary" onClick={handleClose} disabled={pending}>Cancel</Button>
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="primary" type="submit" form={FORM_ID} disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={handleClose} title={`Edit "${token.name}"`} locked={pending} footer={footer}>
      <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
            {error}
          </div>
        )}

        <p className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-xs text-on-surface-variant">
          Key: <span className="font-mono">{token.key_prefix}…</span> — the key itself cannot be viewed or changed here. Use Rotate to issue a new one.
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="et-name" className="text-xs font-semibold text-on-surface">Name *</label>
          <input
            id="et-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-on-surface">Scopes *</span>
          <div className="flex flex-col gap-1.5 rounded-xl border border-outline-variant p-3">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
                />
                <span className="font-mono">{scope}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-on-surface">Branches</span>
          {isOrgAdmin ? (
            <p className="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-xs text-on-surface-variant">
              Scoped to your branch only.
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
                <input
                  type="checkbox"
                  checked={scopeAllOrgs}
                  onChange={(e) => setScopeAllOrgs(e.target.checked)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
                />
                <span>All branches (tenant-wide)</span>
              </label>
              {!scopeAllOrgs && (
                <div className="mt-1 flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-xl border border-outline-variant p-3">
                  {orgs.length === 0 && <span className="text-xs text-outline">No branches found.</span>}
                  {orgs.map((org) => (
                    <label key={org.id} className="flex cursor-pointer items-center gap-2 text-xs text-on-surface">
                      <input
                        type="checkbox"
                        checked={orgIds.includes(org.id)}
                        onChange={() => toggleOrg(org.id)}
                        disabled={pending}
                        className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
                      />
                      <span>{org.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="et-rate-limit" className="text-xs font-semibold text-on-surface">Rate limit / min</label>
            <input
              id="et-rate-limit"
              type="number"
              min={1}
              max={6000}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              disabled={pending}
              className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="et-expires" className="text-xs font-semibold text-on-surface">Expires on</label>
            <input
              id="et-expires"
              type="date"
              lang="en-GB"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={pending}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low"
            />
          </div>
        </div>
        <p className="-mt-2 text-[0.6875rem] text-outline">Leave Expires blank to clear the expiry (never expires).</p>
      </form>
    </Sheet>
  );
}
