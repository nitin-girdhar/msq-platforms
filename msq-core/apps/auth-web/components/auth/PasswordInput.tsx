'use client';

import { useState, type ReactNode } from 'react';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  /** Right of the label (a link or a status chip). */
  aside?: ReactNode;
  /** Message under the field; rendered as an error when `invalid`. */
  message?: string | null;
  invalid?: boolean;
}

export const fieldCls =
  'min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-body-md text-on-surface transition-colors placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant aria-invalid:border-error';

export default function PasswordInput({ id, label, value, onChange, autoComplete, disabled, aside, message, invalid }: Props) {
  const [show, setShow] = useState(false);
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-label-md font-semibold text-on-surface">{label}</label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={message ? msgId : undefined}
          className={`${fieldCls} pr-16`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-9 min-w-11 items-center justify-center rounded-md px-2 py-1 text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {message && (
        <p id={msgId} className={`text-label-md ${invalid ? 'text-error' : 'text-on-surface-variant'}`}>{message}</p>
      )}
    </div>
  );
}

export function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      aria-busy={busy}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-label-md font-semibold text-on-primary shadow-card transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary" aria-hidden />}
      {children}
    </button>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
      {children}
    </div>
  );
}
