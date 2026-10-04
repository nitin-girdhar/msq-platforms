'use client';

import { useState } from 'react';
import { auth } from '@/src/lib/api/client';
import PasswordInput, { FormAlert, SubmitButton } from './PasswordInput';
import PasswordRules, { passesRules } from './PasswordRules';

/** Set a new password from the emailed link (single-use token in the URL). */
export default function ResetPasswordForm({ token }: { token: string }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const matches = next.length > 0 && next === confirm;
  const canSubmit = passesRules(next) && matches && !busy;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await auth.resetPassword(token, next);
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-lg bg-status-success-container px-4 py-3 text-body-sm text-on-status-success-container">
          Your password has been updated. For your security you&rsquo;ve been signed out on every device.
        </div>
        <a
          href="/login"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-3 text-label-md font-semibold text-on-primary hover:opacity-90"
        >
          Sign in with your new password
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && (
        <FormAlert>
          {error}{' '}
          {/invalid|expired/i.test(error) && (
            <a href="/forgot-password" className="font-semibold underline">
              Request a new link
            </a>
          )}
        </FormAlert>
      )}
      <PasswordInput id="new-pw" label="New password" value={next} onChange={setNext} autoComplete="new-password" disabled={busy} />
      <PasswordRules value={next} />
      <PasswordInput
        id="confirm-pw"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        disabled={busy}
        invalid={confirm.length > 0 && !matches}
        message={confirm.length > 0 && !matches ? 'Passwords do not match.' : null}
      />
      <SubmitButton busy={busy} disabled={!canSubmit}>
        Set new password
      </SubmitButton>
    </form>
  );
}
