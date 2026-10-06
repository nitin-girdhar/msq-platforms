'use client';

import { useState } from 'react';

interface Props {
  apiKey: string;
  name: string;
}

export default function SecretRevealPanel({ apiKey, name }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might be blocked — user can select and copy manually.
    }
  };

  return (
    <div className="rounded-xl border border-status-due/30 bg-status-due-container p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-on-status-due-container">
        API key — shown once
      </p>
      <p className="mt-1 text-xs text-on-status-due-container">
        Store this for <span className="font-semibold">{name}</span> now. It will not be retrievable again — only its prefix is kept.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 select-all overflow-x-auto rounded-lg border border-status-due/30 bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface">
          {apiKey}
        </code>
        <button
          type="button"
          onClick={copy}
          className="min-h-[2.75rem] shrink-0 rounded-lg border border-status-due/30 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-status-due-container transition-colors hover:bg-status-due-container"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
