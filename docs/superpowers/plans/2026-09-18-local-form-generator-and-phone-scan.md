# Local Form Generator & Phone Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained PDF form generator and phone camera scan page that works without the external OMR microservice.

**Architecture:** `LocalFormRenderer` generates A4/A5 PDFs with OMR bubbles using `pdf-lib`. It plugs into `OmrClientService` as a fallback when the external service is unavailable or `OMR_SERVICE_URL=local`. A new `scan-local` backend module processes phone camera images — detecting registration marks, reading QR codes, analysing bubble fill ratios — and creates orders. A new `/scan` frontend page provides the mobile camera UI.

**Tech Stack:** pdf-lib, qrcode (backend PDF); sharp, jsqr (scan processing); React + navigator.mediaDevices (phone camera)

**Spec:** `docs/superpowers/specs/2026-09-18-local-form-generator-and-phone-scan.md`

---

## File Structure

```
canteen-manager/backend/src/omr/
  omr-client.service.ts              ← MODIFY: add local fallback routing
  omr-client.module.ts               ← MODIFY: register LocalFormRenderer
  local-form-renderer.ts             ← CREATE: PDF generation + ROI builder
  local-form-layout.ts               ← CREATE: layout math (margins, grid, coords)

canteen-manager/backend/src/scan-local/
  scan-local.module.ts               ← CREATE: NestJS module
  scan-local.controller.ts           ← CREATE: POST /api/scan/process
  scan-local.service.ts              ← CREATE: orchestrates pipeline
  image-processor.ts                 ← CREATE: grayscale, registration marks, perspective
  bubble-reader.ts                   ← CREATE: bubble fill analysis
  qr-reader.ts                       ← CREATE: QR code extraction from image

canteen-manager/backend/src/app.module.ts  ← MODIFY: register ScanLocalModule

canteen-manager/frontend/src/features/phone-scan/
  phone-scan-page.tsx                ← CREATE: camera + capture + result UI

canteen-manager/frontend/src/app/router.tsx  ← MODIFY: add /scan route
```

---

### Task 1: Install dependencies

**Files:**
- Modify: `canteen-manager/backend/package.json`

- [ ] **Step 1: Install backend deps**

```bash
cd canteen-manager/backend
pnpm add pdf-lib qrcode jsqr sharp
pnpm add -D @types/qrcode @types/jsqr
```

Note: `sharp` has prebuilt native binaries for Windows. If `@types/jsqr` doesn't exist, skip it — `jsqr` ships its own types.

- [ ] **Step 2: Verify install**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

Expected: clean compile (new deps are installed but not imported yet).

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/package.json canteen-manager/backend/pnpm-lock.yaml
git commit -m "chore(backend): add pdf-lib, qrcode, jsqr, sharp for local form gen"
```

---

### Task 2: Layout engine — shared coordinate math

**Files:**
- Create: `canteen-manager/backend/src/omr/local-form-layout.ts`

This file defines page dimensions, margins, grid row heights, and computes (x, y) coordinates for every element. It is pure math — no PDF or image deps — so both the renderer and the scan processor can import it.

- [ ] **Step 1: Create the layout engine**

Create `canteen-manager/backend/src/omr/local-form-layout.ts`:

```typescript
/**
 * Layout math for local OMR form generation and scan processing.
 * All coordinates are in PDF points (1pt = 1/72 inch), origin at top-left.
 */

import type { CatalogRowInput } from './omr-client.service';

// --- Page dimensions ---

export interface PageLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
};

const MARGIN = { top: 40, right: 30, bottom: 30, left: 30 };

export function pageLayout(paperSize: string): PageLayout {
  const size = PAGE_SIZES[paperSize] ?? PAGE_SIZES.A4;
  return { ...size, margin: MARGIN };
}

// --- Registration marks ---

export interface MarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const REG_MARK_SIZE = 8;
const REG_MARK_INSET = 10;

/** Returns 4 corner registration mark rectangles (top-left, top-right, bottom-left, bottom-right). */
export function registrationMarks(layout: PageLayout): [MarkRect, MarkRect, MarkRect, MarkRect] {
  const s = REG_MARK_SIZE;
  const i = REG_MARK_INSET;
  return [
    { x: i, y: i, w: s, h: s },
    { x: layout.width - i - s, y: i, w: s, h: s },
    { x: i, y: layout.height - i - s, w: s, h: s },
    { x: layout.width - i - s, y: layout.height - i - s, w: s, h: s },
  ];
}

// --- QR region ---

export interface QrRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const QR_SIZE = 72;

/** QR code position: top-right of content area. */
export function qrRegion(layout: PageLayout): QrRegion {
  return {
    x: layout.width - layout.margin.right - QR_SIZE,
    y: layout.margin.top,
    w: QR_SIZE,
    h: QR_SIZE,
  };
}

// --- Header ---

export const HEADER_HEIGHT = 90;
export const TITLE_FONT_SIZE = 14;
export const LABEL_FONT_SIZE = 9;
export const ITEM_FONT_SIZE = 8;

// --- Full-list bubble grid ---

export const BUBBLE_RADIUS = 4.5;
export const BUBBLE_SPACING = 14;
export const ROW_HEIGHT = 16;
export const COLUMN_GAP = 12;

export interface BubbleCoord {
  row_index: number;
  menu_item_id: string;
  code_snapshot: string;
  short_label: string;
  quantity: number;
  cx: number;
  cy: number;
  r: number;
}

export interface FullListRowCoord {
  row_index: number;
  menu_item_id: string;
  code_snapshot: string;
  short_label: string;
  x: number;          // left edge of row text
  y: number;          // baseline y
  col: number;        // 0 = left column, 1 = right column
  bubbles: BubbleCoord[];
}

