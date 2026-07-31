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
}

export default function SignOutButton({ loginUrl }: Props) {
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

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="w-full rounded-lg bg-[#0b6cbf] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0a5ca3] disabled:opacity-60"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
