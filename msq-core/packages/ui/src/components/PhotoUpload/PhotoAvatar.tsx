'use client';

// Circular avatar that shows the user's stored photo, falling back to their
// initial when there is none or the image fails to load. Same visual as the
// initials chip used across the shell so swapping in a photo is seamless.

import { useEffect, useState } from 'react';

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

  // Reset the error state when the source changes (e.g. after a re-upload).
  useEffect(() => setFailed(false), [src]);

  const initial = (label?.trim()?.charAt(0) || '?').toUpperCase();
  const base = `flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`;

  if (src && !failed) {
    return (
      <span className={`${base} bg-slate-100`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <span className={`${base} bg-[#0b6cbf] text-xs font-bold text-white`}>{initial}</span>;
}