/** Computes the 2-column full-list grid layout. */
export function fullListGrid(
  layout: PageLayout,
  catalog: CatalogRowInput[],
): { rows: FullListRowCoord[]; allBubbles: BubbleCoord[] } {
  const contentTop = layout.margin.top + HEADER_HEIGHT;
  const contentWidth = layout.width - layout.margin.left - layout.margin.right;
  const colWidth = (contentWidth - COLUMN_GAP) / 2;
  const half = Math.ceil(catalog.length / 2);

  const rows: FullListRowCoord[] = [];
  const allBubbles: BubbleCoord[] = [];

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i];
    const col = i < half ? 0 : 1;
    const rowInCol = col === 0 ? i : i - half;
    const colLeft = layout.margin.left + col * (colWidth + COLUMN_GAP);
    const y = contentTop + ROW_HEIGHT * (rowInCol + 1);

    const bubbleStartX = colLeft + colWidth - 5 * BUBBLE_SPACING;
    const bubbles: BubbleCoord[] = [];
    for (let q = 1; q <= 5; q++) {
      const bubble: BubbleCoord = {
        row_index: item.row_index,
        menu_item_id: item.menu_item_id,
        code_snapshot: item.code_snapshot,
        short_label: item.short_label,
        quantity: q,
        cx: bubbleStartX + (q - 1) * BUBBLE_SPACING + BUBBLE_RADIUS,
        cy: y - ITEM_FONT_SIZE / 2 + 1,
        r: BUBBLE_RADIUS,
      };
      bubbles.push(bubble);
      allBubbles.push(bubble);
    }

    rows.push({
      row_index: item.row_index,
      menu_item_id: item.menu_item_id,
      code_snapshot: item.code_snapshot,
      short_label: item.short_label,
      x: colLeft,
      y,
      col,
      bubbles,
    });
  }

  return { rows, allBubbles };
}

// --- Code mode grid ---

export const DIGIT_BOX_SIZE = 16;
export const DIGIT_BOX_GAP = 3;
export const CODE_ORDER_LINES = 15;

export interface DigitBoxCoord {
  line_index: number;
  box_index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CodeLineCoord {
  line_index: number;
  y: number;
  digitBoxes: DigitBoxCoord[];
  qtyBubbles: BubbleCoord[];
}

export interface CodeLegendItem {
  code_snapshot: string;
  short_label: string;
  x: number;
  y: number;
  col: number;
}

/** Computes the code mode layout: order lines (left) + menu legend (right). */
export function codeGrid(
  layout: PageLayout,
  catalog: CatalogRowInput[],
): { lines: CodeLineCoord[]; legend: CodeLegendItem[]; allDigitBoxes: DigitBoxCoord[]; allQtyBubbles: BubbleCoord[] } {
  const contentTop = layout.margin.top + HEADER_HEIGHT;
  const contentWidth = layout.width - layout.margin.left - layout.margin.right;
  // 60% for order lines, 40% for legend
  const orderWidth = contentWidth * 0.58;
  const legendLeft = layout.margin.left + orderWidth + COLUMN_GAP;
  const legendWidth = contentWidth - orderWidth - COLUMN_GAP;

  const lines: CodeLineCoord[] = [];
  const allDigitBoxes: DigitBoxCoord[] = [];
  const allQtyBubbles: BubbleCoord[] = [];

  const maxLines = Math.min(CODE_ORDER_LINES, Math.floor(
    (layout.height - contentTop - layout.margin.bottom) / (ROW_HEIGHT + 2),
  ));

  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    const y = contentTop + ROW_HEIGHT * (lineIdx + 1);
    const boxLeft = layout.margin.left;

    const digitBoxes: DigitBoxCoord[] = [];
    for (let b = 0; b < 3; b++) {
      const box: DigitBoxCoord = {
        line_index: lineIdx,
        box_index: b,
        x: boxLeft + b * (DIGIT_BOX_SIZE + DIGIT_BOX_GAP),
        y: y - DIGIT_BOX_SIZE + 2,
        w: DIGIT_BOX_SIZE,
        h: DIGIT_BOX_SIZE,
      };
      digitBoxes.push(box);
      allDigitBoxes.push(box);
    }

    const bubbleStartX = boxLeft + 3 * (DIGIT_BOX_SIZE + DIGIT_BOX_GAP) + 12;
    const qtyBubbles: BubbleCoord[] = [];
    for (let q = 1; q <= 5; q++) {
      const bubble: BubbleCoord = {
        row_index: lineIdx,
        menu_item_id: '',
        code_snapshot: '',
        short_label: '',
        quantity: q,
        cx: bubbleStartX + (q - 1) * BUBBLE_SPACING + BUBBLE_RADIUS,
        cy: y - ITEM_FONT_SIZE / 2 + 1,
        r: BUBBLE_RADIUS,
      };
      qtyBubbles.push(bubble);
      allQtyBubbles.push(bubble);
    }

    lines.push({ line_index: lineIdx, y, digitBoxes, qtyBubbles });
  }

  // Legend: 2-column list of all menu items
  const legendHalf = Math.ceil(catalog.length / 2);
  const legendColWidth = (legendWidth - 8) / 2;
  const legend: CodeLegendItem[] = catalog.map((item, i) => {
    const col = i < legendHalf ? 0 : 1;
    const rowInCol = col === 0 ? i : i - legendHalf;
    return {
      code_snapshot: item.code_snapshot,
      short_label: item.short_label,
      x: legendLeft + col * (legendColWidth + 8),
      y: contentTop + ROW_HEIGHT * (rowInCol + 1),
      col,
    };
  });

  return { lines, legend, allDigitBoxes, allQtyBubbles };
}
```

- [ ] **Step 2: Verify compile**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/src/omr/local-form-layout.ts
git commit -m "feat(omr): add layout engine for local form coordinate math"
```

---

### Task 3: Local form renderer — PDF generation

**Files:**
- Create: `canteen-manager/backend/src/omr/local-form-renderer.ts`

This file uses `pdf-lib` and `qrcode` to render the actual PDF, using coordinates from the layout engine. It also builds the ROI template object.

