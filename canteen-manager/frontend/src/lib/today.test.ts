import { describe, it, expect } from 'vitest';
import { today, tomorrow } from './today';

// TZ-agnostic expected "day after the given instant's local date": take today()'s
// own local-date string and add one calendar day with pure UTC arithmetic (which
// rolls month/year), mirroring how the picker derives the next collection day.
function dayAfter(instant: Date): string {
  const [y, m, d] = today(instant).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

describe('today', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(today(new Date('2026-06-18T05:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not roll back to the previous UTC day in a UTC+7 wall clock', () => {
    // 23:30 local on the 18th in Asia/Saigon (UTC+7) is 16:30Z the same day.
    // A toISOString().slice(0,10) shortcut would still read 2026-06-18 here, but
    // at 18:00 local (11:00Z) it must stay on the 18th — assert against the
    // browser-local interpretation the picker relies on.
    const instant = new Date('2026-06-18T11:00:00Z');
    const expected = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    expect(today(instant)).toBe(expected);
  });
});

describe('tomorrow', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(tomorrow(new Date('2026-06-20T05:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the local calendar day after today (mid-day instant)', () => {
    const instant = new Date('2026-06-20T05:00:00Z');
    expect(tomorrow(instant)).toBe(dayAfter(instant));
  });

  it('rolls forward across a month boundary', () => {
    const instant = new Date('2026-06-30T05:00:00Z');
    expect(tomorrow(instant)).toBe(dayAfter(instant));
  });

  it('rolls forward across a year boundary', () => {
    const instant = new Date('2026-12-31T05:00:00Z');
    expect(tomorrow(instant)).toBe(dayAfter(instant));
  });
});
