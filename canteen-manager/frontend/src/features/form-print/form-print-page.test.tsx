import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { menu } from '@/lib/api';
import type { MenuFormStatus } from '@/lib/types';
import { FormPrintPage } from './form-print-page';

vi.mock('@/lib/api', () => ({
  menu: {
    getForm: vi.fn(),
    generateForm: vi.fn(),
  },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const getForm = vi.mocked(menu.getForm);
const generateForm = vi.mocked(menu.generateForm);
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

const AVAILABLE_TEMPLATES: NonNullable<MenuFormStatus['templates']> = {
  code: {
    mode: 'code',
    orientation: 'portrait',
    generatedAt: null,
    version: null,
    available: true,
    unavailableReason: null,
    activeItemCount: 53,
    capacity: null,
  },
  full_list: {
    mode: 'full_list',
    orientation: 'landscape',
    generatedAt: null,
    version: null,
    available: true,
    unavailableReason: null,
    activeItemCount: 52,
    capacity: 52,
  },
};

const AVAILABLE: MenuFormStatus = {
  generatedAt: null,
  version: null,
  templates: AVAILABLE_TEMPLATES,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  getForm.mockResolvedValue(AVAILABLE);
  generateForm.mockResolvedValue({ pdfBase64: 'JVBERi0xLjQ=' });
  createObjectURL.mockReturnValue('blob:calibration-1');
});

describe('FormPrintPage per-mode calibration', () => {
  it('shows independent code and full-list template status and geometry', async () => {
    render(<FormPrintPage />);

    expect(await screen.findByRole('heading', { name: /code-entry template/i })).toBeInTheDocument();
    expect(screen.getByText(/A5 portrait · 2 columns × 6 lines/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /full-list template/i })).toBeInTheDocument();
    expect(screen.getByText(/A5 landscape · 4 columns × 13 rows/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate code-entry template/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /generate full-list template/i })).toBeEnabled();
    expect(screen.getByText(/CALIBRATION \/ NOT FOR ORDERS/i)).toBeInTheDocument();
  });

  it('generates and previews each mode independently', async () => {
    createObjectURL
      .mockReturnValueOnce('blob:code-template')
      .mockReturnValueOnce('blob:full-list-template');
    render(<FormPrintPage />);

    await userEvent.click(await screen.findByRole('button', { name: /generate code-entry template/i }));
    await waitFor(() => expect(generateForm).toHaveBeenCalledWith('code'));
    expect(await screen.findByTitle(/code-entry OMR form preview/i)).toHaveAttribute(
      'src',
      'blob:code-template#toolbar=0',
    );

    await userEvent.click(screen.getByRole('button', { name: /generate full-list template/i }));
    await waitFor(() => expect(generateForm).toHaveBeenCalledWith('full_list'));
    expect(await screen.findByTitle(/full-list OMR form preview/i)).toHaveAttribute(
      'src',
      'blob:full-list-template#toolbar=0',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:code-template');
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('labels generated status and regeneration per mode', async () => {
    getForm.mockResolvedValue({
      ...AVAILABLE,
      templates: {
        ...AVAILABLE_TEMPLATES,
        code: {
          ...AVAILABLE_TEMPLATES.code,
          generatedAt: '2026-07-17T01:00:00Z',
          version: 'omr-a5-v1-r2',
        },
      },
    });
    render(<FormPrintPage />);

    const codeCard = (await screen.findByRole('heading', { name: /code-entry template/i }))
      .closest('section') as HTMLElement;
    expect(within(codeCard).getByText(/active template generated/i)).toBeInTheDocument();
    expect(within(codeCard).getByText(/omr-a5-v1-r2/i)).toBeInTheDocument();
    expect(within(codeCard).getByRole('button', { name: /regenerate code-entry template/i }))
      .toBeEnabled();
    expect(screen.getByRole('button', { name: /generate full-list template/i })).toBeEnabled();
  });

  it('marks full-list unavailable above 52 items without disabling code mode', async () => {
    getForm.mockResolvedValue({
      ...AVAILABLE,
      templates: {
        ...AVAILABLE_TEMPLATES,
        full_list: {
          ...AVAILABLE_TEMPLATES.full_list,
          available: false,
          unavailableReason: 'FORM_TEMPLATE.CAPACITY_EXCEEDED',
          activeItemCount: 53,
        },
      },
    });
    render(<FormPrintPage />);

    const fullListCard = (await screen.findByRole('heading', { name: /full-list template/i }))
      .closest('section') as HTMLElement;
    expect(within(fullListCard).getByText(/unavailable: 53 active items exceeds the 52-item capacity/i))
      .toBeInTheDocument();
    expect(within(fullListCard).getByRole('button', { name: /generate full-list template/i }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: /generate code-entry template/i })).toBeEnabled();
  });

  it('revokes the active preview URL on unmount', async () => {
    const view = render(<FormPrintPage />);
    await userEvent.click(await screen.findByRole('button', { name: /generate code-entry template/i }));
    await screen.findByTitle(/code-entry OMR form preview/i);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:calibration-1');
  });
});
