import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MenuConfigPage } from './menu-config-page';
import { menu } from '@/lib/api';
import type { MenuItem, MenuFormStatus } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  menu: {
    listMenu: vi.fn(),
    getForm: vi.fn(),
    createMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    removeMenuItem: vi.fn(),
    reorderMenu: vi.fn(),
  },
  purchaseLimits: {
    getPurchaseLimits: vi.fn(() => Promise.resolve({ prisoner: { food: { enabled: true, amount: 100000 }, essential: { enabled: false, amount: null } }, visitor: { food: { enabled: true, amount: 500000 }, essential: { enabled: false, amount: null } } })),
    updatePurchaseLimits: vi.fn(),
  },
}));

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { menu as api } from '@/lib/api';

const mockList = api.listMenu as ReturnType<typeof vi.fn>;
const mockForm = api.getForm as ReturnType<typeof vi.fn>;
const mockCreate = api.createMenuItem as ReturnType<typeof vi.fn>;
const mockUpdate = api.updateMenuItem as ReturnType<typeof vi.fn>;
const mockRemove = api.removeMenuItem as ReturnType<typeof vi.fn>;

const ITEMS: MenuItem[] = [
  { id: 'm1', code: 'A01', position: 0, name: 'Cơm', price: 15_000, category: 'food', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'm2', code: 'A02', position: 1, name: 'Canh', price: 8_000, category: 'essential', isActive: false, createdAt: '', updatedAt: '' },
];

const UNLOCKED: MenuFormStatus = { generatedAt: null, version: null };
const LOCKED: MenuFormStatus = { generatedAt: '2026-06-18T01:00:00Z', version: 'v3' };

function renderPage() {
  render(
    <MemoryRouter>
      <MenuConfigPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue(ITEMS);
  mockForm.mockResolvedValue(UNLOCKED);
  mockCreate.mockResolvedValue(ITEMS[0]);
  mockUpdate.mockResolvedValue(ITEMS[0]);
  mockRemove.mockResolvedValue(undefined);
  void menu;
});

describe('MenuConfigPage — listing', () => {
  it('renders each item with its code, name and price', async () => {
    renderPage();
    expect(await screen.findByText('A01')).toBeInTheDocument();
    expect(screen.getByText('Cơm')).toBeInTheDocument();
    expect(screen.getByText('A02')).toBeInTheDocument();
    expect(screen.getByText('Canh')).toBeInTheDocument();
  });
});

describe('MenuConfigPage — create', () => {
  it('adds an item via the API with name + integer price', async () => {
    renderPage();
    await screen.findByText('A01');
    await userEvent.type(screen.getByLabelText(/item name|tên món/i), 'Trứng');
    await userEvent.type(screen.getByLabelText(/price|giá/i), '5000');
    await userEvent.click(screen.getByRole('button', { name: /add item|thêm món/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('Trứng', 5000, 'food'));
  });
});

describe('MenuConfigPage — soft delete', () => {
  it('removes an item via the API after confirming', async () => {
    renderPage();
    const row = (await screen.findByText('Cơm')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /remove|xóa/i }));
    await userEvent.click(screen.getByRole('button', { name: /^remove$|^xóa$/i }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('m1'));
  });
});

describe('MenuConfigPage — lock after form generation', () => {
  it('disables reorder + remove but keeps metadata editing available when a form has been generated', async () => {
    mockForm.mockResolvedValue(LOCKED);
    renderPage();
    const row = (await screen.findByText('Cơm')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: /move up|chuyển lên/i })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /edit|sửa/i })).toBeEnabled();
    expect(within(row).getByRole('button', { name: /remove|xóa/i })).toBeDisabled();
  });

  it('keeps reorder enabled while no form has been generated', async () => {
    mockForm.mockResolvedValue(UNLOCKED);
    renderPage();
    const row = (await screen.findByText('Canh')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: /move up|chuyển lên/i })).toBeEnabled();
  });
});

describe('MenuConfigPage — active toggle', () => {
  it('toggles isActive via the API (allowed even when locked)', async () => {
    mockForm.mockResolvedValue(LOCKED);
    renderPage();
    const row = (await screen.findByText('Cơm')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('switch'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('m1', { isActive: false }));
  });
});
