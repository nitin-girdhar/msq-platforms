'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SessionUser, UserOrgOption } from '@platform/types';
import { RANKS, isTenantWideRole } from '@platform/authz';
import { auth } from '../api/resources';
import { useDropdown } from '../hooks/useDropdown';

interface Props {
  user: SessionUser;
  // Where to land after switching branch — this app's home. A re-mint may drop
  // the user's role below what the current page needs, so we send them somewhere
  // always-accessible rather than reloading in place. Defaults to '/'.
  homeHref?: string;
}

// Navbar chip showing the branch the session is scoped to. When the user has
// more than one branch available it becomes a dropdown that re-mints the
// session for the selected branch via /auth/switch-org. Org-scoped actors get
// the branches they're mapped to (iam.user_org_mapping); tenant-wide actors
// (tenant_admin/super_admin) get every branch in their tenant, since they
// aren't individually mapped to each one -- /auth/my-orgs resolves which list
// applies server-side.
export default function BranchSwitcher({ user, homeHref = '/' }: Props) {
  const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();
  const [orgs, setOrgs] = useState<UserOrgOption[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSwitchBranch = user.rank < RANKS.TENANT_ADMIN || isTenantWideRole(user.role);

  useEffect(() => {
    if (!canSwitchBranch) return;
    let cancelled = false;
    auth
      .myOrgs()
      .then((res) => {
        if (!cancelled) setOrgs(res.data.orgs);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canSwitchBranch]);

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = orgs ?? [];
    const sorted = [...list].sort((a, b) => Number(b.is_home) - Number(a.is_home));
    if (!q) return sorted;
    return sorted.filter(
      (org) => org.org_name.toLowerCase().includes(q) || org.role_label.toLowerCase().includes(q),
    );
  }, [orgs, search]);

  if (!canSwitchBranch) return null;

  const multiBranch = (orgs?.length ?? 0) > 1;

  const handleSwitch = async (org: UserOrgOption) => {
    if (switching || org.org_id === user.org_id) {
      setOpen(false);
      return;
    }
    setSwitching(org.org_id);
    setError(null);
    try {
      await auth.switchOrg(org.org_id);
      // Full navigation (not router.push): the layout is server-rendered from
      // the new cookie, so this rebuilds nav/sidebar for the role held in the
      // selected branch. Land on the app home in case the current page isn't
      // accessible to the new role.
      window.location.assign(homeHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch branch');
      setSwitching(null);
    }
  };

  const chip = (
    <span className="flex items-center gap-1.5 max-w-[220px]">
      <svg className="h-3.5 w-3.5 shrink-0 text-[#64748B]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M4 16.5V5.75A2.75 2.75 0 0 1 6.75 3h6.5A2.75 2.75 0 0 1 16 5.75V16.5h.75a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1 0-1.5H4Zm3-9.25A.75.75 0 0 1 7.75 6.5h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 7 7.25Zm.75 2.25a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1Zm3.5-2.25a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-1a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="truncate text-xs font-semibold text-[#0F172A]">{user.org_name}</span>
    </span>
  );

  if (!multiBranch) {
    return (
      <div className="hidden items-center rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 md:flex" title={user.org_name}>
        {chip}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!!switching}
        className="flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        title={`Branch: ${user.org_name}`}
      >
        {chip}
        <svg className="h-3.5 w-3.5 shrink-0 text-[#64748B]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch branch"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg"
        >
          <p className="border-b border-[#F1F5F9] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
            Switch branch
          </p>
          {error && (
            <p role="alert" className="border-b border-[#F1F5F9] bg-red-50 px-4 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {(orgs?.length ?? 0) > 6 && (
            <div className="border-b border-[#F1F5F9] p-2">
              <input
                ref={searchInputRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search branch…"
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {filteredOrgs.length === 0 && (
              <p className="px-4 py-4 text-center text-xs text-[#64748B]">
                {search ? `No branches match "${search}"` : 'No branches available'}
              </p>
            )}
            {filteredOrgs.map((org) => {
              const active = org.org_id === user.org_id;
              const busy = switching === org.org_id;
              return (
                <button
                  key={org.org_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => handleSwitch(org)}
                  disabled={!!switching}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    active ? 'bg-[#F0F7FF]' : 'hover:bg-[#F8FAFC] cursor-pointer'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#0F172A]">{org.org_name}</span>
                    <span className="block truncate text-xs text-[#64748B]">
                      {org.is_home ? 'Home branch' : org.role_label}
                    </span>
                  </span>
                  {busy ? (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
                  ) : active ? (
                    <svg className="h-4 w-4 shrink-0 text-[#0b6cbf]" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
