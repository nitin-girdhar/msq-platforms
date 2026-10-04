'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/src/lib/api/client';
import { FormAlert, SubmitButton, fieldCls } from './PasswordInput';

const RESEND_COOLDOWN_S = 45;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email-only reset request. The server answers the same for every
 * well-formed address, so this screen always shows the same confirmation —
 * it can never tell anyone whether an account exists.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const send = async (address: string) => {
    setError(null);
    setBusy(true);
    try {
      await auth.forgotPassword(address);
      setSentTo(address);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(/too many/i.test(msg) ? 'Too many requests. Please wait a few minutes and try again.' : msg || 'Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL_RE.test(v)) {
      setError('Enter the email address you sign in with.');
      return;
    }
    void send(v);
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-lg bg-status-success-container px-4 py-3 text-body-sm text-on-status-success-container">
          If an account exists for <span className="font-semibold">{sentTo}</span>, we&rsquo;ve sent a link to reset your
          password. It works once and expires in 15 minutes.
        </div>
        <p className="text-body-sm text-on-surface-variant">Didn&rsquo;t get it? Check your spam folder, or send it again.</p>
        {error && <FormAlert>{error}</FormAlert>}
        <button
          type="button"
          onClick={() => void send(sentTo)}
          disabled={busy || cooldown > 0}
          className="rounded-lg border border-outline-variant px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container-low disabled:cursor-not-allowed disabled:text-outline"
        >
          {cooldown > 0 ? `Resend link in ${cooldown}s` : busy ? 'Sending…' : 'Resend link'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
          className="text-label-md text-on-surface-variant hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-email" className="text-label-md font-semibold text-on-surface">Work email</label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="name@company.com"
          className={fieldCls}
        />
      </div>
      <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</SubmitButton>
    </form>
  );
}
