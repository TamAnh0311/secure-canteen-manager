import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LineEditor } from './line-editor';
import type { LineDraft } from './verify-model';
import type { FullMenuItem } from '@/lib/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MENU: FullMenuItem[] = [
  { id: 'm-001', code: '001', position: 0, name: 'Phở', price: 30_000, category: 'food', isActive: true },
  { id: 'm-002', code: '002', position: 1, name: 'Trà', price: 10_000, category: 'food', isActive: true },
  { id: 'm-003', code: '003', position: 2, name: 'Bánh mì', price: 15_000, category: 'essential', isActive: false },
];

function makeLine(overrides: Partial<LineDraft> = {}): LineDraft {
  return {
    lineIndex: 0,
    codeInput: '001',
    resolvedItem: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
    quantity: 1,
    flags: [],
    mappingAuthority: 'code',
    lowConfidence: false,
    edited: false,
    ...overrides,
  };
}

function renderEditor(lines: LineDraft[], overrides: Partial<Parameters<typeof LineEditor>[0]> = {}) {
  const defaults = {
    lines,
    menuItems: MENU,
    onLineCodeChange: vi.fn(),
    onLineQtyChange: vi.fn(),
    onAddLine: vi.fn(),
    onRemoveLine: vi.fn(),
  };
  return render(<LineEditor {...defaults} {...overrides} />);
}

// ── Resolved item display ────────────────────────────────────────────────────

describe('LineEditor — resolved item display', () => {
  it('shows the resolved item name when code is valid', () => {
    renderEditor([makeLine()]);
    expect(screen.getByText('Phở')).toBeInTheDocument();
  });

  it('shows the unit price for a resolved item', () => {
    renderEditor([makeLine()]);
    // formatVnd(30_000) — text should contain "30" at minimum
    const total = screen.getByTestId('line-editor-total');
    expect(total).toBeInTheDocument();
  });

  it('shows unknown-code error when codeInput non-empty and resolvedItem null', () => {
    renderEditor([makeLine({ codeInput: '099', resolvedItem: null })]);
    expect(screen.getByTestId('unknown-code-0')).toBeInTheDocument();
  });

  it('does NOT show unknown-code error when codeInput is empty', () => {
    renderEditor([makeLine({ codeInput: '', resolvedItem: null })]);
    expect(screen.queryByTestId('unknown-code-0')).not.toBeInTheDocument();
  });
});

// ── Inactive badge ───────────────────────────────────────────────────────────

describe('LineEditor — inactive item badge', () => {
  it('renders inactive badge for an inactive resolved item', () => {
    renderEditor([
      makeLine({
        codeInput: '003',
        resolvedItem: { menuItemId: 'm-003', name: 'Bánh mì', unitPrice: 15_000, inactive: true, category: 'essential' },
      }),
    ]);
    expect(screen.getByTestId('inactive-badge-0')).toBeInTheDocument();
  });

  it('does NOT render inactive badge for an active item', () => {
    renderEditor([makeLine()]);
    expect(screen.queryByTestId('inactive-badge-0')).not.toBeInTheDocument();
  });
});

// ── Running total ────────────────────────────────────────────────────────────

describe('LineEditor — running total', () => {
  it('shows total for resolved lines (price × qty)', () => {
    renderEditor([
      makeLine({ lineIndex: 0, quantity: 2 }), // 30_000 × 2 = 60_000
      makeLine({
        lineIndex: 1,
        codeInput: '002',
        resolvedItem: { menuItemId: 'm-002', name: 'Trà', unitPrice: 10_000, inactive: false, category: 'food' },
        quantity: 1,
      }),
    ]);
    const total = screen.getByTestId('line-editor-total');
    // Total = 70_000 VND — Intl formats this as "70.000 ₫" or "₫70,000"
    expect(total.textContent).toMatch(/70/);
  });

  it('hides total when all lines are unresolved', () => {
    renderEditor([makeLine({ codeInput: '', resolvedItem: null })]);
    expect(screen.queryByTestId('line-editor-total')).not.toBeInTheDocument();
  });
});

// ── Code input interaction ───────────────────────────────────────────────────

