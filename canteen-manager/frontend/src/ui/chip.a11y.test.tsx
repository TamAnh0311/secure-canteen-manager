/**
 * WCAG 2.1 AA accessibility tests for ConfidenceChip and StatusChip.
 *
 * Key invariants:
 * - State must be conveyed via text content, not color alone (1.4.1 Use of Color).
 * - Elements must have an accessible name if they carry meaning.
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { ConfidenceChip, StatusChip } from './chip';

describe('ConfidenceChip — a11y', () => {
  it('high-confidence chip (95%+) has no axe violations', async () => {
    const { container } = render(<ConfidenceChip value={0.97} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('medium-confidence chip (80–95%) has no axe violations', async () => {
    const { container } = render(<ConfidenceChip value={0.87} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('low-confidence chip (<80%) has no axe violations', async () => {
    const { container } = render(<ConfidenceChip value={0.50} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // 1.4.1 — state is conveyed via text, not color alone.
  it('conveys confidence level via visible text (not color alone)', () => {
    const { getByText } = render(<ConfidenceChip value={0.50} />);
    // The percentage text is the non-color signal; AT reads this out.
    expect(getByText('50%')).toBeInTheDocument();
  });
});

describe('StatusChip — a11y', () => {
  it('success chip has no axe violations', async () => {
    const { container } = render(<StatusChip tone="success" label="Verified" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('warning chip has no axe violations', async () => {
    const { container } = render(<StatusChip tone="warning" label="Flagged" dot />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('danger chip has no axe violations', async () => {
    const { container } = render(<StatusChip tone="danger" label="Rejected" dot />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // 1.4.1 — label text is the non-color signal for status.
  it('label text is present as accessible content (not color alone)', () => {
    const { getByText } = render(<StatusChip tone="danger" label="Rejected" />);
    expect(getByText('Rejected')).toBeInTheDocument();
  });

  // The colored dot is decorative; it must be aria-hidden so AT does not
  // announce a nameless element.
  it('dot decoration is aria-hidden so it does not confuse screen readers', () => {
    const { container } = render(<StatusChip tone="warning" label="Flagged" dot />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });
});
