"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../../hooks/useDropdown";
import { useAnchoredPanel } from "../../hooks/useAnchoredPanel";

// Below this many options the list fits on screen and a search box is just an
// extra control to tab past; above it, scanning is the whole interaction.
// Same threshold and same reasoning as UserPicker.
const SEARCH_THRESHOLD = 7;

export interface SearchableOption {
  id: string;
  label: string;
  // Optional second line — a disambiguator when labels repeat (two branches
  // called "Sector 47" under different tenants, say). Searched as well as shown.
  hint?: string | undefined;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: SearchableOption[];
  // Pinned first row that clears the selection. Omit to make the control
  // mandatory — with no empty row there is no way back to "nothing chosen".
  emptyLabel?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  // The <select> this replaces carried a visible <label>; a listbox built from
  // a button needs the name spelled out for assistive tech instead.
  ariaLabel: string;
  // Trigger width. The scope switchers live in a crowded header and cap
  // themselves; a form field would pass a full-width class.
  className?: string;
}

/**
 * Domain-agnostic single-select with type-to-filter.
 *
 * Exists because a native <select> cannot be typed into: past a couple of dozen
 * options — the platform's org list is already there — picking one means
 * scrolling a list you cannot search. UserPicker solved this already but is
 * user-shaped (it requires an `email` per row and searches `role_label`), so
 * reaching for it here would have meant faking user records out of orgs.
 *
 * Deliberately NOT a <datalist>: that filters as you type but lets the field
 * hold free text that matches no option, so the caller has to reconcile a typed
 * string back to an id and decide what a near-miss means. A listbox can only
 * ever emit an id that exists.
 *
 * Panel is portalled and fixed-positioned via useAnchoredPanel for the reason
 * UserPicker documents: an absolutely positioned list is clipped by any
 * overflow-hidden ancestor — here the sticky header — which would cut the
 * options off at the header's bottom edge.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  emptyLabel,
  placeholder = "Select…",
  disabled,
  ariaLabel,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Portalled, so the panel is outside containerRef and needs its own ref here
  // or clicking an option counts as an outside click and closes the list.
  useDismissible(open, [containerRef, panelRef], () => setOpen(false));

  const rect = useAnchoredPanel(open, buttonRef, { preferredMaxHeight: 288 });

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const showSearch = options.length > SEARCH_THRESHOLD;

  const sorted = useMemo(
    () =>
      [...options].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      ),
    [options],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const selectedLabel =
    options.find((o) => o.id === value)?.label ?? (value ? "" : (emptyLabel ?? ""));

  const panel =
    open && rect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            style={rect.style}
            className="flex flex-col overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg"
          >
            {showSearch && (
              <div className="shrink-0 border-b border-[#F1F5F9] p-2">
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
                />
              </div>
            )}
            {/* min-h-0 lets this flex child shrink into the scroll region rather
                than pushing the panel past its measured height. */}
            <ul role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto">
              {emptyLabel !== undefined && (
                <li
                  role="option"
                  aria-selected={!value}
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                    !value ? "bg-[#EFF6FF] text-[#0b6cbf]" : "text-[#64748B] hover:bg-[#F8FAFC]"
                  }`}
                >
                  {emptyLabel}
                </li>
              )}
              {filtered.map((o) => {
                const isSelected = o.id === value;
                return (
                  <li
                    key={o.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className={`cursor-pointer px-3 py-2 transition-colors ${
                      isSelected
                        ? "bg-[#EFF6FF] text-[#0b6cbf]"
                        : "text-[#0F172A] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">{o.label}</span>
                    {o.hint && (
                      <span className="block truncate text-[11px] text-[#64748B]">{o.hint}</span>
                    )}
                  </li>
                );
              })}
              {options.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-[#64748B]">
                  Nothing to choose from
                </li>
              )}
              {options.length > 0 && filtered.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-[#64748B]">
                  No matches for &quot;{search.trim()}&quot;.
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-left text-xs font-semibold text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        <span className={selectedLabel ? "truncate" : "truncate text-[#94A3B8]"}>
          {selectedLabel || placeholder}
        </span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-[#64748B] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {panel}
    </div>
  );
}
