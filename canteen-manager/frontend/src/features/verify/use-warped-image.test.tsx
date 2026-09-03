import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImageObjectUrl } from '@/lib/api-client';
import type { QueueSheetItem } from '@/lib/types';
import { useWarpedImage } from './use-warped-image';

vi.mock('@/lib/api-client', () => ({ fetchImageObjectUrl: vi.fn() }));

const fetchImageObjectUrlMock = vi.mocked(fetchImageObjectUrl);

function scannerSheet(mediaType: string): QueueSheetItem {
  return {
    id: `sheet-${mediaType}`,
    warpedImageUrl: null,
    scannerEvidence: {
      artifacts: [{
        artifactId: 'source-1',
        kind: 'source',
        mediaType,
        fieldId: null,
        rowIndex: null,
        state: 'available',
        url: '/scans/verify/sheet-1/artifacts/source-1',
      }],
    },
  } as QueueSheetItem;
}

describe('useWarpedImage scanner source policy', () => {
  beforeEach(() => {
    fetchImageObjectUrlMock.mockReset();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('loads an allowlisted raster source as the main scanner image', async () => {
    fetchImageObjectUrlMock.mockResolvedValue('blob:source-image');
    const sheet = scannerSheet('image/png');
    const { result } = renderHook(() => useWarpedImage(sheet, null));

    await waitFor(() => expect(result.current.imageUrl).toBe('blob:source-image'));
    expect(result.current.mediaType).toBe('image/png');
    expect(fetchImageObjectUrlMock).toHaveBeenCalledWith('/scans/verify/sheet-1/artifacts/source-1');
  });

  it('loads an allowlisted PDF source as the main scanner document', async () => {
    fetchImageObjectUrlMock.mockResolvedValue('blob:source-pdf');
    const sheet = scannerSheet('application/pdf');
    const { result } = renderHook(() => useWarpedImage(sheet, null));

    await waitFor(() => expect(result.current.imageUrl).toBe('blob:source-pdf'));
    expect(result.current.mediaType).toBe('application/pdf');
    expect(fetchImageObjectUrlMock).toHaveBeenCalledWith('/scans/verify/sheet-1/artifacts/source-1');
  });

  it.each(['text/html', 'image/svg+xml'])(
    'does not send source media type %s to the image viewer',
    (mediaType) => {
      const sheet = scannerSheet(mediaType);
      const { result } = renderHook(() => useWarpedImage(sheet, null));

      expect(result.current.imageUrl).toBeNull();
      expect(result.current.mediaType).toBeNull();
      expect(result.current.imageLoading).toBe(false);
      expect(fetchImageObjectUrlMock).not.toHaveBeenCalled();
    },
  );
});
