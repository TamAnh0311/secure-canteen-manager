export const MAX_ZONE_LENGTH = 255;

export function normalizeZone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
