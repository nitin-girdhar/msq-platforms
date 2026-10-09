'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** What the popover says. Plain text or light markup (`<strong>`, `<code>`). */
  children: ReactNode;
  /** Accessible name of the trigger. Say what the tip is about, not "info". */
  label?: string;
  className?: string;
}

// The (i) that replaces always-visible explanatory paragraphs. The circle is
// deliberately smaller than the title it sits beside (0.625rem against a 1rem
// heading) so it reads as an aside, while the button around it is padded out to
// a comfortable hit area — a 10px target alone is unusable on touch. Opens on
// hover, toggles on click/tap/Enter, closes on Escape or an outside press.
// Warnings, errors and status text do NOT belong in here: if the reader must
// see it to avoid a mistake, keep it on the page.
export default function InfoTip({ children, label = 'More information', className = '' }: Props) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(false); setHover(false); }
    };
    const onPress = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex shrink-0 align-middle ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        // Negative margin cancels the padding so the 10px circle takes the same
        // space in the title row as an unpadded one would.
        className="-m-1.5 inline-flex cursor-pointer items-center justify-center rounded-full p-1.5 text-on-surface-variant hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-expanded:text-primary"
      >
        <span
          aria-hidden="true"
          className="flex h-2.5 w-2.5 items-center justify-center rounded-full border border-current font-serif text-[0.4375rem] font-bold italic leading-none"
        >
          i
        </span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-2 w-max max-w-[min(22rem,calc(100vw-2rem))] space-y-1.5 rounded-lg bg-inverse-surface px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-inverse-on-surface shadow-overlay"
        >
          {children}
        </span>
      )}
    </span>
  );
}
