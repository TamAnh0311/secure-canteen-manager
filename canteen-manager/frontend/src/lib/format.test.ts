import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import i18n from '@/i18n';
import { formatDate, formatTime, formatNumber } from './format';

// Fixed local datetime: 17 June 2026, 13:05.
const SAMPLE = new Date(2026, 5, 17, 13, 5, 0);

describe('format — Vietnamese (default)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('vi');
  });

  it('groups thousands with a dot (vi-VN)', () => {
    expect(formatNumber(1234)).toBe('1.234');
  });

  it('formats the date in the Vietnamese locale', () => {
    const out = formatDate(SAMPLE);
    expect(out).toContain('2026');
    expect(out).toContain('17');
    expect(out).toContain('6'); // month token
  });

  it('formats time as 24-hour', () => {
    expect(formatTime(SAMPLE)).toBe('13:05');
  });

  // Postgres TIME columns (e.g. session time windows) serialize to bare
  // "HH:mm:ss" strings; new Date() of those is Invalid Date and used to throw.
  it('formats a bare time-of-day string', () => {
    expect(formatTime('11:30:00')).toBe('11:30');
    expect(formatTime('09:05')).toBe('09:05');
  });

  it('returns a placeholder for unparseable values instead of throwing', () => {
    expect(formatTime('not-a-time')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('format — English (switched)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('vi');
  });

  it('groups thousands with a comma (en-US)', () => {
    expect(formatNumber(1234)).toBe('1,234');
  });

  it('formats the date in the English locale', () => {
    const out = formatDate(SAMPLE);
    expect(out).toContain('2026');
    expect(out).toContain('Jun');
  });

  it('formats time as 24-hour', () => {
    expect(formatTime(SAMPLE)).toBe('13:05');
  });
});
