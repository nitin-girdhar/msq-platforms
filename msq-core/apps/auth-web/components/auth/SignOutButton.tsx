'use client';

import { useState } from 'react';
import { auth } from '@/src/lib/api/client';

// Clears the shared .app.com session and returns to the sign-in form. Used by
// the no-access page, which is the one authenticated screen with nowhere else
// to go. Navigation is a full assign, not the Next router, so every product
// origin sees the cleared cookie.
interface Props {
  // Resolved server-side via buildLoginUrl() — see the note in UserMenu.
  loginUrl: string;
  /** 'subtle' sits under a primary action; 'primary' is the sole action. */
  variant?: 'primary' | 'subtle';
}

export default function SignOutButton({ loginUrl, variant = 'primary' }: Props) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await auth.logout();
    } catch {
      // The cookie may already be gone or the gateway unreachable. Either way the
      // useful next step is the same — send them to sign in.
    }
    window.location.assign(loginUrl);
  };

  const tone =
    variant === 'primary'
      ? 'bg-primary text-on-primary hover:bg-primary-container'
      : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`min-h-11 w-full rounded-lg px-4 py-2.5 text-label-md font-semibold transition-colors disabled:opacity-60 ${tone}`}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
