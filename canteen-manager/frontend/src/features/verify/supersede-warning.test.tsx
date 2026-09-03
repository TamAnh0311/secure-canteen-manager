import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SupersedeWarning } from './supersede-warning';
import type { ExistingOrderSummary } from '@/lib/types';

const existing: ExistingOrderSummary = {
  items: [
    { menuItemId: 'm-001', name: 'Phở', quantity: 2, unitPrice: 30_000 },
    { menuItemId: 'm-002', name: 'Trà', quantity: 1, unitPrice: 10_000 },
  ],
  total: 70_000,
};

// ── Rendering ────────────────────────────────────────────────────────────────

describe('SupersedeWarning — rendering', () => {
  it('renders nothing when existingOrder is null', () => {
    const { container } = render(
      <SupersedeWarning existingOrder={null} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the dialog when existingOrder is non-null', () => {
    render(
      <SupersedeWarning existingOrder={existing} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // VI key: supersedeTitle
    expect(screen.getByTestId('supersede-warning')).toBeInTheDocument();
  });

  it('shows all prior order item names', () => {
    render(
      <SupersedeWarning existingOrder={existing} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/Phở/)).toBeInTheDocument();
    expect(screen.getByText(/Trà/)).toBeInTheDocument();
  });

  it('shows the prior order total', () => {
    render(
      <SupersedeWarning existingOrder={existing} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // Total 70_000 VND — check numeric content
    const totalEl = screen.getByTestId('supersede-prior-total');
    expect(totalEl.textContent).toMatch(/70/);
  });
});

// ── Blocking confirm until acknowledged ─────────────────────────────────────

describe('SupersedeWarning — acknowledgment', () => {
  it('fires onConfirm when the replace button is clicked', async () => {
    const onConfirm = vi.fn();
    render(
      <SupersedeWarning existingOrder={existing} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    const replaceBtn = screen.getByTestId('supersede-confirm-btn');
    await userEvent.click(replaceBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('fires onCancel when the cancel button is clicked', async () => {
    const onCancel = vi.fn();
    render(
      <SupersedeWarning existingOrder={existing} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    const cancelBtn = screen.getByTestId('supersede-cancel-btn');
    await userEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