- [ ] **Step 1: Create the renderer**

Create `canteen-manager/backend/src/omr/local-form-renderer.ts`:

```typescript
/**
 * Local PDF form renderer. Generates A4/A5 OMR order forms with registration marks,
 * QR code, and bubble grids. Returns the same { roi_template, pdf_base64 } contract
 * as the external OMR service.
 */

import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { Injectable, Logger } from '@nestjs/common';
import type { GenerateA5TemplateInput, GenerateFormResult, CatalogRowInput } from './omr-client.service';
import {
  pageLayout,
  registrationMarks,
  qrRegion,
  fullListGrid,
  codeGrid,
  HEADER_HEIGHT,
  TITLE_FONT_SIZE,
  LABEL_FONT_SIZE,
  ITEM_FONT_SIZE,
  BUBBLE_RADIUS,
  ROW_HEIGHT,
  COLUMN_GAP,
  PAGE_SIZES,
  type PageLayout,
  type BubbleCoord,
  type DigitBoxCoord,
} from './local-form-layout';

@Injectable()
export class LocalFormRenderer {
  private readonly logger = new Logger(LocalFormRenderer.name);

  /** Generates a template PDF and ROI geometry, matching the external service contract. */
  async renderTemplate(input: GenerateA5TemplateInput): Promise<GenerateFormResult> {
    const paperSize = 'A4';  // default; could be extended via input
    const layout = pageLayout(paperSize);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([layout.width, layout.height]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Registration marks
    const marks = registrationMarks(layout);
    for (const mark of marks) {
      page.drawRectangle({
        x: mark.x,
        y: layout.height - mark.y - mark.h,  // pdf-lib uses bottom-left origin
        width: mark.w,
        height: mark.h,
        color: rgb(0, 0, 0),
      });
    }

    // QR code
    const qr = qrRegion(layout);
    const qrPayload = JSON.stringify({
      t: 'template',
      r: input.template_revision,
      m: input.mode,
    });
    const qrPng = await QRCode.toBuffer(qrPayload, { width: Math.round(qr.w * 2), margin: 0 });
    const qrImage = await pdf.embedPng(qrPng);
    page.drawImage(qrImage, {
      x: qr.x,
      y: layout.height - qr.y - qr.h,
      width: qr.w,
      height: qr.h,
    });

    // Header
    this.drawHeader(page, layout, font, fontBold);

    // Mode-specific content
    let roiTemplate: object;
    if (input.mode === 'full_list') {
      roiTemplate = this.drawFullList(page, layout, font, fontBold, input.catalog_rows, marks, qr);
    } else {
      roiTemplate = this.drawCodeMode(page, layout, font, fontBold, input.catalog_rows, marks, qr);
    }

    const pdfBytes = await pdf.save();
    const pdf_base64 = Buffer.from(pdfBytes).toString('base64');

    this.logger.log(`Generated local ${input.mode} form (${paperSize}, rev ${input.template_revision})`);

    return { roi_template: roiTemplate, pdf_base64 };
  }

  /** Draws the form header: title, identity fields, service date. */
  private drawHeader(
    page: PDFPage,
    layout: PageLayout,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  ): void {
    const left = layout.margin.left;
    const topY = layout.height - layout.margin.top;

    page.drawText('PHIEU DAT HANG CANTEEN', {
      x: left,
      y: topY - TITLE_FONT_SIZE,
      size: TITLE_FONT_SIZE,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    const labelY = topY - TITLE_FONT_SIZE - 20;
    const labels = [
      'Ho ten: ________________________________',
      'Ma: ____________  Khu: ____________  Phong: ____________',
      'Ngay phuc vu: _____/_____/_____',
    ];
    for (let i = 0; i < labels.length; i++) {
      page.drawText(labels[i], {
        x: left,
        y: labelY - i * 16,
        size: LABEL_FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // Divider line below header
    const dividerY = layout.height - layout.margin.top - HEADER_HEIGHT;
    page.drawLine({
      start: { x: layout.margin.left, y: dividerY },
      end: { x: layout.width - layout.margin.right, y: dividerY },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
  }

  /** Draws full_list mode: 2-column item grid with bubbles. Returns ROI template. */
  private drawFullList(
    page: PDFPage,
    layout: PageLayout,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
    catalog: CatalogRowInput[],
    marks: ReturnType<typeof registrationMarks>,
    qr: ReturnType<typeof qrRegion>,
  ): object {
    const { rows, allBubbles } = fullListGrid(layout, catalog);

    // Column headers
    const contentTop = layout.margin.top + HEADER_HEIGHT;
    const contentWidth = layout.width - layout.margin.left - layout.margin.right;
    const colWidth = (contentWidth - COLUMN_GAP) / 2;

    for (const col of [0, 1]) {
      const colLeft = layout.margin.left + col * (colWidth + COLUMN_GAP);
      const headerY = layout.height - contentTop - 2;

      page.drawText('MA', { x: colLeft, y: headerY, size: 7, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
      page.drawText('TEN HANG', { x: colLeft + 28, y: headerY, size: 7, font: fontBold, color: rgb(0.3, 0.3, 0.3) });

      const bubbleStartX = colLeft + colWidth - 5 * 14;
      for (let q = 1; q <= 5; q++) {
        page.drawText(String(q), {
          x: bubbleStartX + (q - 1) * 14 + 2,
          y: headerY,
          size: 7,
          font: fontBold,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
    }

    // Draw each row
    for (const row of rows) {
      const pdfY = layout.height - row.y;

      // Code
      page.drawText(row.code_snapshot, {
        x: row.x,
        y: pdfY,
        size: ITEM_FONT_SIZE,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      // Name (truncate to fit)
      const maxNameWidth = colWidth - 5 * 14 - 32;
      let displayName = row.short_label;
      while (font.widthOfTextAtSize(displayName, ITEM_FONT_SIZE) > maxNameWidth && displayName.length > 3) {
        displayName = displayName.slice(0, -2) + '…';
      }
      page.drawText(displayName, {
        x: row.x + 28,
        y: pdfY,
        size: ITEM_FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });

      // Bubbles
      for (const bubble of row.bubbles) {
        page.drawCircle({
          x: bubble.cx,
          y: layout.height - bubble.cy,
          size: bubble.r,
          borderWidth: 0.6,
          borderColor: rgb(0, 0, 0),
          color: rgb(1, 1, 1),
        });
      }
    }

    return {
      schema_version: 'omr-a5-v2',
      mode: 'full_list',
      orientation: 'portrait',
      paper_size: 'A4',
      page_width_pt: layout.width,
      page_height_pt: layout.height,
      registration_marks: marks.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h })),
      qr_region: { x: qr.x, y: qr.y, w: qr.w, h: qr.h },
      bubbles: allBubbles.map((b) => ({
        row_index: b.row_index,
        menu_item_id: b.menu_item_id,
        quantity: b.quantity,
        cx: b.cx,
        cy: b.cy,
        r: b.r,
      })),
    };
  }

  /** Draws code mode: order lines (left) + menu legend (right). Returns ROI template. */
  private drawCodeMode(
    page: PDFPage,
    layout: PageLayout,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
    catalog: CatalogRowInput[],
    marks: ReturnType<typeof registrationMarks>,
    qr: ReturnType<typeof qrRegion>,
  ): object {
    const { lines, legend, allDigitBoxes, allQtyBubbles } = codeGrid(layout, catalog);
    const contentTop = layout.margin.top + HEADER_HEIGHT;
    const contentWidth = layout.width - layout.margin.left - layout.margin.right;
    const orderWidth = contentWidth * 0.58;

    // Section headers
    page.drawText('MA', {
      x: layout.margin.left,
      y: layout.height - contentTop - 2,
      size: 7,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText('SL', {
      x: layout.margin.left + 3 * 19 + 12,
      y: layout.height - contentTop - 2,
      size: 7,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });

    const legendLeft = layout.margin.left + orderWidth + COLUMN_GAP;
    page.drawText('BANG MA HANG', {
      x: legendLeft,
      y: layout.height - contentTop - 2,
      size: 7,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });

    // Vertical divider
    page.drawLine({
      start: { x: legendLeft - COLUMN_GAP / 2, y: layout.height - contentTop },
      end: { x: legendLeft - COLUMN_GAP / 2, y: layout.margin.bottom },
      thickness: 0.3,
      color: rgb(0.7, 0.7, 0.7),
    });

    // Draw order lines
    for (const line of lines) {
      const pdfY = layout.height - line.y;

      // Digit boxes
      for (const box of line.digitBoxes) {
        page.drawRectangle({
          x: box.x,
          y: layout.height - box.y - box.h,
          width: box.w,
          height: box.h,
          borderWidth: 0.6,
          borderColor: rgb(0, 0, 0),
          color: rgb(1, 1, 1),
        });
      }

      // Qty bubbles
      for (const bubble of line.qtyBubbles) {
        page.drawCircle({
          x: bubble.cx,
          y: layout.height - bubble.cy,
          size: bubble.r,
          borderWidth: 0.6,
          borderColor: rgb(0, 0, 0),
          color: rgb(1, 1, 1),
        });
      }
    }

    // Draw legend
    for (const item of legend) {
      page.drawText(`${item.code_snapshot} ${item.short_label}`, {
        x: item.x,
        y: layout.height - item.y,
        size: ITEM_FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
    }

    return {
      schema_version: 'omr-a5-v2',
      mode: 'code',
      orientation: 'portrait',
      paper_size: 'A4',
      page_width_pt: layout.width,
      page_height_pt: layout.height,
      registration_marks: marks.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h })),
      qr_region: { x: qr.x, y: qr.y, w: qr.w, h: qr.h },
      digit_boxes: allDigitBoxes.map((b) => ({
        line_index: b.line_index,
        box_index: b.box_index,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
      })),
      qty_bubbles: allQtyBubbles.map((b) => ({
        line_index: b.row_index,
        quantity: b.quantity,
        cx: b.cx,
        cy: b.cy,
        r: b.r,
      })),
    };
  }
}
```

