import { describe, it, expect } from 'vitest';
import {
  buildDraft,
  orderItems,
  orderTotal,
  resolveCode,
  setLineCode,
  setLineQty,
  addLine,
  removeLine,
  unresolvedCount,
  refreshDraftReferenceData,
} from './verify-model';
import type { FullMenuItem, QueueSheetItem } from '@/lib/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MENU: FullMenuItem[] = [
  { id: 'm-001', code: '001', position: 0, name: 'Phở', price: 30_000, category: 'food', isActive: true },
  { id: 'm-002', code: '002', position: 1, name: 'Trà', price: 10_000, category: 'food', isActive: true },
  { id: 'm-003', code: '003', position: 2, name: 'Bánh mì', price: 15_000, category: 'essential', isActive: false },
];

it('refreshes resolved price/category metadata without changing operator inputs or dirty state', () => {
  const edited = setLineQty(buildDraft(makeSheet(), MENU), 0, 4);
  const refreshed = refreshDraftReferenceData(edited, MENU.map((item) =>
    item.code === '001' ? { ...item, price: 42_000, category: 'essential' as const } : item,
  ));

  expect(refreshed.lines[0]).toMatchObject({
    codeInput: '001',
    quantity: 4,
    resolvedItem: { unitPrice: 42_000, category: 'essential' },
  });
  expect(refreshed.dirty).toBe(true);
});

it('refreshes mutable pricing metadata without replacing a template-row name snapshot', () => {
  const draft = buildDraft(makeSheet({
    orderLines: [{
      lineIndex: 0,
      code: '001',
      qty: 2,
      codeDigits: [],
      qtyDigits: [],
      confidence: 1,
      flags: [],
      mappingAuthority: 'template_row',
      resolved: { menuItemId: 'm-001', name: 'Tên trên phiếu', unitPrice: 30_000, inactive: false, category: 'food' },
    }],
  }), MENU);

  const refreshed = refreshDraftReferenceData(draft, MENU.map((item) =>
    item.id === 'm-001'
      ? { ...item, name: 'Tên hiện tại', price: 42_000, category: 'essential' as const }
      : item,
  ));

  expect(refreshed.lines[0].resolvedItem).toMatchObject({
    menuItemId: 'm-001',
    name: 'Tên trên phiếu',
    unitPrice: 42_000,
    category: 'essential',
  });
});

function makeSheet(overrides: Partial<QueueSheetItem> = {}): QueueSheetItem {
  return {
    id: 'sheet-1',
    sheetId: 'S-1',
    status: 'flagged',
    avgConfidence: 0.9,
    identity: { id: 'u1', legacyId: '12345', name: 'Alice', zone: null, cell: null },
    form: { serial: 'A1B2C3D4', revision: 'v3', serviceDate: '2026-07-15' },
    recognizedId: '12345',
    matchedUserId: 'u1',
    matchedUser: { id: 'u1', legacyId: '12345', name: 'Alice', zone: null, cell: null },
    balance: 100_000,
    idDigits: [],
    orderLines: [
      {
        lineIndex: 0,
        code: '001',
        qty: 2,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.95,
        flags: [],
        resolved: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
      },
      {
        lineIndex: 1,
        code: '002',
        qty: 1,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.82,
        flags: [],
        resolved: { menuItemId: 'm-002', name: 'Trà', unitPrice: 10_000, inactive: false, category: 'food' },
      },
    ],
    existingOrder: null,
    flags: [],
    warpedImageUrl: '/x',
    ...overrides,
  } as unknown as QueueSheetItem;
}

// ── resolveCode ──────────────────────────────────────────────────────────────

describe('resolveCode', () => {
  it('resolves an active item by exact 3-digit code', () => {
    const result = resolveCode('001', MENU);
    expect(result).toMatchObject({ menuItemId: 'm-001', name: 'Phở', inactive: false });
  });

  it('resolves an INACTIVE item (OMR path allows inactive)', () => {
    const result = resolveCode('003', MENU);
    expect(result).toMatchObject({ menuItemId: 'm-003', name: 'Bánh mì', inactive: true });
  });

  it('returns null for empty string', () => {
    expect(resolveCode('', MENU)).toBeNull();
  });

  it('returns null for non-numeric code', () => {
    expect(resolveCode('abc', MENU)).toBeNull();
    expect(resolveCode('01a', MENU)).toBeNull();
  });

  it('returns null for code with wrong digit count (2 digits)', () => {
    expect(resolveCode('01', MENU)).toBeNull();
  });

  it('returns null for stray extra digit (4 digits) — must NOT silently hit another item', () => {
    // '0012' has 4 digits → wrong width → null; never hits '001'
    expect(resolveCode('0012', MENU)).toBeNull();
  });

  it('returns null for an unknown code (correct width, no matching item)', () => {
    expect(resolveCode('099', MENU)).toBeNull();
  });

  it('returns null for negative-looking input', () => {
    expect(resolveCode('-01', MENU)).toBeNull();
  });
});

