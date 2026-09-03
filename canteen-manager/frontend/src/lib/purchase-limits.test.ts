import { describe, expect, it } from 'vitest';
import { calculatePurchaseLimits } from './purchase-limits';
import type { PurchaseLimits } from './types';

const limits: PurchaseLimits = {
  food: { enabled: true, amount: 100 },
  essential: { enabled: false, amount: null },
};

describe('calculatePurchaseLimits', () => {
  it('combines duplicate category lines using price times quantity', () => {
    const result = calculatePurchaseLimits([
      { category: 'food', price: 20, quantity: 2 },
      { category: 'food', price: 30, quantity: 1 },
      { category: 'essential', price: 50, quantity: 4 },
    ], limits);
    expect(result.food).toMatchObject({ subtotal: 70, remaining: 30, exceeded: false });
    expect(result.essential).toMatchObject({ subtotal: 200, remaining: null, exceeded: false });
  });

  it('allows equality and rejects only strict exceedance', () => {
    expect(calculatePurchaseLimits([{ category: 'food', price: 100, quantity: 1 }], limits).food.exceeded).toBe(false);
    expect(calculatePurchaseLimits([{ category: 'food', price: 101, quantity: 1 }], limits).food).toMatchObject({ remaining: 0, exceeded: true });
  });
});
