import { DEFAULT_LOCALE_CONFIG, type LocaleConfig } from './config';

// Pure formatters over a LocaleConfig (no React, no DOM) — the one place a screen,
// export or email turns a stored value into text. Inputs are ISO strings, Dates or
// epoch ms (the storage formats); nothing here is ever parsed back.

type DateInput = Date | string | number | null | undefined;
export interface FormatOptions {
  /** Override the config's timezone — e.g. a branch's own entity.organizations.timezone. */
  timeZone?: string;
}

const EMPTY = '—';
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === '') return null;
  // A bare YYYY-MM-DD is a calendar date, not an instant: anchor it at noon UTC so
  // no timezone can shift it onto the neighbouring day.
  const d = typeof v === 'string' && CALENDAR_DATE.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A bare calendar date is formatted in UTC (see toDate); an instant in the tenant/branch zone. */
function zoneFor(v: DateInput, cfg: LocaleConfig, o?: FormatOptions): string {
  return typeof v === 'string' && CALENDAR_DATE.test(v) ? 'UTC' : (o?.timeZone ?? cfg.timezone);
}

function parts(d: Date, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale, { timeZone, ...opts }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

export interface Formatters {
  config: LocaleConfig;
  /** 05/07/2026 | 07/05/2026 | 2026-07-05 | 05 Jul 2026 per `date_format`. */
  formatDate: (v: DateInput, o?: FormatOptions) => string;
  /** 9:30 am | 09:30 per `time_format`. */
  formatTime: (v: DateInput, o?: FormatOptions) => string;
  formatDateTime: (v: DateInput, o?: FormatOptions) => string;
  /** Grouped per `number_grouping` (12,34,567.5 vs 1,234,567.5). */
  formatNumber: (n: number | null | undefined, maxFractionDigits?: number) => string;
  /** ₹12,34,567.00 | INR 12,34,567.00 per `currency` / `currency_display`. */
  formatMoney: (n: number | null | undefined, o?: { currency?: LocaleConfig['currency'] }) => string;
  /** 0 = Sunday … 6 = Saturday, as Date#getDay(). */
  weekStartDay: number;
  /** Fiscal year label for a date, e.g. 2026-27 (or 2026 when the year starts in January). */
  fiscalYearLabel: (v: DateInput) => string;
}

export function createFormatters(config: LocaleConfig = DEFAULT_LOCALE_CONFIG): Formatters {
  const groupingLocale = config.number_grouping === 'indian' ? 'en-IN' : 'en-US';

  const formatDate: Formatters['formatDate'] = (v, o) => {
    const d = toDate(v);
    if (!d) return EMPTY;
    const tz = zoneFor(v, config, o);
    if (config.date_format === 'DD MMM YYYY') {
      const p = parts(d, config.locale, tz, { day: '2-digit', month: 'short', year: 'numeric' });
      return `${p['day']} ${p['month']} ${p['year']}`;
    }
    const p = parts(d, 'en-GB', tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
    switch (config.date_format) {
      case 'MM/DD/YYYY': return `${p['month']}/${p['day']}/${p['year']}`;
      case 'YYYY-MM-DD': return `${p['year']}-${p['month']}-${p['day']}`;
      default: return `${p['day']}/${p['month']}/${p['year']}`;
    }
  };

  const formatTime: Formatters['formatTime'] = (v, o) => {
    const d = toDate(v);
    if (!d) return EMPTY;
    const h12 = config.time_format === '12h';
    const p = parts(d, 'en-US', o?.timeZone ?? config.timezone, {
      hour: h12 ? 'numeric' : '2-digit',
      minute: '2-digit',
      hour12: h12,
      ...(h12 ? {} : { hourCycle: 'h23' as const }),
    });
    return h12 ? `${p['hour']}:${p['minute']} ${(p['dayPeriod'] ?? '').toLowerCase()}`.trim() : `${p['hour']}:${p['minute']}`;
  };

  const formatNumber: Formatters['formatNumber'] = (n, maxFractionDigits = 2) =>
    n === null || n === undefined || Number.isNaN(n)
      ? EMPTY
      : new Intl.NumberFormat(groupingLocale, { maximumFractionDigits: maxFractionDigits }).format(n);

  const formatMoney: Formatters['formatMoney'] = (n, o) =>
    n === null || n === undefined || Number.isNaN(n)
      ? EMPTY
      : new Intl.NumberFormat(groupingLocale, {
          style: 'currency',
          currency: o?.currency ?? config.currency,
          currencyDisplay: config.currency_display === 'code' ? 'code' : 'symbol',
        }).format(n);

  const fiscalYearLabel: Formatters['fiscalYearLabel'] = (v) => {
    const d = toDate(v);
    if (!d) return EMPTY;
    const p = parts(d, 'en-GB', zoneFor(v, config), { year: 'numeric', month: 'numeric' });
    const year = Number(p['year']);
    const month = Number(p['month']);
    if (config.fiscal_year_start === 1) return String(year);
    const start = month >= config.fiscal_year_start ? year : year - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
  };

  return {
    config,
    formatDate,
    formatTime,
    formatDateTime: (v, o) => {
      const d = formatDate(v, o);
      return d === EMPTY ? EMPTY : `${d} ${formatTime(v, o)}`;
    },
    formatNumber,
    formatMoney,
    weekStartDay: config.week_start === 'sunday' ? 0 : config.week_start === 'saturday' ? 6 : 1,
    fiscalYearLabel,
  };
}
