import { describe, expect, it } from 'vitest';
import { buildVerifyUrl, rangeContains } from './verify-route';

describe('Verify route helpers', () => {
  const range = { dateFrom: '2026-08-20', dateTo: '2026-08-21' };

  it('builds stable per-sheet URLs with queue date context', () => {
    expect(buildVerifyUrl('sheet/1', range)).toBe('/verify/sheet%2F1?dateFrom=2026-08-20&dateTo=2026-08-21');
    expect(buildVerifyUrl(null, range)).toBe('/verify?dateFrom=2026-08-20&dateTo=2026-08-21');
  });

  it('checks inclusive service-date bounds', () => {
    expect(rangeContains(range, '2026-08-20')).toBe(true);
    expect(rangeContains(range, '2026-08-21')).toBe(true);
    expect(rangeContains(range, '2026-08-22')).toBe(false);
  });
});