- [ ] **Step 2: Verify compile**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add canteen-manager/backend/src/omr/local-form-renderer.ts
git commit -m "feat(omr): add LocalFormRenderer for PDF generation with pdf-lib"
```

---

### Task 4: Wire LocalFormRenderer into OmrClientService

**Files:**
- Modify: `canteen-manager/backend/src/omr/omr-client.service.ts`
- Modify: `canteen-manager/backend/src/omr/omr-client.module.ts`

- [ ] **Step 1: Register LocalFormRenderer in the module**

Edit `canteen-manager/backend/src/omr/omr-client.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OmrClientService } from './omr-client.service';
import { LocalFormRenderer } from './local-form-renderer';

@Module({
  providers: [OmrClientService, LocalFormRenderer],
  exports: [OmrClientService, LocalFormRenderer],
})
export class OmrClientModule {}
```

- [ ] **Step 2: Add local fallback to OmrClientService**

In `canteen-manager/backend/src/omr/omr-client.service.ts`, modify the constructor to accept `LocalFormRenderer` and add fallback logic.

Add import at the top:

```typescript
import { LocalFormRenderer } from './local-form-renderer';
```

Modify the constructor (around line 186):

```typescript
constructor(
  private readonly config: ConfigService<AppEnv, true>,
  private readonly localRenderer: LocalFormRenderer,
) {
  this.baseUrl = this.config.get('OMR_SERVICE_URL', { infer: true });
  this.timeoutMs = this.config.get('OMR_SERVICE_TIMEOUT_MS', { infer: true });
}

