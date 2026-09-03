import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseLimitConfiguration } from '@/lib/types';
import { PurchaseLimitsCard } from './purchase-limits-card';

const configuration: PurchaseLimitConfiguration = {
  prisoner: { food: { enabled: true, amount: 100_000 }, essential: { enabled: false, amount: null } },
  visitor: { food: { enabled: true, amount: 500_000 }, essential: { enabled: false, amount: null } },
};

vi.mock('@/lib/api', () => ({ purchaseLimits: {
  getPurchaseLimits: vi.fn(),
  updatePurchaseLimits: vi.fn(),
} }));
vi.mock('@/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui')>()),
  useToast: () => ({ toast: vi.fn() }),
}));

import { purchaseLimits } from '@/lib/api';

describe('PurchaseLimitsCard', () => {
  beforeEach(() => {
    vi.mocked(purchaseLimits.getPurchaseLimits).mockResolvedValue(configuration);
    vi.mocked(purchaseLimits.updatePurchaseLimits).mockResolvedValue(configuration);
  });

  it('renders four independently named rules and saves one atomic matrix', async () => {
    render(<PurchaseLimitsCard />);
    expect(await screen.findAllByRole('checkbox')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: /lưu giới hạn/i }));
    expect(purchaseLimits.updatePurchaseLimits).toHaveBeenCalledTimes(1);
    expect(purchaseLimits.updatePurchaseLimits).toHaveBeenCalledWith(configuration);
  });

  it('retains edited values after a failed save and rejects amounts above MAX_VND', async () => {
    vi.mocked(purchaseLimits.updatePurchaseLimits).mockRejectedValueOnce(new Error('offline'));
    render(<PurchaseLimitsCard />);
    const prisonerFood = (await screen.findAllByLabelText(/giới hạn đồ ăn/i))[0];
    await userEvent.clear(prisonerFood);
    await userEvent.type(prisonerFood, '120000');
    await userEvent.click(screen.getByRole('button', { name: /lưu giới hạn/i }));
    expect(prisonerFood).toHaveValue(120000);

    await userEvent.clear(prisonerFood);
    await userEvent.type(prisonerFood, '1000000001');
    expect(prisonerFood).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /lưu giới hạn/i })).toBeDisabled();
  });
});
