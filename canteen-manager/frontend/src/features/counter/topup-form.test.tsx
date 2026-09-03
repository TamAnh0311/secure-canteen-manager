/**
 * Unit tests for TopupForm.
 *
 * Key invariants:
 * - Amount validation rejects 0, negative, non-integer, and >1_000_000_000.
 * - Valid submission calls counter.createTopup with the right payload.
 * - onSuccess fires after a successful API call.
 * - API errors surface via an error banner (not a thrown exception).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopupForm } from './topup-form';

// Mock the counter API module so tests run without a network.
vi.mock('@/lib/api', () => ({
  counter: {
    createTopup: vi.fn(),
  },
  menu: { listMenu: vi.fn(() => Promise.resolve([])) },
}));

// Mock useToast so toast calls don't require a ToastProvider.
vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return {
    ...actual,
    useToast: () => ({ toast: vi.fn() }),
  };
});

import { counter } from '@/lib/api';

const mockCreateTopup = counter.createTopup as ReturnType<typeof vi.fn>;

function renderForm(overrides: Partial<Parameters<typeof TopupForm>[0]> = {}) {
  const defaults = {
    prisonId: 'P001',
    disabled: false,
    onSuccess: vi.fn(),
  };
  return { onSuccess: defaults.onSuccess, ...render(<TopupForm {...defaults} {...overrides} />) };
}

async function fillAmount(amount: string) {
  const input = screen.getByRole('spinbutton');
  await userEvent.clear(input);
  await userEvent.type(input, amount);
}

async function submit() {
  await userEvent.click(screen.getByRole('button', { name: /nạp tiền/i }));
}

describe('TopupForm — amount validation', () => {
  beforeEach(() => {
    mockCreateTopup.mockReset();
  });

  it('rejects empty amount', async () => {
    renderForm();
    await submit();
    // Validation message appears; API not called.
    expect(await screen.findByText(/vui lòng nhập số tiền/i)).toBeInTheDocument();
    expect(mockCreateTopup).not.toHaveBeenCalled();
  });

  it('rejects amount of 0', async () => {
    renderForm();
    await fillAmount('0');
    await submit();
    expect(await screen.findByText(/phải lớn hơn 0/i)).toBeInTheDocument();
    expect(mockCreateTopup).not.toHaveBeenCalled();
  });

  it('rejects amount greater than 1_000_000_000', async () => {
    renderForm();
    await fillAmount('1000000001');
    await submit();
    expect(await screen.findByText(/không được vượt quá/i)).toBeInTheDocument();
    expect(mockCreateTopup).not.toHaveBeenCalled();
  });

  it('accepts the maximum boundary value 1_000_000_000', async () => {
    mockCreateTopup.mockResolvedValue({ userId: 'u1', balance: 1_000_000_000 });
    renderForm();
    await fillAmount('1000000000');
    await submit();
    await waitFor(() => expect(mockCreateTopup).toHaveBeenCalledOnce());
    expect(mockCreateTopup).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_000_000_000 }),
    );
  });
});

describe('TopupForm — valid submission', () => {
  beforeEach(() => {
    mockCreateTopup.mockReset();
  });

  it('calls createTopup with prisonId, amount, and method', async () => {
    mockCreateTopup.mockResolvedValue({ userId: 'u1', balance: 500_000 });
    const { onSuccess } = renderForm();

    await fillAmount('100000');
    // Default method is cash — no need to click radio.
    await submit();

    await waitFor(() => expect(mockCreateTopup).toHaveBeenCalledOnce());
    expect(mockCreateTopup).toHaveBeenCalledWith({
      prisonId: 'P001',
      amount: 100_000,
      method: 'cash',
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('includes ref when filled', async () => {
    mockCreateTopup.mockResolvedValue({ userId: 'u1', balance: 200_000 });
    renderForm();

    await fillAmount('50000');
    const refInput = screen.getByPlaceholderText(/mã giao dịch/i);
    await userEvent.type(refInput, 'TXN-123');
    await submit();

    await waitFor(() => expect(mockCreateTopup).toHaveBeenCalledOnce());
    expect(mockCreateTopup).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'TXN-123' }),
    );
  });

  it('omits ref when blank', async () => {
    mockCreateTopup.mockResolvedValue({ userId: 'u1', balance: 200_000 });
    renderForm();
    await fillAmount('50000');
    await submit();

    await waitFor(() => expect(mockCreateTopup).toHaveBeenCalledOnce());
    const call = mockCreateTopup.mock.calls[0][0] as Record<string, unknown>;
    expect(call.ref).toBeUndefined();
  });

  it('calls onSuccess after successful topup', async () => {
    mockCreateTopup.mockResolvedValue({ userId: 'u1', balance: 300_000 });
    const { onSuccess } = renderForm();
    await fillAmount('100000');
    await submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });
});

describe('TopupForm — API error handling', () => {
  beforeEach(() => {
    mockCreateTopup.mockReset();
  });

  it('shows banner on API error and does not call onSuccess', async () => {
    mockCreateTopup.mockRejectedValue(Object.assign(new Error('Prisoner inactive'), { body: { code: 'USER.INACTIVE', message: 'Prisoner inactive' } }));
    const { onSuccess } = renderForm();
    await fillAmount('10000');
    await submit();

    // Error banner must appear (translated or fallback text).
    await waitFor(() => {
      const banners = document.querySelectorAll('[class*="danger"]');
      expect(banners.length).toBeGreaterThan(0);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
