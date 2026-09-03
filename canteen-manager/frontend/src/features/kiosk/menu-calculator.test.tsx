import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MenuCalculator } from './menu-calculator';
import { kiosk } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import type { KioskMenuItem, PurchaseLimits } from '@/lib/types';
import type { KioskOrderResult } from '@/lib/api/kiosk';

// Only placeOrder is exercised here; mock the namespace so no real fetch fires.
vi.mock('@/lib/api', () => ({
  kiosk: { placeOrder: vi.fn() },
}));

const placeOrder = vi.mocked(kiosk.placeOrder);

const MENU: KioskMenuItem[] = [
  { id: 'i1', name: 'Cơm', price: 15_000, category: 'food' },
  { id: 'i2', name: 'Canh', price: 8_000, category: 'food' },
  { id: 'i3', name: 'Rau', price: 5_000, category: 'essential' },
];

function renderCalc(opts: {
  menu?: KioskMenuItem[];
  bankEnabled?: boolean;
  onReset?: () => void;
  onPlaced?: (result: KioskOrderResult) => void;
  purchaseLimits?: PurchaseLimits;
  onRefreshLimits?: () => Promise<void>;
} = {}) {
  const onReset = opts.onReset ?? vi.fn();
  const onPlaced = opts.onPlaced ?? vi.fn();
  render(
    <MenuCalculator
      prisonId="P1"
      menu={opts.menu ?? MENU}
      bankEnabled={opts.bankEnabled ?? true}
      purchaseLimits={opts.purchaseLimits}
      onRefreshLimits={opts.onRefreshLimits}
      onReset={onReset}
      onPlaced={onPlaced}
    />,
  );
  return { onReset, onPlaced };
}

// Bump an item's quantity by clicking its + stepper `times` times.
async function increaseItem(name: string, times = 1) {
  const plus = await screen.findByRole('button', { name: new RegExp(`tăng số lượng ${name}`, 'i') });
  for (let i = 0; i < times; i++) await userEvent.click(plus);
}

beforeEach(() => {
  placeOrder.mockReset();
  placeOrder.mockResolvedValue({ orderId: 'order-uuid', confirmationCode: 'ABC123' });
});

describe('MenuCalculator — global-menu order builder', () => {
  it('hides tender + submit until an item is ordered', async () => {
    renderCalc();
    expect(screen.queryByTestId('subtotal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đặt món/i })).not.toBeInTheDocument();

    await increaseItem('Cơm');

    expect(screen.getByTestId('subtotal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đặt món/i })).toBeInTheDocument();
  });

  it('subtotal sums unit_price × quantity across lines', async () => {
    renderCalc();
    await increaseItem('Cơm', 2); // 15_000 × 2 = 30_000
    await increaseItem('Rau');    // 5_000 → total 35_000
    expect(screen.getByTestId('subtotal').textContent).toMatch(/35\.000/);
  });

  it('disables submit until a payment method is chosen', async () => {
    renderCalc();
    await increaseItem('Cơm');

    const submit = screen.getByRole('button', { name: /đặt món/i });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /tiền mặt/i }));
    expect(submit).toBeEnabled();
  });

  it('hard-blocks a strict category limit exceedance before the API call', async () => {
    renderCalc({ purchaseLimits: {
      food: { enabled: true, amount: 10_000 },
      essential: { enabled: false, amount: null },
    } });
    await increaseItem('Cơm');
    await userEvent.click(screen.getByRole('radio', { name: /tiền mặt/i }));
    const submit = screen.getByRole('button', { name: /đặt món/i });
    expect(submit).toBeDisabled();
    expect(screen.getAllByText(/vượt giới hạn/i)).toHaveLength(2);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  // The order body carries the picked items[] with quantity and NO session scope.
  it('submits items[] with per-line quantity and no session scope', async () => {
    renderCalc();
    await increaseItem('Cơm', 3);
    await userEvent.click(screen.getByRole('radio', { name: /chuyển khoản/i }));
    await userEvent.click(screen.getByRole('button', { name: /đặt món/i }));

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith({
      prisonId: 'P1',
      items: [{ menuItemId: 'i1', quantity: 3 }],
      method: 'bank',
    });
    // No session identifier rides along in the payload.
    expect(placeOrder.mock.calls[0][0]).not.toHaveProperty('sessionId');
  });

  it('fires onPlaced with the full order result on success', async () => {
    const result = { orderId: 'o', confirmationCode: 'XYZ789' };
    placeOrder.mockResolvedValue(result);
    const { onPlaced } = renderCalc();
    await increaseItem('Cơm');
    await userEvent.click(screen.getByRole('radio', { name: /tiền mặt/i }));
    await userEvent.click(screen.getByRole('button', { name: /đặt món/i }));

    expect(onPlaced).toHaveBeenCalledWith(result);
  });

  it('shows the see-cashier note on 409 and does not advance', async () => {
    placeOrder.mockRejectedValue(new ApiError(409, 'pending', { code: 'ORDER.ALREADY_PENDING' }));
    const { onPlaced } = renderCalc();
    await increaseItem('Cơm');
    await userEvent.click(screen.getByRole('radio', { name: /tiền mặt/i }));
    await userEvent.click(screen.getByRole('button', { name: /đặt món/i }));

    expect(await screen.findByText(/đến quầy thu ngân/i)).toBeInTheDocument();
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it('shows exact structured limit rejection, preserves selections, and refreshes explicitly', async () => {
    const refresh = vi.fn(async () => undefined);
    placeOrder.mockRejectedValue(new ApiError(400, 'Food subtotal 15000 exceeds the 10000 limit.', {
      code: 'ORDER.CATEGORY_LIMIT_EXCEEDED', category: 'food', actualAmount: 15000, limitAmount: 10000,
    }));
    renderCalc({ onRefreshLimits: refresh });
    await increaseItem('Cơm');
    await userEvent.click(screen.getByRole('radio', { name: /tiền mặt/i }));
    await userEvent.click(screen.getByRole('button', { name: /đặt món/i }));

    expect(await screen.findByText('Food subtotal 15000 exceeds the 10000 limit.')).toBeInTheDocument();
    expect(screen.getByTestId('subtotal').textContent).toMatch(/15\.000/);
    await userEvent.click(screen.getByRole('button', { name: /cập nhật giới hạn/i }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('MenuCalculator — bank tender gating', () => {
  it('hides the bank tender when the canteen account is not configured', async () => {
    renderCalc({ bankEnabled: false });
    await increaseItem('Cơm');
    expect(screen.getByRole('radio', { name: /tiền mặt/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /chuyển khoản/i })).not.toBeInTheDocument();
  });

  it('shows the bank tender when the canteen account is configured', async () => {
    renderCalc({ bankEnabled: true });
    await increaseItem('Cơm');
    expect(screen.getByRole('radio', { name: /chuyển khoản/i })).toBeInTheDocument();
  });
});

describe('MenuCalculator — reset', () => {
  it('start-over calls onReset', async () => {
    const { onReset } = renderCalc();
    await userEvent.click(screen.getByRole('button', { name: /bắt đầu lại/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe('MenuCalculator — empty state', () => {
  it('shows no-menu message when the menu is empty', () => {
    renderCalc({ menu: [] });
    expect(screen.getByText(/chưa có món ăn/i)).toBeInTheDocument();
  });

  it('lists every active menu item once', () => {
    renderCalc();
    const list = screen.getByRole('group', { name: /thực đơn/i });
    // One + stepper control per menu item.
    expect(within(list).getAllByRole('button', { name: /tăng số lượng/i })).toHaveLength(MENU.length);
  });
});
