/**
 * Accessibility tests for LanguageToggle.
 *
 * Key invariants:
 * - The toggle is a labelled group (4.1.2 Name, Role, Value).
 * - Each option exposes its selected state via aria-pressed.
 */
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { LanguageToggle } from './language-toggle';

describe('LanguageToggle — a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(<LanguageToggle />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('exposes a group with an accessible name', () => {
    const { getByRole } = render(<LanguageToggle />);
    expect(getByRole('group')).toHaveAccessibleName();
  });

  it('each option exposes a pressed state', () => {
    const { getAllByRole } = render(<LanguageToggle />);
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      expect(btn).toHaveAttribute('aria-pressed');
    }
  });
});