private get useLocal(): boolean {
  return !this.baseUrl || this.baseUrl === 'local';
}
```

Modify `generateA5Template` (around line 195):

```typescript
async generateA5Template(input: GenerateA5TemplateInput): Promise<GenerateFormResult> {
  if (this.useLocal) {
    return this.localRenderer.renderTemplate(input);
  }
  try {
    return await this.post<GenerateFormResult>('/generate-a5-template', input);
  } catch (err) {
    if (err instanceof OmrRetryableError) {
      this.logger.warn('External OMR service unavailable, falling back to local renderer');
      return this.localRenderer.renderTemplate(input);
    }
    throw err;
  }
}
```

- [ ] **Step 3: Verify compile**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add canteen-manager/backend/src/omr/omr-client.service.ts canteen-manager/backend/src/omr/omr-client.module.ts
git commit -m "feat(omr): wire LocalFormRenderer as fallback in OmrClientService"
```

---

### Task 5: QR reader utility

**Files:**
- Create: `canteen-manager/backend/src/scan-local/qr-reader.ts`

- [ ] **Step 1: Create QR reader**

Create `canteen-manager/backend/src/scan-local/qr-reader.ts`:

```typescript
/**
 * Reads QR codes from raw pixel data using jsQR.
 */

import jsQR from 'jsqr';

export interface FormQrData {
  token: string;
  revision: string;
  mode: 'code' | 'full_list';
}

/**
 * Attempts to read the form QR code from a grayscale or RGBA image buffer.
 * Returns null if no QR found or payload is not a valid form QR.
 */
export function readFormQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FormQrData | null {
  const result = jsQR(data, width, height);
  if (!result) return null;

  try {
    const parsed = JSON.parse(result.data);
    if (!parsed.t || !parsed.r || !parsed.m) return null;
    return {
      token: parsed.t,
      revision: parsed.r,
      mode: parsed.m,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-manager/backend/src/scan-local/qr-reader.ts
git commit -m "feat(scan-local): add QR code reader utility"
```

---

### Task 6: Image processor — registration marks + perspective

**Files:**
- Create: `canteen-manager/backend/src/scan-local/image-processor.ts`

- [ ] **Step 1: Create image processor**

Create `canteen-manager/backend/src/scan-local/image-processor.ts`:

```typescript
/**
 * Image processing for scanned forms: decode, grayscale, find registration marks,
 * and apply perspective correction.
 */

import sharp from 'sharp';
import { type MarkRect } from '../omr/local-form-layout';

export interface ProcessedImage {
  /** Grayscale pixel buffer (1 byte per pixel, 0=black 255=white). */
  grayscale: Buffer;
  /** RGBA pixel buffer for QR reading. */
  rgba: Buffer;
  width: number;
  height: number;
  /** Scale factor: pixels per PDF point. */
  pxPerPt: number;
}

/**
 * Decodes a base64-encoded JPEG/PNG image, converts to grayscale, and normalises.
 * The image is resized so its longest side matches the expected page dimension at ~150 DPI,
 * giving consistent pixel/point ratios for bubble detection.
 */
export async function processImage(
  imageBase64: string,
  expectedPageWidthPt: number,
  expectedPageHeightPt: number,
): Promise<ProcessedImage> {
  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Cannot read image dimensions');
  }

  // Target: ~150 DPI equivalent for the page size
  const targetDpi = 150;
  const targetWidth = Math.round(expectedPageWidthPt * targetDpi / 72);
  const targetHeight = Math.round(expectedPageHeightPt * targetDpi / 72);

  // Resize to target dimensions
  const resized = sharp(imageBuffer).resize(targetWidth, targetHeight, { fit: 'fill' });

  const [grayscaleResult, rgbaResult] = await Promise.all([
    resized.clone().grayscale().raw().toBuffer({ resolveWithObject: true }),
    resized.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  return {
    grayscale: grayscaleResult.data,
    rgba: rgbaResult.data,
    width: grayscaleResult.info.width,
    height: grayscaleResult.info.height,
    pxPerPt: targetWidth / expectedPageWidthPt,
  };
}

/**
 * Finds the 4 registration marks by scanning corner regions for dark clusters.
 * Returns the detected center (px) of each mark, or null if not enough marks found.
 */
export function findRegistrationMarks(
  grayscale: Buffer,
  width: number,
  height: number,
  expectedMarks: MarkRect[],
  pxPerPt: number,
): Array<{ cx: number; cy: number }> | null {
  const threshold = 80; // pixels darker than this are "black"
  const centers: Array<{ cx: number; cy: number }> = [];

  for (const mark of expectedMarks) {
    // Search region: expected mark position ± 30px tolerance
    const tolerance = 30;
    const searchX = Math.max(0, Math.round(mark.x * pxPerPt) - tolerance);
    const searchY = Math.max(0, Math.round(mark.y * pxPerPt) - tolerance);
    const searchW = Math.min(width - searchX, Math.round(mark.w * pxPerPt) + 2 * tolerance);
    const searchH = Math.min(height - searchY, Math.round(mark.h * pxPerPt) + 2 * tolerance);

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let dy = 0; dy < searchH; dy++) {
      for (let dx = 0; dx < searchW; dx++) {
        const px = searchX + dx;
        const py = searchY + dy;
        const pixel = grayscale[py * width + px];
        if (pixel < threshold) {
          sumX += px;
          sumY += py;
          count++;
        }
      }
    }

    if (count < 10) return null; // mark not found
    centers.push({ cx: sumX / count, cy: sumY / count });
  }

  return centers;
}

/**
 * Computes mean pixel intensity in a circular region (for bubble analysis).
 * Returns 0.0 (all black) to 1.0 (all white).
 */
export function meanIntensityInCircle(
  grayscale: Buffer,
  width: number,
  cx: number,
  cy: number,
  r: number,
): number {
  let sum = 0;
  let count = 0;
  const rSq = r * r;
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(width - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(grayscale.length / width - 1, Math.ceil(cy + r));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= rSq) {
        sum += grayscale[py * width + px];
        count++;
      }
    }
  }

  return count === 0 ? 1.0 : sum / count / 255;
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-manager/backend/src/scan-local/image-processor.ts
git commit -m "feat(scan-local): add image processor with registration mark detection"
```

