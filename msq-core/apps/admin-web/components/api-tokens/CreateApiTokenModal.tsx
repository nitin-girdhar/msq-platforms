'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_SCOPES, type ApiScope } from '@platform/auth-constants';
import { Modal, Button } from '@platform/ui-kit';
import { apiTokens } from '@/src/lib/api/client';
import SecretRevealPanel from './SecretRevealPanel';

const FORM_ID = 'create-api-token-form';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  orgs: OrgOption[];
  isOrgAdmin: boolean;
  actorOrgId: string;
}

interface CreateSuccess {
  name: string;
  apiKey: string;
}

export default function CreateApiTokenModal({ open, onClose, orgs, isOrgAdmin, actorOrgId }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [scopeAllOrgs, setScopeAllOrgs] = useState(false);
  const [rateLimit, setRateLimit] = useState('60');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateSuccess | null>(null);

  const reset = () => {
    setName('');
    setScopes([]);
    setOrgIds([]);
    setScopeAllOrgs(false);
    setRateLimit('60');
    setExpiresAt('');
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    if (pending) return;
    reset();
    onClose();
    if (success) router.refresh();
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
      const { data } = await apiTokens.create({
        name: name.trim(),
        scopes,
        ...(!isOrgAdmin ? { scope_all_orgs: scopeAllOrgs, ...(scopeAllOrgs ? {} : { org_ids: orgIds }) } : {}),
        ...(rateLimit ? { rate_limit_per_min: Number(rateLimit) } : {}),
        ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      });
      setSuccess({ name: data.name, apiKey: data.api_key });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const footer = success ? (
    <div className="flex justify-end">
      <Button variant="primary" onClick={handleClose}>Done</Button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={handleClose} disabled={pending}>Cancel</Button>
      <Button variant="primary" type="submit" form={FORM_ID} disabled={pending} aria-busy={pending}>
        {pending ? 'Creating…' : 'Create token'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={success ? 'Token created' : 'New API token'} locked={pending} footer={footer}>
      {success ? (
        <SecretRevealPanel apiKey={success.apiKey} name={success.name} />
      ) : (
        <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="at-name" className="text-xs font-semibold text-[#0F172A]">Name *</label>
            <input
              id="at-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              required
              placeholder="e.g. Zapier integration"
              className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#0F172A]">Scopes *</span>
            <div className="flex flex-col gap-1.5 rounded-xl border border-[#E2E8F0] p-3">
              {API_SCOPES.map((scope) => (
                <label key={scope} className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    disabled={pending}
                    className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                  />
                  <span className="font-mono">{scope}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#0F172A]">Branches</span>
            {isOrgAdmin ? (
              <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 text-xs text-[#475569]">
                Scoped to your branch{orgs.find((o) => o.id === actorOrgId)?.name ? ` (${orgs.find((o) => o.id === actorOrgId)?.name})` : ''} only.
              </p>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                  <input
                    type="checkbox"
                    checked={scopeAllOrgs}
                    onChange={(e) => setScopeAllOrgs(e.target.checked)}
                    disabled={pending}
                    className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                  />
                  <span>All branches (tenant-wide)</span>
                </label>
                {!scopeAllOrgs && (
                  <div className="mt-1 flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-xl border border-[#E2E8F0] p-3">
                    {orgs.length === 0 && <span className="text-xs text-[#94A3B8]">No branches found.</span>}
                    {orgs.map((org) => (
                      <label key={org.id} className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                        <input
                          type="checkbox"
                          checked={orgIds.includes(org.id)}
                          onChange={() => toggleOrg(org.id)}
                          disabled={pending}
                          className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                        />
                        <span>{org.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="at-rate-limit" className="text-xs font-semibold text-[#0F172A]">Rate limit / min</label>
              <input
                id="at-rate-limit"
                type="number"
                min={1}
                max={6000}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                disabled={pending}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="at-expires" className="text-xs font-semibold text-[#0F172A]">Expires</label>
              <input
                id="at-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={pending}
                min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-[#64748B]">Leave Expires blank for a token that never expires.</p>
        </form>
      )}
    </Modal>
  );
}
