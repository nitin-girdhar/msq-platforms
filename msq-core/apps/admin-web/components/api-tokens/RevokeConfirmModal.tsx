'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button } from '@platform/ui-kit';
import { apiTokens } from '@/src/lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  name: string;
}

export default function RevokeConfirmModal({ open, onClose, tokenId, name }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (pending) return;
    setError(null);
    onClose();
  };

  const handleRevoke = async () => {
    setPending(true);
    setError(null);
    try {
      await apiTokens.revoke(tokenId);
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
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="danger" onClick={handleRevoke} disabled={pending} aria-busy={pending}>
        {pending ? 'Revoking…' : 'Revoke token'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={`Revoke · ${name}`} locked={pending} footer={footer} layer="nested">
      {error && (
        <div role="alert" className="mb-3 rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
          {error}
        </div>
      )}
      <p className="text-sm text-on-surface">
        Revoking <span className="font-semibold">{name}</span> immediately disables it. This can&apos;t be undone —
        create a new token if the integration needs to keep working.
      </p>
    </Modal>
  );
}
