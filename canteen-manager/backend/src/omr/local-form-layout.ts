/**
 * local-form-layout.ts
 *
 * Pure layout math for A5 canteen order forms. No PDF dependencies.
 * All coordinates use top-left origin in PDF points (1 pt = 1/72 inch).
 */

import { CatalogRowInput } from './omr-client.service';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const BUBBLE_RADIUS = 3.5;
export const ROW_HEIGHT = 14;
export const DIGIT_BOX_SIZE = 16;

export const TITLE_FONT_SIZE = 11;
export const HEADER_FONT_SIZE = 7;
export const COL_HEADER_FONT_SIZE = 5;
export const ITEM_FONT_SIZE = 5.5;
export const CAT_HEADER_FONT_SIZE = 5.5;
export const INSTRUCTION_FONT_SIZE = 5;

export const CODE_ORDER_LINES = 15;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PageLayout {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  contentWidth: number;
  contentHeight: number;
}

export interface MarkRect { x: number; y: number; size: number }
export interface QrRegion { x: number; y: number; width: number; height: number }
export interface BubbleCoord { cx: number; cy: number; r: number }

// ---------------------------------------------------------------------------
// Full-list two-column categorized layout (portrait A5)
// ---------------------------------------------------------------------------

export interface FullListColumn {
  category: 'food' | 'essential';
  categoryLabel: string;
  x: number;
  width: number;
  rows: FullListRowCoord[];
}

export interface FullListRowCoord {
  rowIndex: number;
  y: number;
  codeX: number;
  nameX: number;
  nameMaxW: number;
  priceX: number;
  bubbles: BubbleCoord[];
}

export interface FullListFormLayout {
  headerHeight: number;
  instructionY: number;
  columns: [FullListColumn, FullListColumn];
  colHeaderLabels: { code: string; name: string; price: string; qtyNums: string[] };
}

// ---------------------------------------------------------------------------
// Code-mode layout
// ---------------------------------------------------------------------------

export interface DigitBoxCoord { x: number; y: number; size: number }

export interface CodeLineCoord {
  lineIndex: number;
  y: number;
  digitBoxes: DigitBoxCoord[];
  bubbles: BubbleCoord[];
}

export interface CodeLegendItem {
  rowIndex: number;
  code: string;
  label: string;
  y: number;
  codeX: number;
  labelX: number;
}

// ---------------------------------------------------------------------------
// Page dimensions
// ---------------------------------------------------------------------------

const PAPER: Record<string, { w: number; h: number }> = {
  A5_PORTRAIT:  { w: 419.53, h: 595.28 },
  A5_LANDSCAPE: { w: 595.28, h: 419.53 },
};

const MARK_SIZE = 6;
const MARK_INSET = 6;
const QR_SIZE = 48;
const MARGIN = 16;

/** Returns page layout. Full-list uses portrait; code uses portrait too. */
export function pageLayout(paperSize: string, _landscape = false): PageLayout {
  // Full-list now uses portrait A5 for more vertical space
  const key = 'A5_PORTRAIT';
  const { w, h } = PAPER[key]!;
  return {
    width: w, height: h,
    marginLeft: MARGIN, marginRight: MARGIN,
    marginTop: MARGIN, marginBottom: MARGIN,
    contentWidth: w - MARGIN * 2,
    contentHeight: h - MARGIN * 2,
  };
}

/** Four corner registration marks. */
export function registrationMarks(layout: PageLayout): MarkRect[] {
  const { width, height } = layout;
  return [
    { x: MARK_INSET, y: MARK_INSET, size: MARK_SIZE },
    { x: width - MARK_INSET - MARK_SIZE, y: MARK_INSET, size: MARK_SIZE },
    { x: MARK_INSET, y: height - MARK_INSET - MARK_SIZE, size: MARK_SIZE },
    { x: width - MARK_INSET - MARK_SIZE, y: height - MARK_INSET - MARK_SIZE, size: MARK_SIZE },
  ];
}

/** QR code region (top-right). */
export function qrRegion(layout: PageLayout): QrRegion {
  const inset = MARK_INSET + MARK_SIZE + 3;
  return { x: layout.width - inset - QR_SIZE, y: inset, width: QR_SIZE, height: QR_SIZE };
}

// ---------------------------------------------------------------------------
// Full-list two-column grid (portrait A5)
// ---------------------------------------------------------------------------

const FL_HEADER_HEIGHT = 52;
const FL_INSTRUCTION_HEIGHT = 10;
const FL_CAT_BAR_HEIGHT = 10;
const FL_COL_HEADER_HEIGHT = 9;
const FL_ROW_HEIGHT = 10.5;
const FL_COL_GAP = 6;
const FL_BUBBLE_SPACING = 8;
const FL_BUBBLE_R = 3.5;

/**
 * Computes the two-column categorized layout for the full-list form.
 * Food items in left column, essential items in right column.
 * Each column: category bar → column header → item rows with code | name | price | ○○○○○
 */
