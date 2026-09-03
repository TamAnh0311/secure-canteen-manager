import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { OrderFormPage } from './order-form-page';
import { omrForms } from '@/lib/api';
import { NAV_GROUPS } from '@/app/shell/nav-items';
import i18n from '@/i18n';
import type {
  IssuedOmrFormBatch,
  GenericOmrMaster,
  OmrFormCapabilities,
  OmrRoster,
  OmrRosterOptions,
} from '@/lib/api/omr-forms';

vi.mock('@/lib/api', () => ({
  omrForms: {
    getRosterOptions: vi.fn(),
    getRoster: vi.fn(),
    getCapabilities: vi.fn(),
    issueOmrFormBatch: vi.fn(),
    getGenericMaster: vi.fn(),
  },
}));

const getRosterOptions = vi.mocked(omrForms.getRosterOptions);
const getRoster = vi.mocked(omrForms.getRoster);
const getCapabilities = vi.mocked(omrForms.getCapabilities);
const issueOmrFormBatch = vi.mocked(omrForms.issueOmrFormBatch);
const getGenericMaster = vi.mocked(omrForms.getGenericMaster);
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

const OPTIONS: OmrRosterOptions = {
  zones: [
    { zone: 'Khu A', cells: ['A-12', null] },
    { zone: 'Khu B', cells: ['B-01'] },
  ],
};

const ROSTER: OmrRoster = {
  zone: 'Khu A',
  cell: 'A-12',
  prisoners: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      legacyId: 'P-004218',
      name: 'Nguyen Van An',
      zone: 'Khu A',
      cell: 'A-12',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      legacyId: 'P-004219',
      name: 'Tran Thi Binh',
      zone: 'Khu A',
      cell: 'A-12',
    },
  ],
};

const CAPABILITIES: OmrFormCapabilities = {
  operationalMode: 'issued',
  maxBatchSize: 20,
  modes: [
    {
      mode: 'code',
      available: true,
      unavailableCode: null,
      orientation: 'portrait',
      itemCount: 53,
      capacity: null,
      templateRevision: 'code-r7',
    },
    {
      mode: 'full_list',
      available: true,
      unavailableCode: null,
      orientation: 'landscape',
      itemCount: 53,
      capacity: 60,
      templateRevision: 'full-r4',
    },
  ],
};

const GENERIC_CODE_MASTER: GenericOmrMaster = {
  mode: 'code',
  templateId: '33333333-3333-4333-8333-333333333333',
  revision: 'code-r7',
  orientation: 'portrait',
  formReference: 'CM-G1:33333333-3333-4333-8333-333333333333',
  pageCount: 1,
  pdfBase64: 'JVBERi0xLjQ=',
};

const ISSUED_BATCH: IssuedOmrFormBatch = {
  serviceDate: '2026-07-18',
  issuedAt: '2026-07-17T09:00:00.000Z',
  mode: 'code',
  orientation: 'portrait',
  pageCount: 2,
  manifest: [
    { userId: ROSTER.prisoners[0].id, shortSerial: '123E4567' },
    { userId: ROSTER.prisoners[1].id, shortSerial: '89ABCDEF' },
  ],
  pdfBase64: 'JVBERi0xLjQ=',
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  getRosterOptions.mockResolvedValue(OPTIONS);
  getCapabilities.mockResolvedValue(CAPABILITIES);
  getRoster.mockResolvedValue(ROSTER);
  issueOmrFormBatch.mockResolvedValue(ISSUED_BATCH);
  getGenericMaster.mockImplementation(async (mode) => ({
    ...GENERIC_CODE_MASTER,
    mode,
    revision: mode === 'code' ? 'code-r7' : 'full-r4',
    orientation: mode === 'code' ? 'portrait' : 'landscape',
  }));
  createObjectURL.mockReturnValue('blob:issued-batch-1');
});

