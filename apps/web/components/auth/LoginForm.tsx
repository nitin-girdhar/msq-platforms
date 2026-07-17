'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/src/lib/api/client';

interface Props {
  callbackUrl: string;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginForm({ callbackUrl }: Props) {
  const router = useRouter();
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition]  = useTransition();
  const busy = submitting || pending;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldErrors({});
    setServerError(null);

    const next: FieldErrors = {};
    if (!email.trim())    next.email    = 'Email is required.';
    if (!password.trim()) next.password = 'Password is required.';
    if (next.email || next.password) { setFieldErrors(next); return; }

    setSubmitting(true);
    try {
      const { data } = await auth.login(email.trim(), password);

      // Users mapped to multiple branches pick one before landing on the
      // dashboard. Skipped when a password change is forced first, and for
      // tenant-level roles (rank >= 90) whose session spans all branches.
      let destination = callbackUrl;
      const user = data.user;
      if (!user.force_password_change && user.rank < 90) {
        try {
          const orgsRes = await auth.myOrgs();
          if (orgsRes.data.orgs.length > 1) {
            destination = `/select-branch?callbackUrl=${encodeURIComponent(callbackUrl)}`;
          }
        } catch {
          // Branch list is a nicety at login; fall through to the dashboard
          // (home branch) and let the navbar switcher handle it.
        }
      }

      startTransition(() => {
        router.replace(destination);
        router.refresh();
      });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9 9a1 1 0 0 1 2 0v3a1 1 0 1 1-2 0V9Zm1-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{serverError}</span>
        </div>
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        disabled={busy}
        error={fieldErrors.email}
        required
      />

      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        disabled={busy}
        error={fieldErrors.password}
        required
      />

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b6cbf] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#095699] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6cbf] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: 'email' | 'password';
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error?: string | undefined;
  required?: boolean;
}

function Field({ id, label, type, autoComplete, value, onChange, disabled, error, required }: FieldProps) {
  const errorId = `${id}-error`;
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={isPassword && show ? 'text' : type}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5 ${isPassword ? 'pr-16' : ''} text-sm text-[#0F172A] shadow-sm transition-colors placeholder:text-[#94A3B8] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#64748B] aria-invalid:border-red-300 aria-invalid:focus:border-red-400 aria-invalid:focus:ring-red-200`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            disabled={disabled}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-[#64748B] hover:bg-[#F1F5F9] disabled:cursor-not-allowed"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
