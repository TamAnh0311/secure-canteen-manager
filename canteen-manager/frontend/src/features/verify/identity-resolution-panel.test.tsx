import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { scans } from '@/lib/api';
import type { IdentityPreview, RankedIdentityCandidate } from '@/lib/types';
import {
  IdentityResolutionPanel,
  reviewReasonKind,
  scannerExactIdentitySelection,
  type IdentitySelection,
} from './identity-resolution-panel';
import { IDENTITY_BLOCK_MESSAGE_KEYS } from './confirm-bar';

vi.mock('@/lib/api', () => ({
  scans: {
    searchIdentityCandidates: vi.fn(),
  },
}));

const rankedCandidates: RankedIdentityCandidate[] = [
  {
    userId: '11111111-1111-4111-8111-111111111111',
    legacyId: 'P-001',
    name: 'Nguyen Van An',
    zone: 'A',
    cell: '12',
    score: 0.94,
    reasons: ['cell_exact', 'name_similar'],
  },
  {
    userId: '22222222-2222-4222-8222-222222222222',
    legacyId: 'P-002',
    name: 'Tran Van Binh',
    zone: 'A',
    cell: '12',
    score: 0.79,
    reasons: ['cell_exact'],
  },
];

const preview: IdentityPreview = {
  user: {
    id: rankedCandidates[0].userId,
    legacyId: rankedCandidates[0].legacyId,
    name: rankedCandidates[0].name,
    zone: rankedCandidates[0].zone,
    cell: rankedCandidates[0].cell,
  },
  balance: 125_000,
  existingOrder: null,
};

