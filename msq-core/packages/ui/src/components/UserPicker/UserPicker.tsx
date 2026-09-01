"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../../hooks/useDropdown";
import { useAnchoredPanel } from "../../hooks/useAnchoredPanel";

// Below this many people the list fits on screen and a search box is just an
// extra control to skip past; above it, scanning for a colleague is the whole
// interaction.
const SEARCH_THRESHOLD = 7;

// Only the four fields this list actually renders. Deliberately not SessionUser:
// the rows from /users/assignable carry a different, thinner shape, and a full
// SessionUser[] still satisfies this.
export interface PickerUser {
  id: string;
  name?: string | null;
  email: string;
  role_label?: string | null;
}

interface Props {
  value: string;
  onChange: (userId: string) => void;
  users: PickerUser[];
  disabled?: boolean;
  placeholder?: string;
  hasError?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  extraOption?: { id: string; label: string } | undefined;
}

export default function UserPicker({
  value,
  onChange,
  users,
  disabled,
  placeholder = "Select a user…",
  hasError,
  allowEmpty,
  emptyLabel = "Unassigned",
  extraOption,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Once portalled the panel lives outside containerRef, so it needs its own ref
  // here or clicking a name would count as an outside click and close the list.
  useDismissible(open, [containerRef, panelRef], () => setOpen(false));

  // This picker is used inside Modal, whose card is overflow-hidden and whose
  // body is the scroll region — an absolutely positioned list was clipped at the
  // dialog's edge, hiding most of the names. Fixed positioning against the
  // trigger, portalled to <body>, is what keeps the whole list reachable.
  const rect = useAnchoredPanel(open, buttonRef, { preferredMaxHeight: 288 });

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const showSearch = users.length > SEARCH_THRESHOLD;

  // Alphabetical by the label each row renders, so the list reads the way
  // someone scanning it expects. The `allowEmpty` and `extraOption` rows sit
  // outside this — they are pinned, not part of the roster.
  const sorted = useMemo(
    () =>
      [...users].sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email, undefined, {
          sensitivity: "base",
        }),
      ),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.role_label ?? "").toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const selected =
    users.find((u) => u.id === value) ??
    (extraOption && extraOption.id === value ? null : null);

  const selectedLabel = selected
    ? selected.name || selected.email
    : extraOption?.id === value
      ? extraOption.label
      : allowEmpty && !value
        ? emptyLabel
        : "";

  const borderClass = hasError
    ? "border-red-400 focus:ring-red-200"
    : "border-[#E2E8F0] focus:border-[#0b6cbf] focus:ring-[#0b6cbf]/20";

  const panel =
    open && rect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              maxHeight: rect.maxHeight,
              zIndex: 1000,
            }}
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
            <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto">
              {allowEmpty && (
                <li
                  role="option"
                  aria-selected={!value}
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                    !value
                      ? "bg-[#EFF6FF] text-[#0b6cbf]"
                      : "text-[#64748B] hover:bg-[#F8FAFC]"
                  }`}
                >
                  {emptyLabel}
                </li>
              )}
              {extraOption && !users.some((u) => u.id === extraOption.id) && (
                <li
                  role="option"
                  aria-selected={value === extraOption.id}
                  onClick={() => {
                    onChange(extraOption.id);
                    setOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
                    value === extraOption.id
                      ? "bg-[#EFF6FF] text-[#0b6cbf]"
                      : "text-[#0F172A] hover:bg-[#F8FAFC]"
                  }`}
                >
                  {extraOption.label}
                </li>
              )}
              {filtered.map((u) => {
                const isSelected = u.id === value;
                return (
                  <li
                    key={u.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(u.id);
                      setOpen(false);
                    }}
                    className={`cursor-pointer px-3 py-2 transition-colors ${
                      isSelected
                        ? "bg-[#EFF6FF] text-[#0b6cbf]"
                        : "text-[#0F172A] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {u.name || u.email}
                    </span>
                    {u.name && (
                      <span className="block truncate text-[11px] text-[#64748B]">
                        {u.email}
                      </span>
                    )}
                    {u.role_label && (
                      <span className="block truncate text-[11px] text-[#64748B]">
                        {u.role_label}
                      </span>
                    )}
                  </li>
                );
              })}
              {users.length === 0 && !extraOption && (
                <li className="px-3 py-4 text-center text-xs text-[#64748B]">
                  No assignees available
                </li>
              )}
              {users.length > 0 && filtered.length === 0 && (
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
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm text-[#0F172A] focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] ${borderClass}`}
      >
        <span className={selectedLabel ? "truncate" : "text-[#94A3B8]"}>
          {selectedLabel || placeholder}
        </span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-[#64748B] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {panel}
    </div>
  );
}
