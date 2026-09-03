import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PendingOrderRow, type AcceptOptions } from './pending-order-row';
import type { PendingOrder } from '@/lib/types';

type OnAccept = (id: string, opts: AcceptOptions) => void;

function makeOrder(method: 'cash' | 'bank'): PendingOrder {
  return {
    orderId: 'o1',
    confirmationCode: 'AABBCCDD',
    prisoner: { legacyId: 'P1', name: 'NGUYEN VAN A' },
    serviceDate: '2026-06-19',
    items: [{ menuItemId: 'i1', name: 'Cơm', unitPrice: 15_000 }],
    totalAmount: 15_000,
    paymentMethod: method,
    createdAt: '2026-06-19T08:00:00Z',
  };
}

function renderRow(method: 'cash' | 'bank', opts: { onAccept?: OnAccept } = {}) {
  const onAccept: OnAccept = opts.onAccept ?? vi.fn();
  const onReject = vi.fn();
  render(
    <PendingOrderRow order={makeOrder(method)} busy={false} onAccept={onAccept} onReject={onReject} />,
  );
  return { onAccept, onReject };
}

describe('PendingOrderRow — bank reconciliation', () => {
  it('shows the emphasized bank amount badge for a bank order', () => {
    renderRow('bank');
    const badge = screen.getByTestId('bank-amount-badge');
    expect(badge.textContent).toMatch(/15\.000/);
  });

  it('does NOT show the bank amount badge for a cash order', () => {
    renderRow('cash');
    expect(screen.queryByTestId('bank-amount-badge')).not.toBeInTheDocument();
  });

  it('bank Accept forwards an optional transfer reference + received amount', async () => {
    const { onAccept } = renderRow('bank');
    await userEvent.click(screen.getByRole('button', { name: /^duyệt$/i }));

    // Method defaults to the intended tender (bank) → bank extras are shown.
    await userEvent.type(screen.getByLabelText(/mã giao dịch/i), 'TXN123');
    await userEvent.type(screen.getByLabelText(/số tiền nhận được/i), '15000');
    await userEvent.click(screen.getByRole('button', { name: /xác nhận thu tiền/i }));

    expect(onAccept).toHaveBeenCalledWith('o1', {
      method: 'bank',
      transferReference: 'TXN123',
      receivedAmount: 15_000,
    });
  });

  it('cash Accept sends only the method (no bank extras)', async () => {
    const { onAccept } = renderRow('cash');
    await userEvent.click(screen.getByRole('button', { name: /^duyệt$/i }));
    // Intended tender is cash → no bank fields rendered.
    expect(screen.queryByLabelText(/mã giao dịch/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /xác nhận thu tiền/i }));

    expect(onAccept).toHaveBeenCalledWith('o1', { method: 'cash' });
  });
});
