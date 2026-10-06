// @platform/ui-kit/locale — tenant regional formats. Config + formatters are pure
// (server- and client-safe); only useLocale is a client hook.
export * from './config';
export { createFormatters } from './format';
export type { Formatters, FormatOptions } from './format';
export { useLocale } from './useLocale';
