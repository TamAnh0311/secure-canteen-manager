import { today, tomorrow } from '@/lib/today';

export type RangePreset = 'shift' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Format a Date to YYYY-MM-DD string. */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD string to a local Date. */
function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Compute dateFrom/dateTo for a preset, anchored to today. */
export function presetRange(preset: RangePreset): { dateFrom: string; dateTo: string } {
  const t = today();
  const d = parse(t);

  switch (preset) {
    case 'shift':
    case 'day':
      return { dateFrom: tomorrow(), dateTo: tomorrow() };
    case 'week': {
      // Monday–Sunday week containing tomorrow
      const tom = parse(tomorrow());
      const dow = tom.getDay() || 7; // Mon=1..Sun=7
      const mon = new Date(tom);
      mon.setDate(tom.getDate() - dow + 1);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { dateFrom: fmt(mon), dateTo: fmt(sun) };
    }
    case 'month':
      return {
        dateFrom: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
        dateTo: fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      };
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3);
      const qStart = new Date(d.getFullYear(), q * 3, 1);
      const qEnd = new Date(d.getFullYear(), q * 3 + 3, 0);
      return { dateFrom: fmt(qStart), dateTo: fmt(qEnd) };
    }
    case 'year':
      return {
        dateFrom: `${d.getFullYear()}-01-01`,
        dateTo: `${d.getFullYear()}-12-31`,
      };
  }
}

/** Shift a range backward by one period of the same length (for comparison). */
export function previousPeriod(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = parse(dateFrom);
  const to = parse(dateTo);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(from.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - days + 1);
  return { dateFrom: fmt(prevFrom), dateTo: fmt(prevTo) };
}
