import type { FullMenuItem, ItemCategory, OrderLineItemDto, QueueSheetItem } from '@/lib/types';

// Confidence bands match the ConfidenceChip thresholds so color cues stay in sync
// across the screen: >=0.95 high, >=0.80 medium, otherwise low.
export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(value: number): ConfidenceBand {
  const pct = value > 1 ? value : value * 100;
  if (pct >= 95) return 'high';
  if (pct >= 80) return 'medium';
  return 'low';
}

// One editable order line. codeInput holds what the operator typed (or the OMR
// decoded code). resolvedItem is null when codeInput is non-empty but cannot be
// matched to any menu item (active or inactive).
export interface LineDraft {
  lineIndex: number;
  mappingAuthority: 'code' | 'template_row';
  codeInput: string;
  resolvedItem: {
    menuItemId: string;
    name: string;
    unitPrice: number;
    inactive: boolean;
    category: ItemCategory;
  } | null;
  quantity: number;
  flags: string[];
  // true when the line had low OMR confidence or non-empty flags at build time;
  // reset to false after the operator explicitly edits code or qty.
  lowConfidence: boolean;
  edited: boolean;
  itemNeedsReview?: boolean;
  quantityNeedsReview?: boolean;
  itemReviewed?: boolean;
  quantityReviewed?: boolean;
}

// The full operator-editable draft for the sheet currently in focus.
export interface SheetDraft {
  lines: LineDraft[];
  dirty: boolean;
}

// Lines below this confidence threshold are marked low-confidence until the
// operator resolves them. Mirrors the ConfidenceChip "medium" floor (80%).
const LOW_CONFIDENCE_THRESHOLD = 0.8;

