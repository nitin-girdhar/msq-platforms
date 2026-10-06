'use client';

import { useState } from 'react';

interface Props {
  password: string;
  email: string;
}

export default function TemporaryPasswordPanel({ password, email }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might be blocked — user can select and copy manually.
    }
  };

  return (
    <div className="rounded-xl border border-status-due/30 bg-status-due-container p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-on-status-due-container">
        Temporary password — shown once
      </p>
      <p className="mt-1 text-xs text-on-status-due-container">
        Share with {email} via a secure channel. It will not be retrievable again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 select-all rounded-lg border border-status-due/30 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-on-surface">
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-status-due/30 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-status-due-container transition-colors hover:bg-status-due-container"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
