import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import i18n from '@/i18n';
import { ScanUploadPage } from './scan-upload-page';

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

function renderPage() {
  const router = createMemoryRouter([
    { path: '/', element: <ScanUploadPage /> },
    { path: '/scan-monitor', element: <div>Scan Monitor</div> },
  ]);
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('ScanUploadPage accessibility', () => {
  it('has no axe violations and exposes a labelled multiple JPG/PNG picker', async () => {
    const { container } = renderPage();
    const input = screen.getByLabelText(/scanned form images/i);

    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    expect(input.getAttribute('accept')?.split(',')).toEqual(
      expect.arrayContaining(['.jpg', '.jpeg', '.png']),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a non-color waiting label and a restrained polite live status', async () => {
    const { container } = renderPage();
    await userEvent.upload(
      screen.getByLabelText(/scanned form images/i),
      new File([JPEG_MAGIC], 'accessible.jpg', { type: 'image/jpeg' }),
    );

    const row = screen.getByText('accessible.jpg').closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/waiting/i)).toBeInTheDocument();

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('gives per-file actions accessible names and restores picker focus after remove', async () => {
    renderPage();
    const input = screen.getByLabelText(/scanned form images/i);
    const picker = screen.getByRole('button', { name: /choose or drop scanned forms/i });
    await userEvent.upload(
      input,
      new File([JPEG_MAGIC], 'remove-me.jpg', { type: 'image/jpeg' }),
    );

    const remove = screen.getByRole('button', { name: /remove remove-me\.jpg/i });
    await userEvent.click(remove);

    expect(screen.queryByText('remove-me.jpg')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(picker).toHaveFocus());
  });
});