// Handwritten codes occupy exactly this many numeric digit boxes on the OMR form.
// This MUST match the backend resolver + form generator width (CODE_DIGIT_COUNT): if
// the printed box count ever changes and only one side is updated, the UI would resolve
// codes the backend rejects (or vice versa) — i.e. the displayed item would diverge from
// the debited item. Kept as a single named constant so that coupling is explicit.
const CODE_DIGIT_COUNT = 3;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_DIGIT_COUNT}}$`);

// Resolve a code string against the full menu (active + inactive) by exact string
// match. Resolution rules (mirrors backend authoritative resolver):
//   - code must be exactly 3 numeric digits (no leading/trailing space, no letters)
//   - must match exactly one stored menu item code
//   - stray extra digits → null (wrong width rejects cleanly, never hits another item)
//   - inactive items ARE resolvable on the OMR path
export function resolveCode(
  code: string,
  menuItems: FullMenuItem[],
): LineDraft['resolvedItem'] | null {
  if (!code || !CODE_PATTERN.test(code)) return null;
  const match = menuItems.find((m) => m.code === code);
  if (!match) return null;
  return {
    menuItemId: match.id,
    name: match.name,
    unitPrice: match.price,
    inactive: !match.isActive,
    category: match.category,
  };
}

function lineDraft(
  lineIndex: number,
  code: string | null,
  qty: number | null,
  resolved: QueueSheetItem['orderLines'][number]['resolved'],
  confidence: number,
  flags: string[],
  mappingAuthority: QueueSheetItem['orderLines'][number]['mappingAuthority'],
  itemConfidence?: number,
  quantityConfidence?: number,
  itemFlags?: string[],
  quantityFlags?: string[],
): LineDraft {
  const codeInput = code ?? '';
  // Carry the server-resolved item so inactive items are displayed correctly
  // even before the operator makes any edits.
  const resolvedItem = resolved
    ? {
        menuItemId: resolved.menuItemId,
        name: resolved.name,
        unitPrice: resolved.unitPrice,
        inactive: resolved.inactive,
        category: resolved.category,
      }
    : null;
  const independentReview = itemConfidence !== undefined || quantityConfidence !== undefined;
  const itemNeedsReview = independentReview
    ? (itemConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD || (itemFlags?.length ?? 0) > 0
    : undefined;
  const quantityNeedsReview = independentReview
    ? (quantityConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD || (quantityFlags?.length ?? 0) > 0
    : undefined;
  return {
    lineIndex,
    mappingAuthority: mappingAuthority === 'template_row' ? 'template_row' : 'code',
    codeInput,
    resolvedItem,
    quantity: qty ?? 1,
    flags,
    lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD || flags.length > 0,
    edited: false,
    itemNeedsReview,
    quantityNeedsReview,
    itemReviewed: independentReview ? false : undefined,
    quantityReviewed: independentReview ? false : undefined,
  };
}

// Build the initial draft from a queue sheet and the full menu. One LineDraft
// per orderLine entry; server-resolved items are seeded directly so inactive
// codes display correctly without a second resolve pass.
export function buildDraft(sheet: QueueSheetItem, menuItems: FullMenuItem[]): SheetDraft {
  const lines = sheet.orderLines.map((ol) => {
    const scannerItem = sheet.scannerEvidence?.items.find((item) => item.rowIndex === ol.lineIndex);
    const candidateCode = sheet.source === 'scanner' && !ol.code && !ol.resolved
      ? scannerItem?.itemCandidates[0]?.catalogueItemId ?? null
      : null;
    const autoSelectedItem = candidateCode ? resolveCode(candidateCode, menuItems) : null;

    const draftLine = lineDraft(
      ol.lineIndex,
      autoSelectedItem ? candidateCode : ol.code,
      ol.qty,
      autoSelectedItem ?? ol.resolved,
      ol.confidence,
      ol.flags,
      ol.mappingAuthority,
      ol.itemConfidence,
      ol.quantityConfidence,
      ol.itemFlags,
      ol.quantityFlags,
    );

    return draftLine;
  });
  return { lines, dirty: false };
}

// Refresh only server-owned menu metadata after a stale policy/catalog rejection. Operator
// inputs and workflow state remain untouched while price, category, name and active status are
// re-resolved from the new authoritative reference snapshot.
export function refreshDraftReferenceData(
  draft: SheetDraft,
  menuItems: FullMenuItem[],
): SheetDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => {
      if (line.mappingAuthority === 'code') {
        return { ...line, resolvedItem: resolveCode(line.codeInput, menuItems) };
      }

      const current = line.resolvedItem
        ? menuItems.find((item) => item.id === line.resolvedItem!.menuItemId)
        : undefined;
      return current && line.resolvedItem
        ? {
            ...line,
            resolvedItem: {
              ...line.resolvedItem,
              unitPrice: current.price,
              inactive: !current.isActive,
              category: current.category,
            },
          }
        : line;
    }),
  };
}

// Count of fields that still block a clean confirm: low-confidence/unreadable
// digits; unresolved lines (non-empty codeInput with no resolved item or flagged
// lines the operator has not touched).
export function unresolvedCount(draft: SheetDraft): number {
  return draft.lines.reduce((count, line) => {
    if (line.itemNeedsReview !== undefined || line.quantityNeedsReview !== undefined) {
      return count + Number(Boolean(line.itemNeedsReview && !line.itemReviewed)) +
        Number(Boolean(line.quantityNeedsReview && !line.quantityReviewed));
    }
    return count + Number(!line.edited && line.lowConfidence);
  }, 0);
}

export function lineHasUnresolvedReview(line: LineDraft): boolean {
  if (line.itemNeedsReview !== undefined || line.quantityNeedsReview !== undefined) {
    return Boolean(
      line.itemNeedsReview && !line.itemReviewed ||
      line.quantityNeedsReview && !line.quantityReviewed,
    );
  }
  return line.lowConfidence && !line.edited;
}

// Items to include in the confirm payload. Empty-code lines (no codeInput and no
// resolvedItem) are skipped. Lines with codeInput but no resolvedItem are included
// with a sentinel that will cause the parent to block confirm (operator must reconcile).
export function orderItems(draft: SheetDraft): OrderLineItemDto[] {
  return draft.lines
    .filter((l) => l.resolvedItem !== null)
    .map((l) => ({
      menuItemId: l.resolvedItem!.menuItemId,
      quantity: l.quantity,
    }));
}

// Integer-VND total of the order the operator is about to confirm.
// Σ unitPrice × quantity for all lines that have a resolved item.
export function orderTotal(draft: SheetDraft): number {
  return draft.lines.reduce(
    (sum, l) => (l.resolvedItem ? sum + l.resolvedItem.unitPrice * l.quantity : sum),
    0,
  );
}

// ── Immutable draft mutations ───────────────────────────────────────────────

// Re-resolve the code against the full menu after the operator edits a line.
export function setLineCode(
  draft: SheetDraft,
  lineIndex: number,
  codeInput: string,
  menuItems: FullMenuItem[],
): SheetDraft {
  const target = draft.lines.find((line) => line.lineIndex === lineIndex);
  if (target?.mappingAuthority === 'template_row') return draft;
  const resolvedItem = resolveCode(codeInput, menuItems);
  const lines = draft.lines.map((l) =>
    l.lineIndex === lineIndex
      ? l.itemNeedsReview !== undefined || l.quantityNeedsReview !== undefined
        ? {
            ...l,
            codeInput,
            resolvedItem,
            itemReviewed: true,
            edited: Boolean(!l.quantityNeedsReview || l.quantityReviewed),
          }
        : { ...l, codeInput, resolvedItem, lowConfidence: false, edited: true }
      : l,
  );
  return { ...draft, lines, dirty: true };
}

export function setLineQty(draft: SheetDraft, lineIndex: number, quantity: number): SheetDraft {
  const lines = draft.lines.map((l) =>
    l.lineIndex === lineIndex
      ? l.itemNeedsReview !== undefined || l.quantityNeedsReview !== undefined
        ? {
            ...l,
            quantity,
            quantityReviewed: true,
            edited: Boolean(!l.itemNeedsReview || l.itemReviewed),
          }
        : { ...l, quantity, lowConfidence: false, edited: true }
      : l,
  );
  return { ...draft, lines, dirty: true };
}

// Add a blank line at the end (operator manually adds an item).
export function addLine(draft: SheetDraft): SheetDraft {
  if (!draft.lines.some((line) => line.mappingAuthority === 'code')) return draft;
  const nextIndex = draft.lines.reduce((max, l) => Math.max(max, l.lineIndex), -1) + 1;
  const blank: LineDraft = {
    lineIndex: nextIndex,
    mappingAuthority: 'code',
    codeInput: '',
    resolvedItem: null,
    quantity: 1,
    flags: [],
    lowConfidence: false,
    edited: true,
  };
  return { ...draft, lines: [...draft.lines, blank], dirty: true };
}

export function removeLine(draft: SheetDraft, lineIndex: number): SheetDraft {
  const target = draft.lines.find((line) => line.lineIndex === lineIndex);
  if (target?.mappingAuthority === 'template_row') return draft;
  const lines = draft.lines.filter((l) => l.lineIndex !== lineIndex);
  return { ...draft, lines, dirty: true };
}
