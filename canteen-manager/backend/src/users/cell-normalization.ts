export const CELL_NORMALIZATION_VERSION = 1;

export interface NormalizedCellValue {
  value: string | null;
  version: number;
}

// Cell labels are operational identifiers, not prose. NFKC folds width variants,
// Vietnamese-aware upper-casing removes case drift, and punctuation/spacing is ignored.
export function normalizeCellV1(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = raw
    .normalize('NFKC')
    .toLocaleUpperCase('vi-VN')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return normalized || null;
}

export function normalizeCell(raw: string | null | undefined): NormalizedCellValue {
  return { value: normalizeCellV1(raw), version: CELL_NORMALIZATION_VERSION };
}
