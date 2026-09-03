/**
 * WCAG 2.1 AA accessibility tests for TopupForm.
 *
 * Key invariants:
 * - Form has no axe violations in idle state.
 * - Validation error state has no axe violations.
 * - All form controls have accessible labels.
 * - Error messages are associated with their inputs via aria-describedby
 *   or rendered adjacent to the field (Field component pattern).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { TopupForm } from './topup-form';

vi.mock('@/lib/api', () => ({
  counter: { createTopup: vi.fn(() => new Promise(() => {})) },
  menu: { listMenu: vi.fn(() => Promise.resolve([])) },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

function renderForm() {
  return render(
    <TopupForm prisonId="P001" disabled={false} onSuccess={vi.fn()} />,
  );
}

describe('TopupForm — axe no-violations', () => {
  it('idle state has no axe violations', async () => {
    const { container } = renderForm();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('validation-error state has no axe violations', async () => {
    const { container } = renderForm();
    // Trigger validation by submitting empty form.
    await userEvent.click(screen.getByRole('button', { name: /nạp tiền/i }));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled state has no axe violations', async () => {
    const { container } = render(
      <TopupForm prisonId="P001" disabled={true} onSuccess={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('TopupForm — accessible form controls', () => {
  it('amount field has an accessible label', () => {
    renderForm();
    // Field component renders a <label> with htmlFor matching the input id.
    expect(screen.getByLabelText(/số tiền/i)).toBeInTheDocument();
  });

  it('submit button has an accessible name', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /nạp tiền/i })).toBeInTheDocument();
  });

  it('method radio group contains cash and bank options', () => {
    renderForm();
    expect(screen.getByRole('radio', { name: /tiền mặt/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /chuyển khoản/i })).toBeInTheDocument();
  });
});
