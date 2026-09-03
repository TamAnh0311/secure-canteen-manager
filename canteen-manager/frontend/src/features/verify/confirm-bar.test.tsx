import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmBar } from './confirm-bar';

// ConfirmBar uses aria-disabled (not native disabled) on the Confirm button
// when hard-blocked. This lets the operator still click and receive a toast
// from the parent hook, rather than silently eating the press. The invariant
// we test: aria-disabled is present ↔ a hard block is active.

type Phase3ConfirmBarProps = Omit<Parameters<typeof ConfirmBar>[0], 'blockedNoUser'> & {
  identityReady: boolean;
};

function renderBar(overrides: Partial<Phase3ConfirmBarProps> = {}) {
  const defaults: Phase3ConfirmBarProps = {
    unresolved: 0,
    identityReady: true,
    blockedNoSelection: false,
    blockedUnresolvedLine: false,
    balance: null,
    orderTotal: 0,
    insufficientFunds: false,
    saving: false,
    onConfirm: vi.fn(),
    onReject: vi.fn(),
    onSkip: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return render(<ConfirmBar {...(props as unknown as Parameters<typeof ConfirmBar>[0])} />);
}

describe('confirm readiness uses server-locked issued identity', () => {
  it('marks Confirm unavailable when the rollout mode disables confirmation', () => {
    renderBar({ confirmationEnabled: false });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Chế độ triển khai hiện tại đang tắt xác nhận')).toBeInTheDocument();
  });

  it('marks Confirm unavailable when the queue has no locked issued identity', () => {
    renderBar({ identityReady: false });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Confirm button has aria-disabled when blockedNoSelection=true', () => {
    renderBar({ blockedNoSelection: true });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Confirm button has aria-disabled when identity and selection are both unavailable', () => {
    renderBar({ identityReady: false, blockedNoSelection: true });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Confirm button does NOT have aria-disabled when no hard block', () => {
    renderBar({ identityReady: true, blockedNoSelection: false, unresolved: 0 });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    // aria-disabled absent or false when fully clear
    const ariaDisabled = btn.getAttribute('aria-disabled');
    expect(ariaDisabled === null || ariaDisabled === 'false').toBe(true);
  });

  it('Confirm button does NOT have aria-disabled when only soft-blocked (unresolved > 0)', () => {
    // unresolved fields are a soft block — parent hook refocuses the field
    // rather than blocking outright. aria-disabled must NOT be set here.
    renderBar({ unresolved: 2, identityReady: true, blockedNoSelection: false });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    const ariaDisabled = btn.getAttribute('aria-disabled');
    expect(ariaDisabled === null || ariaDisabled === 'false').toBe(true);
  });
});

describe('confirm-bar status text', () => {
  it('announces that generic identity requires explicit selection', () => {
    renderBar({ identityReady: false, identityBlockReason: 'selection_required' });
    expect(screen.getByText('Hãy chủ động chọn phạm nhân trước khi xác nhận')).toBeInTheDocument();
  });

  it('shows add-item warning when blockedNoSelection and identity is locked', () => {
    renderBar({ blockedNoSelection: true, identityReady: true });
    // VI: "Thêm ít nhất một mục hợp lệ, hoặc từ chối"
    expect(screen.getByText('Thêm ít nhất một mục hợp lệ, hoặc từ chối')).toBeInTheDocument();
  });

  it('shows low-confidence count for single unresolved field', () => {
    renderBar({ unresolved: 1 });
    // VI singular: "1 ô độ tin cậy thấp"
    expect(screen.getByText('1 ô độ tin cậy thấp')).toBeInTheDocument();
  });

  it('shows plural form for multiple unresolved fields', () => {
    renderBar({ unresolved: 3 });
    // VI plural: "3 ô độ tin cậy thấp"
    expect(screen.getByText('3 ô độ tin cậy thấp')).toBeInTheDocument();
  });

  it('shows all-resolved message when clear', () => {
    renderBar({ unresolved: 0 });
    // VI: "Tất cả ô đã giải quyết"
    expect(screen.getByText('Tất cả ô đã giải quyết')).toBeInTheDocument();
  });
});

describe('confirm-bar insufficient-funds guard', () => {
  // The commissary balance guard is a SOFT flag, not a hard block: the server is
  // the source of truth and the client balance may be stale, so the operator can
  // still press Confirm (and get a server 400 toast) rather than being trapped.
  it('shows the insufficient-balance warning when insufficientFunds=true', () => {
    renderBar({ insufficientFunds: true, balance: 5_000, orderTotal: 30_000 });
    // VI: "Số dư không đủ"
    expect(screen.getByText('Số dư không đủ')).toBeInTheDocument();
  });

  it('does NOT set aria-disabled on Confirm for insufficient funds (soft flag)', () => {
    renderBar({ insufficientFunds: true, balance: 5_000, orderTotal: 30_000 });
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    const ariaDisabled = btn.getAttribute('aria-disabled');
    expect(ariaDisabled === null || ariaDisabled === 'false').toBe(true);
  });

  it('renders the balance + order money line when a balance is known', () => {
    renderBar({ balance: 50_000, orderTotal: 30_000 });
    expect(screen.getByTestId('confirm-money-line')).toBeInTheDocument();
  });

  it('omits the money line when balance is unknown (operator-assigned user)', () => {
    renderBar({ balance: null, orderTotal: 30_000 });
    expect(screen.queryByTestId('confirm-money-line')).not.toBeInTheDocument();
  });
});

describe('confirm-bar button states', () => {
  it('Skip and Reject are disabled while saving', () => {
    renderBar({ saving: true });
    expect(screen.getByRole('button', { name: /bỏ qua/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /từ chối/i })).toBeDisabled();
  });

  it('Skip and Reject are enabled when not saving', () => {
    renderBar({ saving: false });
    expect(screen.getByRole('button', { name: /bỏ qua/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /từ chối/i })).not.toBeDisabled();
  });

  it('onSkip fires when Skip clicked', async () => {
    const onSkip = vi.fn();
    renderBar({ onSkip });
    await userEvent.click(screen.getByRole('button', { name: /bỏ qua/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('onReject fires when Reject clicked', async () => {
    const onReject = vi.fn();
    renderBar({ onReject });
    await userEvent.click(screen.getByRole('button', { name: /từ chối/i }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('onConfirm fires when selection-blocked (parent handles toast)', async () => {
    // aria-disabled is presentational — the button is not natively disabled,
    // so the click reaches onConfirm and the hook decides what to do (show toast).
    const onConfirm = vi.fn();
    renderBar({ blockedNoSelection: true, onConfirm });
    await userEvent.click(screen.getByRole('button', { name: /xác nhận/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
