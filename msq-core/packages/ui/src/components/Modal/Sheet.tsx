'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Tailwind max-width of the desktop drawer (the phone sheet is always full-screen). */
  maxWidth?: string;
  /** `nested` stacks above a sheet/modal already open. */
  layer?: 'base' | 'nested';
  bodyClassName?: string;
  closeOnBackdropClick?: boolean;
}

let sheetLocks = 0;
let previousOverflow = '';

function lockScroll() {
  if (sheetLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  sheetLocks += 1;
}

function unlockScroll() {
  sheetLocks = Math.max(0, sheetLocks - 1);
  if (sheetLocks === 0) document.body.style.overflow = previousOverflow;
}

/**
 * Create/edit surface for forms: a full-screen sheet on phones and a right-hand
 * drawer from `sm` up (Stitch "drawer on desktop, full-screen sheet on mobile").
 * Same contract as `Modal` (Escape closes, backdrop click inert by default,
 * `role="dialog"` + `aria-modal`, pinned header/footer, single scroll region),
 * so a form can swap one for the other without touching its handlers.
 */
export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  locked,
  maxWidth = 'sm:max-w-xl',
  layer = 'base',
  bodyClassName,
  closeOnBackdropClick = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const pressStartedOnBackdrop = useRef(false);

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
      className={`fixed inset-0 ${layer === 'nested' ? 'z-[300]' : 'z-50'} flex justify-end bg-on-surface/50`}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        const startedOnBackdrop = pressStartedOnBackdrop.current;
        pressStartedOnBackdrop.current = false;
        if (closeOnBackdropClick && !locked && startedOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`flex h-dvh w-full ${maxWidth} flex-col overflow-hidden bg-surface-container-lowest shadow-2xl sm:rounded-l-2xl`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 px-4 py-3 sm:px-6 sm:py-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-on-surface">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-on-surface-variant">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-outline transition-colors hover:bg-surface-container hover:text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
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

        <div className={bodyClassName ?? 'sheet-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6'}>
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-outline-variant/60 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export type { Props as SheetProps };
