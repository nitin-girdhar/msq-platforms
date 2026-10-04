'use client';

// Circular avatar that shows the user's stored photo, falling back to their
// initial when there is none or the image fails to load. Same visual as the
// initials chip used across the shell so swapping in a photo is seamless.

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Image URL (e.g. users.photoUrl(id)); null/undefined renders the fallback. */
  src?: string | null;
  /** Text used for the fallback initial and alt text. */
  label: string;
  /** Tailwind size classes, e.g. 'h-7 w-7'. */
  sizeClass?: string;
  className?: string;
}

export default function PhotoAvatar({ src, label, sizeClass = 'h-7 w-7', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset the error state when the source changes (e.g. after a re-upload).
  // Also catch an image that ALREADY failed before hydration: a server-rendered
  // <img> can error before React attaches onError, which then never fires and
  // the alt text shows instead of the initial.
  useEffect(() => {
    const img = imgRef.current;
    setFailed(Boolean(img && img.complete && img.naturalWidth === 0));
  }, [src]);

  const initial = (label?.trim()?.charAt(0) || '?').toUpperCase();
  const base = `flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`;

  if (src && !failed) {
    return (
      <span className={`${base} bg-surface-container`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={label}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <span className={`${base} bg-primary text-xs font-bold text-on-primary`}>{initial}</span>;
}
