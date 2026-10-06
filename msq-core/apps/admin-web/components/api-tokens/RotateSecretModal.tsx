'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button } from '@platform/ui-kit';
import { apiTokens } from '@/src/lib/api/client';
import SecretRevealPanel from './SecretRevealPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  name: string;
}

export default function RotateSecretModal({ open, onClose, tokenId, name }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const handleClose = () => {
    if (pending) return;
    setError(null);
    setApiKey(null);
    onClose();
    if (apiKey) router.refresh();
  };

  const handleRotate = async () => {
    setPending(true);
    setError(null);
    try {
      const { data } = await apiTokens.rotate(tokenId);
      setApiKey(data.api_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const footer = apiKey ? (
    <div className="flex justify-end">
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="primary" onClick={handleClose}>Done</Button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="secondary" onClick={handleClose} disabled={pending}>Cancel</Button>
      <Button className="min-h-[2.75rem] sm:min-h-0" variant="primary" onClick={handleRotate} disabled={pending} aria-busy={pending}>
        {pending ? 'Rotating…' : 'Rotate secret'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={`Rotate secret · ${name}`} locked={pending} footer={footer} layer="nested">
      {apiKey ? (
        <SecretRevealPanel apiKey={apiKey} name={name} />
      ) : (
        <div className="flex flex-col gap-3">
          {error && (
            <div role="alert" className="rounded-xl border border-status-overdue/30 bg-status-overdue-container px-3 py-2 text-xs text-on-status-overdue-container">
              {error}
            </div>
          )}
          <p className="text-sm text-on-surface">
            The current key for <span className="font-semibold">{name}</span> will stop working immediately.
            Any integration using it must be updated with the new key.
          </p>
        </div>
      )}
    </Modal>
  );
}
