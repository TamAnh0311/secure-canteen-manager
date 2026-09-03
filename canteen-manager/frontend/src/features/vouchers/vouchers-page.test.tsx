import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { VouchersPage } from './vouchers-page';
import type { DeliveryVoucher } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  orders: { getDeliveryVouchers: vi.fn() },
}));

import { orders } from '@/lib/api';

const mockGet = orders.getDeliveryVouchers as ReturnType<typeof vi.fn>;

// Two prisoners in the same zone but different cells — exercises the cell filter.
const VOUCHERS: DeliveryVoucher[] = [
  {
    userId: 'u1',
    name: 'Nguyen Van A',
    legacyId: 'PN001',
    zone: 'Khu 1',
    cell: 'Buong 1',
    items: [
      { name: 'Com ga', qty: 2 },
      { name: 'Bun bo', qty: 1 },
    ],
    totalAmount: 110_000,
    remainingBalance: 120_000,
    printedAt: '2026-06-20T03:30:00.000Z',
  },
  {
    userId: 'u2',
    name: 'Tran Thi B',
    legacyId: 'PN002',
    zone: 'Khu 1',
    cell: 'Buong 2',
    items: [{ name: 'Com suon', qty: 1 }],
    totalAmount: 30_000,
    remainingBalance: 5_000,
    printedAt: '2026-06-20T03:30:00.000Z',
  },
];

const printSpy = vi.fn();

function renderPage() {
  render(
    <MemoryRouter>
      <VouchersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(VOUCHERS);
  window.print = printSpy;
});

describe('VouchersPage — listing', () => {
  it('renders one sheet per voucher', async () => {
    renderPage();
    await screen.findByText('Nguyen Van A');
    expect(screen.getByText('Tran Thi B')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('fetches the vouchers for today by default', async () => {
    renderPage();
    await screen.findByText('Nguyen Van A');
    expect(mockGet).toHaveBeenCalledWith({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});

describe('VouchersPage — sheet content', () => {
  it('shows identity, items+qty, total, balance and three signature lines', async () => {
    renderPage();
    const sheet = (await screen.findByRole('article', { name: 'Nguyen Van A' })) as HTMLElement;
    const q = within(sheet);

    // Identity
    expect(q.getByText('PN001')).toBeInTheDocument();
    expect(q.getByText('Khu 1')).toBeInTheDocument();
    expect(q.getByText('Buong 1')).toBeInTheDocument();

    // Items + qty
    expect(q.getByText('Com ga')).toBeInTheDocument();
    expect(q.getByText('Bun bo')).toBeInTheDocument();

    // Money — match digit grouping (locale-separator + nbsp agnostic)
    expect(q.getByText(/110[.,]000/)).toBeInTheDocument();
    expect(q.getByText(/120[.,]000/)).toBeInTheDocument();

    // Three signature lines
    expect(q.getByText(/người nhận|receiver/i)).toBeInTheDocument();
    expect(q.getByText(/cán bộ trực|duty officer/i)).toBeInTheDocument();
    expect(q.getByText(/cán bộ giao hàng|delivery officer/i)).toBeInTheDocument();
  });

  it('renders the balance capture time from printedAt', async () => {
    renderPage();
    const sheet = (await screen.findByRole('article', { name: 'Nguyen Van A' })) as HTMLElement;
    // The remaining-balance label interpolates the captured HH:MM from printedAt.
    expect(within(sheet).getByText(/số dư còn lại|remaining balance/i)).toBeInTheDocument();
  });
});

describe('VouchersPage — zone/cell filter', () => {
  it('narrows the visible sheets when a cell is selected', async () => {
    renderPage();
    await screen.findByText('Nguyen Van A');
    expect(screen.getAllByRole('article')).toHaveLength(2);

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /buồng|cell/i }),
      'Buong 2',
    );

    expect(screen.getByText('Tran Thi B')).toBeInTheDocument();
    expect(screen.queryByText('Nguyen Van A')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});

describe('VouchersPage — print', () => {
  it('calls window.print when the print button is clicked', async () => {
    renderPage();
    await screen.findByText('Nguyen Van A');
    await userEvent.click(screen.getByRole('button', { name: /in phiếu|print vouchers/i }));
    expect(printSpy).toHaveBeenCalledOnce();
  });
});