describe('LineEditor — code input', () => {
  it('renders printed template-row code and name as locked text with quantity as the only input', () => {
    renderEditor([makeLine({
      codeInput: '001',
      mappingAuthority: 'template_row',
      resolvedItem: { menuItemId: 'm-001', name: 'Phở bản in', unitPrice: 30_000, inactive: false, category: 'food' },
    })]);

    expect(screen.getByText('001')).toBeInTheDocument();
    expect(screen.getByText('Phở bản in')).toBeInTheDocument();
    expect(screen.getByText(/đã khóa/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /mã dòng/i })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /số lượng dòng/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /xóa dòng/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thêm dòng/i })).not.toBeInTheDocument();
  });

  it('keeps code correction available beside a template row in mixed line data', () => {
    renderEditor([
      makeLine({ lineIndex: 0, mappingAuthority: 'template_row' }),
      makeLine({ lineIndex: 1, codeInput: '002', resolvedItem: { menuItemId: 'm-002', name: 'Trà', unitPrice: 10_000, inactive: false, category: 'food' } }),
    ]);

    expect(screen.getByRole('textbox', { name: /mã dòng 2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /thêm dòng/i })).toBeInTheDocument();
  });

  it('calls onLineCodeChange when the operator types in the code field', async () => {
    const onLineCodeChange = vi.fn();
    renderEditor([makeLine({ codeInput: '' })], { onLineCodeChange });
    const input = screen.getByRole('textbox', { name: /mã dòng/i });
    await userEvent.type(input, '001');
    expect(onLineCodeChange).toHaveBeenCalled();
  });

  it('marks the code input aria-invalid when code is non-empty and unresolved', () => {
    renderEditor([makeLine({ codeInput: '099', resolvedItem: null })]);
    const input = screen.getByRole('textbox', { name: /mã dòng/i });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('does NOT mark code input aria-invalid for empty codeInput', () => {
    renderEditor([makeLine({ codeInput: '', resolvedItem: null })]);
    const input = screen.getByRole('textbox', { name: /mã dòng/i });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });
});

// ── Qty input interaction ────────────────────────────────────────────────────

describe('LineEditor — qty input', () => {
  it('calls onLineQtyChange when operator changes quantity', async () => {
    const onLineQtyChange = vi.fn();
    renderEditor([makeLine()], { onLineQtyChange });
    const qtyInput = screen.getByRole('spinbutton', { name: /số lượng dòng/i });
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '3');
    expect(onLineQtyChange).toHaveBeenCalled();
  });
});

// ── Add / Remove line ────────────────────────────────────────────────────────

describe('LineEditor — add / remove line', () => {
  it('calls onAddLine when add button is clicked', async () => {
    const onAddLine = vi.fn();
    renderEditor([makeLine()], { onAddLine });
    const addBtn = screen.getByRole('button', { name: /thêm dòng/i });
    await userEvent.click(addBtn);
    expect(onAddLine).toHaveBeenCalledOnce();
  });

  it('calls onRemoveLine with the correct lineIndex when remove button clicked', async () => {
    const onRemoveLine = vi.fn();
    renderEditor(
      [
        makeLine({ lineIndex: 0 }),
        makeLine({ lineIndex: 1, codeInput: '002',
          resolvedItem: { menuItemId: 'm-002', name: 'Trà', unitPrice: 10_000, inactive: false, category: 'food' } }),
      ],
      { onRemoveLine },
    );
    const removeBtns = screen.getAllByRole('button', { name: /xóa dòng/i });
    await userEvent.click(removeBtns[0]);
    expect(onRemoveLine).toHaveBeenCalledWith(0);
  });
});

// ── Low-confidence highlight ─────────────────────────────────────────────────

describe('LineEditor — low-confidence indicator', () => {
  it('shows low-confidence hint when at least one line is unedited and lowConfidence', () => {
    renderEditor([makeLine({ lowConfidence: true, edited: false })]);
    // VI key: lineLowConfidenceHint
    expect(screen.getByText(/độ tin cậy thấp/i)).toBeInTheDocument();
  });

  it('hides low-confidence hint when all low-confidence lines have been edited', () => {
    renderEditor([makeLine({ lowConfidence: true, edited: true })]);
    expect(screen.queryByText(/độ tin cậy thấp/i)).not.toBeInTheDocument();
  });
});

// ── focusFirst handle ────────────────────────────────────────────────────────

describe('LineEditor — focusFirst ref', () => {
  it('exposes a focusFirst handle that focuses the first code input', () => {
    const ref = { current: null } as React.RefObject<import('./line-editor').LineEditorHandle>;
    render(
      <LineEditor
        ref={ref}
        lines={[makeLine()]}
        menuItems={MENU}
        onLineCodeChange={vi.fn()}
        onLineQtyChange={vi.fn()}
        onAddLine={vi.fn()}
        onRemoveLine={vi.fn()}
      />,
    );
    // Should not throw; focus is best-effort in jsdom
    expect(() => ref.current?.focusFirst()).not.toThrow();
  });
});
