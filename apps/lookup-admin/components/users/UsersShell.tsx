'use client';

import { useEffect, useState } from 'react';
import { orgs as orgsApi, type UserRow } from '@/src/lib/api/client';
import UsersTable from './UsersTable';
import CreateUserModal from './CreateUserModal';
import EditUserModal from './EditUserModal';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  users: UserRow[];
  currentUserId: string;
}

export default function UsersShell({ users, currentUserId }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);

  useEffect(() => {
    orgsApi.listAll()
      .then((res) => setOrgs(res.data.map((o) => ({ id: o.id, name: o.name }))))
      .catch(() => setOrgs([]));
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Users</h1>
          <p className="mt-1 text-xs text-[#64748B]">{users.length} total · super admin scope</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
        >
          New user
        </button>
      </div>

      <UsersTable
        users={users}
        currentUserId={currentUserId}
        onEdit={setEditTarget}
      />

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {editTarget && (
        <EditUserModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          user={editTarget}
          currentUserId={currentUserId}
          users={users}
          orgs={orgs}
        />
      )}
    </div>
  );
}
