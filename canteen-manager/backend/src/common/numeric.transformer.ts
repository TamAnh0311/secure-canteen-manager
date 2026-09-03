import { ValueTransformer } from 'typeorm';

// Upper bound for any single monetary value (price, transaction amount).
// Deliberately far below Number.MAX_SAFE_INTEGER (2^53 - 1 ≈ 9.0e15) so that
// Postgres BIGINT values round-trip through a JS `number` without precision loss.
// 1,000,000,000 VND (~40k USD) is a generous ceiling for a commissary item/topup.
export const MAX_VND = 1_000_000_000;

// Postgres BIGINT is returned by the `pg` driver as a string to avoid silent
// precision loss in JS. This transformer maps it to a `number` on read and back
// on write. Each single transaction amount is validated 0 ≤ v ≤ MAX_VND;
// accumulated balances are only bounded by ≥ 0, but would need ~9M max-value
// topups to approach 2^53, so they stay safely inside the lossless double range.
export const numericTransformer: ValueTransformer = {
  to(value?: number | null): number | null {
    return value ?? null;
  },
  from(value?: string | null): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
  },
};