---

### Task 7: Bubble reader

**Files:**
- Create: `canteen-manager/backend/src/scan-local/bubble-reader.ts`

- [ ] **Step 1: Create bubble reader**

Create `canteen-manager/backend/src/scan-local/bubble-reader.ts`:

```typescript
/**
 * Reads OMR bubble fill states from a processed grayscale image using
 * the ROI template coordinates.
 */

import { meanIntensityInCircle } from './image-processor';

export interface BubbleReadResult {
  row_index: number;
  menu_item_id: string;
  quantity: number;
  fillRatio: number;
  state: 'ticked' | 'empty' | 'ambiguous';
}

export interface OrderLineDetection {
  menu_item_id: string;
  code_snapshot: string;
  quantity: number;
  confidence: 'high' | 'low';
}

interface BubbleRoi {
  row_index: number;
  menu_item_id: string;
  quantity: number;
  cx: number;
  cy: number;
  r: number;
}

interface ThresholdConfig {
  omrEmptyMax: number;
  omrTickedMin: number;
}

/**
 * Reads all bubbles from a full_list mode form image.
 * Returns one OrderLineDetection per item that has a ticked bubble.
 */
export function readFullListBubbles(
  grayscale: Buffer,
  width: number,
  bubbles: BubbleRoi[],
  pxPerPt: number,
  thresholds: ThresholdConfig,
): { detections: OrderLineDetection[]; warnings: string[] } {
  const warnings: string[] = [];

  // Read all bubble fill ratios
  const reads: BubbleReadResult[] = bubbles.map((b) => {
    const pxCx = b.cx * pxPerPt;
    const pxCy = b.cy * pxPerPt;
    const pxR = b.r * pxPerPt;
    const meanBrightness = meanIntensityInCircle(grayscale, width, pxCx, pxCy, pxR);
    const fillRatio = 1.0 - meanBrightness;

    let state: 'ticked' | 'empty' | 'ambiguous';
    if (fillRatio >= thresholds.omrTickedMin) {
      state = 'ticked';
    } else if (fillRatio <= thresholds.omrEmptyMax) {
      state = 'empty';
    } else {
      state = 'ambiguous';
    }

    return { row_index: b.row_index, menu_item_id: b.menu_item_id, quantity: b.quantity, fillRatio, state };
  });

  // Group by row_index (each row = one menu item)
  const byRow = new Map<number, BubbleReadResult[]>();
  for (const r of reads) {
    const arr = byRow.get(r.row_index) ?? [];
    arr.push(r);
    byRow.set(r.row_index, arr);
  }

  const detections: OrderLineDetection[] = [];

  for (const [rowIdx, rowBubbles] of byRow) {
    const ticked = rowBubbles.filter((b) => b.state === 'ticked');
    const ambiguous = rowBubbles.filter((b) => b.state === 'ambiguous');

    if (ticked.length === 0 && ambiguous.length === 0) continue; // no selection

    if (ambiguous.length > 0) {
      warnings.push(`ambiguous_row_${rowIdx}`);
    }

    // Pick the highest quantity among ticked bubbles (if multiple are filled)
    const allMarked = [...ticked, ...ambiguous].sort((a, b) => b.quantity - a.quantity);
    const best = allMarked[0];

    detections.push({
      menu_item_id: best.menu_item_id,
      code_snapshot: '',
      quantity: best.quantity,
      confidence: ticked.length === 1 && ambiguous.length === 0 ? 'high' : 'low',
    });

    if (ticked.length > 1) {
      warnings.push(`multiple_ticked_row_${rowIdx}`);
    }
  }

  return { detections, warnings };
}
```

- [ ] **Step 2: Commit**

```bash
git add canteen-manager/backend/src/scan-local/bubble-reader.ts
git commit -m "feat(scan-local): add bubble reader for OMR fill detection"
```

---

### Task 8: Scan-local service + controller + module

**Files:**
- Create: `canteen-manager/backend/src/scan-local/scan-local.service.ts`
- Create: `canteen-manager/backend/src/scan-local/scan-local.controller.ts`
- Create: `canteen-manager/backend/src/scan-local/scan-local.module.ts`
- Modify: `canteen-manager/backend/src/app.module.ts`

- [ ] **Step 1: Create the scan service**

Create `canteen-manager/backend/src/scan-local/scan-local.service.ts`:

