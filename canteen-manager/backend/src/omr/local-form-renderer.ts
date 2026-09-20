/**
 * local-form-renderer.ts
 *
 * Generates A5 canteen order-form PDFs using pdf-lib + qrcode.
 *   - full_list: Portrait A5 — two-column categorized table (food left | essential right)
 *   - code:      Portrait A5 — digit boxes + qty bubbles left, menu legend right
 *
 * Coordinate note: layout = top-left origin; pdf-lib = bottom-left.
 * Convert: pdfY = pageHeight - topY
 */

import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, grayscale, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as QRCode from 'qrcode';

import {
  CatalogRowInput,
  GenerateA5TemplateInput,
  GenerateFormResult,
} from './omr-client.service';

import {
  pageLayout, registrationMarks, qrRegion,
  fullListFormLayout, fullListGrid, codeGrid,
  TITLE_FONT_SIZE, HEADER_FONT_SIZE, COL_HEADER_FONT_SIZE,
  ITEM_FONT_SIZE, CAT_HEADER_FONT_SIZE, INSTRUCTION_FONT_SIZE,
  BUBBLE_RADIUS, ROW_HEIGHT, DIGIT_BOX_SIZE,
  type PageLayout, type FullListColumn, type FullListFormLayout,
} from './local-form-layout';

// Colors
const BLACK = grayscale(0);
const WHITE = grayscale(1);
const GREY_ROW = grayscale(0.95);
const GREY_LINE = grayscale(0.85);
const GREY_TEXT = grayscale(0.45);
const GREY_PRICE = grayscale(0.5);
const COL_HEADER_BG = grayscale(0.95);
const CAT_FOOD_COLOR = rgb(0.83, 0.33, 0);
const CAT_ESSENTIAL_COLOR = rgb(0.14, 0.44, 0.64);
const CODE_RED = rgb(0.75, 0.22, 0.17);

