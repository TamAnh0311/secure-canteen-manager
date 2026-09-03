const safeRasterMediaTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function isSafeScannerRasterMediaType(mediaType: string): boolean {
  return safeRasterMediaTypes.has(mediaType.toLowerCase());
}

export function isSafeScannerOriginalMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase() === 'application/pdf' || isSafeScannerRasterMediaType(mediaType);
}
