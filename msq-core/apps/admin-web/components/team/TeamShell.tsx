'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { canCreateUser } from '@/src/lib/permissions';
import TeamTable from './TeamTable';
import CreateUserModal from './CreateUserModal';
import EditUserModal from './EditUserModal';

interface Props {
  users: SessionUser[];
  actor: SessionUser;
}

export default function TeamShell({ users, actor }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SessionUser | null>(null);

  // Anyone reaching this screen is already org_admin+ (layout gate), but that
  // still leaves nobody creatable if their rank ties the top of the ladder —
  // canCreateUser requires actorRank > targetRank for every role.
  const canCreate = canCreateUser(actor.rank, actor.rank - 1);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Team</h1>
          <p className="mt-1 text-xs text-[#64748B]">{users.length} total</p>
        </div>
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

      <TeamTable users={users} currentUserId={actor.id} onEdit={setEditTarget} />

      {canCreate && (
        <CreateUserModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          actorRank={actor.rank}
          users={users}
          actor={actor}
        />
      )}

      {editTarget && (
        <EditUserModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          user={editTarget}
          currentUserId={actor.id}
          actorRank={actor.rank}
          users={users}
        />
      )}
    </div>
  );
}
