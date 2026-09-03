import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { SheetImageViewer } from './sheet-image-viewer';

const baseProps = {
  loading: false,
  error: false,
  roiTemplate: null,
  focused: null,
  zoom: 1,
  onRetry: () => undefined,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('SheetImageViewer media rendering', () => {
  it('renders an authenticated PDF blob in the main viewer', () => {
    render(
      <SheetImageViewer
        {...baseProps}
        imageUrl="blob:scanner-pdf"
        mediaType="application/pdf"
      />,
    );

    expect(screen.getByTitle('Original scanner PDF')).toHaveAttribute('src', 'blob:scanner-pdf');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps raster sources in the image viewer', () => {
    render(
      <SheetImageViewer
        {...baseProps}
        imageUrl="blob:scanner-png"
        mediaType="image/png"
      />,
    );

    expect(screen.getByRole('img', { name: 'Perspective-corrected scanned order sheet' }))
      .toHaveAttribute('src', 'blob:scanner-png');
    expect(screen.queryByTitle('Original scanner PDF')).not.toBeInTheDocument();
  });
});
