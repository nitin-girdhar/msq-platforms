'use client';

import { useState } from 'react';
import type { SessionUser } from '@platform/types';
import { Button, PageBody, PageHeader } from '@platform/ui-kit';
import { can, CAPABILITY } from '@platform/rbac';
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
  // Branch-only unless the role holds admin.api_tokens.tenant_wide (identity-service enforces the same).
  const isOrgAdmin = !can(actor, CAPABILITY.ADMIN_API_TOKENS_TENANT_WIDE);

  return (
    <>
      <PageHeader
        title="API Tokens"
        subtitle={`${tokens.length} total · machine credentials for integrations`}
        actions={
          canManage ? (
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)} className="min-h-[2.75rem] sm:min-h-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New token
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <ApiTokensTable
          tokens={tokens}
          orgs={orgs}
          canManage={canManage}
          onEdit={setEditTarget}
          onRotate={setRotateTarget}
          onRevoke={setRevokeTarget}
        />
      </PageBody>

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
    </>
  );
}