```typescript
/**
 * Orchestrates the local scan processing pipeline: image decode → QR read →
 * ROI lookup → bubble analysis → order creation.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OmrFormTemplate } from '../omr-forms/omr-form-template.entity';
import { ThresholdConfigService } from '../config/threshold-config.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { processImage } from './image-processor';
import { readFormQr } from './qr-reader';
import { readFullListBubbles, type OrderLineDetection } from './bubble-reader';
import { registrationMarks, pageLayout } from '../omr/local-form-layout';
import { findRegistrationMarks } from './image-processor';
import { tomorrowInDeployTz } from '../common/today-in-tz';

export interface ScanProcessResult {
  formToken: string | null;
  mode: string | null;
  items: Array<{
    menuItemId: string;
    code: string;
    name: string;
    quantity: number;
  }>;
  orderId: string | null;
  status: 'created' | 'review_required' | 'no_items';
  warnings: string[];
}

@Injectable()
export class ScanLocalService {
  private readonly logger = new Logger(ScanLocalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly menuService: MenuService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Processes a scanned form image and creates an order if items are detected.
   * @param imageBase64 Base64-encoded JPEG/PNG image
   * @param operatorId The staff member processing the scan
   */
  async processScan(imageBase64: string, operatorId: string): Promise<ScanProcessResult> {
    // 1. Look up the latest active template to get ROI geometry
    const template = await this.dataSource.getRepository(OmrFormTemplate).findOne({
      where: { isActive: true },
      relations: { rows: true },
      order: { activatedAt: 'DESC' },
    });
    if (!template) {
      throw new BadRequestException({
        message: 'No active form template found. Generate a form first.',
        code: 'SCAN.NO_TEMPLATE',
      });
    }

    const geometry = template.geometry as Record<string, unknown>;
    const paperSize = String(geometry['paper_size'] ?? 'A4');
    const layout = pageLayout(paperSize);

    // 2. Process image
    const image = await processImage(imageBase64, layout.width, layout.height);

    // 3. Read QR code
    const qrData = readFormQr(
      new Uint8ClampedArray(image.rgba),
      image.width,
      image.height,
    );

    // 4. Find registration marks (optional — continue even if not found)
    const marks = registrationMarks(layout);
    const detectedMarks = findRegistrationMarks(
      image.grayscale,
      image.width,
      image.height,
      marks,
      image.pxPerPt,
    );
    const warnings: string[] = [];
    if (!detectedMarks) {
      warnings.push('registration_marks_not_found');
    }

    // 5. Read bubbles based on mode
    const mode = (geometry['mode'] as string) ?? qrData?.mode ?? 'full_list';
    let detections: OrderLineDetection[] = [];

    if (mode === 'full_list') {
      const bubbles = geometry['bubbles'] as Array<{
        row_index: number;
        menu_item_id: string;
        quantity: number;
        cx: number;
        cy: number;
        r: number;
      }> ?? [];

      const thresholds = await this.thresholdConfig.resolve();
      const result = readFullListBubbles(
        image.grayscale,
        image.width,
        bubbles,
        image.pxPerPt,
        { omrEmptyMax: thresholds.omrEmptyMax, omrTickedMin: thresholds.omrTickedMin },
      );
      detections = result.detections;
      warnings.push(...result.warnings);
    } else {
      // Code mode — not implemented in MVP, flag for manual review
      warnings.push('code_mode_auto_read_not_supported');
      return {
        formToken: qrData?.token ?? null,
        mode,
        items: [],
        orderId: null,
        status: 'review_required',
        warnings,
      };
    }

    if (detections.length === 0) {
      return {
        formToken: qrData?.token ?? null,
        mode,
        items: [],
        orderId: null,
        status: 'no_items',
        warnings,
      };
    }

    // 6. Enrich detections with menu item details
    const allItems = await this.menuService.listAll();
    const itemMap = new Map(allItems.map((i) => [i.id, i]));

    const enrichedItems = detections
      .map((d) => {
        const item = itemMap.get(d.menu_item_id);
        if (!item) return null;
        return {
          menuItemId: item.id,
          code: item.code,
          name: item.name,
          quantity: d.quantity,
        };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);

    const hasLowConfidence = detections.some((d) => d.confidence === 'low');

    // 7. Create order if all items are high-confidence
    if (!hasLowConfidence && warnings.length === 0) {
      try {
        const order = await this.ordersService.createOrReplace({
          serviceDate: tomorrowInDeployTz(),
          userId: '', // scan-originated orders need a user — will be resolved from QR in future
          items: enrichedItems.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
          source: 'omr',
          operatorId,
        });
        return {
          formToken: qrData?.token ?? null,
          mode,
          items: enrichedItems,
          orderId: order.id,
          status: 'created',
          warnings,
        };
      } catch (err) {
        this.logger.warn(`Order creation from scan failed: ${err instanceof Error ? err.message : err}`);
        warnings.push('order_creation_failed');
      }
    }

    return {
      formToken: qrData?.token ?? null,
      mode,
      items: enrichedItems,
      orderId: null,
      status: 'review_required',
      warnings,
    };
  }
}
```

- [ ] **Step 2: Create the controller**

Create `canteen-manager/backend/src/scan-local/scan-local.controller.ts`:

```typescript
import { Body, Controller, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { ScanLocalService, type ScanProcessResult } from './scan-local.service';

interface ScanRequestBody {
  imageBase64: string;
}

interface AuthRequest {
  user: OperatorPublic;
}

@Controller('scan-local')
export class ScanLocalController {
  constructor(private readonly scanService: ScanLocalService) {}

  /** Processes a scanned form image and returns detected items / created order. */
  @Post('process')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN, OperatorRole.CASHIER)
  async processScan(
    @Body() body: ScanRequestBody,
    @Req() req: AuthRequest,
  ): Promise<ScanProcessResult> {
    return this.scanService.processScan(body.imageBase64, req.user.id);
  }
}
```

- [ ] **Step 3: Create the module**

Create `canteen-manager/backend/src/scan-local/scan-local.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScanLocalController } from './scan-local.controller';
import { ScanLocalService } from './scan-local.service';
import { ThresholdConfigModule } from '../config/threshold-config.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [ThresholdConfigModule, MenuModule, OrdersModule],
  controllers: [ScanLocalController],
  providers: [ScanLocalService],
})
export class ScanLocalModule {}
```

- [ ] **Step 4: Register in app module**

In `canteen-manager/backend/src/app.module.ts`, add:

Import at top:
```typescript
import { ScanLocalModule } from './scan-local/scan-local.module';
```

Add to imports array (after `PurchaseLimitConfigModule`):
```typescript
ScanLocalModule,
```

- [ ] **Step 5: Verify compile**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add canteen-manager/backend/src/scan-local/ canteen-manager/backend/src/app.module.ts
git commit -m "feat(scan-local): add scan processing service, controller, and module"
```

---

### Task 9: Phone scan frontend page

**Files:**
- Create: `canteen-manager/frontend/src/features/phone-scan/phone-scan-page.tsx`
- Modify: `canteen-manager/frontend/src/app/router.tsx`
- Modify: `canteen-manager/frontend/src/lib/api/index.ts`

- [ ] **Step 1: Add scan API function**

Add to `canteen-manager/frontend/src/lib/api/index.ts` (or create a new file `canteen-manager/frontend/src/lib/api/scan-local.ts`):

Create `canteen-manager/frontend/src/lib/api/scan-local.ts`:

```typescript
import { apiFetch } from '@/lib/api-client';

