'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import { resolveScope, CAPABILITY } from '@platform/rbac';
import { canCreateUser, canManageTeam, canNotifyUser } from '../../lib/permissions';
import type { TeamRow, TeamScope } from '../../lib/types';
import TeamTable from './TeamTable';
import CreateUserModal from './CreateUserModal';
import EditUserModal from './EditUserModal';

interface Props {
  users: TeamRow[];
  actor: SessionUser;
  total: number;
  /** Every branch in the tenant — assignable only by a tenant-wide actor, and
   *  the option list behind the table's Branch filter. */
  orgs: Array<{ id: string; name: string }>;
  /** The actor's own branches (iam.user_org_mapping), for everyone else. */
  myOrgs: Array<{ id: string; name: string }>;
  /** Either branch fetch failed; the modals say so rather than quietly offering one. */
  branchesFailed: boolean;
  /** Which product's work a departing user might be holding, for the reassign
   *  pickers in Edit. `null` where the host serves no such product. */
  leadProduct?: 'lms' | 'tasks' | null;
  /** The slice the SERVER actually returned — it narrows a scope the actor may
   *  not use, so this is the only honest label for what is on screen. */
  scope: TeamScope;
}

const SCOPE_LABEL: Record<TeamScope, string> = {
  reports: 'My team',
  org: 'My branch',
  tenant: 'All branches',
};

const SCOPE_EMPTY: Record<TeamScope, string> = {
  reports: 'Nobody reports to you yet. Once people are placed under you in the org chart they appear here.',
  org: 'No one else in your branch yet.',
  tenant: 'No users found in this tenant.',
};

export default function TeamShell({ users, actor, total, orgs, myOrgs, branchesFailed, scope, leadProduct = 'lms' }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SessionUser | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [switching, startSwitching] = useTransition();

  // Which rungs to offer. Mirrors widestScopeFor in identity-service's
  // users.service.ts — capability ladder first, platform tier second, because
  // tenant_admin holds no admin.team.view.* scope at all and the capability
  // answer alone would narrow an admin to nothing.
  //
  // Advisory only: the server re-derives this and downgrades anything the actor
  // may not use, so a hand-typed ?scope=tenant gains nobody anything.
  const held = resolveScope(actor, CAPABILITY.ADMIN_TEAM_VIEW);
  const tenantWide = actor.rank >= RANKS.TENANT_ADMIN || held === 'tenant' || held === 'all';
  const scopeOptions: TeamScope[] = tenantWide
    ? ['reports', 'org', 'tenant']
    : held === 'org'
      ? ['reports', 'org']
      : ['reports'];

  const switchScope = (next: TeamScope) => {
    if (next === scope) return;
    // A URL param, not client state: the roster is server-rendered, so the
    // switch has to go back through the page for the new slice — and it makes
    // the current view linkable and survivable across a refresh.
    startSwitching(() => router.push(`${pathname}?scope=${next}`));
  };

  // Two gates, ANDed, because they answer different questions and neither
  // implies the other:
  //   canManageTeam  — the admin.team.manage CAPABILITY. May they write at all?
  //                    The same grant identity-service checks on POST/PATCH
  //                    /users and that iam.fn_user_can_manage_users resolves
  //                    inside the RLS write policies.
  //   canCreateUser  — RANK. Is there anyone below them to create? A capability
  //                    is role-level and tenant-scoped, so it can never answer
  //                    "may they act on THIS person"; rank is what does.
  //
  // The layout used to keep everyone below org_admin out of this console, so
  // rank alone was a safe proxy. It no longer does — a senior_sales_executive
  // granted the view scope reaches this screen — so the capability has to be
  // asked explicitly rather than assumed from having arrived here.
  const canManage = canManageTeam(actor);
  const canCreate = canManage && canCreateUser(actor.rank, actor.rank - 1);
  // Whether to show the "Notify user by email" checkbox in the modals. The
  // server enforces the same grant regardless of what the form sends.
  const canNotify = canNotifyUser(actor);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Team</h1>
          {/* Names the slice, not just the count. "12 total" on a subtree reads
              as the whole company to someone who has never seen the wider one. */}
          <p className="mt-1 text-xs text-[#64748B]">
            {total} {total === 1 ? 'person' : 'people'} · {SCOPE_LABEL[scope].toLowerCase()}
          </p>
        </div>

        {/* Only rendered when there is a real choice — a single-rung actor gets
            a label above, not a control that cannot change anything. */}
        {scopeOptions.length > 1 && (
          <div
            role="group"
            aria-label="Roster scope"
            className="flex gap-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-1"
          >
            {scopeOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => switchScope(opt)}
                disabled={switching}
                aria-pressed={opt === scope}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  opt === scope ? 'bg-white text-[#0b6cbf] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {SCOPE_LABEL[opt]}
              </button>
            ))}
          </div>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
          >
            New user
          </button>
        )}
      </div>

      {users.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
          {SCOPE_EMPTY[scope]}
        </div>
      ) : (
      <TeamTable
        users={users}
        currentUserId={actor.id}
        actorRank={actor.rank}
        orgs={orgs}
        canManage={canManage}
        onEdit={setEditTarget}
      />
      )}

      {canCreate && (
        <CreateUserModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          actorRank={actor.rank}
          users={users}
          actor={actor}
          orgs={orgs}
          myOrgs={myOrgs}
          branchesFailed={branchesFailed}
          canNotify={canNotify}
        />
      )}

      {editTarget && (
        <EditUserModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          user={editTarget}
          currentUserId={actor.id}
          actorRank={actor.rank}
          actorRole={actor.role}
          orgs={orgs}
          myOrgs={myOrgs}
          branchesFailed={branchesFailed}
          actor={actor}
          leadProduct={leadProduct}
          canNotify={canNotify}
        />
      )}
    </div>
  );
}