export function fullListFormLayout(
  layout: PageLayout,
  catalog: CatalogRowInput[],
): FullListFormLayout {
  const contentLeft = layout.marginLeft;
  const colWidth = (layout.contentWidth - FL_COL_GAP) / 2;
  const instructionY = layout.marginTop + FL_HEADER_HEIGHT;
  const bodyTop = instructionY + FL_INSTRUCTION_HEIGHT;

  // Split catalog by category (items have price field, category inferred from position:
  // even positions = food, odd = essential based on the MVP seed pattern).
  // Actually, we don't have category in CatalogRowInput. Split evenly into two columns.
  const half = Math.ceil(catalog.length / 2);
  const leftItems = catalog.slice(0, half);
  const rightItems = catalog.slice(half);

  function buildColumn(items: CatalogRowInput[], colX: number, category: 'food' | 'essential', label: string): FullListColumn {
    const rowsTop = bodyTop + FL_CAT_BAR_HEIGHT + FL_COL_HEADER_HEIGHT;

    // Column sub-layout: code(22pt) | name(flex) | price(28pt) | gap(8pt) | bubbles(5×8=40pt)
    const codeW = 22;
    const priceW = 28;
    const gapW = 8;
    const bubblesW = 5 * FL_BUBBLE_SPACING;
    const nameW = colWidth - codeW - priceW - gapW - bubblesW;

    const rows: FullListRowCoord[] = items.map((item, i) => {
      const y = rowsTop + i * FL_ROW_HEIGHT;
      const midY = y + FL_ROW_HEIGHT / 2;
      const bubblesStartX = colX + codeW + nameW + priceW + gapW;

      return {
        rowIndex: item.row_index,
        y,
        codeX: colX + 2,
        nameX: colX + codeW,
        nameMaxW: nameW - 2,
        priceX: colX + codeW + nameW + priceW - 2,
        bubbles: Array.from({ length: 5 }, (_, qi) => ({
          cx: bubblesStartX + qi * FL_BUBBLE_SPACING + FL_BUBBLE_SPACING / 2,
          cy: midY,
          r: FL_BUBBLE_R,
        })),
      };
    });

    return { category, categoryLabel: label, x: colX, width: colWidth, rows };
  }

  const leftCol = buildColumn(leftItems, contentLeft, 'food', 'THUC PHAM');
  const rightCol = buildColumn(rightItems, contentLeft + colWidth + FL_COL_GAP, 'essential', 'DO DUNG THIET YEU');

  return {
    headerHeight: FL_HEADER_HEIGHT,
    instructionY,
    columns: [leftCol, rightCol],
    colHeaderLabels: { code: 'Ma', name: 'Ten hang', price: 'Gia', qtyNums: ['1', '2', '3', '4', '5'] },
  };
}

// Re-export for ROI builder compatibility
export function fullListGrid(layout: PageLayout, catalog: CatalogRowInput[]): FullListRowCoord[] {
  const fl = fullListFormLayout(layout, catalog);
  return [...fl.columns[0].rows, ...fl.columns[1].rows];
}

// ---------------------------------------------------------------------------
// Code-mode grid (portrait A5)
// ---------------------------------------------------------------------------

const BUBBLE_SPACING = 16;

export function codeGrid(
  layout: PageLayout,
  catalog: CatalogRowInput[],
): { codeLines: CodeLineCoord[]; legend: CodeLegendItem[] } {
  const contentX = layout.marginLeft;
  const contentY = layout.marginTop + 90;
  const COLUMN_GAP = 12;

  const digitGroupWidth = 3 * DIGIT_BOX_SIZE + 2 * 2;
  const bubblesGroupWidth = 5 * BUBBLE_SPACING;
  const leftPanelWidth = digitGroupWidth + 8 + bubblesGroupWidth + 4;
  const rightPanelX = contentX + leftPanelWidth + COLUMN_GAP;
  const legendCodeColWidth = 28;
  const legendLabelX = rightPanelX + legendCodeColWidth + 4;

  const codeLines: CodeLineCoord[] = Array.from({ length: CODE_ORDER_LINES }, (_, lineIdx) => {
    const rowY = contentY + lineIdx * ROW_HEIGHT;
    const digitStartX = contentX;
    const digitBoxes: DigitBoxCoord[] = Array.from({ length: 3 }, (_, dIdx) => ({
      x: digitStartX + dIdx * (DIGIT_BOX_SIZE + 2),
      y: rowY + (ROW_HEIGHT - DIGIT_BOX_SIZE) / 2,
      size: DIGIT_BOX_SIZE,
    }));
    const bubblesStartX = contentX + digitGroupWidth + 8;
    const bubbles: BubbleCoord[] = Array.from({ length: 5 }, (_, qIdx) => ({
      cx: bubblesStartX + qIdx * BUBBLE_SPACING + BUBBLE_RADIUS,
      cy: rowY + ROW_HEIGHT / 2,
      r: BUBBLE_RADIUS,
    }));
    return { lineIndex: lineIdx, y: rowY, digitBoxes, bubbles };
  });

  const legend: CodeLegendItem[] = catalog.map((item, i) => ({
    rowIndex: item.row_index,
    code: item.code_snapshot,
    label: item.short_label,
    y: contentY + i * ROW_HEIGHT,
    codeX: rightPanelX,
    labelX: legendLabelX,
  }));

  return { codeLines, legend };
}

// Legacy exports
export const HEADER_HEIGHT = 90;
export const LABEL_FONT_SIZE = 9;
export const COLUMN_GAP = 12;
