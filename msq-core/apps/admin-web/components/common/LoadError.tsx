import LogoutButton from '@/components/auth/LogoutButton';

// Rendered when the gateway refuses or fails a data fetch. Reports the CLASS
// of failure (denied vs unavailable) and never the backend's own error text,
// which can carry internal detail.
export default function LoadError({
  title,
  status,
}: {
  title: string;
  status: number;
}) {
  const denied = status === 401 || status === 403;

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
          {denied ? 'Access restricted' : `${title} is unavailable`}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[#64748B]">
          {denied
            ? `Your account is not permitted to manage ${title}. If you were recently granted admin access, sign out and sign back in — your current session still carries the old permissions.`
            : `${title} could not be loaded right now. This is a problem on our side, not with the address you used. Please retry in a moment.`}
        </p>
        {denied ? (
          <div className="mt-6 flex justify-center">
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </main>
  );
}
