import { describe, it, expect } from 'vitest';
// Relative on purpose: ui-kit has no runtime dependency on the validation package.
import * as v from '../../../../platform-validation/src/branding';
import {
  CURRENCY_DISPLAY_IDS, CURRENCY_IDS, DATE_FORMAT_IDS, DEFAULT_LOCALE_CONFIG, LOCALE_IDS,
  NUMBER_GROUPING_IDS, PHONE_COUNTRY_CODES, TIME_FORMAT_IDS, WEEK_START_IDS, localeFromApi,
} from '../config';
import { createFormatters } from '../format';

describe('locale whitelists match the API gate', () => {
  it('ui-kit lists equal @platform/validation lists', () => {
    expect([...LOCALE_IDS]).toEqual([...v.LOCALE_IDS]);
    expect([...DATE_FORMAT_IDS]).toEqual([...v.DATE_FORMAT_IDS]);
    expect([...TIME_FORMAT_IDS]).toEqual([...v.TIME_FORMAT_IDS]);
    expect([...WEEK_START_IDS]).toEqual([...v.WEEK_START_IDS]);
    expect([...CURRENCY_IDS]).toEqual([...v.CURRENCY_IDS]);
    expect([...CURRENCY_DISPLAY_IDS]).toEqual([...v.CURRENCY_DISPLAY_IDS]);
    expect([...NUMBER_GROUPING_IDS]).toEqual([...v.NUMBER_GROUPING_IDS]);
    expect([...PHONE_COUNTRY_CODES]).toEqual([...v.PHONE_COUNTRY_CODES]);
  });
});

describe('localeFromApi', () => {
  it('gives the platform default for empty / junk input', () => {
    expect(localeFromApi({})).toEqual(DEFAULT_LOCALE_CONFIG);
    expect(localeFromApi(null)).toEqual(DEFAULT_LOCALE_CONFIG);
    expect(localeFromApi([])).toEqual(DEFAULT_LOCALE_CONFIG);
  });
  it('drops unknown values per key instead of trusting them', () => {
    const c = localeFromApi({ currency: 'XXX', timezone: 'Mars/Base', date_format: 'YYYY-MM-DD', fiscal_year_start: 13 });
    expect(c.currency).toBe('INR');
    expect(c.timezone).toBe('Asia/Kolkata');
    expect(c.fiscal_year_start).toBe(4);
    expect(c.date_format).toBe('YYYY-MM-DD');
  });
});

describe('createFormatters', () => {
  const instant = '2026-07-05T04:00:00Z'; // 09:30 in Asia/Kolkata

  it('default config matches today (DD/MM/YYYY, 12h, Indian grouping, INR)', () => {
    const f = createFormatters();
    expect(f.formatDate(instant)).toBe('05/07/2026');
    expect(f.formatTime(instant)).toBe('9:30 am');
    expect(f.formatNumber(1234567.5)).toBe('12,34,567.5');
    expect(f.formatMoney(1234567)).toBe('₹12,34,567.00');
    expect(f.weekStartDay).toBe(1);
  });

  it('honours date format, 24h time, grouping, currency and week start', () => {
    const f = createFormatters({
      ...DEFAULT_LOCALE_CONFIG,
      date_format: 'MM/DD/YYYY', time_format: '24h', number_grouping: 'international',
      currency: 'USD', currency_display: 'code', week_start: 'sunday',
    });
    expect(f.formatDate(instant)).toBe('07/05/2026');
    expect(f.formatTime(instant)).toBe('09:30');
    expect(f.formatNumber(1234567.5)).toBe('1,234,567.5');
    expect(f.formatMoney(1234.5)).toMatch(/USD\s?1,234\.50/);
    expect(f.weekStartDay).toBe(0);
    expect(createFormatters({ ...DEFAULT_LOCALE_CONFIG, date_format: 'YYYY-MM-DD' }).formatDate(instant)).toBe('2026-07-05');
    expect(createFormatters({ ...DEFAULT_LOCALE_CONFIG, date_format: 'DD MMM YYYY' }).formatDate(instant)).toBe('05 Jul 2026');
  });

  it('a bare calendar date never shifts a day, whatever the timezone', () => {
    const west = createFormatters({ ...DEFAULT_LOCALE_CONFIG, timezone: 'America/Los_Angeles' });
    expect(west.formatDate('2026-07-05')).toBe('05/07/2026');
  });

  it('an instant honours a per-call timezone override (branch tz)', () => {
    expect(createFormatters().formatTime(instant, { timeZone: 'UTC' })).toBe('4:00 am');
  });

  it('missing values render an em dash, never "Invalid Date"', () => {
    const f = createFormatters();
    expect(f.formatDate(null)).toBe('—');
    expect(f.formatDate('not a date')).toBe('—');
    expect(f.formatMoney(undefined)).toBe('—');
    expect(f.formatDateTime('')).toBe('—');
  });

  it('fiscal year label follows fiscal_year_start', () => {
    const f = createFormatters();
    expect(f.fiscalYearLabel('2026-04-01')).toBe('2026-27');
    expect(f.fiscalYearLabel('2026-03-31')).toBe('2025-26');
    expect(createFormatters({ ...DEFAULT_LOCALE_CONFIG, fiscal_year_start: 1 }).fiscalYearLabel('2026-03-31')).toBe('2026');
  });
});
