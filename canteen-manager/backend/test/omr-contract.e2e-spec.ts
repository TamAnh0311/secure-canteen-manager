/**
 * Backend ↔ OMR Service HTTP Contract Test (e2e)
 *
 * Proves the real backend ↔ omr-service handshake over HTTP:
 * - Backend generates a real form + ROI template via /generate-form
 * - Uses the committed synthetic raster as a calibration/no-token sheet
 * - Posts to real /process-scan endpoint
 * - Asserts the v3 form_token + items contract and fail-closed no-token behavior
 * - Validates /warp-sheet endpoint response format
 *
 * Requires: omr-service running on OMR_SERVICE_URL (default http://localhost:8000)
 * The old raster intentionally carries no QR; under a v3 calibration ROI it must be rejected
 * safely as QR_NOT_FOUND rather than falling back to its handwritten identity marks.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { OmrClientService } from '../src/omr/omr-client.service';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'verify-flow');

interface FixtureRoi extends Record<string, unknown> {
  template_width_px: number;
  template_height_px: number;
}

describe('Backend ↔ OMR Contract (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let omrClient: OmrClientService;
  let fixtureRoi: FixtureRoi;
  let fixturePng: Buffer;

  beforeAll(async () => {
    // Point to real omr-service (no override)
    process.env.OMR_SERVICE_URL = process.env.OMR_SERVICE_URL || 'http://localhost:8000';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    omrClient = moduleRef.get<OmrClientService>(OmrClientService);
    dataSource = moduleRef.get<DataSource>(DataSource);

    await dataSource.query('TRUNCATE TABLE menu_items CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    // Load committed fixture (verify-flow has a real synthetic sheet)
    fixturePng = fs.readFileSync(path.join(FIXTURE_DIR, 'verify-fixture.png'));
    const legacyRoi = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, 'verify-fixture-roi.json'), 'utf-8'),
    ) as FixtureRoi;
    fixtureRoi = {
      ...legacyRoi,
      roi_version: 'v3',
      digit_boxes: [],
      checkboxes: [],
      order_lines: [],
      qr_roi: null,
    };
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE TABLE menu_items CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await app.close();
  });

  describe('Real /process-scan handshake', () => {
    it('real personalized generation returns a v3 QR/order-line ROI without exposing token text', async () => {
      const token = '123e4567-e89b-42d3-a456-426614174000';
      const generated = await omrClient.generateForm({
        menu_items: [],
        digit_box_count: 0,
        paper_size: 'A4',
        sheet_id_mode: 'none',
        personalization: {
          form_token: token,
          short_serial: '123E4567',
          service_date: '2026-07-15',
          name: 'Synthetic Contract User',
          prison_id: 'SYNTH-004218',
          zone: 'Zone A',
          cell: 'A-12',
        },
      });
      const roi = generated.roi_template as {
        roi_version: string;
        qr_roi: object | null;
        digit_boxes: unknown[];
        checkboxes: unknown[];
        order_lines: unknown[];
      };

      expect(roi.roi_version).toBe('v3');
      expect(roi.qr_roi).not.toBeNull();
      expect(roi.digit_boxes).toEqual([]);
      expect(roi.checkboxes).toEqual([]);
      expect(roi.order_lines.length).toBeGreaterThan(0);
      const pdf = Buffer.from(generated.pdf_base64, 'base64');
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.includes(Buffer.from(token))).toBe(false);
    });

    it('schema validates and a v3 sheet without QR fails closed as QR_NOT_FOUND', async () => {
      const imageBase64 = fixturePng.toString('base64');

      // Post to real /process-scan endpoint via backend's OmrClientService
      const result = await omrClient.processScan({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
        omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
        icr_threshold: 0.85,
        digit_box_count: 0,
      });

      // Assert schema shape matches expected contract
      expect(result).toBeDefined();
      expect(result.form_token).toBeNull();
      expect(result.recognized_id).toBeNull();
      expect(Array.isArray(result.id_digits)).toBe(true);
      expect(Array.isArray(result.order_lines)).toBe(true);
      expect(typeof result.avg_confidence).toBe('number');
      expect(Array.isArray(result.flags)).toBe(true);
      expect(typeof result.warp_ok).toBe('boolean');

      expect(result.id_digits).toEqual([]);
      expect(result.flags).toContain('QR_NOT_FOUND');

      // avg_confidence in valid range
      expect(result.avg_confidence).toBeGreaterThanOrEqual(0);
      expect(result.avg_confidence).toBeLessThanOrEqual(1);

      // Fixture should warp cleanly (it's synthetic in template space)
      expect(result.warp_ok).toBe(true);
    });

    it('same no-token sheet deterministically returns no form authority', async () => {
      const imageBase64 = fixturePng.toString('base64');

      const result1 = await omrClient.processScan({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
        omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
        icr_threshold: 0.85,
        digit_box_count: 0,
      });

      const result2 = await omrClient.processScan({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
        omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
        icr_threshold: 0.85,
        digit_box_count: 0,
      });

      // Same image should yield deterministic result
      expect(result1.form_token).toBeNull();
      expect(result2.form_token).toBeNull();
      expect(result2.flags).toEqual(result1.flags);
      expect(result2.order_lines).toEqual(result1.order_lines);
    });

    it('v3 ignores handwritten legacy identity boxes instead of reconstructing an ID', async () => {
      const imageBase64 = fixturePng.toString('base64');

      const result = await omrClient.processScan({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
        omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
        icr_threshold: 0.85,
        digit_box_count: 0,
      });

      expect(result.recognized_id).toBeNull();
      expect(result.id_digits).toEqual([]);
      expect(result.form_token).toBeNull();
    });

    it('/warp-sheet response includes valid image + metadata', async () => {
      const imageBase64 = fixturePng.toString('base64');

      const result = await omrClient.warpSheet({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
      });

      // Assert schema
      expect(result).toBeDefined();
      expect(typeof result.warped_image_base64).toBe('string');
      expect(typeof result.template_width_px).toBe('number');
      expect(typeof result.template_height_px).toBe('number');
      expect(typeof result.warp_ok).toBe('boolean');

      // Warped image should be valid base64 (decodable)
      expect(result.warped_image_base64.length).toBeGreaterThan(0);
      const buffer = Buffer.from(result.warped_image_base64, 'base64');
      expect(buffer.length).toBeGreaterThan(0);

      // Template dimensions should match ROI
      expect(result.template_width_px).toBe(fixtureRoi.template_width_px);
      expect(result.template_height_px).toBe(fixtureRoi.template_height_px);

      // Fixture should warp cleanly
      expect(result.warp_ok).toBe(true);
    });

    it('order_lines array is present in the v3 response contract', async () => {
      const imageBase64 = fixturePng.toString('base64');

      const result = await omrClient.processScan({
        image_base64: imageBase64,
        roi_template: fixtureRoi,
        omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
        icr_threshold: 0.85,
        digit_box_count: 0,
      });

      // Calibration/no-token input has no marked lines, but the contract is always present.
      expect(Array.isArray(result.order_lines)).toBe(true);
    });
  });
});
