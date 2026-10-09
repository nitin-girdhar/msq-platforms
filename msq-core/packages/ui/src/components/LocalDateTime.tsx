'use client';

import { useEffect, useState } from 'react';

export interface LocalDateTimeProps {
  value: string | number | Date | null | undefined;
  /** Intl options; default is a medium date with a short time. */
  options?: Intl.DateTimeFormatOptions;
  /** Rendered when `value` is empty or not a valid date. */
  fallback?: string;
  className?: string;
}

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

function toDate(value: LocalDateTimeProps['value']): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A timestamp in the viewer's own locale and time zone without a hydration mismatch.
 * The server (and the first client render) uses a fixed en-US / UTC string; after
 * mount it switches to the browser's locale. Calling `toLocaleString()` directly in
 * a server-rendered client component renders in the server's zone, differs from the
 * browser's, and makes React discard the server HTML (error #418).
 */
export function LocalDateTime({ value, options = DEFAULT_OPTIONS, fallback = '—', className }: LocalDateTimeProps) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);

  const d = toDate(value);
  if (!d) return <span className={className}>{fallback}</span>;

  const text = local
    ? d.toLocaleString(undefined, options)
    : d.toLocaleString('en-US', { ...options, timeZone: 'UTC' });
  return <time dateTime={d.toISOString()} className={className}>{text}</time>;
}
