/**
 * WCAG 2.1 AA accessibility tests for ConfirmBar.
 *
 * Key invariants:
 * - Status text region uses aria-live="polite" so AT announces updates without
 *   interrupting the operator mid-sentence.
 * - Buttons have accessible names (text + kbd shortcut hints are both visible).
 * - Hard-blocked Confirm carries aria-disabled rather than native disabled so
 *   click still fires and the hook can show a toast (existing behavior, not a11y
 *   violation — aria-disabled is valid and the button is still focusable/operable).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ConfirmBar } from './confirm-bar';

function renderBar(overrides: Partial<Parameters<typeof ConfirmBar>[0]> = {}) {
  const defaults = {
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
  return render(<ConfirmBar {...defaults} {...overrides} />);
}

describe('ConfirmBar — axe no-violations', () => {
  it('all-resolved state has no axe violations', async () => {
    const { container } = renderBar();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('missing-issued-identity state has no axe violations', async () => {
    const { container } = renderBar({ identityReady: false });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('unresolved-fields state has no axe violations', async () => {
    const { container } = renderBar({ unresolved: 3 });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('saving state has no axe violations', async () => {
    const { container } = renderBar({ saving: true });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ConfirmBar — aria-live region', () => {
  // The status span must be polite (not assertive) — it updates on every
  // field edit and assertive would interrupt AT mid-speech during rapid edits.
  it('status text region has aria-live="polite"', () => {
    const { container } = renderBar();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
    // The live region must contain the status message, not be empty.
    expect(live?.textContent).toBeTruthy();
  });

  it('status text is the live-region content (not color alone)', () => {
    renderBar({ unresolved: 2 });
    const live = document.querySelector('[aria-live="polite"]');
    // VI: "ô độ tin cậy thấp"
    expect(live?.textContent).toContain('độ tin cậy thấp');
  });
});

describe('ConfirmBar — button accessible names', () => {
  it('Skip button has an accessible name', () => {
    renderBar();
    // VI: "Bỏ qua"
    const btn = screen.getByRole('button', { name: /bỏ qua/i });
    expect(btn).toBeInTheDocument();
  });

  it('Reject button has an accessible name', () => {
    renderBar();
    // VI: "Từ chối"
    const btn = screen.getByRole('button', { name: /từ chối/i });
    expect(btn).toBeInTheDocument();
  });

  it('Confirm button has an accessible name', () => {
    renderBar();
    // VI: "Xác nhận & Tiếp"
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn).toBeInTheDocument();
  });
});
