// Locale-aware date/time/number formatting. Locale tracks the active i18n
// language: Vietnamese (vi-VN) by default, English (en-US) when switched.

import i18n from '@/i18n';

function activeLocale(): string {
  return i18n.language === 'en' ? 'en-US' : 'vi-VN';
}

// Matches a bare time-of-day string ("HH:mm" or "HH:mm:ss") with no date part —
// the shape Postgres TIME columns serialize to.
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    // `new Date("11:30:00")` is Invalid Date; anchor time-only strings to a
    // fixed date so Intl can format the time component.
    if (TIME_ONLY.test(t)) return new Date(`1970-01-01T${t}`);
  }
  return new Date(value);
}

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

const DEFAULT_TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

// Placeholder for unparseable values — keeps a bad field from throwing
// RangeError and tearing down the whole route via the error boundary.
const INVALID_PLACEHOLDER = '—';

export function formatDate(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return INVALID_PLACEHOLDER;
  return new Intl.DateTimeFormat(activeLocale(), opts).format(date);
}

export function formatTime(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = DEFAULT_TIME_OPTS,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return INVALID_PLACEHOLDER;
  return new Intl.DateTimeFormat(activeLocale(), opts).format(date);
}

export function formatNumber(
  value: number,
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(activeLocale(), opts).format(value);
}

// Integer VND. No fraction digits — đồng has no minor unit.
export function formatVnd(value: number): string {
  return new Intl.NumberFormat(activeLocale(), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}
