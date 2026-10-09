// Compact icon buttons for AG Grid action columns, matching the Leads grid (a bordered square with an icon,
// the label in `title` / `aria-label`) so a row action costs ~30px instead of a ~70px text button.
// Paths are Heroicons outline, inlined like the Leads grid does (no icon package is a dependency).

export type GridIcon = 'edit' | 'confirm' | 'hide' | 'restore' | 'subscribe';

const PATHS: Record<GridIcon, string> = {
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  confirm: 'M5 13l4 4L19 7',
  hide: 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21',
  restore: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
  subscribe: 'M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z',
};

interface Props {
  icon: GridIcon;
  /** Shown as the tooltip and read by screen readers — an icon-only button must name its action. */
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  /** The one primary action of a row (Confirm): filled instead of outlined. */
  primary?: boolean | undefined;
}

export default function GridIconButton({ icon, label, onClick, disabled, primary }: Props) {
  const tone = primary
    ? 'border-primary bg-primary text-on-primary hover:bg-primary/90'
    : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PATHS[icon]} />
      </svg>
    </button>
  );
}
