import Link from 'next/link';
import { ErrorState } from '@platform/ui-kit';

export default function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      description="This page does not exist, or you may not have access to it."
      actions={
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-inverse-surface px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-inverse-surface"
        >
          Back to dashboard
        </Link>
      }
    />
  );
}
