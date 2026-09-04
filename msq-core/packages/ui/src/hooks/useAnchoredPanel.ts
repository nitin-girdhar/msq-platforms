'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

export interface AnchoredPanelRect {
  /** Set when opening below; `bottom` is set instead when opening above. */
  top?: number | undefined;
  /** Distance from the viewport's bottom edge, set only when opening above. */
  bottom?: number | undefined;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'below' | 'above';
  /** Spread straight onto the portalled panel — see the note on anchoring below. */
  style: CSSProperties;
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
 *
 * Which edge anchors the panel depends on the side. Opening below, the top is
 * known. Opening above it is the *bottom* that is known — `maxHeight` is a cap,
 * not a height, so a list shorter than the cap that were pinned by its top would
 * render downwards from there and stop short of the trigger, leaving a gap that
 * changes size as the list is filtered. Hence `bottom` for the flipped case, and
 * `style` so callers spread the right pair rather than reaching for `rect.top`.
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
    // The `minHeight` floor keeps a squeezed panel usable, but it can ask for
    // more room than the side has — clamp it to the viewport so the panel
    // scrolls internally instead of running off the screen edge.
    const maxHeight = Math.min(
      Math.max(minHeight, Math.min(preferredMaxHeight, openAbove ? above : below)),
      window.innerHeight - 2 * edge,
    );
    // Anchored by the bottom edge when flipped: see the note above the hook.
    const top = openAbove ? undefined : r.bottom + gap;
    const bottom = openAbove ? window.innerHeight - r.top + gap : undefined;
    setRect({
      top,
      bottom,
      left: r.left,
      width: r.width,
      maxHeight,
      placement: openAbove ? 'above' : 'below',
      style: { position: 'fixed', top, bottom, left: r.left, width: r.width, maxHeight, zIndex: 1000 },
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