const baseProps = {
  sheetId: 'sheet-1',
  form: { serial: 'GENERIC1', revision: 'code-r7', serviceDate: '2026-07-29' },
  evidence: [
    { field: 'name' as const, status: 'recognized' as const, rawText: 'NGUYEN VAN AN', flags: [] },
    { field: 'cell' as const, status: 'recognized' as const, rawText: 'A-12', flags: [] },
    { field: 'prisoner_id' as const, status: 'abstained' as const, rawText: null, flags: ['LOW_CONFIDENCE'] },
  ],
  rankedCandidates,
  previewLoading: false,
  previewError: null,
  onRetryPreview: vi.fn(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('IdentityResolutionPanel explicit selection', () => {
  it('initializes an exact scanner ID and room match as the selected prisoner', () => {
    const selection = scannerExactIdentitySelection({
      bindingKind: 'scanner',
      rankedCandidates: [{
        userId: preview.user.id,
        legacyId: preview.user.legacyId,
        name: preview.user.name,
        zone: preview.user.zone,
        cell: preview.user.cell,
        score: 1,
        reasons: ['exact_id', 'room_match'],
      }],
      scannerEvidence: { requiresIdentityReason: false },
    });

    expect(selection).toEqual({ source: 'ranked', user: preview.user });
  });

  it('does not initialize ambiguous scanner or generic identity candidates', () => {
    const candidate = {
      userId: preview.user.id,
      legacyId: preview.user.legacyId,
      name: preview.user.name,
      zone: preview.user.zone,
      cell: preview.user.cell,
      score: 0.7,
      reasons: ['room_match'],
    };

    expect(scannerExactIdentitySelection({
      bindingKind: 'scanner',
      rankedCandidates: [candidate],
      scannerEvidence: { requiresIdentityReason: true },
    })).toBeNull();
    expect(scannerExactIdentitySelection({
      bindingKind: 'scanner',
      rankedCandidates: [{ ...candidate, reasons: ['exact_id', 'room_match'] }],
      scannerEvidence: { requiresIdentityReason: true },
    })).toBeNull();
    expect(scannerExactIdentitySelection({
      bindingKind: 'generic',
      rankedCandidates: [{ ...candidate, reasons: ['exact_id', 'room_match'] }],
      scannerEvidence: null,
    })).toBeNull();
  });

  it('announces the exact scanner selection without changing the candidate controls', () => {
    const selection: IdentitySelection = { source: 'ranked', user: preview.user };
    render(
      <IdentityResolutionPanel
        {...baseProps}
        bindingKind="scanner"
        rankedCandidates={[{
          ...rankedCandidates[0],
          score: 1,
          reasons: ['exact_id', 'room_match'],
        }]}
        selection={selection}
        preview={preview}
        reason=""
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: /candidate 1.*Nguyen Van An/i })).toBeChecked();
    expect(screen.getByText(/exact scanner match selected/i)).toBeInTheDocument();
    expect(screen.queryByText(/first ranked candidate is not preselected/i)).not.toBeInTheDocument();
  });

  it('shows a scanner review reason for an exact identity with item warnings', () => {
    const scannerCandidate = {
      ...rankedCandidates[0],
      score: 1,
      reasons: ['exact_id', 'room_match'],
    };
    const selection: IdentitySelection = { source: 'ranked', user: preview.user };
    const reasonKind = reviewReasonKind(selection, [scannerCandidate], {
      requiresIdentityReason: false,
      catalogueDrift: false,
      blockers: ['SCANNER.ITEM_0_WARNINGS'],
    });

    expect(reasonKind).toBe('scanner_review');
    render(
      <IdentityResolutionPanel
        {...baseProps}
        bindingKind="scanner"
        rankedCandidates={[scannerCandidate]}
        selection={selection}
        preview={preview}
        reason=""
        reasonKind={reasonKind}
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
      />,
    );

    const reason = screen.getByLabelText(/scanner review reason/i);
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/reason before confirming this scanner review/i)).toBeInTheDocument();
  });

  it.each([
    ['quantity warnings', { catalogueDrift: false, blockers: ['SCANNER.QUANTITY_0_WARNINGS'] }],
    ['catalogue drift', { catalogueDrift: true, blockers: [] }],
  ])('classifies %s as a scanner review reason', (_label, evidence) => {
    const selection: IdentitySelection = { source: 'ranked', user: preview.user };
    expect(reviewReasonKind(selection, [{
      ...rankedCandidates[0],
      reasons: ['exact_id', 'room_match'],
    }], {
      requiresIdentityReason: false,
      ...evidence,
    })).toBe('scanner_review');
  });

  it('keeps identity reasons ahead of scanner review reasons', () => {
    const selection: IdentitySelection = { source: 'manual', user: preview.user };
    expect(reviewReasonKind(selection, rankedCandidates, {
      requiresIdentityReason: true,
      catalogueDrift: true,
      blockers: ['SCANNER.ITEM_0_WARNINGS'],
    })).toBe('identity');
    expect(IDENTITY_BLOCK_MESSAGE_KEYS.scanner_review_reason_required).toEqual({
      status: 'confirmBlockedScannerReviewReason',
      toast: 'toastBlockedScannerReviewReason',
    });
  });

  it('shows handwriting evidence and never preselects the first ranked candidate', () => {
    render(
      <IdentityResolutionPanel
        {...baseProps}
        selection={null}
        preview={null}
        reason=""
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
      />,
    );

    expect(screen.getByText('NGUYEN VAN AN')).toBeInTheDocument();
    expect(screen.getByText('A-12')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('radio').every((radio) => !radio.hasAttribute('checked') && !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/first ranked candidate is not preselected/i)).toBeInTheDocument();
  });

  it('requires a bounded reason after an explicit non-top ranked selection', async () => {
    function Harness() {
      const [selection, setSelection] = useState<IdentitySelection | null>(null);
      const [reason, setReason] = useState('');
      const selectedPreview = selection ? {
        ...preview,
        user: { ...preview.user, ...selection.user },
      } : null;
      return (
        <IdentityResolutionPanel
          {...baseProps}
          selection={selection}
          preview={selectedPreview}
          reason={reason}
          onSelect={setSelection}
          onReasonChange={setReason}
        />
      );
    }
    render(<Harness />);

    await userEvent.click(screen.getByRole('radio', { name: /candidate 2.*Tran Van Binh/i }));

    const reason = screen.getByLabelText(/selection reason/i);
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute('maxlength', '500');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(reason, 'The written prisoner ID matches the second candidate.');
    expect(reason).toHaveAttribute('aria-invalid', 'false');
  });

  it('searches through the actor-scoped endpoint and treats the result as a manual selection', async () => {
    vi.mocked(scans.searchIdentityCandidates).mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        legacyId: 'P-003',
        name: 'Le Thi Chi',
        zone: 'A',
        cell: '13',
      },
    ]);
    const onSelect = vi.fn();
    render(
      <IdentityResolutionPanel
        {...baseProps}
        selection={null}
        preview={null}
        reason=""
        onSelect={onSelect}
        onReasonChange={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/manual prisoner search/i), 'P-003{Enter}');

    await waitFor(() => expect(scans.searchIdentityCandidates).toHaveBeenCalledWith('sheet-1', 'P-003'));
    await userEvent.click(await screen.findByRole('radio', { name: /manual search result.*Le Thi Chi/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual',
      user: expect.objectContaining({ id: '33333333-3333-4333-8333-333333333333' }),
    }));
  });

  it('renders only the server preview balance and replacement state for the selected user', () => {
    const selection: IdentitySelection = {
      source: 'ranked',
      user: {
        id: preview.user.id,
        legacyId: preview.user.legacyId,
        name: preview.user.name,
        zone: preview.user.zone,
        cell: preview.user.cell,
      },
    };
    render(
      <IdentityResolutionPanel
        {...baseProps}
        selection={selection}
        preview={{ ...preview, existingOrder: { items: [], total: 40_000 } }}
        reason=""
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/125,000/)).toBeInTheDocument();
    expect(screen.getByText(/Existing OMR order:.*40,000/i)).toBeInTheDocument();
  });
});
