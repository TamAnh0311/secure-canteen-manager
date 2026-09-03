import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import i18n from '@/i18n';
import { IdentityResolutionPanel } from './identity-resolution-panel';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('IdentityResolutionPanel accessibility', () => {
  it('has no violations with no preselection and an announced selection requirement', async () => {
    const { container } = render(
      <IdentityResolutionPanel
        sheetId="sheet-a11y"
        form={{ serial: 'GENERIC1', revision: 'code-r7', serviceDate: '2026-07-29' }}
        evidence={[
          { field: 'name', status: 'recognized', rawText: 'NGUYEN VAN AN', flags: [] },
          { field: 'cell', status: 'recognized', rawText: 'A-12', flags: [] },
          { field: 'prisoner_id', status: 'blank', rawText: null, flags: [] },
        ]}
        rankedCandidates={[{
          userId: '11111111-1111-4111-8111-111111111111',
          legacyId: 'P-001',
          name: 'Nguyen Van An',
          zone: 'A',
          cell: '12',
          score: 0.94,
          reasons: ['cell_exact'],
        }]}
        selection={null}
        preview={null}
        previewLoading={false}
        previewError={null}
        reason=""
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
        onRetryPreview={vi.fn()}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps the same labelled controls and no axe violations in Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    const { container, getByLabelText } = render(
      <IdentityResolutionPanel
        sheetId="sheet-a11y-vi"
        form={{ serial: 'GENERIC2', revision: 'full-r4', serviceDate: '2026-07-29' }}
        evidence={[]}
        rankedCandidates={[]}
        selection={null}
        preview={null}
        previewLoading={false}
        previewError={null}
        reason=""
        onSelect={vi.fn()}
        onReasonChange={vi.fn()}
        onRetryPreview={vi.fn()}
      />,
    );

    expect(getByLabelText(/tìm phạm nhân thủ công/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
