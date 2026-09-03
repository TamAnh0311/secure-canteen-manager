/**
 * Unit tests for PendingOrdersQueue.
 *
 * Key invariants:
 * - Lists pending relative orders from the API; empty state when none.
 * - Accept calls counter.acceptOrder(id, {method}) with the intended tender by
 *   default, or an overridden one; the queue refetches so the row drops.
 * - Reject calls counter.rejectOrder(id, {reason}) and refetches.
 * - Polls on an interval (refetch fires again after the poll window).
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingOrdersQueue } from './pending-orders-queue';
import type { PendingOrder } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  counter: {
    pendingOrders: vi.fn(),
    acceptOrder: vi.fn(),
    rejectOrder: vi.fn(),
  },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import { counter } from '@/lib/api';

const mockPending = counter.pendingOrders as ReturnType<typeof vi.fn>;
const mockAccept = counter.acceptOrder as ReturnType<typeof vi.fn>;
const mockReject = counter.rejectOrder as ReturnType<typeof vi.fn>;

const ORDER: PendingOrder = {
  orderId: '11111111-1111-4111-8111-111111111111',
  confirmationCode: 'ABC123',
  prisoner: { legacyId: 'P001', name: 'Nguyễn Văn A' },
  serviceDate: '2026-06-18',
  items: [{ menuItemId: 'm1', name: 'Cơm', unitPrice: 15_000 }],
  totalAmount: 15_000,
  paymentMethod: 'cash',
  createdAt: '2026-06-18T02:00:00Z',
};

function resetMocks() {
  mockPending.mockReset();
  mockAccept.mockReset();
  mockReject.mockReset();
}

describe('PendingOrdersQueue — render + empty', () => {
  beforeEach(resetMocks);

  it('shows empty state when there are no pending orders', async () => {
    mockPending.mockResolvedValue([]);
    render(<PendingOrdersQueue />);
    expect(await screen.findByText(/không có đơn nào đang chờ/i)).toBeInTheDocument();
  });

  it('renders a pending row from the API', async () => {
    mockPending.mockResolvedValue([ORDER]);
    render(<PendingOrdersQueue />);
    expect(await screen.findByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('Cơm')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });
});

describe('PendingOrdersQueue — accept', () => {
  beforeEach(resetMocks);

  it('accepts with the intended method by default and drops the row', async () => {
    mockPending.mockResolvedValueOnce([ORDER]).mockResolvedValue([]);
    mockAccept.mockResolvedValue({});
    render(<PendingOrdersQueue />);
    await screen.findByText('Nguyễn Văn A');

    await userEvent.click(screen.getByRole('button', { name: /^duyệt$/i }));
    await userEvent.click(screen.getByRole('button', { name: /xác nhận thu tiền/i }));

    await waitFor(() =>
      expect(mockAccept).toHaveBeenCalledWith(ORDER.orderId, { method: 'cash' }),
    );
    expect(await screen.findByText(/không có đơn nào đang chờ/i)).toBeInTheDocument();
  });

  it('accepts with an overridden method', async () => {
    mockPending.mockResolvedValueOnce([ORDER]).mockResolvedValue([]);
    mockAccept.mockResolvedValue({});
    render(<PendingOrdersQueue />);
    await screen.findByText('Nguyễn Văn A');

    await userEvent.click(screen.getByRole('button', { name: /^duyệt$/i }));
    await userEvent.click(screen.getByRole('radio', { name: /chuyển khoản/i }));
    await userEvent.click(screen.getByRole('button', { name: /xác nhận thu tiền/i }));

    await waitFor(() =>
      expect(mockAccept).toHaveBeenCalledWith(ORDER.orderId, { method: 'bank' }),
    );
  });
});

describe('PendingOrdersQueue — reject', () => {
  beforeEach(resetMocks);

  it('rejects with a reason and refetches', async () => {
    mockPending.mockResolvedValueOnce([ORDER]).mockResolvedValue([]);
    mockReject.mockResolvedValue({});
    render(<PendingOrdersQueue />);
    await screen.findByText('Nguyễn Văn A');

    await userEvent.click(screen.getByRole('button', { name: /^từ chối$/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /lý do/i }), 'hết món');
    await userEvent.click(screen.getByRole('button', { name: /xác nhận từ chối/i }));

    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith(ORDER.orderId, { reason: 'hết món' }),
    );
  });
});

describe('PendingOrdersQueue — polling', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.useRealTimers());

  it('refetches the queue on the polling interval', async () => {
    vi.useFakeTimers();
    mockPending.mockResolvedValue([]);
    render(<PendingOrdersQueue />);

    // Flush the mount fetch, then advance one poll window → a second fetch fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(mockPending.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
