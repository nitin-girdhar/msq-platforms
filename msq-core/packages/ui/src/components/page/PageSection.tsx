import type { ReactNode } from 'react';
import InfoTip from './InfoTip';

interface Props {
  title: string;
  /** Explanatory text shown in an (i) beside the title; see PageHeader `info`. */
  info?: ReactNode;
  /** Right-aligned control for the section (a filter select, a date picker, …). */
  action?: ReactNode;
  children: ReactNode;
}

// A titled block inside PageBody. The heading uses the same muted micro-label
// treatment as the LMS stat cards (11px / uppercase / #64748B). HR and Tasks
// previously set section headings in #0b6cbf, which is the brand's interactive
// colour — it made every static heading look like a link.
export default function PageSection({ title, info, action, children }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-[26px] items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">
          {title}
          {info && <InfoTip label={`About ${title}`}>{info}</InfoTip>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
