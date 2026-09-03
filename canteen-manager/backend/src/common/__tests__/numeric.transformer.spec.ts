import { numericTransformer, MAX_VND } from '../numeric.transformer';

describe('numericTransformer', () => {
  describe('from() — DB string → JS number', () => {
    it('parses a bigint string to a number', () => {
      expect(numericTransformer.from('0')).toBe(0);
      expect(numericTransformer.from('12345')).toBe(12345);
    });

    it('round-trips values up to MAX_VND losslessly', () => {
      const s = String(MAX_VND);
      const parsed = numericTransformer.from(s) as number;
      expect(parsed).toBe(MAX_VND);
      expect(String(parsed)).toBe(s);
      expect(Number.isSafeInteger(parsed)).toBe(true);
    });

    it('returns null for null/undefined', () => {
      expect(numericTransformer.from(null)).toBeNull();
      expect(numericTransformer.from(undefined)).toBeNull();
    });
  });

  describe('to() — JS number → DB value', () => {
    it('passes through finite values including zero', () => {
      expect(numericTransformer.to(0)).toBe(0);
      expect(numericTransformer.to(MAX_VND)).toBe(MAX_VND);
    });

    it('maps null/undefined to null', () => {
      expect(numericTransformer.to(null)).toBeNull();
      expect(numericTransformer.to(undefined)).toBeNull();
    });
  });

  describe('MAX_VND ceiling', () => {
    it('stays well below Number.MAX_SAFE_INTEGER', () => {
      expect(MAX_VND).toBeLessThan(Number.MAX_SAFE_INTEGER);
      // round-trip of the ceiling is exact (no float drift)
      expect(numericTransformer.from(numericTransformer.to(MAX_VND) as unknown as string)).toBe(
        MAX_VND,
      );
    });
  });
});
