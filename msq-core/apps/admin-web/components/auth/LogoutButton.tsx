'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/src/lib/api/client';

export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    if (pending) return;
    setPending(true);
    try {
      await auth.logout();
    } catch {
      // Server-side session cleanup may fail; still redirect to login
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      aria-busy={pending}
      className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Log out'}
    </button>
  );
}
