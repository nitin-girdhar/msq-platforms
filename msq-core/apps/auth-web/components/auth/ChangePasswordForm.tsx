'use client';

import { useState } from 'react';
import { auth } from '@/src/lib/api/client';
import PasswordInput, { FormAlert, SubmitButton } from './PasswordInput';
import PasswordRules, { passesRules } from './PasswordRules';

interface Props {
  forced: boolean;
  // Absolute product URL to land on after a successful change (allowlist-
  // validated server-side). Cross-origin, so navigation uses window.location.
  destination: string;
}

export default function ChangePasswordForm({ forced, destination }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = next.length > 0 && next === confirm;
  const differs = next !== current;
  const canSubmit = current.length > 0 && passesRules(next) && matches && differs && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      // Full navigation (possibly cross-origin) to the product.
      window.location.assign(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {error && <FormAlert>{error}</FormAlert>}

      <PasswordInput
        id="cur-pw"
        label={forced ? 'Current (temporary) password' : 'Current password'}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        disabled={submitting}
        aside={
          forced ? undefined : (
            <a href="/forgot-password" className="text-label-md font-semibold text-primary hover:underline">
              Forgot current password?
            </a>
          )
        }
      />

      <PasswordInput
        id="new-pw"
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        disabled={submitting}
        invalid={next.length > 0 && !differs}
        message={next.length > 0 && !differs ? 'New password must differ from the current one.' : null}
      />

      <PasswordRules value={next} />

      <PasswordInput
        id="confirm-pw"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        disabled={submitting}
        invalid={confirm.length > 0 && !matches}
        message={confirm.length > 0 && !matches ? 'Passwords do not match.' : null}
        aside={
          matches ? <span className="text-label-sm font-semibold text-on-status-success-container">Passwords match</span> : undefined
        }
      />

      {/* Informational, not a choice: identity-service already revokes every
          other session on a password change (auth.service changePassword). */}
      <p className="flex items-start gap-2 rounded-lg bg-surface-container-low px-3 py-2.5 text-body-sm text-on-surface-variant">
        <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
        </svg>
        You&rsquo;ll stay signed in here. Every other device and browser signed in to your account will be signed out.
      </p>

      <SubmitButton busy={submitting} disabled={!canSubmit}>
        Update password
      </SubmitButton>
    </form>
  );
}
