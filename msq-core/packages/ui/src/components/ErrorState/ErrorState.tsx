'use client';

// Shared error / not-found surface for every product app's Next.js error
// boundaries. Built once here because the alternative — hand-rolling error.tsx
// per app — is how the five apps ended up with NO boundary at all: a render-time
// throw fell through to Next's stock error screen, which in production is a bare
// "Application error: a client-side exception has occurred" with no branding, no
// way back, and no indication of whether the user is still signed in.

export interface ErrorStateProps {
  title: string;
  description: string;
  /** Shown collapsed — never rendered unless the caller passes it. */
  detail?: string | undefined;
  /** Correlation id from Next's error boundary, worth quoting in a report. */
  digest?: string | undefined;
  actions?: React.ReactNode;
}

export function ErrorState({ title, description, detail, digest, actions }: ErrorStateProps) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"
        >
          <svg className="h-7 w-7 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p>

        {actions ? <div className="mt-8 flex items-center justify-center gap-3">{actions}</div> : null}

        {/* Collapsed by default: useful to whoever is debugging, invisible to
            everyone else. Never auto-expanded — an error message can carry
            internal detail that does not belong on screen by default. */}
        {(detail || digest) && (
          <details className="mt-8 text-left">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
              Technical details
            </summary>
            <div className="mt-2 rounded-lg bg-slate-50 p-3">
              {digest && (
                <p className="text-xs text-slate-500">
                  Reference: <code className="font-mono">{digest}</code>
                </p>
              )}
              {detail && (
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-slate-500">
                  {detail}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
