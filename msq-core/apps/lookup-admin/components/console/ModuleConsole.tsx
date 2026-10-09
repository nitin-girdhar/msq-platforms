'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { InfoTip } from '@platform/ui-kit';

export interface ConsoleCard {
  key: string;
  title: string;
  description: string;
  href: string;
}

export interface ConsoleSection {
  id: string;
  title: string;
  blurb?: string | undefined;
  cards: ConsoleCard[];
}

interface Props {
  sections: ConsoleSection[];
}

// Card console shared by the Platform home and every module pane (Stitch
// "Platform Console" / "Module Console"). Sections group the cards; the chips
// and the filter box narrow what is shown on screen only — every card stays a
// plain link, and a section with no match disappears rather than showing empty.
export default function ModuleConsole({ sections }: Props) {
  const [active, setActive] = useState<string>('all');
  const [query, setQuery] = useState('');

  const total = sections.reduce((n, s) => n + s.cards.length, 0);
  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      sections
        .filter((s) => active === 'all' || s.id === active)
        .map((s) => ({
          ...s,
          cards: q
            ? s.cards.filter((c) => `${c.title} ${c.description}`.toLowerCase().includes(q))
            : s.cards,
        }))
        .filter((s) => s.cards.length > 0),
    [sections, active, q],
  );

  const multi = sections.length > 1;
  const chip = (on: boolean) =>
    `inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-semibold transition-colors sm:min-h-8 ${
      on
        ? 'border-primary bg-primary-fixed text-on-primary-container'
        : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {multi && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Section">
            <button type="button" className={chip(active === 'all')} aria-pressed={active === 'all'} onClick={() => setActive('all')}>
              All ({total})
            </button>
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={chip(active === s.id)}
                aria-pressed={active === s.id}
                onClick={() => setActive(s.id)}
              >
                {s.title} ({s.cards.length})
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter cards"
          className="min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface placeholder:text-outline sm:ml-auto sm:min-h-8 sm:w-64 sm:text-xs"
        />
      </div>

      {visible.length === 0 && (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
          Nothing matches “{query}”.
        </p>
      )}

      {visible.map((s) => (
        <section key={s.id} className="space-y-2" aria-label={s.title || 'Cards'}>
          {s.title && (
            <div className="flex items-start gap-3 border-l-4 border-primary pl-3">
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                  {s.title}
                  {s.blurb && <InfoTip label={`About ${s.title}`}>{s.blurb}</InfoTip>}
                </h2>
              </div>
              <span className="shrink-0 rounded-md bg-surface-container px-2 py-0.5 text-[0.6875rem] font-semibold text-on-surface-variant">
                {s.cards.length} {s.cards.length === 1 ? 'card' : 'cards'}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.cards.map((c) => (
              // The (i) is a sibling of the link, not a child: a button inside an anchor is invalid
              // and would navigate on tap. Positioned over the card's top-right corner.
              <div key={c.key} className="relative">
                <Link
                  href={c.href}
                  className="group flex min-h-11 items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest py-2.5 pl-3 pr-9 shadow-sm transition-colors hover:border-primary hover:bg-primary-fixed"
                >
                  <h3 className="min-w-0 truncate text-sm font-semibold text-on-surface">{c.title}</h3>
                  <span className="shrink-0 text-xs font-semibold text-primary" aria-hidden="true">
                    Open →
                  </span>
                </Link>
                <InfoTip label={`About ${c.title}`} className="absolute right-3 top-1/2 -translate-y-1/2">{c.description}</InfoTip>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
