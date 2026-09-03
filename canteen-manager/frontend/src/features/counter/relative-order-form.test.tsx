/**
 * Unit tests for RelativeOrderForm (single global menu, no session).
 *
 * Key invariants:
 * - Requires >=1 ordered portion before submit.
 * - Requires a payment method (cash or bank).
 * - Running total reflects unit_price × quantity across ordered lines.
 * - Submits items[] (per-line quantity); never balance; never a session id.
 * - Calls onSuccess after a successful API call.
 * - A counter create is PENDING (not paid): the form shows a pending-queue notice.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelativeOrderForm } from './relative-order-form';
import type { MenuItem, OrderWithItems } from '@/lib/types';
import { ApiError } from '@/lib/api-client';

const mockMenu: MenuItem[] = [
  { id: 'item-1', code: 'A01', position: 0, name: 'Cơm', price: 15_000, category: 'food', isActive: true, createdAt: '2026-06-17T00:00:00Z', updatedAt: '2026-06-17T00:00:00Z' },
  { id: 'item-2', code: 'A02', position: 1, name: 'Canh', price: 8_000, category: 'essential', isActive: true, createdAt: '2026-06-17T00:00:00Z', updatedAt: '2026-06-17T00:00:00Z' },
];

vi.mock('@/lib/api', () => ({
  counter: {
    createRelativeOrder: vi.fn(),
  },
  menu: {
    listMenu: vi.fn(() => Promise.resolve(mockMenu)),
  },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return {
    ...actual,
    useToast: () => ({ toast: vi.fn() }),
  };
});

import { counter, menu } from '@/lib/api';

const mockCreateRelativeOrder = counter.createRelativeOrder as ReturnType<typeof vi.fn>;
const mockListMenu = menu.listMenu as ReturnType<typeof vi.fn>;

function renderForm(overrides: Partial<Parameters<typeof RelativeOrderForm>[0]> = {}) {
  const defaults = {
    prisonId: 'P001',
    disabled: false,
    onSuccess: vi.fn(),
  };
  return { onSuccess: defaults.onSuccess, ...render(<RelativeOrderForm {...defaults} {...overrides} />) };
}

// Bump an item's quantity by clicking its + stepper `times` times.
async function increaseItem(name: string, times = 1) {
  const plus = await screen.findByRole('button', { name: new RegExp(`tăng số lượng ${name}`, 'i') });
  for (let i = 0; i < times; i++) await userEvent.click(plus);
}

async function decreaseItem(name: string) {
  const minus = await screen.findByRole('button', { name: new RegExp(`giảm số lượng ${name}`, 'i') });
  await userEvent.click(minus);
}

async function selectMethod(method: 'cash' | 'bank') {
  const label = method === 'cash' ? /tiền mặt/i : /chuyển khoản/i;
  const radio = screen.getByRole('radio', { name: label });
  await userEvent.click(radio);
}

async function submit() {
  await userEvent.click(screen.getByRole('button', { name: /tạo đơn hàng/i }));
}

function mockOrder(over: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: 'order-1',
    serviceDate: '2026-06-17',
    userId: 'u1',
    source: 'relative',
    sheetId: null,
    status: 'active',
    totalAmount: 15_000,
    paymentStatus: 'unpaid',
    paymentMethod: 'cash',
    supersededAt: null,
    supersededByOrderId: null,
    createdAt: '2026-06-17T00:00:00Z',
    updatedAt: '2026-06-17T00:00:00Z',
    items: [],
    ...over,
  };
}

describe('RelativeOrderForm — validation', () => {
  beforeEach(() => {
    mockCreateRelativeOrder.mockReset();
    mockListMenu.mockResolvedValue(mockMenu);
  });

  it('requires at least one ordered portion', async () => {
    renderForm();
    // The menu loads immediately; select a method but order nothing.
    await selectMethod('cash');
    await submit();
    expect(await screen.findByText(/chọn ít nhất một món/i)).toBeInTheDocument();
    expect(mockCreateRelativeOrder).not.toHaveBeenCalled();
  });

  it('requires a payment method', async () => {
    renderForm();
    await increaseItem('Cơm');
    await submit();
    expect(await screen.findByText(/chọn phương thức thanh toán/i)).toBeInTheDocument();
    expect(mockCreateRelativeOrder).not.toHaveBeenCalled();
  });
});

describe('RelativeOrderForm — running total', () => {
  beforeEach(() => {
    mockListMenu.mockResolvedValue(mockMenu);
  });

  it('shows running total once an item is ordered', async () => {
    renderForm();
    await increaseItem('Cơm'); // 15_000
    expect(await screen.findByText(/tổng cộng/i)).toBeInTheDocument();
  });

  it('accumulates total across lines and multiplies by quantity', async () => {
    renderForm();
    await increaseItem('Cơm', 2); // 15_000 × 2 = 30_000
    await increaseItem('Canh');   // 8_000 → total 38_000
    const totalEl = await screen.findByText(/tổng cộng/i);
    expect(totalEl.textContent).toMatch(/38/);
  });

  it('hard-blocks a strict visitor category exceedance before the API call', async () => {
    renderForm({ purchaseLimits: {
      food: { enabled: true, amount: 10_000 },
      essential: { enabled: false, amount: null },
    } });
    await increaseItem('Cơm');
    await selectMethod('cash');
    expect(screen.getByRole('button', { name: /tạo đơn hàng/i })).toBeDisabled();
    expect(screen.getByText(/tổng đồ ăn 15\.000.*vượt giới hạn 10\.000/i)).toBeInTheDocument();
    expect(mockCreateRelativeOrder).not.toHaveBeenCalled();
  });
});

describe('RelativeOrderForm — valid submission', () => {
  beforeEach(() => {
    mockCreateRelativeOrder.mockReset();
    mockListMenu.mockResolvedValue(mockMenu);
  });

  it('submits items[] with per-line quantity and method=cash, no session id', async () => {
    mockCreateRelativeOrder.mockResolvedValue(mockOrder());

    const { onSuccess } = renderForm();
    await increaseItem('Cơm', 2);
    await selectMethod('cash');
    await submit();

    await waitFor(() => expect(mockCreateRelativeOrder).toHaveBeenCalledOnce());
    expect(mockCreateRelativeOrder).toHaveBeenCalledWith({
      prisonId: 'P001',
      items: [{ menuItemId: 'item-1', quantity: 2 }],
      method: 'cash',
    });
    // The payload carries no session scope.
    expect(mockCreateRelativeOrder.mock.calls[0][0]).not.toHaveProperty('sessionId');
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('submits with method=bank', async () => {
    mockCreateRelativeOrder.mockResolvedValue(mockOrder({ id: 'order-2', totalAmount: 8_000, paymentMethod: 'bank' }));

    renderForm();
    await increaseItem('Canh');
    await selectMethod('bank');
    await submit();

    await waitFor(() => expect(mockCreateRelativeOrder).toHaveBeenCalledOnce());
    expect(mockCreateRelativeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'bank' }),
    );
  });

  it('decreasing a line to zero removes it from the order', async () => {
    mockCreateRelativeOrder.mockResolvedValue(mockOrder());

    renderForm();
    await increaseItem('Cơm');
    await increaseItem('Canh');
    await decreaseItem('Cơm'); // Cơm back to 0 → dropped
    await selectMethod('cash');
    await submit();

    await waitFor(() => expect(mockCreateRelativeOrder).toHaveBeenCalledOnce());
    expect(mockCreateRelativeOrder).toHaveBeenCalledWith({
      prisonId: 'P001',
      items: [{ menuItemId: 'item-2', quantity: 1 }],
      method: 'cash',
    });
  });

  it('shows a pending-queue notice after submit (order is not paid yet)', async () => {
    mockCreateRelativeOrder.mockResolvedValue(mockOrder({ id: 'order-3' }));

    renderForm();
    await increaseItem('Cơm');
    await selectMethod('cash');
    await submit();

    // The form must reflect pending/sent-to-queue, not a paid/collected state.
    expect(await screen.findByText(/hàng chờ/i)).toBeInTheDocument();
  });

  it('balance method option is NOT rendered (relative orders cannot use balance)', async () => {
    renderForm();
    await screen.findByRole('button', { name: /tăng số lượng cơm/i });
    // The balance radio must not exist anywhere in the form.
    const balanceRadio = screen.queryByRole('radio', { name: /balance|số dư/i });
    expect(balanceRadio).not.toBeInTheDocument();
  });

  it('keeps draft/tender and shows exact structured limit rejection with explicit refresh', async () => {
    const refresh = vi.fn(async () => undefined);
    mockCreateRelativeOrder.mockRejectedValue(new ApiError(400, 'Food subtotal 15000 exceeds the 10000 limit.', {
      code: 'ORDER.CATEGORY_LIMIT_EXCEEDED', category: 'food', actualAmount: 15000, limitAmount: 10000,
    }));
    renderForm({ onRefreshPolicies: refresh });
    await increaseItem('Cơm');
    await selectMethod('cash');
    await submit();

    expect(await screen.findByText('Food subtotal 15000 exceeds the 10000 limit.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /tiền mặt/i })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /cập nhật giới hạn/i }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
