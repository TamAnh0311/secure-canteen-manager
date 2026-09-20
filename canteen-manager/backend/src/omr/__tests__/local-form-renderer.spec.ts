/**
 * local-form-renderer.spec.ts
 *
 * Integration tests for LocalFormRendererService.
 * Verifies that the renderer produces a valid PDF and a correctly shaped
 * ROI template for both 'code' and 'full_list' modes.
 */

import { LocalFormRendererService } from '../local-form-renderer';
import type { GenerateA5TemplateInput, CatalogRowInput } from '../omr-client.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATALOG_ROWS: CatalogRowInput[] = [
  { row_index: 0, menu_item_id: 'item-1', code_snapshot: '001', short_label: 'Com trang' },
  { row_index: 1, menu_item_id: 'item-2', code_snapshot: '002', short_label: 'Pho bo' },
];

function makeInput(mode: GenerateA5TemplateInput['mode']): GenerateA5TemplateInput {
  return {
    mode,
    template_revision: 'rev-test-1',
    catalog_rows: mode === 'full_list' ? CATALOG_ROWS : [],
  };
}

// ---------------------------------------------------------------------------
// Test 1 & 2: LocalFormRendererService produces valid output
// ---------------------------------------------------------------------------

describe('LocalFormRendererService.renderTemplate', () => {
  let service: LocalFormRendererService;

  beforeAll(() => {
    // No constructor dependencies — instantiate directly.
    service = new LocalFormRendererService();
  });

  describe('mode: full_list', () => {
    it('returns a non-empty pdf_base64 string', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      expect(typeof result.pdf_base64).toBe('string');
      expect(result.pdf_base64.length).toBeGreaterThan(0);
    });

    it('pdf_base64 is valid base64 (decodes to a non-empty buffer)', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const decoded = Buffer.from(result.pdf_base64, 'base64');
      expect(decoded.length).toBeGreaterThan(0);
      // PDF files begin with the %PDF header.
      expect(decoded.slice(0, 4).toString('ascii')).toBe('%PDF');
    });

    it('roi_template has schema_version: omr-a5-v2', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['schema_version']).toBe('omr-a5-v2');
    });

    it('roi_template.mode matches input mode', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['mode']).toBe('full_list');
    });

    it('roi_template.orientation is "landscape" for full_list mode', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['orientation']).toBe('landscape');
    });

    it('roi_template passes controller schema_version validation check', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(['omr-a5-v1', 'omr-a5-v2']).toContain(geometry['schema_version']);
      expect(geometry['mode']).toBe('full_list');
    });

    it('roi_template.body contains full_list rows with bubble coordinates', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;
      const body = geometry['body'] as Record<string, unknown>;
      expect(body['type']).toBe('full_list');
      const rows = body['rows'] as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(CATALOG_ROWS.length);
      // Each row should have row_index and 5 bubbles (quantities 1–5).
      for (const row of rows) {
        const bubbles = row['bubbles'] as Array<Record<string, unknown>>;
        expect(Array.isArray(bubbles)).toBe(true);
        expect(bubbles).toHaveLength(5);
        for (const bubble of bubbles) {
          expect(typeof bubble['cx']).toBe('number');
          expect(typeof bubble['cy']).toBe('number');
          expect(typeof bubble['r']).toBe('number');
        }
      }
    });
  });

  describe('mode: code', () => {
    it('returns a non-empty pdf_base64 string', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      expect(typeof result.pdf_base64).toBe('string');
      expect(result.pdf_base64.length).toBeGreaterThan(0);
    });

    it('pdf_base64 is valid base64 that starts with %PDF', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const decoded = Buffer.from(result.pdf_base64, 'base64');
      expect(decoded.slice(0, 4).toString('ascii')).toBe('%PDF');
    });

    it('roi_template has schema_version: omr-a5-v2', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['schema_version']).toBe('omr-a5-v2');
    });

    it('roi_template.mode matches input mode', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['mode']).toBe('code');
    });

    it('roi_template.orientation is "portrait" for code mode', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(geometry['orientation']).toBe('portrait');
    });

    it('roi_template passes controller schema_version validation check', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const geometry = result.roi_template as Record<string, unknown>;
      expect(['omr-a5-v1', 'omr-a5-v2']).toContain(geometry['schema_version']);
      expect(geometry['mode']).toBe('code');
    });

    it('roi_template.body contains code order_lines with digit_boxes and qty_bubbles', async () => {
      const result = await service.renderTemplate(makeInput('code'));
      const geometry = result.roi_template as Record<string, unknown>;
      const body = geometry['body'] as Record<string, unknown>;
      expect(body['type']).toBe('code');
      const orderLines = body['order_lines'] as Array<Record<string, unknown>>;
      expect(Array.isArray(orderLines)).toBe(true);
      expect(orderLines.length).toBeGreaterThan(0);
      // Each order line has 3 digit boxes and 5 qty bubbles.
      for (const line of orderLines) {
        const digitBoxes = line['digit_boxes'] as Array<Record<string, unknown>>;
        const qtyBubbles = line['qty_bubbles'] as Array<Record<string, unknown>>;
        expect(digitBoxes).toHaveLength(3);
        expect(qtyBubbles).toHaveLength(5);
      }
    });
  });

  describe('roi_template common fields', () => {
    it('includes paper_size, page dimensions, registration_marks, qr_region, and template_revision', async () => {
      const result = await service.renderTemplate(makeInput('full_list'));
      const geometry = result.roi_template as Record<string, unknown>;

      expect(geometry['paper_size']).toBe('A5');
      expect(geometry['template_revision']).toBe('rev-test-1');

      const page = geometry['page'] as Record<string, unknown>;
      expect(typeof page['width']).toBe('number');
      expect(typeof page['height']).toBe('number');

      const marks = geometry['registration_marks'] as Array<unknown>;
      expect(Array.isArray(marks)).toBe(true);
      expect(marks).toHaveLength(4);

      const qr = geometry['qr_region'] as Record<string, unknown>;
      expect(typeof qr['x']).toBe('number');
      expect(typeof qr['y']).toBe('number');
      expect(typeof qr['width']).toBe('number');
      expect(typeof qr['height']).toBe('number');
    });
  });
});
