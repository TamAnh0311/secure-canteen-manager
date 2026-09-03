import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { LanguageToggle } from './language-toggle';

describe('LanguageToggle', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('vi');
  });

  afterEach(async () => {
    await i18n.changeLanguage('vi');
    localStorage.clear();
  });

  it('renders both language options', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'VI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
  });

  it('marks the active language as pressed', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'VI' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to English on click, persisting choice and <html lang>', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle />);

    await user.click(screen.getByRole('button', { name: 'EN' }));

    expect(i18n.language).toBe('en');
    expect(localStorage.getItem('canteen.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'VI' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reverts to Vietnamese on click', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('en');
    render(<LanguageToggle />);

    await user.click(screen.getByRole('button', { name: 'VI' }));

    expect(i18n.language).toBe('vi');
    expect(localStorage.getItem('canteen.lang')).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
  });
});
