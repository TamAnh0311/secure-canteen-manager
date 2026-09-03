import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { BankQrScreen } from './bank-qr-screen';
import type { KioskBankTransfer } from '@/lib/api/kiosk';

const TRANSFER: KioskBankTransfer = {
  qrPayload: '00020101021238...6304ABCD',
  accountName: 'CANG TIN TRAI GIAM',
  accountNumber: '0123456789',
  amount: 50_000,
  memo: 'AABBCCDD NGUYEN VAN A',
};

function renderScreen(opts: { onReset?: () => void } = {}) {
  const onReset = opts.onReset ?? vi.fn();
  render(
    <BankQrScreen transfer={TRANSFER} confirmationCode="AABBCCDD" onReset={onReset} />,
  );
  return { onReset };
}

describe('BankQrScreen — offline VietQR transfer', () => {
  it('renders the QR as a pure-SVG (no image fetch / no CDN)', () => {
    renderScreen();
    const box = screen.getByTestId('bank-qr');
    // react-qr-code emits an <svg>; assert it is rendered and there is no <img>.
    expect(box.querySelector('svg')).toBeInTheDocument();
    expect(box.querySelector('img')).not.toBeInTheDocument();
  });

  it('shows the account name, number and memo to copy', () => {
    renderScreen();
    expect(screen.getByText(TRANSFER.accountName)).toBeInTheDocument();
    expect(screen.getByText(TRANSFER.accountNumber)).toBeInTheDocument();
    expect(screen.getByText(TRANSFER.memo)).toBeInTheDocument();
  });

  it('binds the displayed amount to bankTransfer.amount (formatted, not undefined)', () => {
    renderScreen();
    // 50_000 → "50.000" in vi-VN; never the literal "undefined".
    expect(screen.getByTestId('bank-amount').textContent).toMatch(/50\.000/);
    expect(screen.getByTestId('bank-amount').textContent).not.toMatch(/undefined/);
  });

  it('shows the confirmation code and the transfer instruction copy', () => {
    renderScreen();
    expect(screen.getByTestId('confirmation-code').textContent).toBe('AABBCCDD');
    // Instruction tells the visitor to transfer then see the cashier.
    expect(screen.getByText(/thu ngân/i)).toBeInTheDocument();
  });

  it('start-over button fires onReset', async () => {
    const { onReset } = renderScreen();
    await userEvent.click(screen.getByRole('button', { name: /đặt món mới/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
