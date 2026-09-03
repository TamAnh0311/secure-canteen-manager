import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentConfigPage } from './payment-config-page';
import { paymentConfig } from '@/lib/api';
import type { PaymentConfigView } from '@/lib/api/payment-config';

vi.mock('@/lib/api', () => ({
  paymentConfig: { getPaymentConfig: vi.fn(), updatePaymentConfig: vi.fn() },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const getConfig = vi.mocked(paymentConfig.getPaymentConfig);
const updateConfig = vi.mocked(paymentConfig.updatePaymentConfig);

const CURRENT: PaymentConfigView = {
  bankBin: '970415',
  accountNumber: '******6789', // masked on read
  accountName: 'CANG TIN TRAI GIAM',
  isConfigured: true,
};

beforeEach(() => {
  getConfig.mockReset().mockResolvedValue(CURRENT);
  updateConfig.mockReset().mockResolvedValue(CURRENT);
});

describe('PaymentConfigPage — canteen bank account', () => {
  it('loads the current config: prefills BIN + name, never the masked number', async () => {
    render(<PaymentConfigPage />);

    const bin = (await screen.findByLabelText(/BIN/i)) as HTMLInputElement;
    expect(bin.value).toBe('970415');
    const name = screen.getByLabelText(/chủ tài khoản/i) as HTMLInputElement;
    expect(name.value).toBe('CANG TIN TRAI GIAM');
    // The full number never leaves the server — the editable field starts empty,
    // the masked current value is shown for reference only.
    const acct = screen.getByLabelText(/số tài khoản/i) as HTMLInputElement;
    expect(acct.value).toBe('');
    expect(screen.getByText(/6789/)).toBeInTheDocument();
  });

  it('Save sends the entered values to updatePaymentConfig', async () => {
    render(<PaymentConfigPage />);
    await screen.findByLabelText(/BIN/i);

    const acct = screen.getByLabelText(/số tài khoản/i);
    await userEvent.type(acct, '0123456789');
    await userEvent.click(screen.getByRole('button', { name: /lưu/i }));

    await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
    expect(updateConfig).toHaveBeenCalledWith({
      bankBin: '970415',
      accountNumber: '0123456789',
      accountName: 'CANG TIN TRAI GIAM',
    });
  });

  it('invalid BIN shows an error and blocks the save', async () => {
    render(<PaymentConfigPage />);
    const bin = await screen.findByLabelText(/BIN/i);

    await userEvent.clear(bin);
    await userEvent.type(bin, '12');
    await userEvent.type(screen.getByLabelText(/số tài khoản/i), '0123456789');
    await userEvent.click(screen.getByRole('button', { name: /lưu/i }));

    expect(await screen.findByText(/6 chữ số/i)).toBeInTheDocument();
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
