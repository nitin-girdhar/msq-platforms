'use client';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pages: (number | '...')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/60 px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
        {onPageSizeChange && (
          <>
            <span>Page Size:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-md border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 text-xs text-on-surface"
            >
              {[5, 10, 25, 50, 100].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </>
        )}
        <span>{from}–{to} of {total}</span>
      </div>
      <div className="flex items-center gap-1">
        <NavBtn onClick={() => onPageChange(1)} disabled={page <= 1} label="First">{'«'}</NavBtn>
        <NavBtn onClick={() => onPageChange(page - 1)} disabled={page <= 1} label="Previous">{'‹'}</NavBtn>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="px-1 text-xs text-outline">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors ${
                p === page
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <NavBtn onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} label="Next">{'›'}</NavBtn>
        <NavBtn onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} label="Last">{'»'}</NavBtn>
      </div>
    </div>
  );
}

function NavBtn({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-md px-1.5 py-0.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:text-outline-variant"
    >
      {children}
    </button>
  );
}