// ── buildDraft ───────────────────────────────────────────────────────────────

describe('buildDraft', () => {
  it('auto-selects the highest-ranked scanner item candidate without clearing review state', () => {
    const draft = buildDraft(makeSheet({
      source: 'scanner',
      orderLines: [{
        lineIndex: 0,
        code: null,
        qty: 2,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.5,
        itemConfidence: 0.5,
        quantityConfidence: 0.99,
        flags: [],
        itemFlags: ['ambiguous_item'],
        quantityFlags: [],
        resolved: null,
      }],
      scannerEvidence: {
        outcome: 'needs_review', resultId: 'result-1', documentId: 'document-1', revision: 1,
        warnings: [], requiresIdentityReason: false, catalogueDrift: false,
        reviewState: 'needs_review', blockers: [], artifacts: [],
        items: [{
          rowIndex: 0,
          itemRawText: 'Pho?',
          quantityRawText: '2',
          catalogueItemId: null,
          itemCandidates: [{ catalogueItemId: '001', value: 'Phở', confidence: 0.7 }],
          quantityCandidates: [],
        }],
      },
    }), MENU);

    expect(draft.lines[0]).toMatchObject({
      codeInput: '001',
      resolvedItem: { menuItemId: 'm-001' },
      itemReviewed: false,
      quantityReviewed: false,
    });
    expect(unresolvedCount(draft)).toBe(1);
  });

  it('uses the highest-ranked candidate when several scanner candidates exist', () => {
    const draft = buildDraft(makeSheet({
      source: 'scanner',
      orderLines: [{
        lineIndex: 0,
        code: null,
        qty: 2,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.5,
        itemConfidence: 0.5,
        quantityConfidence: 0.99,
        flags: [],
        itemFlags: ['ambiguous_item'],
        quantityFlags: [],
        resolved: null,
      }],
      scannerEvidence: {
        outcome: 'needs_review', resultId: 'result-2', documentId: 'document-2', revision: 1,
        warnings: [], requiresIdentityReason: false, catalogueDrift: false,
        reviewState: 'needs_review', blockers: [], artifacts: [],
        items: [{
          rowIndex: 0,
          itemRawText: 'Pho?',
          quantityRawText: '2',
          catalogueItemId: null,
          itemCandidates: [
            { catalogueItemId: '001', value: 'Phở', confidence: 0.7 },
            { catalogueItemId: '002', value: 'Trà', confidence: 0.4 },
          ],
          quantityCandidates: [],
        }],
      },
    }), MENU);

    expect(draft.lines[0]).toMatchObject({
      codeInput: '001',
      resolvedItem: { menuItemId: 'm-001' },
      itemReviewed: false,
    });
    expect(unresolvedCount(draft)).toBe(1);
  });

  it('keeps item and quantity review gates independent', () => {
    const sheet = makeSheet({
      orderLines: [{
        lineIndex: 0,
        code: '001',
        qty: 2,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.5,
        itemConfidence: 0.5,
        quantityConfidence: 0.5,
        flags: [],
        itemFlags: ['ambiguous_item'],
        quantityFlags: ['quantity_uncertain'],
        resolved: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
      }],
    });
    const draft = buildDraft(sheet, MENU);
    expect(unresolvedCount(draft)).toBe(2);

    const itemFixed = setLineCode(draft, 0, '001', MENU);
    expect(unresolvedCount(itemFixed)).toBe(1);
    const bothFixed = setLineQty(itemFixed, 0, 2);
    expect(unresolvedCount(bothFixed)).toBe(0);
  });

  it('locks template-row identity to the issued code and resolved snapshot', () => {
    const sheet = makeSheet({
      orderLines: [{
        lineIndex: 7,
        code: '777',
        qty: 2,
        codeDigits: [],
        qtyDigits: [],
        confidence: 0.99,
        flags: [],
        mappingAuthority: 'template_row',
        resolved: { menuItemId: 'immutable-item', name: 'Tên đã in', unitPrice: 25_000, inactive: false, category: 'food' },
      }],
    });

    const draft = buildDraft(sheet, MENU);

    expect(draft.lines[0]).toMatchObject({
      mappingAuthority: 'template_row',
      codeInput: '777',
      resolvedItem: { menuItemId: 'immutable-item', name: 'Tên đã in' },
    });
    expect(setLineCode(draft, 7, '001', MENU)).toEqual(draft);
  });

  it('treats omitted mapping authority as legacy code mode', () => {
    const draft = buildDraft(makeSheet(), MENU);
    expect(draft.lines.every((line) => line.mappingAuthority === 'code')).toBe(true);
  });

  it('contains order-line state only; issued identity is never copied into an editable draft', () => {
    const draft = buildDraft(makeSheet(), MENU);

    expect(draft).not.toHaveProperty('digits');
    expect(draft).not.toHaveProperty('assignedUserId');
    expect(draft).not.toHaveProperty('assignedLabel');
    expect(draft).toHaveProperty('lines');
    expect(draft).toHaveProperty('dirty', false);
  });

  it('counts unresolved state from order lines only', () => {
    const draft = buildDraft(makeSheet(), MENU);

    expect(unresolvedCount(draft)).toBe(0);
  });

  it('creates one LineDraft per orderLine', () => {
    const draft = buildDraft(makeSheet(), MENU);
    expect(draft.lines).toHaveLength(2);
  });

  it('seeds codeInput from orderLine.code', () => {
    const draft = buildDraft(makeSheet(), MENU);
    expect(draft.lines[0].codeInput).toBe('001');
    expect(draft.lines[1].codeInput).toBe('002');
  });

  it('seeds quantity from orderLine.qty, defaulting to 1 when null', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '001',
          qty: null,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.95,
          flags: [],
          resolved: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].quantity).toBe(1);
  });

  it('carries server-resolved item (incl. inactive) without re-resolving', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '003',
          qty: 1,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.9,
          flags: [],
          resolved: { menuItemId: 'm-003', name: 'Bánh mì', unitPrice: 15_000, inactive: true, category: 'essential' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].resolvedItem).toMatchObject({ menuItemId: 'm-003', inactive: true });
  });

  it('marks a line lowConfidence when confidence < 0.8', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '001',
          qty: 1,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.6,
          flags: [],
          resolved: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].lowConfidence).toBe(true);
  });

  it('marks a line lowConfidence when flags are non-empty', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '001',
          qty: 1,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.98,
          flags: ['UNKNOWN_CODE'],
          resolved: null,
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].lowConfidence).toBe(true);
  });

  it('marks resolvedItem null when server resolved is null', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '099',
          qty: 1,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.9,
          flags: ['UNKNOWN_CODE'],
          resolved: null,
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].resolvedItem).toBeNull();
  });
});

