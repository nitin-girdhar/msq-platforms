interface Props {
  title: string;
  body: string;
}

export default function Placeholder({ title, body }: Props) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
      </header>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-on-surface">Coming in a later phase.</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-on-surface-variant">
          {body}
        </p>
      </div>
    </div>
  );
}
