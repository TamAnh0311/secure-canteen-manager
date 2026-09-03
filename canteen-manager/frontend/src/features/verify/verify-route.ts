import type { DateRange } from '@/features/_shared/date-range-picker';

export function buildVerifyUrl(sheetId: string | null, range: DateRange): string {
  const params = new URLSearchParams({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  return `/verify${sheetId ? `/${encodeURIComponent(sheetId)}` : ''}?${params.toString()}`;
}

export function rangeContains(range: DateRange, date: string): boolean {
  return date >= range.dateFrom && date <= range.dateTo;
}