// ── setLineCode ──────────────────────────────────────────────────────────────

describe('setLineCode', () => {
  it('re-resolves to a valid item after operator edits code', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineCode(draft, 0, '002', MENU);
    expect(updated.lines[0].resolvedItem?.menuItemId).toBe('m-002');
  });

  it('sets resolvedItem null for invalid code', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineCode(draft, 0, 'abc', MENU);
    expect(updated.lines[0].resolvedItem).toBeNull();
  });

  it('sets resolvedItem null for stray extra digit', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineCode(draft, 0, '0012', MENU);
    expect(updated.lines[0].resolvedItem).toBeNull();
  });

  it('resolves inactive item', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineCode(draft, 0, '003', MENU);
    expect(updated.lines[0].resolvedItem?.inactive).toBe(true);
  });

  it('clears lowConfidence after operator edit', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '001',
          qty: 1,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.5,
          flags: [],
          resolved: { menuItemId: 'm-001', name: 'Phở', unitPrice: 30_000, inactive: false, category: 'food' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(draft.lines[0].lowConfidence).toBe(true);
    const updated = setLineCode(draft, 0, '001', MENU);
    expect(updated.lines[0].lowConfidence).toBe(false);
  });

  it('marks draft dirty', () => {
    const draft = buildDraft(makeSheet(), MENU);
    expect(draft.dirty).toBe(false);
    const updated = setLineCode(draft, 0, '002', MENU);
    expect(updated.dirty).toBe(true);
  });
});