export interface ScanProcessResult {
  formToken: string | null;
  mode: string | null;
  items: Array<{
    menuItemId: string;
    code: string;
    name: string;
    quantity: number;
  }>;
  orderId: string | null;
  status: 'created' | 'review_required' | 'no_items';
  warnings: string[];
}

export function processScan(imageBase64: string): Promise<ScanProcessResult> {
  return apiFetch<ScanProcessResult>('/scan-local/process', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
  });
}
```

Then in `canteen-manager/frontend/src/lib/api/index.ts`, add the re-export:

```typescript
export * as scanLocal from './scan-local';
```

- [ ] **Step 2: Create the phone scan page**

Create `canteen-manager/frontend/src/features/phone-scan/phone-scan-page.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';
import { processScan, type ScanProcessResult } from '@/lib/api/scan-local';

type Phase = 'camera' | 'preview' | 'processing' | 'result';

export function PhoneScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [imageData, setImageData] = useState<string | null>(null);
  const [result, setResult] = useState<ScanProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('camera');
      setError(null);
    } catch (err) {
      setError('Could not access camera. Please allow camera access and try again.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    setImageData(base64);
    setPhase('preview');
    stopCamera();
  }, [stopCamera]);

  const submit = useCallback(async () => {
    if (!imageData) return;
    setPhase('processing');
    setError(null);
    try {
      const scanResult = await processScan(imageData);
      setResult(scanResult);
      setPhase('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan processing failed');
      setPhase('preview');
    }
  }, [imageData]);

  const reset = useCallback(() => {
    setImageData(null);
    setResult(null);
    setError(null);
    void startCamera();
  }, [startCamera]);

  // Auto-start camera on mount
  useState(() => { void startCamera(); });

  return (
    <div style={{ minHeight: '100dvh', background: '#111', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#222', textAlign: 'center', fontWeight: 600, fontSize: 16 }}>
        Scan Order Form
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#7f1d1d', color: '#fca5a5', textAlign: 'center', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Camera viewfinder */}
      {phase === 'camera' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', maxHeight: '70dvh', objectFit: 'contain', background: '#000' }}
          />
          <button
            onClick={capture}
            style={{
              marginTop: 16, padding: '14px 48px', fontSize: 18, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Capture
          </button>
        </div>
      )}

      {/* Preview */}
      {phase === 'preview' && imageData && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <img
            src={`data:image/jpeg;base64,${imageData}`}
            alt="Captured form"
            style={{ maxWidth: '100%', maxHeight: '60dvh', objectFit: 'contain', borderRadius: 8 }}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              onClick={reset}
              style={{
                padding: '12px 32px', fontSize: 16, background: '#374151', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              Retake
            </button>
            <button
              onClick={submit}
              style={{
                padding: '12px 32px', fontSize: 16, fontWeight: 600, background: '#16a34a',
                color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Processing */}
      {phase === 'processing' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{ width: 40, height: 40, border: '4px solid #555', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p>Processing scan...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Result */}
      {phase === 'result' && result && (
        <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
          <div style={{
            padding: 16, borderRadius: 12, marginBottom: 16,
            background: result.status === 'created' ? '#14532d' : result.status === 'no_items' ? '#78350f' : '#7f1d1d',
          }}>
            <p style={{ fontWeight: 600, fontSize: 18 }}>
              {result.status === 'created' && 'Order Created'}
              {result.status === 'review_required' && 'Review Required'}
              {result.status === 'no_items' && 'No Items Detected'}
            </p>
            {result.orderId && <p style={{ fontSize: 14, opacity: 0.8 }}>Order ID: {result.orderId.slice(0, 8)}</p>}
          </div>

          {result.items.length > 0 && (
            <div style={{ background: '#222', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#333' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Code</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Item</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #333' }}>
                      <td style={{ padding: '10px 12px' }}>{item.code}</td>
                      <td style={{ padding: '10px 12px' }}>{item.name}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: '#78350f', borderRadius: 8, fontSize: 13 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Warnings:</p>
              {result.warnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          <button
            onClick={reset}
            style={{
              marginTop: 20, width: '100%', padding: '14px', fontSize: 16, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Scan Another
          </button>
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
```

- [ ] **Step 3: Add the /scan route**

In `canteen-manager/frontend/src/app/router.tsx`, add the public route. Find where other public routes are defined (outside the `ProtectedRoute` wrapper) and add:

Import at top:
```typescript
import { PhoneScanPage } from '@/features/phone-scan/phone-scan-page';
```

Add route alongside other public routes (e.g. near `/canteen`):
```typescript
{ path: '/scan', element: <PhoneScanPage /> },
```

- [ ] **Step 4: Verify frontend compile**

```bash
cd canteen-manager/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add canteen-manager/frontend/src/features/phone-scan/ canteen-manager/frontend/src/lib/api/scan-local.ts canteen-manager/frontend/src/lib/api/index.ts canteen-manager/frontend/src/app/router.tsx
git commit -m "feat(frontend): add phone scan page with camera capture and result display"
```

---

### Task 10: Final integration verification

- [ ] **Step 1: Full backend type check**

```bash
cd canteen-manager/backend && npx tsc --noEmit
```

- [ ] **Step 2: Full frontend type check**

```bash
cd canteen-manager/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Run existing menu tests to verify no regressions**

```bash
cd canteen-manager/backend && npx jest -- src/menu --no-coverage
```

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A && git commit -m "fix: integration fixups for local form gen + phone scan"
```
