import sharp from 'sharp';
import { MarkRect } from '../omr/local-form-layout';

export type { MarkRect };

/** Output of the image pre-processing step. */
export interface ProcessedImage {
  /** Grayscale pixel buffer — 1 byte per pixel, row-major. */
  grayscale: Buffer;
  /** RGBA pixel buffer — 4 bytes per pixel, row-major. */
  rgba: Buffer;
  /** Pixel width of the processed image. */
  width: number;
  /** Pixel height of the processed image. */
  height: number;
  /** Pixels per PDF point used for coordinate mapping. */
  pxPerPt: number;
}

/** Target DPI for OMR recognition — balances accuracy against memory footprint. */
const TARGET_DPI = 150;

/** PDF points per inch (1 pt = 1/72 in). */
const PT_PER_INCH = 72;

/**
 * Decodes a base64 image and resizes it to ~150 DPI relative to the stated page dimensions.
 * Returns both grayscale and RGBA buffers for OMR and QR pipelines respectively.
 *
 * @param imageBase64           Base64-encoded image (JPEG, PNG, etc.).
 * @param expectedPageWidthPt   Expected page width in PDF points.
 * @param expectedPageHeightPt  Expected page height in PDF points.
 * @returns Processed image buffers and geometry metadata.
 */
export async function processImage(
  imageBase64: string,
  expectedPageWidthPt: number,
  expectedPageHeightPt: number,
): Promise<ProcessedImage> {
  const pxPerPt = TARGET_DPI / PT_PER_INCH;
  const targetWidth = Math.round(expectedPageWidthPt * pxPerPt);
  const targetHeight = Math.round(expectedPageHeightPt * pxPerPt);

  const inputBuffer = Buffer.from(imageBase64, 'base64');
  const base = sharp(inputBuffer).resize(targetWidth, targetHeight, { fit: 'fill' });

  const [grayscaleRaw, rgbaRaw] = await Promise.all([
    base.clone().grayscale().raw().toBuffer(),
    base.clone().ensureAlpha().raw().toBuffer(),
  ]);

  return {
    grayscale: grayscaleRaw,
    rgba: rgbaRaw,
    width: targetWidth,
    height: targetHeight,
    pxPerPt,
  };
}

/**
 * Locates registration marks within corner regions of a grayscale image.
 * Scans the bounding box of each expected mark, finds dark pixels (< 128),
 * and returns the centroid of each cluster.
 *
 * @param grayscale     Grayscale buffer (1 byte per pixel).
 * @param width         Image width in pixels.
 * @param height        Image height in pixels.
 * @param expectedMarks Expected mark rectangles in PDF-point coordinates.
 * @param pxPerPt       Pixels per PDF point for coordinate conversion.
 * @returns Array of centroids {cx, cy} in pixels, or null if any mark is not found.
 */
export function findRegistrationMarks(
  grayscale: Buffer,
  width: number,
  height: number,
  expectedMarks: MarkRect[],
  pxPerPt: number,
): Array<{ cx: number; cy: number }> | null {
  const centroids: Array<{ cx: number; cy: number }> = [];

  for (const mark of expectedMarks) {
    const x0 = Math.max(0, Math.floor(mark.x * pxPerPt));
    const y0 = Math.max(0, Math.floor(mark.y * pxPerPt));
    const markEnd = mark.x + mark.size;
    const markEndY = mark.y + mark.size;
    const x1 = Math.min(width - 1, Math.ceil(markEnd * pxPerPt));
    const y1 = Math.min(height - 1, Math.ceil(markEndY * pxPerPt));

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const intensity = grayscale[py * width + px];
        if (intensity !== undefined && intensity < 128) {
          sumX += px;
          sumY += py;
          count++;
        }
      }
    }

    if (count === 0) return null;

    centroids.push({ cx: sumX / count, cy: sumY / count });
  }

  return centroids;
}

/**
 * Computes mean pixel intensity in a circular region of a grayscale image.
 *
 * @param grayscale Grayscale buffer (1 byte per pixel).
 * @param width     Image width in pixels.
 * @param cx        Circle centre x in pixels.
 * @param cy        Circle centre y in pixels.
 * @param r         Circle radius in pixels.
 * @returns Mean intensity in range 0.0 (black) to 1.0 (white).
 */
export function meanIntensityInCircle(
  grayscale: Buffer,
  width: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const height = Math.floor(grayscale.length / width);
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));

  let sum = 0;
  let count = 0;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        const v = grayscale[py * width + px];
        if (v !== undefined) {
          sum += v;
          count++;
        }
      }
    }
  }

  if (count === 0) return 1.0;
  return sum / (count * 255);
}
