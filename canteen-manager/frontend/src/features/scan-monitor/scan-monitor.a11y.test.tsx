/**
 * WCAG 2.1 AA accessibility tests for the scan-monitor aria-live status region.
 *
 * Tests import the real ScanStatusLiveRegion component so any drift in
 * production markup (e.g. changing polite→assertive) is caught immediately.
 *
 * Key invariants:
 * - The status announcement region has aria-live="polite" (not assertive —
 *   scan updates are informational, not blocking).
 * - aria-atomic="true" so AT reads the full sentence on each update, not a
 *   partial diff.
 * - The region is visually hidden (sr-only) but present in the accessibility
 *   tree (not aria-hidden).
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { ScanStatusLiveRegion } from './scan-status-live-region';

describe('ScanMonitor status region — axe no-violations', () => {
  it('empty message has no axe violations', async () => {
    const { container } = render(<ScanStatusLiveRegion message="" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('populated message has no axe violations', async () => {
    const { container } = render(
      <ScanStatusLiveRegion message="3 flagged awaiting verify, 12 auto-accepted, 1 rejected" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ScanMonitor status region — uses polite aria-live for non-interrupting updates', () => {
  // Scan updates are informational — polite means AT queues the announcement
  // until a natural pause. Assertive would interrupt the operator every 2 s poll.
  it('region has aria-live="polite"', () => {
    const { container } = render(<ScanStatusLiveRegion message="5 flagged" />);
    const region = container.querySelector('[aria-live]');
    expect(region).toBeInTheDocument();
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  it('region has aria-atomic="true" so the full message is read on update', () => {
    const { container } = render(<ScanStatusLiveRegion message="5 flagged" />);
    const region = container.querySelector('[aria-live]');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
  });

  it('region is NOT aria-hidden (must be in the accessibility tree)', () => {
    const { container } = render(<ScanStatusLiveRegion message="5 flagged" />);
    const region = container.querySelector('[aria-live]');
    expect(region?.getAttribute('aria-hidden')).not.toBe('true');
  });
});
