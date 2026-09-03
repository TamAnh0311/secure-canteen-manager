import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PurchaseLimitSummary } from './purchase-limit-summary';

describe('PurchaseLimitSummary', () => {
  it('shows subtotal, configured limit, and remaining allowance', () => {
    render(<PurchaseLimitSummary namespace="counter" calculation={{
      food: { category: 'food', subtotal: 60_000, limit: 100_000, remaining: 40_000, exceeded: false },
      essential: { category: 'essential', subtotal: 0, limit: null, remaining: null, exceeded: false },
    }} />);
    expect(screen.getByText(/60\.000 ₫ \/ 100\.000 ₫/)).toBeInTheDocument();
    expect(screen.getByText(/còn 40\.000 ₫/i)).toBeInTheDocument();
  });
});
