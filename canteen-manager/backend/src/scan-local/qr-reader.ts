import jsQR from 'jsqr';

/** Structured data encoded in a canteen order-form QR code. */
export interface FormQrData {
  /** One-time token identifying the issued form. */
  token: string;
  /** Template revision that this form was printed from. */
  revision: string;
  /** Scanning mode: 'code' = ICR digit entry, 'full_list' = bubble sheet. */
  mode: 'code' | 'full_list';
}

/**
 * Scans RGBA pixel data for a QR code and decodes the canteen form payload.
 *
 * @param data   Raw RGBA buffer (4 bytes per pixel, row-major).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns Decoded FormQrData, or null if no valid QR is found.
 */
export function readFormQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FormQrData | null {
  const result = jsQR(data, width, height);
  if (!result) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(result.data);
  } catch {
    return null;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).t !== 'string' ||
    typeof (payload as Record<string, unknown>).r !== 'string' ||
    typeof (payload as Record<string, unknown>).m !== 'string'
  ) {
    return null;
  }

  const p = payload as { t: string; r: string; m: string };
  if (p.m !== 'code' && p.m !== 'full_list') return null;

  return { token: p.t, revision: p.r, mode: p.m };
}
