/**
 * WCAG 2.1 AA accessibility tests for PrisonIdKeypad.
 *
 * Key invariants:
 * - No axe violations on the rendered keypad.
 * - Digit buttons carry non-empty aria-labels so AT announces each key.
 * - Action buttons (clear, backspace, submit) each have a non-empty aria-label.
 * - All buttons are in the natural tab order.
 * - The value display region has aria-live="polite" so AT reads the typed ID.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { PrisonIdKeypad } from './prison-id-keypad';

function renderKeypad(value = '') {
  return render(
    <PrisonIdKeypad value={value} onChange={vi.fn()} onSubmit={vi.fn()} />,
  );
}

describe('PrisonIdKeypad — axe no-violations', () => {
  it('empty state has no axe violations', async () => {
    const { container } = renderKeypad('');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('with a typed value has no axe violations', async () => {
    const { container } = renderKeypad('12345');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('PrisonIdKeypad — button aria-labels', () => {
  it('every digit button has a non-empty aria-label', () => {
    renderKeypad();
    // 10 digit buttons (0–9)
    const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (const d of digits) {
      const btn = screen.getByRole('button', { name: new RegExp(`chữ số ${d}`, 'i') });
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('clear button has a non-empty aria-label', () => {
    renderKeypad();
    const btn = screen.getByRole('button', { name: /xóa toàn bộ/i });
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('backspace button has a non-empty aria-label', () => {
    renderKeypad();
    const btn = screen.getByRole('button', { name: /xóa ký tự cuối/i });
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('submit button has a non-empty aria-label', () => {
    renderKeypad();
    const btn = screen.getByRole('button', { name: /xác nhận/i });
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('PrisonIdKeypad — keyboard reachability', () => {
  it('all buttons are in the natural tab order', () => {
    renderKeypad('5');
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      const ti = btn.getAttribute('tabindex');
      // tabindex absent (default 0) or >= 0 means focusable
      expect(ti === null || Number(ti) >= 0).toBe(true);
    }
  });
});

describe('PrisonIdKeypad — live region', () => {
  it('value display has aria-live="polite"', () => {
    const { container } = renderKeypad('99');
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
  });
});
