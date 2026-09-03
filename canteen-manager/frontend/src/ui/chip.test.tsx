import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ConfidenceChip, StatusChip } from './chip';

// ConfidenceChip bands:
//   >= 95  → success (bg-success-bg text-success-fg)
//   >= 80  → warning
//   <  80  → danger

describe('ConfidenceChip', () => {
  describe('percentage display', () => {
    it('shows rounded percent when given a 0..1 fraction', () => {
      render(<ConfidenceChip value={0.876} />);
      expect(screen.getByText('88%')).toBeInTheDocument();
    });

    it('shows percent as-is when value > 1 (already-percent input)', () => {
      render(<ConfidenceChip value={92.4} />);
      expect(screen.getByText('92%')).toBeInTheDocument();
    });

    it('rounds 0.995 to 100%', () => {
      render(<ConfidenceChip value={0.995} />);
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('rounds 0.004 to 0%', () => {
      render(<ConfidenceChip value={0.004} />);
      expect(screen.getByText('0%')).toBeInTheDocument();
    });
  });

  describe('confident band (>= 95%) → success classes', () => {
    it('applies success classes at exactly 0.95', () => {
      const { container } = render(<ConfidenceChip value={0.95} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-success-bg');
      expect(chip.className).toContain('text-success-fg');
    });

    it('applies success classes at 1.0 (100%)', () => {
      const { container } = render(<ConfidenceChip value={1.0} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-success-bg');
    });

    it('applies success classes at 0.97', () => {
      const { container } = render(<ConfidenceChip value={0.97} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-success-bg');
    });
  });

  describe('flag band (>= 80% and < 95%) → warning classes', () => {
    it('applies warning classes at exactly 0.80', () => {
      const { container } = render(<ConfidenceChip value={0.80} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-warning-bg');
      expect(chip.className).toContain('text-warning-fg');
    });

    it('applies warning classes at 0.94 (just below confident threshold)', () => {
      const { container } = render(<ConfidenceChip value={0.94} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-warning-bg');
    });

    it('applies warning classes at 0.85', () => {
      const { container } = render(<ConfidenceChip value={0.85} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-warning-bg');
    });
  });

  describe('low-confidence band (< 80%) → danger classes', () => {
    it('applies danger classes at 0.79 (just below warning threshold)', () => {
      const { container } = render(<ConfidenceChip value={0.79} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-danger-bg');
      expect(chip.className).toContain('text-danger-fg');
    });

    it('applies danger classes at 0.0', () => {
      const { container } = render(<ConfidenceChip value={0} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-danger-bg');
    });

    it('applies danger classes at 0.50', () => {
      const { container } = render(<ConfidenceChip value={0.5} />);
      const chip = container.firstChild as HTMLElement;
      expect(chip.className).toContain('bg-danger-bg');
    });
  });
});

describe('StatusChip', () => {
  it('renders label text', () => {
    render(<StatusChip tone="success" label="Verified" />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('renders dot element when dot=true', () => {
    const { container } = render(<StatusChip tone="warning" label="Flagged" dot />);
    // The dot is an aria-hidden span
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });

  it('does not render dot when dot=false (default)', () => {
    const { container } = render(<StatusChip tone="info" label="Pending" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it('applies tone classes for danger', () => {
    const { container } = render(<StatusChip tone="danger" label="Rejected" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain('bg-danger-bg');
    expect(chip.className).toContain('text-danger-fg');
  });
});
