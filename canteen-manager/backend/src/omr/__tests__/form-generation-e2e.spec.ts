/**
 * Integration test: verifies the full form generation flow works end-to-end.
 * Tests the LocalFormRenderer → controller validation → template activation path.
 */

import { LocalFormRendererService } from '../local-form-renderer';
import { canonicalGeometryHash } from '../../omr-forms/omr-form-templates.service';

describe('Form generation full flow', () => {
  const renderer = new LocalFormRendererService();

  describe('code mode', () => {
    it('generates a valid PDF that passes controller validation', async () => {
      const result = await renderer.renderTemplate({
        mode: 'code',
        template_revision: 'a5-code-test-001',
        catalog_rows: [],
      });

      // 1. Has PDF content
      expect(result.pdf_base64.length).toBeGreaterThan(100);
      const decoded = Buffer.from(result.pdf_base64, 'base64');
      expect(decoded.slice(0, 5).toString()).toBe('%PDF-');

      // 2. ROI template passes controller validation (menu.controller.ts:188)
      const geometry = result.roi_template as Record<string, unknown>;
      expect(['omr-a5-v1', 'omr-a5-v2']).toContain(geometry['schema_version']);
      expect(geometry['mode']).toBe('code');
      expect(geometry['orientation']).toBe('portrait');

      // 3. Geometry hash is deterministic and non-empty
      const hash = canonicalGeometryHash(result.roi_template);
      expect(hash).toHaveLength(64);
      // Same input → same hash
      const result2 = await renderer.renderTemplate({
        mode: 'code',
        template_revision: 'a5-code-test-001',
        catalog_rows: [],
      });
      expect(canonicalGeometryHash(result2.roi_template)).toBe(hash);
    });
  });

  describe('full_list mode', () => {
    const catalog = [
      { row_index: 0, menu_item_id: 'item-1', code_snapshot: '001', short_label: 'Com trang' },
      { row_index: 1, menu_item_id: 'item-2', code_snapshot: '002', short_label: 'Pho bo' },
      { row_index: 2, menu_item_id: 'item-3', code_snapshot: '003', short_label: 'Bun cha' },
    ];

    it('generates a valid PDF that passes controller validation', async () => {
      const result = await renderer.renderTemplate({
        mode: 'full_list',
        template_revision: 'a5-full-test-001',
        catalog_rows: catalog,
      });

      // 1. Has PDF content
      expect(result.pdf_base64.length).toBeGreaterThan(100);

      // 2. ROI template passes controller validation
      const geometry = result.roi_template as Record<string, unknown>;
      expect(['omr-a5-v1', 'omr-a5-v2']).toContain(geometry['schema_version']);
      expect(geometry['mode']).toBe('full_list');
      expect(geometry['orientation']).toBe('landscape');

      // 3. Body contains bubble geometry for scan processing
      const body = geometry['body'] as Record<string, unknown>;
      expect(body['type']).toBe('full_list');
      const rows = body['rows'] as Array<{ row_index: number; bubbles: Array<unknown> }>;
      expect(rows).toHaveLength(3);
      // Each row has 5 bubbles (qty 1-5)
      for (const row of rows) {
        expect(row.bubbles).toHaveLength(5);
      }
    });

    it('different catalog produces different geometry hash', async () => {
      const result1 = await renderer.renderTemplate({
        mode: 'full_list',
        template_revision: 'a5-full-test-v1',
        catalog_rows: catalog,
      });
      const result2 = await renderer.renderTemplate({
        mode: 'full_list',
        template_revision: 'a5-full-test-v2',
        catalog_rows: [...catalog, { row_index: 3, menu_item_id: 'item-4', code_snapshot: '004', short_label: 'Mi xao' }],
      });
      expect(canonicalGeometryHash(result1.roi_template))
        .not.toBe(canonicalGeometryHash(result2.roi_template));
    });
  });
});
