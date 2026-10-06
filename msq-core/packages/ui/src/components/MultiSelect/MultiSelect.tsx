'use client';

import { useMemo } from 'react';
import { useDropdown } from '../../hooks/useDropdown';

export interface SelectOption {
  id: string | number;
  label: string;
}

interface Props {
  label: string;
  placeholder: string;
  options: SelectOption[];
  selected: SelectOption[];
  onChange: (next: SelectOption[]) => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Rendered in place of the chips when every option is selected. Give it a
   * value on any filter that defaults to "everything" — a branch or source
   * filter over 30 options would otherwise open as 30 chips and push the rest
   * of the filter bar off the row. Without it, a full selection chips out
   * normally (the pre-existing behaviour).
   */
  allLabel?: string;
  /** Beyond this many chips, collapse to an "N selected" summary. Unbounded by
   *  default, so existing call sites keep chipping out every selection. */
  maxChips?: number;
  /** Adds a "Select all" action beside "Clear all". */
  selectAllLabel?: string;
  /**
   * 'field' (default): the labelled form control every filter bar uses.
   * 'chip': a navbar pill matching the branch switcher — no label above, the
   * label becomes a prefix ("Type: All types" / "Type: Sales" /
   * "Type: 2 selected") and the list opens right-aligned under it.
   */
  variant?: 'field' | 'chip';
}

export default function MultiSelect({
  label, placeholder, options, selected, onChange, loading = false, disabled = false,
  allLabel, maxChips = Number.POSITIVE_INFINITY, selectAllLabel, variant = 'field',
}: Props) {
  const isChip = variant === 'chip';
  const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();

  const selectedIds = useMemo(() => new Set(selected.map((o) => o.id)), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options.filter((o) => !q || String(o.label).toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (opt: SelectOption) => {
    if (selectedIds.has(opt.id)) {
      onChange(selected.filter((o) => o.id !== opt.id));
    } else {
      onChange([...selected, opt]);
    }
    searchInputRef.current?.focus();
  };

  const removeChip = (opt: SelectOption, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((o) => o.id !== opt.id));
  };

  // Compared on count alone: `selected` is always built from `options`, so the
  // two can only match in length when they hold the same ids.
  const allSelected = options.length > 0 && selected.length === options.length;
  const summary = allSelected && allLabel
    ? allLabel
    : selected.length > maxChips
      ? `${selected.length} selected`
      : null;

  // Chip text: the label as a prefix, then the selection in one short phrase.
  const chipValue = selected.length === 0
    ? placeholder
    : summary ?? (selected.length === 1 ? String(selected[0]!.label) : `${selected.length} selected`);

  return (
    <div ref={rootRef} className={`relative flex min-w-0 ${isChip ? 'shrink-0' : 'flex-col gap-1'}`}>
      {!isChip && (
        <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </span>
      )}

      {isChip ? (
        <button
          type="button"
          onClick={() => { if (!disabled) setOpen((v) => !v); }}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${chipValue}`}
          title={`${label}: ${chipValue}`}
          className="flex max-w-[240px] cursor-pointer items-center gap-1.5 rounded-lg bg-surface-container-low px-2.5 py-1.5 text-label-md font-semibold text-on-surface transition-colors hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
        >
          <svg className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.59l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 0 1 8 18.25v-5.757a2.25 2.25 0 0 0-.659-1.591L2.659 6.22A2.25 2.25 0 0 1 2 4.629V2.34a.75.75 0 0 1 .628-.74Z" clipRule="evenodd" />
          </svg>
          <span className="truncate">
            <span className="font-medium text-on-surface-variant">{label}:</span>{' '}
            <span className={selected.length > 0 ? 'text-primary' : ''}>{chipValue}</span>
          </span>
          <svg className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      ) : (
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[34px] w-full min-w-[140px] flex-wrap items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-left shadow-sm transition-colors hover:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-container-low aria-expanded:border-primary aria-expanded:ring-2 aria-expanded:ring-primary/20"
      >
        {selected.length === 0 ? (
          <span className="text-xs text-outline">{placeholder}</span>
        ) : summary ? (
          <span className="rounded-full border border-primary-fixed-dim bg-primary-fixed px-1.5 py-0.5 text-[0.6875rem] font-semibold text-primary">
            {summary}
          </span>
        ) : (
          selected.map((opt) => (
            <span
              key={opt.id}
              className="flex items-center gap-0.5 rounded-full border border-primary-fixed-dim bg-primary-fixed px-1.5 py-0.5 text-[0.6875rem] font-semibold text-primary"
            >
              {opt.label}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => removeChip(opt, e)}
                aria-label={`Remove ${opt.label}`}
                className="cursor-pointer text-primary/60 hover:text-primary"
              >
                ×
              </span>
            </span>
          ))
        )}
      </button>
      )}

      {open && (
        <div
          role="listbox"
          className={isChip
            ? 'absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg'
            : 'absolute top-full z-50 mt-1 w-full min-w-[180px] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg'}
        >
          <div className="border-b border-outline-variant/60 p-2">
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none"
            />
          </div>

          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <p className="px-3 py-4 text-center text-xs text-on-surface-variant">Loading…</p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-on-surface-variant">
                {search ? `No matches for "${search}"` : 'No options available'}
              </p>
            )}
            {!loading && filtered.map((opt) => {
              const checked = selectedIds.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(opt)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-low"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      checked ? 'border-primary bg-primary' : 'border-outline-variant bg-surface-container-lowest'
                    }`}
                  >
                    {checked && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`truncate text-xs ${checked ? 'font-semibold text-on-surface' : 'text-on-surface'}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>

          {(selected.length > 0 || selectAllLabel) && (
            <div className="flex gap-1 border-t border-outline-variant/60 p-2">
              {selectAllLabel && (
                <button
                  type="button"
                  onClick={() => onChange([...options])}
                  disabled={allSelected}
                  className="flex-1 rounded-lg py-1 text-center text-[0.6875rem] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
                >
                  {selectAllLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={selected.length === 0}
                className="flex-1 rounded-lg py-1 text-center text-[0.6875rem] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
