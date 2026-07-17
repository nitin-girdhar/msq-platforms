'use client';

import { useEffect, useState } from 'react';
import type { UserOrgOption } from '@crm/types';
import { auth } from '@/src/lib/api/client';

interface Props {
  callbackUrl: string;
}

// Post-login branch picker. Lists every branch the user is mapped to and
// re-mints the session for the chosen one via /auth/switch-org. Users with a
// single branch (or a failed lookup) are sent straight to the dashboard.
export default function SelectBranchList({ callbackUrl }: Props) {
  const [orgs, setOrgs] = useState<UserOrgOption[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      // Full navigation so the server-rendered dashboard layout picks up the
      // re-minted session cookie and the role held in this branch.
      window.location.assign(callbackUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the selected branch');
      setSwitching(null);
    }
  };

  if (!orgs) {
    return (
      <div className="flex justify-center py-10" role="status" aria-label="Loading branches">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {orgs.map((org) => {
        const busy = switching === org.org_id;
        return (
          <button
            key={org.org_id}
            type="button"
            onClick={() => handleSelect(org)}
            disabled={!!switching}
            aria-busy={busy}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-[#0b6cbf] hover:shadow disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#0F172A]">{org.org_name}</span>
              <span className="mt-0.5 block truncate text-xs text-[#64748B]">
                {org.role_label}
                {org.is_home ? ' · Default branch' : ''}
              </span>
            </span>
            {busy ? (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
            ) : (
              <svg className="h-4 w-4 shrink-0 text-[#94A3B8]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
