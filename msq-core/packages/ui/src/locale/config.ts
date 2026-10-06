// Regional formats a tenant admin can set (entity.tenant_branding.locale_config,
// schema 1.73.0). Whitelists only: the ids here mirror @platform/validation
// (LOCALE_IDS … PHONE_COUNTRY_CODES) and the formatter understands exactly these —
// the locale test asserts the two lists match. Display only: stored data stays
// UTC / ISO / NUMERIC and API fields keep their wire formats.

export const LOCALE_IDS = ['en-IN', 'en-GB', 'en-US', 'en-AE', 'en-SG', 'en-AU', 'hi-IN'] as const;
export const DATE_FORMAT_IDS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'] as const;
export const TIME_FORMAT_IDS = ['12h', '24h'] as const;
export const WEEK_START_IDS = ['monday', 'sunday', 'saturday'] as const;
export const CURRENCY_IDS = ['INR', 'USD', 'AED', 'SGD', 'GBP', 'EUR', 'AUD'] as const;
export const CURRENCY_DISPLAY_IDS = ['symbol', 'code'] as const;
export const NUMBER_GROUPING_IDS = ['indian', 'international'] as const;
export const PHONE_COUNTRY_CODES = ['+91', '+971', '+65', '+44', '+1', '+61'] as const;

export type LocaleId = (typeof LOCALE_IDS)[number];
export type DateFormatId = (typeof DATE_FORMAT_IDS)[number];
export type TimeFormatId = (typeof TIME_FORMAT_IDS)[number];
export type WeekStartId = (typeof WEEK_START_IDS)[number];
export type CurrencyId = (typeof CURRENCY_IDS)[number];
export type CurrencyDisplayId = (typeof CURRENCY_DISPLAY_IDS)[number];
export type NumberGroupingId = (typeof NUMBER_GROUPING_IDS)[number];
export type PhoneCountryCode = (typeof PHONE_COUNTRY_CODES)[number];

/** Fully resolved settings a renderer uses — no optionals. snake_case: crosses the API. */
export interface LocaleConfig {
  locale: LocaleId;
  date_format: DateFormatId;
  time_format: TimeFormatId;
  timezone: string;
  week_start: WeekStartId;
  currency: CurrencyId;
  currency_display: CurrencyDisplayId;
  number_grouping: NumberGroupingId;
  fiscal_year_start: number;
  phone_country_code: PhoneCountryCode;
}

/** What a tenant that set nothing sees — exactly today's behaviour. */
export const DEFAULT_LOCALE_CONFIG: LocaleConfig = {
  locale: 'en-IN',
  date_format: 'DD/MM/YYYY',
  time_format: '12h',
  timezone: 'Asia/Kolkata',
  week_start: 'monday',
  currency: 'INR',
  currency_display: 'symbol',
  number_grouping: 'indian',
  fiscal_year_start: 4,
  phone_country_code: '+91',
};

const inList = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /me/branding `locale` → LocaleConfig. Defensive like brandingFromApi: an
 * unknown or malformed value is dropped (that key falls back to the default)
 * rather than trusted, so a stale row can never break a page.
 */
export function localeFromApi(data: unknown): LocaleConfig {
  const out: LocaleConfig = { ...DEFAULT_LOCALE_CONFIG };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return out;
  const d = data as Record<string, unknown>;
  if (inList(LOCALE_IDS, d['locale'])) out.locale = d['locale'];
  if (inList(DATE_FORMAT_IDS, d['date_format'])) out.date_format = d['date_format'];
  if (inList(TIME_FORMAT_IDS, d['time_format'])) out.time_format = d['time_format'];
  if (validTimezone(d['timezone'])) out.timezone = d['timezone'];
  if (inList(WEEK_START_IDS, d['week_start'])) out.week_start = d['week_start'];
  if (inList(CURRENCY_IDS, d['currency'])) out.currency = d['currency'];
  if (inList(CURRENCY_DISPLAY_IDS, d['currency_display'])) out.currency_display = d['currency_display'];
  if (inList(NUMBER_GROUPING_IDS, d['number_grouping'])) out.number_grouping = d['number_grouping'];
  const fy = d['fiscal_year_start'];
  if (typeof fy === 'number' && Number.isInteger(fy) && fy >= 1 && fy <= 12) out.fiscal_year_start = fy;
  if (inList(PHONE_COUNTRY_CODES, d['phone_country_code'])) out.phone_country_code = d['phone_country_code'];
  return out;
}
