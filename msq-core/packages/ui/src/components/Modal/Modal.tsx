'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional second line under the title, inside the pinned header band. */
  subtitle?: ReactNode;
  /** Scrolling body content only — action buttons belong in `footer`. */
  children: ReactNode;
  /** Pinned action bar. The band (and its top border) is omitted when absent. */
  footer?: ReactNode;
  locked?: boolean;
  maxWidth?: string;
  /** `nested` stacks above a modal already open (e.g. a confirm over an edit form). */
  layer?: 'base' | 'nested';
  /** Escape hatch for bodies that manage their own padding/panes. */
  bodyClassName?: string;
}

// Background scroll is locked while any modal is open. Refcounted so a nested
// dialog closing does not unlock the page underneath its still-open parent.
let scrollLocks = 0;
let previousOverflow = '';

function lockScroll() {
  if (scrollLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  locked,
  maxWidth = 'max-w-md',
  layer = 'base',
  bodyClassName,
}: Props) {
  // The panel is portalled to <body>, so it escapes `body.dashboard-shell`
  // (overflow:hidden at >=1024px) and any ag-grid stacking context.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, locked]);

  useEffect(() => {
    if (!open) return;
    lockScroll();
    return unlockScroll;
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${layer === 'nested' ? 'z-[300]' : 'z-50'} flex items-center justify-center bg-slate-900/50 px-4 py-8`}
      onClick={() => {
        if (!locked) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex max-h-[calc(100dvh-4rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#F1F5F9] px-5 py-3.5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#0F172A]">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-[#64748B]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 0 1 1.06 0L10 8.94l4.66-4.66a.75.75 0 1 1 1.06 1.06L11.06 10l4.66 4.66a.75.75 0 1 1-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 1 1-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* min-h-0 is what lets this flex child shrink below its content height
            and become the single scroll region between the two pinned bands. */}
        <div className={bodyClassName ?? 'sheet-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6'}>
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-[#F1F5F9] px-5 py-3 sm:px-6">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export type { Props as ModalProps };