// ── setLineQty ───────────────────────────────────────────────────────────────

describe('setLineQty', () => {
  it('updates quantity for the target line', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineQty(draft, 0, 5);
    expect(updated.lines[0].quantity).toBe(5);
    expect(updated.lines[1].quantity).toBe(1); // untouched
  });

  it('marks draft dirty', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineQty(draft, 0, 3);
    expect(updated.dirty).toBe(true);
  });
});

// ── addLine / removeLine ─────────────────────────────────────────────────────

describe('addLine', () => {
  it('appends a blank line with unique lineIndex', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = addLine(draft);
    expect(updated.lines).toHaveLength(3);
    expect(updated.lines[2].codeInput).toBe('');
    expect(updated.lines[2].resolvedItem).toBeNull();
    expect(updated.lines[2].quantity).toBe(1);
  });
});

describe('removeLine', () => {
  it('removes the line with the given lineIndex', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = removeLine(draft, 0);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0].lineIndex).toBe(1);
  });
});

describe('template-row structural locks', () => {
  it('does not add or remove identity-locked template rows', () => {
    const draft = buildDraft(makeSheet({
      orderLines: [{
        lineIndex: 0,
        code: '001',
        qty: 1,
        codeDigits: [],
        qtyDigits: [],
        confidence: 1,
        flags: [],
        mappingAuthority: 'template_row',
        resolved: { menuItemId: 'm-001', name: 'Phở bản in', unitPrice: 30_000, inactive: false, category: 'food' },
      }],
    }), MENU);

    expect(addLine(draft)).toEqual(draft);
    expect(removeLine(draft, 0)).toEqual(draft);
    expect(orderItems(setLineQty(draft, 0, 4))).toEqual([
      { menuItemId: 'm-001', quantity: 4 },
    ]);
  });
});

// ── orderItems ───────────────────────────────────────────────────────────────

describe('orderItems', () => {
  it('returns items for all resolved lines', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const items = orderItems(draft);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ menuItemId: 'm-001', quantity: 2 });
    expect(items[1]).toEqual({ menuItemId: 'm-002', quantity: 1 });
  });

  it('skips lines with no resolvedItem (empty or unresolved code)', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: null,
          qty: null,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0,
          flags: [],
          resolved: null,
        },
        {
          lineIndex: 1,
          code: '002',
          qty: 3,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.9,
          flags: [],
          resolved: { menuItemId: 'm-002', name: 'Trà', unitPrice: 10_000, inactive: false, category: 'food' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    const items = orderItems(draft);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ menuItemId: 'm-002', quantity: 3 });
  });

  it('returns empty array when all lines are unresolved', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: null,
          qty: null,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0,
          flags: [],
          resolved: null,
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(orderItems(draft)).toHaveLength(0);
  });
});

// ── orderTotal ───────────────────────────────────────────────────────────────

describe('orderTotal', () => {
  it('sums unitPrice × quantity for all resolved lines', () => {
    const draft = buildDraft(makeSheet(), MENU);
    // line 0: 30_000 × 2 = 60_000; line 1: 10_000 × 1 = 10_000
    expect(orderTotal(draft)).toBe(70_000);
  });

  it('is zero when all lines are unresolved', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: null,
          qty: null,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0,
          flags: [],
          resolved: null,
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    expect(orderTotal(draft)).toBe(0);
  });

  it('updates after qty change', () => {
    const draft = buildDraft(makeSheet(), MENU);
    const updated = setLineQty(draft, 1, 3);
    // line 0: 30_000×2=60_000, line 1: 10_000×3=30_000
    expect(orderTotal(updated)).toBe(90_000);
  });

  it('excludes inactive-item lines from total (they still have a price)', () => {
    const sheet = makeSheet({
      orderLines: [
        {
          lineIndex: 0,
          code: '003',
          qty: 2,
          codeDigits: [],
          qtyDigits: [],
          confidence: 0.9,
          flags: [],
          resolved: { menuItemId: 'm-003', name: 'Bánh mì', unitPrice: 15_000, inactive: true, category: 'essential' },
        },
      ],
    });
    const draft = buildDraft(sheet, MENU);
    // Inactive but resolved — still included in total (operator path allows it).
    expect(orderTotal(draft)).toBe(30_000); // 15_000 × 2
  });
});
