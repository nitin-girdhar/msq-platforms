'use client';

import { useEffect, useRef, useState } from 'react';

export type ExportFormat = 'xlsx' | 'csv';

interface Props {
  onExport: (format: ExportFormat) => void;
  rowCount: number;
  disabled?: boolean;
  compact?: boolean;
}

export default function DownloadButton({ onExport, rowCount, disabled, compact }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  };

  const isDisabled = disabled || rowCount === 0;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={rowCount === 0 ? 'Nothing to export' : `Download ${rowCount} row${rowCount === 1 ? '' : 's'}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
        {!compact && <span>Download</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest py-1 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-outline">
            Export {rowCount} row{rowCount === 1 ? '' : 's'}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose('xlsx')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-status-success-container text-[9px] font-bold text-on-status-success-container">XLS</span>
            Excel (.xlsx)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose('csv')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-low"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-surface-container text-[9px] font-bold text-on-surface-variant">CSV</span>
            CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
