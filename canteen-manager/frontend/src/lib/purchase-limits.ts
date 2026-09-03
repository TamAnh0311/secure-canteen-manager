import type { ItemCategory, PurchaseLimits } from './types';

export const ITEM_CATEGORIES = ['food', 'essential'] as const;
export const UNLIMITED_PURCHASE_LIMITS: PurchaseLimits = {
  food: { enabled: false, amount: null },
  essential: { enabled: false, amount: null },
};

export interface PurchaseLine {
  category: ItemCategory;
  price: number;
  quantity: number;
}

export interface CategoryAllowance {
  category: ItemCategory;
  subtotal: number;
  limit: number | null;
  remaining: number | null;
  exceeded: boolean;
}

export type PurchaseLimitCalculation = Record<ItemCategory, CategoryAllowance>;

export function calculatePurchaseLimits(
  lines: readonly PurchaseLine[],
  limits: PurchaseLimits,
): PurchaseLimitCalculation {
  const subtotals: Record<ItemCategory, number> = { food: 0, essential: 0 };
  for (const line of lines) subtotals[line.category] += line.price * line.quantity;

  return Object.fromEntries(ITEM_CATEGORIES.map((category) => {
    const rule = limits[category];
    const limit = rule.enabled ? rule.amount : null;
    return [category, {
      category,
      subtotal: subtotals[category],
      limit,
      remaining: limit == null ? null : Math.max(0, limit - subtotals[category]),
      exceeded: limit != null && subtotals[category] > limit,
    }];
  })) as PurchaseLimitCalculation;
}

export function hasExceededPurchaseLimit(calculation: PurchaseLimitCalculation): boolean {
  return ITEM_CATEGORIES.some((category) => calculation[category].exceeded);
}
