/**
 * bubble-reader.spec.ts
 *
 * Unit tests for readFullListBubbles() and the meanIntensityInCircle() helper.
 *
 * All tests work with synthetic in-memory pixel buffers — no file I/O or
 * external dependencies are required.
 */

import { readFullListBubbles } from '../bubble-reader';
import { meanIntensityInCircle } from '../image-processor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a grayscale buffer filled with a single intensity byte (0–255). */
function solidGrayscale(width: number, height: number, fill: number): Buffer {
  return Buffer.alloc(width * height, fill);
}

/**
 * Paints a dark circle into an existing grayscale buffer in-place.
 * All pixels within radius r of (cx, cy) are set to `fill`.
 * Returns the same buffer for chaining convenience.
 */
function paintDarkCircle(
  buf: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
  fill: number,
): Buffer {
  const r2 = r * r;
  for (let py = Math.max(0, Math.floor(cy - r)); py <= Math.min(height - 1, Math.ceil(cy + r)); py++) {
    for (let px = Math.max(0, Math.floor(cx - r)); px <= Math.min(width - 1, Math.ceil(cx + r)); px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        buf[py * width + px] = fill;
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// meanIntensityInCircle — direct tests
// ---------------------------------------------------------------------------

describe('meanIntensityInCircle', () => {
  const W = 100;
  const H = 100;

  it('returns ~1.0 for an all-white buffer', () => {
    const buf = solidGrayscale(W, H, 255);
    const intensity = meanIntensityInCircle(buf, W, 50, 50, 10);
    expect(intensity).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.0 for an all-black buffer', () => {
    const buf = solidGrayscale(W, H, 0);
    const intensity = meanIntensityInCircle(buf, W, 50, 50, 10);
    expect(intensity).toBeCloseTo(0.0, 2);
  });

  it('returns ~0.5 for a mid-grey (128) buffer', () => {
    const buf = solidGrayscale(W, H, 128);
    const intensity = meanIntensityInCircle(buf, W, 50, 50, 10);
    // 128 / 255 ≈ 0.502
    expect(intensity).toBeGreaterThan(0.48);
    expect(intensity).toBeLessThan(0.52);
  });

  it('returns 1.0 when circle is entirely outside the image bounds', () => {
    const buf = solidGrayscale(W, H, 0);
    // Centre far outside — no pixels hit.
    const intensity = meanIntensityInCircle(buf, W, 500, 500, 5);
    expect(intensity).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// readFullListBubbles — all-white image (no ticks)
// ---------------------------------------------------------------------------

describe('readFullListBubbles — all-white image', () => {
  const W = 200;
  const H = 200;
  const PX_PER_PT = 1;
  const THRESHOLDS = { omrEmptyMax: 0.3, omrTickedMin: 0.5 };

  it('returns zero detections when every bubble region is white', () => {
    const grayscale = solidGrayscale(W, H, 255);

    const bubbles = [
      { row_index: 0, menu_item_id: 'item-1', quantity: 1, cx: 50, cy: 50, r: 8 },
      { row_index: 0, menu_item_id: 'item-1', quantity: 2, cx: 70, cy: 50, r: 8 },
      { row_index: 1, menu_item_id: 'item-2', quantity: 1, cx: 50, cy: 80, r: 8 },
    ];

    const { detections, warnings } = readFullListBubbles(grayscale, W, bubbles, PX_PER_PT, THRESHOLDS);
    expect(detections).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readFullListBubbles — single darkened bubble
// ---------------------------------------------------------------------------

describe('readFullListBubbles — single darkened bubble', () => {
  const W = 200;
  const H = 200;
  const PX_PER_PT = 1;
  // Low intensity fill = 20 → 20/255 ≈ 0.078, fill = 1 - 0.078 = 0.922 ≥ tickedMin
  const THRESHOLDS = { omrEmptyMax: 0.3, omrTickedMin: 0.5 };

  it('detects the darkened bubble with correct quantity and high confidence', () => {
    // Paint qty=2 bubble very dark (intensity ~0.08, fill ~0.92 — clearly ticked).
    const cx = 70;
    const cy = 50;
    const r = 8;
    const grayscale = paintDarkCircle(solidGrayscale(W, H, 255), W, H, cx, cy, r, 20);

    const bubbles = [
      { row_index: 0, menu_item_id: 'item-1', quantity: 1, cx: 50, cy: 50, r: 8 },
      { row_index: 0, menu_item_id: 'item-1', quantity: 2, cx, cy, r },
      { row_index: 0, menu_item_id: 'item-1', quantity: 3, cx: 90, cy: 50, r: 8 },
    ];

    const { detections, warnings } = readFullListBubbles(grayscale, W, bubbles, PX_PER_PT, THRESHOLDS);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.menu_item_id).toBe('item-1');
    expect(detections[0]?.quantity).toBe(2);
    expect(detections[0]?.confidence).toBe('high');
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readFullListBubbles — multiple ticked bubbles in same row
// ---------------------------------------------------------------------------

describe('readFullListBubbles — multiple ticked bubbles in same row', () => {
  const W = 300;
  const H = 200;
  const PX_PER_PT = 1;
  const THRESHOLDS = { omrEmptyMax: 0.3, omrTickedMin: 0.5 };

  it('picks the highest quantity and emits a warning when multiple bubbles are ticked', () => {
    // Paint both qty=1 (cx=50) and qty=3 (cx=90) bubbles very dark on the same buffer.
    const grayscale = solidGrayscale(W, H, 255);
    paintDarkCircle(grayscale, W, H, 50, 50, 8, 20);
    paintDarkCircle(grayscale, W, H, 90, 50, 8, 20);

    const bubbles = [
      { row_index: 0, menu_item_id: 'item-1', quantity: 1, cx: 50, cy: 50, r: 8 },
      { row_index: 0, menu_item_id: 'item-1', quantity: 2, cx: 70, cy: 50, r: 8 },  // white
      { row_index: 0, menu_item_id: 'item-1', quantity: 3, cx: 90, cy: 50, r: 8 },
    ];

    const { detections, warnings } = readFullListBubbles(grayscale, W, bubbles, PX_PER_PT, THRESHOLDS);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.quantity).toBe(3);
    expect(detections[0]?.confidence).toBe('high');

    // Must emit exactly one multi-ticked warning.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/multiple ticked/i);
  });
});

// ---------------------------------------------------------------------------
// readFullListBubbles — independent rows
// ---------------------------------------------------------------------------

describe('readFullListBubbles — independent rows', () => {
  const W = 200;
  const H = 200;
  const PX_PER_PT = 1;
  const THRESHOLDS = { omrEmptyMax: 0.3, omrTickedMin: 0.5 };

  it('produces one detection per row that has a ticked bubble and skips empty rows', () => {
    // Row 0: qty=1 ticked. Row 1: all white (skip). Row 2: qty=5 ticked.
    const grayscale = solidGrayscale(W, H, 255);
    paintDarkCircle(grayscale, W, H, 30, 40, 7, 15);  // row 0, qty 1
    paintDarkCircle(grayscale, W, H, 30, 120, 7, 15); // row 2, qty 5

    const bubbles = [
      // Row 0
      { row_index: 0, menu_item_id: 'item-a', quantity: 1, cx: 30, cy: 40, r: 7 },
      // Row 1 — all white, nothing ticked
      { row_index: 1, menu_item_id: 'item-b', quantity: 1, cx: 30, cy: 80, r: 7 },
      // Row 2
      { row_index: 2, menu_item_id: 'item-c', quantity: 5, cx: 30, cy: 120, r: 7 },
    ];

    const { detections, warnings } = readFullListBubbles(grayscale, W, bubbles, PX_PER_PT, THRESHOLDS);

    const ids = detections.map((d) => d.menu_item_id);
    expect(ids).toContain('item-a');
    expect(ids).not.toContain('item-b');
    expect(ids).toContain('item-c');
    expect(detections).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });
});
