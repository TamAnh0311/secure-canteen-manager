import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImageObjectUrl } from '@/lib/api-client';
import type { QueueSheetItem } from '@/lib/types';
import { ScannerEvidencePanel } from './scanner-evidence-panel';

vi.mock('@/lib/api-client', () => ({ fetchImageObjectUrl: vi.fn() }));

const fetchImageObjectUrlMock = vi.mocked(fetchImageObjectUrl);

describe('ScannerEvidencePanel', () => {
  beforeEach(() => {
    fetchImageObjectUrlMock.mockReset();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('keeps scanner evidence details hidden by default and toggles them without hiding the heading', async () => {
    const evidence = {
      outcome: 'needs_review', resultId: 'result-toggle', documentId: 'document-toggle', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [],
      items: [{
        rowIndex: 0,
        itemRawText: 'Pho?',
        quantityRawText: '2',
        catalogueItemId: null,
        itemCandidates: [],
        quantityCandidates: [],
      }],
      artifacts: [],
    } satisfies NonNullable<QueueSheetItem['scannerEvidence']>;
    const { rerender } = render(<ScannerEvidencePanel evidence={evidence} />);

    const toggle = screen.getByRole('button', { name: /hiện bằng chứng/i });
    const details = document.getElementById('scanner-evidence-details');
    expect(details).toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Bằng chứng từ máy quét')).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Ẩn bằng chứng');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(details).not.toHaveAttribute('hidden');
    expect(screen.getByText('Pho?')).toBeVisible();

    rerender(<ScannerEvidencePanel evidence={{ ...evidence, resultId: 'result-next', documentId: 'document-next' }} />);
    const nextToggle = screen.getByRole('button', { name: /hiện bằng chứng/i });
    expect(nextToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows candidate codes and blocks on terminal evidence without exposing source URLs', () => {
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review',
      resultId: 'result-1',
      documentId: 'document-1',
      revision: 1,
      warnings: [],
      requiresIdentityReason: true,
      catalogueDrift: true,
      reviewState: 'evidence_fault',
      blockers: ['SCANNER.EVIDENCE_FAULT'],
      items: [{
        rowIndex: 0,
        itemRawText: 'Pho bo?',
        quantityRawText: '2?',
        catalogueItemId: null,
        itemCandidates: [{ catalogueItemId: '001', value: 'Pho bo', confidence: 0.61 }],
        quantityCandidates: [{ value: 2, confidence: 0.51 }],
      }],
      artifacts: [{
        artifactId: 'crop-1',
        kind: 'crop',
        mediaType: 'image/png',
        fieldId: 'items.0.item',
        rowIndex: 0,
        state: 'integrity_fault',
        url: null,
      }],
    }} />);

    expect(screen.getByText('Pho bo?')).toBeInTheDocument();
    expect(screen.getByText(/001/)).toBeInTheDocument();
    expect(screen.getByText(/Lỗi toàn vẹn/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('https://');
  });

  it('lets the operator select an item candidate and retry terminal evidence', async () => {
    const onSelect = vi.fn();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<ScannerEvidencePanel
      onSelectItemCandidate={onSelect}
      onRetryArtifact={onRetry}
      evidence={{
        outcome: 'needs_review',
        resultId: 'result-2',
        documentId: 'document-2',
        revision: 1,
        warnings: [],
        requiresIdentityReason: true,
        catalogueDrift: false,
        reviewState: 'evidence_fault',
        blockers: ['SCANNER.EVIDENCE_FAULT'],
        items: [{
          rowIndex: 0,
          itemRawText: 'Pho?',
          quantityRawText: '2',
          catalogueItemId: null,
          itemCandidates: [{ catalogueItemId: '001', value: 'Pho', confidence: 0.7 }],
          quantityCandidates: [],
        }],
        artifacts: [{
          artifactId: 'crop-2',
          kind: 'crop',
          mediaType: 'image/png',
          fieldId: 'items.0.item',
          rowIndex: 0,
          state: 'missing',
          url: null,
        }],
      }}
    />);

    await userEvent.click(screen.getByRole('button', { name: /hiện bằng chứng/i }));
    await userEvent.click(screen.getByRole('button', { name: '001' }));
    await userEvent.click(screen.getByRole('button', { name: /thử nhập lại bằng chứng/i }));
    expect(onSelect).toHaveBeenCalledWith(0, '001');
    expect(onRetry).toHaveBeenCalledWith('crop-2');
  });

  it('keeps terminal recovery actions visible while evidence details are collapsed', () => {
    render(<ScannerEvidencePanel
      onRetryArtifact={vi.fn().mockResolvedValue(undefined)}
      onReject={vi.fn()}
      evidence={{
        outcome: 'needs_review', resultId: 'result-safety', documentId: 'document-safety', revision: 1,
        warnings: [], requiresIdentityReason: false, catalogueDrift: false,
        reviewState: 'evidence_fault', blockers: ['SCANNER.EVIDENCE_FAULT'], items: [],
        artifacts: [{
          artifactId: 'crop-safety', kind: 'crop', mediaType: 'image/png',
          fieldId: 'items.0.item', rowIndex: 0, state: 'integrity_fault', url: null,
        }],
      }}
    />);

    expect(document.getElementById('scanner-evidence-details')).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: /thử nhập lại bằng chứng/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /từ chối/i })).toBeVisible();
  });

  it('maps an unknown artifact state to a closed plain-language fallback', async () => {
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review', resultId: 'result-unknown', documentId: 'document-unknown', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [], items: [],
      artifacts: [{
        artifactId: 'crop-unknown', kind: 'crop', mediaType: 'image/png',
        fieldId: 'items.0.item', rowIndex: 0, state: 'future_state', url: null,
      }],
    } as unknown as NonNullable<QueueSheetItem['scannerEvidence']>} />);

    await userEvent.click(screen.getByRole('button', { name: /hiện bằng chứng/i }));
    expect(screen.getByText('Không khả dụng')).toBeVisible();
    expect(screen.queryByText('Thiếu tệp')).not.toBeInTheDocument();
  });

  it('does not fetch or render the original scanner image in the evidence panel', async () => {
    fetchImageObjectUrlMock.mockResolvedValue('blob:source-image');
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review', resultId: 'result-3', documentId: 'document-3', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [], items: [],
      artifacts: [{
        artifactId: 'source-1', kind: 'source', mediaType: 'image/png',
        fieldId: null, rowIndex: null, state: 'available',
        url: '/scans/verify/sheet-1/artifacts/source-1',
      }],
    }} />);

    expect(screen.queryByRole('img', { name: /source/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /xem tệp gốc/i })).not.toBeInTheDocument();
    expect(fetchImageObjectUrlMock).not.toHaveBeenCalled();
  });

  it('does not expose a PDF source in the evidence panel', async () => {
    fetchImageObjectUrlMock.mockResolvedValue('blob:source-pdf');
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review', resultId: 'result-4', documentId: 'document-4', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [], items: [],
      artifacts: [{
        artifactId: 'source-pdf', kind: 'source', mediaType: 'application/pdf',
        fieldId: null, rowIndex: null, state: 'available',
        url: '/scans/verify/sheet-2/artifacts/source-pdf',
      }],
    }} />);

    expect(screen.queryByRole('link', { name: /xem tệp gốc/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(fetchImageObjectUrlMock).not.toHaveBeenCalled();
  });

  it('keeps crop previews unchanged without an original-file action', async () => {
    fetchImageObjectUrlMock.mockResolvedValue('blob:crop-image');
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review', resultId: 'result-5', documentId: 'document-5', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [], items: [],
      artifacts: [{
        artifactId: 'crop-3', kind: 'review-crop', mediaType: 'image/png',
        fieldId: 'items.0.item', rowIndex: 0, state: 'available',
        url: '/scans/verify/sheet-3/artifacts/crop-3',
      }],
    }} />);

    await userEvent.click(screen.getByRole('button', { name: /hiện bằng chứng/i }));
    expect(await screen.findByRole('img', { name: /ảnh cần kiểm tra/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /xem tệp gốc/i })).not.toBeInTheDocument();
  });

  it.each(['text/html', 'image/svg+xml'])(
    'does not load source media type %s in the evidence panel',
    (mediaType) => {
    render(<ScannerEvidencePanel evidence={{
      outcome: 'needs_review', resultId: 'result-6', documentId: 'document-6', revision: 1,
      warnings: [], requiresIdentityReason: false, catalogueDrift: false,
      reviewState: 'needs_review', blockers: [], items: [],
      artifacts: [{
        artifactId: 'source-unsafe', kind: 'source', mediaType,
        fieldId: null, rowIndex: null, state: 'available',
        url: '/scans/verify/sheet-4/artifacts/source-unsafe',
      }],
    }} />);

    expect(screen.queryByRole('link', { name: /xem tệp gốc/i })).not.toBeInTheDocument();
    expect(fetchImageObjectUrlMock).not.toHaveBeenCalled();
    },
  );
});