// Font resolution
const FONT_PATHS = [
  'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/ARIAL.TTF',
  '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];
const BOLD_PATHS = [
  'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/ARIALBD.TTF',
  '/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

/** Returns first existing path or null. */
function findFont(paths: string[]): string | null {
  for (const p of paths) { try { if (fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

/** Strip diacritics for WinAnsi fallback. */
function stripDiacritics(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

@Injectable()
export class LocalFormRendererService {
  private readonly logger = new Logger(LocalFormRendererService.name);
  private unicode = false;

  /** Renders an A5 form PDF for either mode. */
  async renderTemplate(input: GenerateA5TemplateInput): Promise<GenerateFormResult> {
    const layout = pageLayout('A5');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([layout.width, layout.height]);
    const { font, bold } = await this.loadFonts(pdf);

    this.drawMarks(page, layout);
    await this.drawQr(pdf, page, layout, input.template_revision, input.mode);

    if (input.mode === 'full_list') {
      this.renderFullList(page, layout, font, bold, input);
    } else {
      this.renderCode(page, layout, font, bold, input);
    }

    return {
      pdf_base64: await pdf.saveAsBase64(),
      roi_template: this.buildRoi(layout, input),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL-LIST — Portrait A5, two-column categorized
  // ═══════════════════════════════════════════════════════════════════════════

  private renderFullList(
    page: PDFPage, layout: PageLayout,
    font: PDFFont, bold: PDFFont,
    input: GenerateA5TemplateInput,
  ): void {
    const H = layout.height;
    const fl = fullListFormLayout(layout, input.catalog_rows);

    // ── Title ──
    const cx = layout.marginLeft + layout.contentWidth / 2;
    const title = this.t('PHIEU DAT HANG CANTEEN');
    const tw = bold.widthOfTextAtSize(title, TITLE_FONT_SIZE);
    page.drawText(title, { x: cx - tw / 2, y: H - layout.marginTop - TITLE_FONT_SIZE - 2, size: TITLE_FONT_SIZE, font: bold, color: BLACK });

    // ── Identity fields ──
    const r1y = H - layout.marginTop - TITLE_FONT_SIZE - 18;
    const r2y = r1y - 14;
    this.labelLine(page, font, this.t('Ho ten:'), layout.marginLeft, r1y, 110);
    this.labelLine(page, font, this.t('So tu:'), layout.marginLeft + 150, r1y, 60);
    this.labelLine(page, font, this.t('Buong:'), layout.marginLeft, r2y, 70);
    this.labelLine(page, font, this.t('Ngay:'), layout.marginLeft + 150, r2y, 60);

    // ── Instruction ──
    const instrText = this.t('To kin mot o tron cho moi phan can mua (toi da 5). Khong tay xoa.');
    const instrW = font.widthOfTextAtSize(instrText, INSTRUCTION_FONT_SIZE);
    page.drawText(instrText, {
      x: cx - instrW / 2, y: H - fl.instructionY - INSTRUCTION_FONT_SIZE,
      size: INSTRUCTION_FONT_SIZE, font, color: GREY_TEXT,
    });

    // ── Columns ──
    for (const col of fl.columns) {
      this.drawColumn(page, H, font, bold, col, fl, input.catalog_rows);
    }

    // ── Dashed divider ──
    const divX = fl.columns[0].x + fl.columns[0].width + 3;
    const divTop = fl.instructionY + 10;
    const divBot = layout.height - layout.marginBottom;
    for (let y = divTop; y < divBot; y += 4) {
      page.drawLine({
        start: { x: divX, y: H - y },
        end: { x: divX, y: H - Math.min(y + 2, divBot) },
        thickness: 0.3, color: GREY_LINE,
      });
    }
  }

  /** Draws one column: category bar → column headers → item rows. */
  private drawColumn(
    page: PDFPage, H: number,
    font: PDFFont, bold: PDFFont,
    col: FullListColumn,
    fl: FullListFormLayout,
    catalog: CatalogRowInput[],
  ): void {
    const bodyTop = fl.instructionY + 10;

    // Category bar
    const catColor = col.category === 'food' ? CAT_FOOD_COLOR : CAT_ESSENTIAL_COLOR;
    const catBarH = 10;
    page.drawRectangle({ x: col.x, y: H - bodyTop - catBarH, width: col.width, height: catBarH, color: catColor });
    const catLabel = this.t(col.categoryLabel) + ` (${col.rows.length})`;
    page.drawText(catLabel, { x: col.x + 3, y: H - bodyTop - catBarH + 3, size: CAT_HEADER_FONT_SIZE, font: bold, color: WHITE });

    // Column header
    const colHdrY = bodyTop + catBarH;
    const colHdrH = 8;
    page.drawRectangle({ x: col.x, y: H - colHdrY - colHdrH, width: col.width, height: colHdrH, color: COL_HEADER_BG });
    const hdrTxtY = H - colHdrY - colHdrH + 2.5;
    if (col.rows.length > 0) {
      const r0 = col.rows[0];
      page.drawText(fl.colHeaderLabels.code, { x: r0.codeX, y: hdrTxtY, size: COL_HEADER_FONT_SIZE, font: bold, color: GREY_TEXT });
      page.drawText(this.t(fl.colHeaderLabels.name), { x: r0.nameX, y: hdrTxtY, size: COL_HEADER_FONT_SIZE, font: bold, color: GREY_TEXT });
      const phw = bold.widthOfTextAtSize(fl.colHeaderLabels.price, COL_HEADER_FONT_SIZE);
      page.drawText(fl.colHeaderLabels.price, { x: r0.priceX - phw, y: hdrTxtY, size: COL_HEADER_FONT_SIZE, font: bold, color: GREY_TEXT });
      for (let qi = 0; qi < 5; qi++) {
        const lbl = fl.colHeaderLabels.qtyNums[qi];
        const lw = bold.widthOfTextAtSize(lbl, COL_HEADER_FONT_SIZE);
        page.drawText(lbl, { x: r0.bubbles[qi].cx - lw / 2, y: hdrTxtY, size: COL_HEADER_FONT_SIZE, font: bold, color: GREY_TEXT });
      }
    }

    // Item rows
    const catalogMap = new Map(catalog.map((c) => [c.row_index, c]));
    const rowH = 10.5;
    for (let i = 0; i < col.rows.length; i++) {
      const row = col.rows[i];
      const pdfTop = H - row.y;
      const cat = catalogMap.get(row.rowIndex);

      // Alternating bg
      if (i % 2 === 0) {
        page.drawRectangle({ x: col.x, y: pdfTop - rowH, width: col.width, height: rowH, color: GREY_ROW });
      }

      const txtY = pdfTop - rowH + 3;

      // Code
      page.drawText(cat?.code_snapshot ?? '', { x: row.codeX, y: txtY, size: ITEM_FONT_SIZE, font: bold, color: CODE_RED });

      // Name (wraps if long)
      page.drawText(this.t(cat?.short_label ?? ''), { x: row.nameX, y: txtY, size: ITEM_FONT_SIZE, font, color: BLACK, maxWidth: row.nameMaxW });

      // Price right-aligned
      const priceStr = cat?.price ? `${Math.round(cat.price / 1000)}k` : '';
      const pw = font.widthOfTextAtSize(priceStr, ITEM_FONT_SIZE);
      page.drawText(priceStr, { x: row.priceX - pw, y: txtY, size: ITEM_FONT_SIZE, font, color: GREY_PRICE });

      // Bubbles — fixed size
      for (const b of row.bubbles) {
        page.drawCircle({ x: b.cx, y: H - b.cy, size: b.r, color: WHITE, borderColor: BLACK, borderWidth: 0.6 });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CODE MODE
  // ═══════════════════════════════════════════════════════════════════════════

  private renderCode(page: PDFPage, layout: PageLayout, font: PDFFont, bold: PDFFont, input: GenerateA5TemplateInput): void {
    const H = layout.height;
    const { codeLines, legend } = codeGrid(layout, input.catalog_rows);
    this.drawCodeHeader(page, layout, font, bold, input);

    const first = codeLines[0];
    if (first) {
      const hy = H - (first.y - ROW_HEIGHT) - 7;
      page.drawText(this.t('Ma'), { x: first.digitBoxes[0]?.x ?? layout.marginLeft, y: hy, size: 8, font: bold, color: BLACK });
      page.drawText('SL (1-5)', { x: first.bubbles[0]?.cx ?? layout.marginLeft + 60, y: hy, size: 8, font: bold, color: BLACK });
    }
    for (const line of codeLines) {
      const ry = H - line.y;
      if (line.lineIndex % 2 === 0) {
        page.drawRectangle({ x: layout.marginLeft, y: ry - ROW_HEIGHT, width: layout.contentWidth / 2, height: ROW_HEIGHT, color: GREY_ROW, borderWidth: 0 });
      }
      for (const box of line.digitBoxes) {
        page.drawSquare({ x: box.x, y: ry - box.size - (ROW_HEIGHT - box.size) / 2, size: DIGIT_BOX_SIZE, color: WHITE, borderColor: BLACK, borderWidth: 0.5 });
      }
      for (const b of line.bubbles) {
        page.drawCircle({ x: b.cx, y: H - b.cy, size: b.r, color: WHITE, borderColor: BLACK, borderWidth: 0.6 });
      }
    }
    if (legend.length > 0 && legend[0]) {
      const hy = H - (legend[0].y - ROW_HEIGHT) - 7;
      page.drawText(this.t('Ma'), { x: legend[0].codeX, y: hy, size: 8, font: bold, color: BLACK });
      page.drawText(this.t('Mon an'), { x: legend[0].labelX, y: hy, size: 8, font: bold, color: BLACK });
    }
    for (const item of legend) {
      const ry = H - item.y - ITEM_FONT_SIZE;
      page.drawText(item.code, { x: item.codeX, y: ry, size: ITEM_FONT_SIZE, font, color: BLACK });
      page.drawText(this.t(item.label), { x: item.labelX, y: ry, size: ITEM_FONT_SIZE, font, color: BLACK, maxWidth: 100 });
    }
  }

  private drawCodeHeader(page: PDFPage, layout: PageLayout, font: PDFFont, bold: PDFFont, input: GenerateA5TemplateInput): void {
    const { marginLeft, marginTop, contentWidth, height } = layout;
    const cx = marginLeft + contentWidth / 2;
    const title = this.t('PHIEU DAT HANG CANTEEN');
    const tw = bold.widthOfTextAtSize(title, 14);
    page.drawText(title, { x: cx - tw / 2, y: height - marginTop - 16, size: 14, font: bold, color: BLACK });
    const sub = `${input.mode.toUpperCase()} | Rev: ${input.template_revision}`;
    const sw = font.widthOfTextAtSize(sub, 9);
    page.drawText(sub, { x: cx - sw / 2, y: height - marginTop - 28, size: 9, font, color: BLACK });
    this.labelLine(page, font, this.t('Ho ten:'), marginLeft, height - marginTop - 56, 130);
    this.labelLine(page, font, this.t('So tu:'), marginLeft + 140, height - marginTop - 56, 80);
    this.labelLine(page, font, this.t('Buong/Phong:'), marginLeft, height - marginTop - 74, 60);
    this.labelLine(page, font, this.t('Ngay phuc vu:'), marginLeft + 140, height - marginTop - 74, 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Shared
  // ═══════════════════════════════════════════════════════════════════════════

  private drawMarks(page: PDFPage, layout: PageLayout): void {
    for (const m of registrationMarks(layout)) page.drawSquare({ x: m.x, y: layout.height - m.y - m.size, size: m.size, color: BLACK });
  }

  private async drawQr(pdf: PDFDocument, page: PDFPage, layout: PageLayout, revision: string, mode: string): Promise<void> {
    const region = qrRegion(layout);
    const buf = await QRCode.toBuffer(JSON.stringify({ t: 'template', r: revision, m: mode }), { width: region.width, margin: 0 });
    page.drawImage(await pdf.embedPng(buf), { x: region.x, y: layout.height - region.y - region.height, width: region.width, height: region.height });
  }

  private labelLine(page: PDFPage, font: PDFFont, label: string, x: number, y: number, lineW: number): void {
    page.drawText(label, { x, y: y + 2, size: HEADER_FONT_SIZE, font, color: BLACK });
    const lw = font.widthOfTextAtSize(label, HEADER_FONT_SIZE) + 3;
    page.drawLine({ start: { x: x + lw, y }, end: { x: x + lw + lineW, y }, thickness: 0.5, color: BLACK });
  }

  private t(text: string): string { return this.unicode ? text : stripDiacritics(text); }

  private async loadFonts(pdf: PDFDocument): Promise<{ font: PDFFont; bold: PDFFont }> {
    const fp = findFont(FONT_PATHS);
    const bp = findFont(BOLD_PATHS);
    if (fp) {
      try {
        pdf.registerFontkit(fontkit);
        const font = await pdf.embedFont(fs.readFileSync(fp), { subset: true });
        const bold = bp ? await pdf.embedFont(fs.readFileSync(bp), { subset: true }) : font;
        this.unicode = true;
        return { font, bold };
      } catch (err) { this.logger.warn(`Font embed failed: ${err}`); }
    }
    this.unicode = false;
    return { font: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  }

  private buildRoi(layout: PageLayout, input: GenerateA5TemplateInput): object {
    const marks = registrationMarks(layout);
    const qr = qrRegion(layout);
    const orientation = input.mode === 'full_list' ? 'landscape' : 'portrait';
    let body: object;
    if (input.mode === 'full_list') {
      const rows = fullListGrid(layout, input.catalog_rows);
      body = { type: 'full_list', rows: rows.map((r) => ({ row_index: r.rowIndex, bubbles: r.bubbles.map((b) => ({ cx: b.cx, cy: b.cy, r: b.r })) })) };
    } else {
      const { codeLines } = codeGrid(layout, input.catalog_rows);
      body = { type: 'code', order_lines: codeLines.map((l) => ({ line_index: l.lineIndex, digit_boxes: l.digitBoxes.map((b) => ({ x: b.x, y: b.y, w: b.size, h: b.size })), qty_bubbles: l.bubbles.map((b) => ({ cx: b.cx, cy: b.cy, r: b.r })) })) };
    }
    return { schema_version: 'omr-a5-v2', paper_size: 'A5', orientation, page: { width: layout.width, height: layout.height }, registration_marks: marks.map((m) => ({ x: m.x, y: m.y, size: m.size })), qr_region: { x: qr.x, y: qr.y, width: qr.width, height: qr.height }, template_revision: input.template_revision, mode: input.mode, body };
  }
}
