'use client';

import { useEffect, useState } from 'react';
import type { UserOrgOption } from '@platform/types';
import { auth } from '@/src/lib/api/client';

interface Props {
  // Absolute product URL to land on once a branch is chosen (allowlist-validated
  // server-side). Cross-origin, so navigation uses window.location.
  callbackUrl: string;
}

// Post-login branch picker. Lists every branch the user is mapped to and
// re-mints the session for the chosen one via /auth/switch-org. Users with a
// single branch (or a failed lookup) are sent straight to the product.
//
// A platform super_admin's list spans every tenant (rows carry tenant_id /
// tenant_name), so it is grouped under a heading per tenant; picking a branch
// enters that tenant.
function groupByTenant(orgs: UserOrgOption[]): Array<{ key: string; name: string | null; orgs: UserOrgOption[] }> {
  if (!orgs.some((o) => o.tenant_id)) return [{ key: 'all', name: null, orgs }];
  const groups = new Map<string, { key: string; name: string | null; orgs: UserOrgOption[] }>();
  for (const o of orgs) {
    const key = o.tenant_id ?? '';
    const g = groups.get(key) ?? { key, name: o.tenant_name ?? null, orgs: [] };
    g.orgs.push(o);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}
export default function SelectBranchList({ callbackUrl }: Props) {
  const [orgs, setOrgs] = useState<UserOrgOption[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side filter over the already-fetched list (display only).
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    auth
      .myOrgs()
      .then((res) => {
        if (cancelled) return;
        if (res.data.orgs.length <= 1) {
          window.location.assign(callbackUrl);
          return;
        }
        setOrgs(res.data.orgs);
      })
      .catch(() => {
        if (!cancelled) window.location.assign(callbackUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [callbackUrl]);

  const handleSelect = async (org: UserOrgOption) => {
    if (switching) return;
    setSwitching(org.org_id);
    setError(null);
    try {
      // Always re-mint (even for the home branch) so the session role comes
      // from the branch's user_org_mapping row rather than the login default.
      await auth.switchOrg(org.org_id);
      // Full navigation so the product app server-renders with the re-minted
      // session cookie and the role held in this branch.
      window.location.assign(callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the selected branch');
      setSwitching(null);
    }
  };

  if (!orgs) {
    return (
      <div className="flex justify-center py-10" role="status" aria-label="Loading branches">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden />
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? orgs.filter((o) =>
        [o.org_name, o.role_label, o.tenant_name ?? ''].some((v) => v.toLowerCase().includes(q)),
      )
    : orgs;
  const groups = groupByTenant(visible);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          {error}
        </div>
      )}

      {/* Worth having only when scanning is slow; harmless otherwise. */}
      {orgs.length > 6 && (
        <div className="relative">
          <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branches"
            aria-label="Search branches"
            autoComplete="off"
            className="min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-3.5 text-body-md text-on-surface transition-colors placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {visible.length === 0 && (
        <p role="status" className="py-6 text-center text-body-sm text-on-surface-variant">
          No branches match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          {group.name && (
            <h2 className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{group.name}</h2>
          )}
          <div className="flex flex-col gap-2">
            {group.orgs.map((org) => {
              const busy = switching === org.org_id;
              return (
                <div key={org.org_id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(org)}
                    disabled={!!switching}
                    aria-busy={busy}
                    className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary-fixed/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                      org.is_home ? 'border-primary/40 bg-primary-fixed/30' : 'border-outline-variant bg-surface-container-lowest'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-md font-semibold text-on-surface">{org.org_name}</span>
                      <span className="mt-0.5 block truncate text-label-md text-on-surface-variant">
                        {org.role_label}
                        {org.is_home ? ' · Default' : ''}
                      </span>
                    </span>
                    {busy ? (
                      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden />
                    ) : (
                      <svg className="h-4 w-4 shrink-0 text-outline" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
