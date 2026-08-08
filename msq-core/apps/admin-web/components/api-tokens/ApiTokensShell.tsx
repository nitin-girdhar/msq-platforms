'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { RANKS } from '@platform/authz';
import type { ApiTokenRow } from '@/src/lib/api/client';
import ApiTokensTable from './ApiTokensTable';
import CreateApiTokenModal from './CreateApiTokenModal';
import EditApiTokenModal from './EditApiTokenModal';
import RotateSecretModal from './RotateSecretModal';
import RevokeConfirmModal from './RevokeConfirmModal';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  tokens: ApiTokenRow[];
  orgs: OrgOption[];
  actor: SessionUser;
  canManage: boolean;
}

export default function ApiTokensShell({ tokens, orgs, actor, canManage }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiTokenRow | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiTokenRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenRow | null>(null);
  const isOrgAdmin = actor.rank < RANKS.TENANT_ADMIN;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">API Tokens</h1>
          <p className="mt-1 text-xs text-[#64748B]">{tokens.length} total · machine credentials for integrations</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
          >
            New token
          </button>
        )}
      </div>

      <ApiTokensTable
        tokens={tokens}
        orgs={orgs}
        canManage={canManage}
        onEdit={setEditTarget}
        onRotate={setRotateTarget}
        onRevoke={setRevokeTarget}
      />

      {canManage && (
        <CreateApiTokenModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          orgs={orgs}
          isOrgAdmin={isOrgAdmin}
          actorOrgId={actor.org_id}
        />
      )}

      {editTarget && (
        <EditApiTokenModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          token={editTarget}
          orgs={orgs}
          isOrgAdmin={isOrgAdmin}
        />
      )}

      {rotateTarget && (
        <RotateSecretModal
          open={rotateTarget !== null}
          onClose={() => setRotateTarget(null)}
          tokenId={rotateTarget.id}
          name={rotateTarget.name}
        />
      )}

      {revokeTarget && (
        <RevokeConfirmModal
          open={revokeTarget !== null}
          onClose={() => setRevokeTarget(null)}
          tokenId={revokeTarget.id}
          name={revokeTarget.name}
        />
      )}
    </div>
  );
}