async function chooseSelect(name: string, optionName: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

async function loadAssignedRoster() {
  await chooseSelect('Prison block', 'Khu A');
  await chooseSelect('Prison cell', 'A-12');
  await screen.findByText('Nguyen Van An');
}

async function confirmIssue() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /issue selected forms/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/invalidates that predecessor/i)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /issue selected forms/i }));
}

describe('OrderFormPage exact roster and selection', () => {
  it('loads zone before cell and represents the unassigned cell explicitly', async () => {
    render(<OrderFormPage />);

    const cellSelect = await screen.findByRole('combobox', { name: 'Prison cell' });
    expect(cellSelect).toBeDisabled();
    await chooseSelect('Prison block', 'Khu A');
    expect(cellSelect).toBeEnabled();
    await chooseSelect('Prison cell', 'Unassigned cell');

    await waitFor(() => expect(getRoster).toHaveBeenCalledWith('Khu A', null));
  });

  it('supports individual and select-all-visible selection with the server cap summary', async () => {
    render(<OrderFormPage />);
    await loadAssignedRoster();
    const user = userEvent.setup();

    await user.click(screen.getByRole('checkbox', { name: /select Nguyen Van An/i }));
    expect(screen.getByText('1 of 20 maximum selected')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /select all visible prisoners/i }));
    expect(screen.getByText('2 of 20 maximum selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /select Tran Thi Binh/i })).toBeChecked();
  });

  it('submits only explicit selected IDs and one mode, then shows combined print guidance', async () => {
    render(<OrderFormPage />);
    await loadAssignedRoster();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /select all visible prisoners/i }));

    await confirmIssue();

    await waitFor(() => expect(issueOmrFormBatch).toHaveBeenCalledWith(
      ROSTER.prisoners.map((prisoner) => prisoner.id),
      'code',
    ));
    expect(await screen.findByTitle(/combined issued order forms preview/i))
      .toHaveAttribute('src', 'blob:issued-batch-1#toolbar=0');
    expect(screen.getByText(/2 forms · 2 PDF pages · Code entry · Portrait/i)).toBeInTheDocument();
    expect(screen.getByText(/Actual size \(100%\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/123E4567|89ABCDEF/)).not.toBeInTheDocument();
  });

  it('preserves selected prisoners after an issue failure so the same batch can be retried', async () => {
    issueOmrFormBatch
      .mockRejectedValueOnce(new Error('Roster changed; refresh and retry'))
      .mockResolvedValueOnce(ISSUED_BATCH);
    render(<OrderFormPage />);
    await loadAssignedRoster();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /select Nguyen Van An/i }));

    await confirmIssue();

    expect(await screen.findByText('Roster changed; refresh and retry')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /select Nguyen Van An/i })).toBeChecked();
    expect(screen.getByText('1 of 20 maximum selected')).toBeInTheDocument();

    await confirmIssue();
    await waitFor(() => expect(issueOmrFormBatch).toHaveBeenCalledTimes(2));
  });
});

