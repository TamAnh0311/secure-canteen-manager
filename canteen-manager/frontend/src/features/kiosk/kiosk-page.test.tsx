import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KioskPage } from './kiosk-page';
import { kiosk } from '@/lib/api';
import type { KioskMenuItem, KioskPrisonerView } from '@/lib/types';
import type { KioskBankTransfer, KioskOrderResult } from '@/lib/api/kiosk';

// Both kiosk reads/writes go through this namespace; mock it so no fetch fires.
vi.mock('@/lib/api', () => ({
  kiosk: { getPrisonerView: vi.fn(), placeOrder: vi.fn() },
}));

const getPrisonerView = vi.mocked(kiosk.getPrisonerView);
const placeOrder = vi.mocked(kiosk.placeOrder);

const MENU: KioskMenuItem[] = [{ id: 'i1', name: 'Cơm', price: 15_000, category: 'food' }];

const VIEW: KioskPrisonerView = { name: 'NGUYEN VAN A', prisonId: 'P0001', zone: 'A', cell: 'A-01', menu: MENU, bankEnabled: true, purchaseLimits: { food: { enabled: false, amount: null }, essential: { enabled: false, amount: null } } };

const TRANSFER: KioskBankTransfer = {
  qrPayload: '00020101021238...6304ABCD',
  accountName: 'CANG TIN TRAI GIAM',
  accountNumber: '0123456789',
  amount: 15_000,
  memo: 'AABBCCDD NGUYEN VAN A',
};

// Drives entry → menu → place-order with the given tender, returning once the
// resulting screen has rendered. fireEvent (not userEvent) keeps fake timers clean.
async function placeOrderAs(method: 'cash' | 'bank') {
  render(<KioskPage />);
  // Entry: tap one digit then confirm (submit enables once value is non-empty).
  fireEvent.click(screen.getByRole('button', { name: /chữ số 1/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^xác nhận$/i }));
  });
  // Menu: order one portion, pick a tender, then place.
  fireEvent.click(screen.getByRole('button', { name: /tăng số lượng cơm/i }));
  fireEvent.click(
    screen.getByRole('radio', { name: method === 'cash' ? /tiền mặt/i : /chuyển khoản/i }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /đặt món/i }));
  });
}

beforeEach(() => {
  getPrisonerView.mockReset().mockResolvedValue(VIEW);
  placeOrder.mockReset();
});

describe('KioskPage — post-order branching', () => {
  it('renders exactly the approved identity and location values after lookup', async () => {
    render(<KioskPage />);
    fireEvent.click(screen.getByRole('button', { name: /chữ số 1/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^xác nhận$/i }));
    });

    expect(screen.getByText(VIEW.name)).toBeInTheDocument();
    expect(screen.getByText(VIEW.prisonId)).toBeInTheDocument();
    expect(screen.getByText(VIEW.zone as string)).toBeInTheDocument();
    expect(screen.getByText(VIEW.cell as string)).toBeInTheDocument();
    expect(screen.queryByText(/số dư|balance/i)).not.toBeInTheDocument();
  });

  it('renders neutral placeholders for missing zone and cell', async () => {
    getPrisonerView.mockResolvedValue({ ...VIEW, zone: null, cell: null });
    render(<KioskPage />);
    fireEvent.click(screen.getByRole('button', { name: /chữ số 1/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^xác nhận$/i }));
    });

    expect(screen.getAllByText(/chưa có thông tin/i)).toHaveLength(2);
  });

  it('bank order with a transfer → renders the offline VietQR screen', async () => {
    const result: KioskOrderResult = {
      orderId: 'o',
      confirmationCode: 'AABBCCDD',
      bankTransfer: TRANSFER,
    };
    placeOrder.mockResolvedValue(result);

    await placeOrderAs('bank');

    expect(screen.getByTestId('bank-qr').querySelector('svg')).toBeInTheDocument();
    // Amount is bound to bankTransfer.amount, not undefined.
    expect(screen.getByTestId('bank-amount').textContent).toMatch(/15\.000/);
    expect(screen.getByText(TRANSFER.accountNumber)).toBeInTheDocument();
  });

  it('cash order → keeps the plain give-the-code confirmation screen', async () => {
    placeOrder.mockResolvedValue({ orderId: 'o', confirmationCode: 'AABBCCDD' });

    await placeOrderAs('cash');

    expect(screen.queryByTestId('bank-qr')).not.toBeInTheDocument();
    expect(screen.getByText(/đưa mã này cho thu ngân/i)).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-code').textContent).toBe('AABBCCDD');
  });

  it('bank order WITHOUT a transfer (unconfigured account) → graceful confirm fallback', async () => {
    // bankEnabled true at lookup but the server returns no transfer → fall through.
    placeOrder.mockResolvedValue({ orderId: 'o', confirmationCode: 'AABBCCDD' });

    await placeOrderAs('bank');

    expect(screen.queryByTestId('bank-qr')).not.toBeInTheDocument();
    expect(screen.getByText(/đưa mã này cho thu ngân/i)).toBeInTheDocument();
  });
});

describe('KioskPage — idle reset on the bank-QR screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does NOT auto-reset at 60s mid-transfer, but does after the longer window', async () => {
    placeOrder.mockResolvedValue({
      orderId: 'o',
      confirmationCode: 'AABBCCDD',
      bankTransfer: TRANSFER,
    });

    await placeOrderAs('bank');
    expect(screen.getByTestId('bank-qr')).toBeInTheDocument();

    // The standard 60s kiosk idle window would wipe a cash confirm — but here the
    // visitor is quietly transferring, so the QR must still be on screen.
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('bank-qr')).toBeInTheDocument();

    // After the extended bank window it does eventually reset to entry.
    act(() => vi.advanceTimersByTime(600_000));
    expect(screen.getByText(/chào mừng/i)).toBeInTheDocument();
    expect(screen.queryByTestId('bank-qr')).not.toBeInTheDocument();
  });
});
