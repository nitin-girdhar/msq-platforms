'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AnchoredPanelRect {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'below' | 'above';
}

interface Options {
  /** Tallest the panel should ever be, before the viewport trims it further. */
  preferredMaxHeight?: number;
  /** Below this much room, flip rather than squeeze into a two-row sliver. */
  minHeight?: number;
  /** Gap between the trigger and the panel, and from the viewport edge. */
  gap?: number;
}

/**
 * Fixed-position geometry for a dropdown panel that must escape its container.
 *
 * A panel rendered inside a dialog is clipped by it: `Modal`'s own card is
 * `overflow-hidden` and its body is the scroll region, so an absolutely
 * positioned list is cut off at the modal's edge — the assignee names sat below
 * the fold with no way to reach them. The fix is to portal the panel to
 * `document.body` and position it against the trigger's viewport rect, which is
 * what this returns.
 *
 * It also decides which side to open on: below when there is room, above when
 * there is not, and it caps the height to the space actually available so the
 * panel scrolls internally instead of running off-screen. The rect is
 * recomputed on scroll (capture phase, so scrolling *inside* the dialog counts)
 * and on resize.
 */
export function useAnchoredPanel(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  { preferredMaxHeight = 384, minHeight = 200, gap = 4 }: Options = {},
): AnchoredPanelRect | null {
  const [rect, setRect] = useState<AnchoredPanelRect | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const edge = 8;
    const below = window.innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    // Prefer below; flip only when below cannot show a usable list and above can
    // show more. A panel that flips for a few pixels' gain jumps around as the
    // list is filtered.
    const openAbove = below < minHeight && above > below;
    setRect({
      top: openAbove ? Math.max(edge, r.top - gap - Math.min(preferredMaxHeight, above)) : r.bottom + gap,
      left: r.left,
      width: r.width,
      maxHeight: Math.max(minHeight, Math.min(preferredMaxHeight, openAbove ? above : below)),
      placement: openAbove ? 'above' : 'below',
    });
  }, [anchorRef, preferredMaxHeight, minHeight, gap]);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  return rect;
}
