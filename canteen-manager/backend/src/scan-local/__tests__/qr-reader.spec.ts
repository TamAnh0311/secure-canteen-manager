/**
 * qr-reader.spec.ts
 *
 * Unit tests for readFormQr().
 *
 * These tests cover the error-path contracts: invalid/empty input always returns
 * null. We do not attempt to generate actual QR pixel data in unit tests because
 * that would make this a rendering integration test rather than a function test.
 */

import { readFormQr } from '../qr-reader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a solid RGBA buffer of the given size. */
function solidRgba(width: number, height: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4 + 0] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// readFormQr — error/null-path tests
// ---------------------------------------------------------------------------

describe('readFormQr', () => {
  it('returns null for an all-white image (no QR code present)', () => {
    const data = solidRgba(100, 100, 255, 255, 255, 255);
    const result = readFormQr(data, 100, 100);
    expect(result).toBeNull();
  });

  it('returns null for an all-black image', () => {
    const data = solidRgba(100, 100, 0, 0, 0, 255);
    const result = readFormQr(data, 100, 100);
    expect(result).toBeNull();
  });

  it('returns null for a 1×1 pixel image', () => {
    const data = solidRgba(1, 1, 128, 128, 128, 255);
    const result = readFormQr(data, 1, 1);
    expect(result).toBeNull();
  });

  it('returns null for a zero-dimension image (0×0)', () => {
    const data = new Uint8ClampedArray(0);
    const result = readFormQr(data, 0, 0);
    expect(result).toBeNull();
  });

  it('returns null for random noise (no recognisable QR pattern)', () => {
    const width = 50;
    const height = 50;
    const buf = new Uint8ClampedArray(width * height * 4);
    // Fill with alternating random-ish values — no valid QR structure.
    for (let i = 0; i < buf.length; i++) {
      buf[i] = (i * 37 + 13) % 256;
    }
    const result = readFormQr(buf, width, height);
    expect(result).toBeNull();
  });
});
