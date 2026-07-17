'use client';

// Generic colored-bar month grid — zero domain knowledge. A consumer supplies
// the year/month, a list of dated bars ({ date, label, color }) and dated
// markers (e.g. holidays); MonthGrid lays them out on a 7-column calendar and
// emits month navigation. Leave-specific composition (which requests become
// bars, what colors mean) lives in apps/web.

import { useMemo } from 'react';

export interface MonthGridBar {
  /** 'YYYY-MM-DD' */
  date: string;
  label: string;
  /** any CSS color / Tailwind-arbitrary background applied inline */
  color: string;
  title?: string;
}

export interface MonthGridMarker {
  /** 'YYYY-MM-DD' */
  date: string;
  label: string;
}

interface Props {
  /** full year, e.g. 2026 */
  year: number;
  /** 1–12 */
  month: number;
  bars?: MonthGridBar[];
  markers?: MonthGridMarker[];
  onMonthChange: (year: number, month: number) => void;
  /** optional — makes each day cell clickable, receiving its 'YYYY-MM-DD' date */
  onDayClick?: (date: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function MonthGrid({ year, month, bars = [], markers = [], onMonthChange, onDayClick }: Props) {
  const { cells, barsByDate, markersByDate } = useMemo(() => {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const list: (number | null)[] = [];
    for (let i = 0; i < firstDow; i += 1) list.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) list.push(d);
    while (list.length % 7 !== 0) list.push(null);

    const b = new Map<string, MonthGridBar[]>();
    for (const bar of bars) {
      const arr = b.get(bar.date) ?? [];
      arr.push(bar);
      b.set(bar.date, arr);
    }
    const m = new Map<string, MonthGridMarker[]>();
    for (const mk of markers) {
      const arr = m.get(mk.date) ?? [];
      arr.push(mk);
      m.set(mk.date, arr);
    }
    return { cells: list, barsByDate: b, markersByDate: m };
  }, [year, month, bars, markers]);

  const prev = () => {
    if (month === 1) onMonthChange(year - 1, 12);
    else onMonthChange(year, month - 1);
  };
  const next = () => {
    if (month === 12) onMonthChange(year + 1, 1);
    else onMonthChange(year, month + 1);
  };

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous month"
          className="rounded-lg border border-[#E2E8F0] bg-white p-1.5 text-[#475569] transition-colors hover:border-[#0b6cbf] hover:text-[#0b6cbf]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-sm font-semibold text-[#0F172A]">
          {MONTH_NAMES[month - 1]} {year}
        </h3>
        <button
          type="button"
          onClick={next}
          aria-label="Next month"
          className="rounded-lg border border-[#E2E8F0] bg-white p-1.5 text-[#475569] transition-colors hover:border-[#0b6cbf] hover:text-[#0b6cbf]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
            {w}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="min-h-[64px] rounded-lg bg-[#F8FAFC]" />;
          const date = iso(year, month, day);
          const dayBars = barsByDate.get(date) ?? [];
          const dayMarkers = markersByDate.get(date) ?? [];
          const isHoliday = dayMarkers.length > 0;
          const Cell = onDayClick ? 'button' : 'div';
          return (
            <Cell
              key={date}
              type={onDayClick ? 'button' : undefined}
              onClick={onDayClick ? () => onDayClick(date) : undefined}
              className={`min-h-[64px] rounded-lg border p-1 text-left ${
                isHoliday ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-[#E2E8F0] bg-white'
              } ${onDayClick ? 'cursor-pointer transition-colors hover:border-[#0b6cbf]' : ''}`}
            >
              <div className="mb-1 text-[11px] font-medium text-[#64748B]">{day}</div>
              {dayMarkers.map((mk, i) => (
                <div key={`mk-${i}`} className="truncate text-[10px] font-medium text-[#B45309]" title={mk.label}>
                  {mk.label}
                </div>
              ))}
              {dayBars.map((bar, i) => (
                <div
                  key={`bar-${i}`}
                  title={bar.title ?? bar.label}
                  className="mb-0.5 truncate rounded px-1 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: bar.color }}
                >
                  {bar.label}
                </div>
              ))}
            </Cell>
          );
        })}
      </div>
    </div>
  );
}