describe('OrderFormPage mode and preview gates', () => {
  it('uses one radio group and disables full-list with the backend reason', async () => {
    getCapabilities.mockResolvedValue({
      ...CAPABILITIES,
      modes: [
        CAPABILITIES.modes[0],
        {
          ...CAPABILITIES.modes[1],
          available: false,
          unavailableCode: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
          itemCount: 61,
        },
      ],
    });
    render(<OrderFormPage />);

    const code = await screen.findByRole('radio', { name: /Code entry/i });
    const fullList = screen.getByRole('radio', { name: /Full item list/i });
    expect(code).toHaveAttribute('name', 'order-form-mode');
    expect(fullList).toHaveAttribute('name', 'order-form-mode');
    expect(code).toBeChecked();
    expect(fullList).toBeDisabled();
    expect(screen.getByText(/Portrait · 53 active items · template code-r7/i)).toBeInTheDocument();
    expect(within(code.closest('label')!).queryByText(/capacity/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Landscape · 61 of 60 item capacity · template full-r4/i)).toBeInTheDocument();
    expect(screen.getByText(/active item count exceeds the full-list capacity/i)).toBeInTheDocument();
  });

  it('issues an available full-list batch and follows its landscape orientation', async () => {
    issueOmrFormBatch.mockResolvedValue({
      ...ISSUED_BATCH,
      mode: 'full_list',
      orientation: 'landscape',
    });
    render(<OrderFormPage />);
    await loadAssignedRoster();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /select Nguyen Van An/i }));
    await user.click(screen.getByRole('radio', { name: /Full item list/i }));

    await confirmIssue();

    await waitFor(() => expect(issueOmrFormBatch).toHaveBeenCalledWith(
      [ROSTER.prisoners[0].id],
      'full_list',
    ));
    expect(await screen.findByText(/Full item list · Landscape/i)).toBeInTheDocument();
    expect(screen.getByText(/printer orientation is Landscape/i)).toBeInTheDocument();
  });

  it('revokes replaced and active PDF object URLs', async () => {
    createObjectURL
      .mockReturnValueOnce('blob:issued-batch-1')
      .mockReturnValueOnce('blob:issued-batch-2');
    const view = render(<OrderFormPage />);
    await loadAssignedRoster();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /select Nguyen Van An/i }));
    await confirmIssue();
    await screen.findByTitle(/combined issued order forms preview/i);

    await confirmIssue();
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:issued-batch-1');

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:issued-batch-2');
  });
});

describe('OrderFormPage generic master mode', () => {
  it('shows two read-only master cards without loading a roster or issuing personalized forms', async () => {
    getCapabilities.mockResolvedValue({ ...CAPABILITIES, operationalMode: 'generic' });
    const { container } = render(<OrderFormPage />);

    expect(await screen.findByRole('heading', { name: /generic order-form masters/i })).toBeInTheDocument();
    expect(screen.getAllByText('Read-only master')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: /prison block/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue selected forms/i })).not.toBeInTheDocument();
    expect(getRosterOptions).not.toHaveBeenCalled();
    expect(getRoster).not.toHaveBeenCalled();
    expect(issueOmrFormBatch).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /preview/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /download pdf/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^print$/i })).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('loads a selected master through the read-only endpoint and previews its PDF', async () => {
    getCapabilities.mockResolvedValue({ ...CAPABILITIES, operationalMode: 'generic' });
    createObjectURL.mockReturnValue('blob:generic-code');
    render(<OrderFormPage />);

    const previews = await screen.findAllByRole('button', { name: /preview/i });
    await userEvent.click(previews[0]);

    await waitFor(() => expect(getGenericMaster).toHaveBeenCalledWith('code'));
    expect(await screen.findByTitle(/code entry generic master preview/i))
      .toHaveAttribute('src', 'blob:generic-code#toolbar=0');
    expect(screen.getByText(/CM-G1:33333333/i)).toBeInTheDocument();
    expect(issueOmrFormBatch).not.toHaveBeenCalled();
  });

  it('downloads the requested master PDF without invoking personalized issuance', async () => {
    getCapabilities.mockResolvedValue({ ...CAPABILITIES, operationalMode: 'generic' });
    createObjectURL.mockReturnValue('blob:generic-download');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<OrderFormPage />);

    const downloads = await screen.findAllByRole('button', { name: /download pdf/i });
    await userEvent.click(downloads[1]);

    await waitFor(() => expect(getGenericMaster).toHaveBeenCalledWith('full_list'));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('generic-order-form-full_list-full-r4.pdf');
    expect(anchor.href).toContain('blob:generic-download');
    expect(issueOmrFormBatch).not.toHaveBeenCalled();
  });
});

describe('Order form role visibility', () => {
  const item = NAV_GROUPS.flatMap((group) => group.items).find((entry) => entry.id === 'order-form');

  it('is visible to operator and admin but not cashier', () => {
    expect(item).toBeDefined();
    expect(item?.roles).toEqual(['operator', 'admin']);
    expect(item?.roles).not.toContain('cashier');
  });
});
