import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import type { ExistingOrderSummary } from '@/lib/types';
import { LockedIdentityBanner } from './locked-identity-banner';

const identity = {
  id: 'user-1',
  legacyId: 'P-004218',
  name: 'Nguyễn Văn An',
  zone: 'Khu A',
  cell: 'Buồng 12',
};

const form = {
  serial: 'A1B2C3D4',
  revision: 'v3',
  serviceDate: '2026-07-15',
};

function renderBanner(existingOrder: ExistingOrderSummary | null = null) {
  return render(
    <LockedIdentityBanner
      identity={identity}
      balance={125_000}
      form={form}
      existingOrder={existingOrder}
    />,
  );
}

describe('LockedIdentityBanner', () => {
  it('shows the four human-checkable identity fields plus form revision and serial', () => {
    renderBanner();

    expect(screen.getByText(identity.name)).toBeInTheDocument();
    expect(screen.getByText(identity.legacyId)).toBeInTheDocument();
    expect(screen.getByText(identity.zone)).toBeInTheDocument();
    expect(screen.getByText(identity.cell)).toBeInTheDocument();
    expect(screen.getByText(form.revision)).toBeInTheDocument();
    expect(screen.getByText(form.serial)).toBeInTheDocument();
    expect(screen.getByText(/125[.,\s]?000/)).toBeInTheDocument();
  });

  it('is a labelled, non-interactive identity region with no edit/search/change path', () => {
    const { container } = renderBanner();

    expect(screen.getByRole('region')).toHaveAccessibleName();
    expect(container.querySelector('button')).not.toBeInTheDocument();
    expect(container.querySelector('input')).not.toBeInTheDocument();
    expect(container.querySelector('select')).not.toBeInTheDocument();
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  it('keeps the existing-order warning visible beside the locked identity', () => {
    const { container } = renderBanner({
      items: [{ menuItemId: 'menu-1', name: 'Phở', quantity: 2, unitPrice: 30_000 }],
      total: 60_000,
    });

    expect(container).toHaveTextContent('Phở');
    expect(container).toHaveTextContent(/60[.,\s]?000/);
  });

  it('has no axe accessibility violations', async () => {
    const { container } = renderBanner();

    expect(await axe(container)).toHaveNoViolations();
  });
});
