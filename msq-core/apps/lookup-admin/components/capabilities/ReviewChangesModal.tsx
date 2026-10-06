'use client';

import { Button, Modal } from '@platform/ui-kit';

export interface StagedChange {
  key: string;
  label: string;
  from: boolean;
  to: boolean;
}

interface Props {
  roleLabel: string;
  changes: StagedChange[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const word = (granted: boolean) => (granted ? 'Granted' : 'Denied');

export default function ReviewChangesModal({ roleLabel, changes, saving, onConfirm, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={`Review changes for ${roleLabel}`} maxWidth="max-w-xl" locked={saving}>
      <p className="mb-3 text-xs text-on-surface-variant">
        {changes.length} change{changes.length === 1 ? '' : 's'} will be saved. Denying a page also switches off everything beneath it.
      </p>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {changes.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant px-3 py-1.5 text-xs">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-on-surface">{c.label}</span>
              <span className="block truncate font-mono text-[0.6875rem] text-on-surface-variant">{c.key}</span>
            </span>
            <span className="shrink-0 text-on-surface-variant">
              {word(c.from)} <span aria-hidden="true">→</span> <strong className={c.to ? 'text-on-status-success-container' : 'text-error'}>{word(c.to)}</strong>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose} disabled={saving}>Back</Button>
        <Button variant="primary" onClick={onConfirm} disabled={saving} aria-busy={saving}>
          {saving ? 'Saving…' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Modal>
  );
}
